import {createRequire} from 'node:module';
import posix from 'node:path/posix';
import {inspectDocument,decodeDocumentUtf8,DocumentError} from './validation.mjs';
import {readOfficeZipDocument} from './containers.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),{SaxesParser}=require('saxes');
const CT='http://schemas.openxmlformats.org/package/2006/content-types',REL='http://schemas.openxmlformats.org/package/2006/relationships',OFF='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FAMILIES={docx:{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',root:'document',ns:'http://schemas.openxmlformats.org/wordprocessingml/2006/main'},xlsx:{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',root:'workbook',ns:'http://schemas.openxmlformats.org/spreadsheetml/2006/main'},pptx:{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',root:'presentation',ns:'http://schemas.openxmlformats.org/presentationml/2006/main'}};
const fail=code=>{throw new DocumentError(code);};
function xml(bytes){
 if(bytes.length>1024**2)fail('office_xml_limit');const text=decodeDocumentUtf8(bytes),parser=new SaxesParser({xmlns:true}),elements=[];let depth=0;
 parser.on('doctype',()=>fail('xml_doctype_forbidden'));parser.on('error',()=>fail('invalid_xml'));
 parser.on('opentag',tag=>{if(++depth>32||elements.length>=10000||Object.keys(tag.attributes).length>256)fail('markup_structure_limit');const attrs={};for(const attr of Object.values(tag.attributes))if(!attr.uri)attrs[attr.local]=attr.value;elements.push({local:tag.local,uri:tag.uri,depth,attrs});});
 parser.on('closetag',()=>depth--);try{parser.write(text).close();}catch(error){if(error instanceof DocumentError)throw error;fail('invalid_xml');}return elements;
}
function targetPath(value,base=''){
 if(typeof value!=='string'||!value||/[\\:%?#\u0000-\u0020]/u.test(value)||value.startsWith('//'))fail('office_unsafe_target');
 const result=posix.normalize(value.startsWith('/')?value.slice(1):posix.join(base,value));if(result==='..'||result.startsWith('../')||result==='.'||result.endsWith('/'))fail('office_unsafe_target');return result;
}
function forbidden(value){return /macroenabled|vbaproject|activex|oleobject|embeddings|externallink|attachedtemplate|afchunk/i.test(value);}
export async function inspectOfficePackage(input,options={}){
 const document=inspectDocument(input),family=FAMILIES[document.format];if(!family)fail('office_parser_unavailable');
 const started=performance.now(),archive=await readOfficeZipDocument({name:'package.zip',bytes:Buffer.from(input.bytes)},options),parts=new Map(archive.entries.filter(p=>!p.directory).map(p=>[p.path,p])),trees=new Map();
 const check=()=>{if(options.signal?.aborted)fail('archive_cancelled');if(performance.now()-started>Math.min(options.limits?.timeoutMs??10000,10000))fail('archive_timeout');};
 for(const part of parts.values()){
  check();if(forbidden(part.path))fail('office_active_content_forbidden');
  if(/\.(xml|rels)$/i.test(part.path))trees.set(part.path,xml(part.content));
 }
 const types=trees.get('[Content_Types].xml');if(!types||types[0]?.local!=='Types'||types[0].uri!==CT)fail('office_content_types_invalid');
 const defaults=new Map(),overrides=new Map();
 for(const tag of types.slice(1)){
  if(tag.depth!==2||tag.uri!==CT||!['Default','Override'].includes(tag.local))fail('office_content_types_invalid');
  const type=tag.attrs.ContentType?.toLowerCase();if(!type||forbidden(type))fail('office_active_content_forbidden');
  if(tag.local==='Default'){const key=tag.attrs.Extension;if(!key||!/^[a-z0-9]+$/.test(key)||defaults.has(key))fail('office_content_types_invalid');defaults.set(key,type);}
  else{const name=tag.attrs.PartName;if(!name?.startsWith('/'))fail('office_content_types_invalid');const key=targetPath(name);if('/'+key!==name||!parts.has(key)||overrides.has(key))fail('office_content_types_invalid');overrides.set(key,type);}
 }
 for(const part of parts.values()){if(part.path==='[Content_Types].xml')continue;const type=overrides.get(part.path)??defaults.get(part.path.slice(part.path.lastIndexOf('.')+1));if(!type)fail('office_content_type_missing');if(/openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$|application\/zip/i.test(type))fail('office_embedded_package_forbidden');if(/(?:\+xml|\/xml)$/i.test(type)&&!trees.has(part.path))trees.set(part.path,xml(part.content));if(part.path.endsWith('.rels')&&type!=='application/vnd.openxmlformats-package.relationships+xml')fail('office_content_types_invalid');}
 let main;
 for(const [name,tags]of trees){
  const media=overrides.get(name)??defaults.get(name.slice(name.lastIndexOf('.')+1));if(!/\.rels$/i.test(name)&&media!=='application/vnd.openxmlformats-package.relationships+xml')continue;check();if(!name.endsWith('.rels'))fail('office_relationships_invalid');
  if(tags[0]?.local!=='Relationships'||tags[0].uri!==REL)fail('office_relationships_invalid');
  let owner='';if(name!=='_rels/.rels'){const match=name.match(/^(.*\/)?_rels\/([^/]+)\.rels$/);if(!match)fail('office_relationships_invalid');owner=(match[1]??'')+match[2];if(!parts.has(owner))fail('office_relationships_invalid');}
  const ids=new Set();for(const tag of tags.slice(1)){
   const {Id,Type,Target,TargetMode}=tag.attrs;if(tag.depth!==2||tag.local!=='Relationship'||tag.uri!==REL||!Id||ids.has(Id)||!Type)fail('office_relationships_invalid');ids.add(Id);
   if(TargetMode&&TargetMode!=='Internal')fail('office_external_reference_forbidden');if(forbidden(Type))fail('office_active_content_forbidden');const target=targetPath(Target,posix.dirname(owner)==='.'?'':posix.dirname(owner));if(!parts.has(target))fail('office_relationship_target_missing');
   if(name==='_rels/.rels'&&Type===OFF){if(main)fail('office_main_part_invalid');main=target;}
  }
 }
 if(!main||overrides.get(main)!==family.type)fail('office_main_part_invalid');const root=trees.get(main)?.[0];if(!root||root.local!==family.root||root.uri!==family.ns)fail('office_main_part_invalid');check();
 return Object.freeze({document,validation:'office-package-policy-passed',mainPart:main,parts:Object.freeze([...parts.values()]),warnings:Object.freeze(['office_schema_and_text_extraction_pending'])});
}
