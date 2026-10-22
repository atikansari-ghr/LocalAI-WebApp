import posix from 'node:path/posix';
import {inspectDocument} from './validation.mjs';
import {readOpenDocumentZip} from './containers.mjs';
import {officeContext,xmlTree,children,one,walk,attr,fail} from './office-xml.mjs';
const O='urn:oasis:names:tc:opendocument:xmlns:office:1.0',T='urn:oasis:names:tc:opendocument:xmlns:text:1.0',TABLE='urn:oasis:names:tc:opendocument:xmlns:table:1.0',D='urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',M='urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',X='http://www.w3.org/1999/xlink';
const KINDS={odt:'text',ods:'spreadsheet',odp:'presentation'};
function repeat(value){if(value===undefined)return 1;if(!/^[1-9][0-9]*$/.test(value)||Number(value)>10000)fail('opendocument_repeat_limit');return Number(value);}
async function inspectOpenDocument(input,options={}){
 const document=inspectDocument(input),kind=KINDS[document.format];if(!kind)fail('opendocument_parser_unavailable');const bytes=Buffer.from(input.bytes),media='application/vnd.oasis.opendocument.'+kind;
 if(bytes.length<38||bytes.readUInt16LE(8)!==0||bytes.readUInt16LE(26)!==8||bytes.readUInt16LE(28)!==0||bytes.subarray(30,38).toString()!=='mimetype')fail('opendocument_mimetype_invalid');
 const archive=await readOpenDocumentZip({name:'document.zip',bytes},options),parts=new Map(archive.entries.filter(p=>!p.directory).map(p=>[p.path,p]));if(archive.entries[0]?.path!=='mimetype'||!parts.get('mimetype')?.content.equals(Buffer.from(media))||!parts.has('content.xml')||!parts.has('META-INF/manifest.xml'))fail('opendocument_package_invalid');
 const started=performance.now(),check=()=>{if(options.signal?.aborted)fail('archive_cancelled');if(performance.now()-started>Math.min(options.limits?.timeoutMs??10000,10000))fail('archive_timeout');};
 const trees=new Map();
 function inspect(part){
  check();const root=xmlTree(part,check);for(const node of walk(root)){
   if(node.ns===M&&node.local==='encryption-data')fail('encrypted_document_unsupported');
   if(node.ns==='urn:oasis:names:tc:opendocument:xmlns:script:1.0'||(node.ns===O&&['script','forms','dde-source'].includes(node.local))||(node.ns===D&&['object','object-ole','plugin','applet','floating-frame'].includes(node.local)))fail('opendocument_active_content_forbidden');
   for(const attribute of node.attributes){if(attribute.uri===X&&attribute.local==='href'){
    const value=attribute.value;if(value.startsWith('#'))continue;if(!value||/[\\:%?#\u0000-\u0020]/u.test(value)||value.startsWith('/'))fail('opendocument_external_reference_forbidden');const target=posix.normalize(posix.join(posix.dirname(part.path),value));if(target.startsWith('../')||!parts.has(target))fail('opendocument_reference_missing');
   }}
  }trees.set(part.path,root);return root;
 }
 for(const part of parts.values()){if(/^(?:Basic|Scripts)\//i.test(part.path))fail('opendocument_active_content_forbidden');if(/\.xml$/i.test(part.path))inspect(part);}
 const manifest=trees.get('META-INF/manifest.xml');if(manifest?.ns!==M||manifest.local!=='manifest')fail('opendocument_manifest_invalid');const declared=new Map();
 for(const entry of manifest.children){if(entry.ns!==M||entry.local!=='file-entry')fail('opendocument_manifest_invalid');const name=attr(entry,'full-path',M),type=attr(entry,'media-type',M);if(!name||type===undefined||declared.has(name))fail('opendocument_manifest_invalid');declared.set(name,type);
  if(name==='/'){if(type!==media)fail('opendocument_manifest_invalid');continue;}
  if(name==='mimetype'||name.startsWith('META-INF/')||!parts.has(name))fail('opendocument_manifest_invalid');if(/(?:\+xml|\/xml)$/i.test(type)&&!trees.has(name))inspect(parts.get(name));
 }
 if(!declared.has('/'))fail('opendocument_manifest_invalid');for(const part of parts.values())if(part.path!=='mimetype'&&!part.path.startsWith('META-INF/')&&!declared.has(part.path))fail('opendocument_manifest_invalid');
 const root=trees.get('content.xml');if(root?.ns!==O||root.local!=='document-content')fail('opendocument_content_invalid');check();return {document,parts:[...parts.values()],mainPart:'content.xml'};
}
export async function parseOpenDocument(input,options={}){
 const format=inspectDocument(input).format,ctx=await officeContext(input,options,format,inspectOpenDocument),root=ctx.read('content.xml'),body=one(root,O,'body'),content=body&&one(body,O,KINDS[format]);if(!content)fail('opendocument_body_invalid');
 const warnings=new Set(['opendocument_source_order_not_rendered_layout','opendocument_styles_media_and_annotations_not_extracted','opendocument_fields_and_formulas_not_evaluated']);
 const skipped=node=>(node.ns===O&&node.local==='annotation')||(node.ns===T&&['note','tracked-changes','deletion'].includes(node.local));
 function paragraphs(node){const list=[];function visit(n){if(skipped(n))return;if(n.ns===T&&['p','h'].includes(n.local)){list.push(n);return;}for(const child of n.children)visit(child);}visit(node);return list;}
 function render(node,metadata={},charge=true){
  const output=[],units=[];let size=0;const add=(text,source)=>{size+=Buffer.byteLength(text);if(size>1024**2)fail('text_output_limit');if(units.length>=10000)fail('text_unit_limit');if(charge)ctx.add(text);output.push(text);units.push(Object.freeze({text,source:Object.freeze({...source,...metadata})}));};
  function inline(n){ctx.check();for(const item of n.sequence){if(item.unit){add(item.unit.text,item.unit.source);continue;}const child=item.node;if(skipped(child))continue;
   if(child.ns!==T){warnings.add('opendocument_inline_content_omitted');continue;}
   if(child.local==='s'){add(' '.repeat(repeat(attr(child,'c',T))),ctx.source('content.xml',child));continue;}if(['tab','line-break'].includes(child.local)){add(child.local==='tab'?'\t':'\n',ctx.source('content.xml',child));continue;}
   if(['span','a','bookmark','bookmark-start','bookmark-end','reference-mark','reference-mark-start','reference-mark-end'].includes(child.local))inline(child);else warnings.add('opendocument_inline_content_omitted');
  }}
  for(const para of paragraphs(node)){inline(para);if(charge)ctx.add('\n',0);output.push('\n');}return {text:output.join(''),units};
 }
 if(format==='odt'){const result=render(content);return Object.freeze({document:ctx.pkg.document,parser:'opendocument-literal-v1',text:result.text,units:Object.freeze(result.units),warnings:Object.freeze([...warnings])});}
 if(format==='odp'){
  const pages=[];for(const page of children(content,D,'page')){if(pages.length)ctx.add('\n',0);const result=render(page,{page:pages.length+1,pageName:attr(page,'name',D)??''});pages.push(Object.freeze({index:pages.length+1,text:result.text,units:Object.freeze(result.units)}));}return Object.freeze({document:ctx.pkg.document,parser:'opendocument-literal-v1',text:pages.map(p=>p.text).join('\n'),pages:Object.freeze(pages),warnings:Object.freeze([...warnings])});
 }
 const cells=[],output=[];let expandedRows=0;for(const table of children(content,TABLE,'table')){
  const name=attr(table,'name',TABLE)??'';let rowIndex=0;
  const rows=[];function collectRows(node){for(const child of node.children)if(child.ns===TABLE){if(child.local==='table-row')rows.push(child);else if(['table-header-rows','table-rows','table-row-group'].includes(child.local))collectRows(child);}}collectRows(table);
  for(const row of rows){const rowRepeat=repeat(attr(row,'number-rows-repeated',TABLE));for(let copy=0;copy<rowRepeat;copy++){
   ctx.check();rowIndex++;if(++expandedRows>10000||rowIndex>10000)fail('opendocument_repeat_limit');let column=0;
   for(const cell of row.children.filter(n=>n.ns===TABLE&&['table-cell','covered-table-cell'].includes(n.local))){const count=repeat(attr(cell,'number-columns-repeated',TABLE)),result=render(cell,{},false),formula=attr(cell,'formula',TABLE),type=attr(cell,'value-type',O),raw=attr(cell,'value',O)??attr(cell,'string-value',O)??attr(cell,'date-value',O)??attr(cell,'time-value',O)??attr(cell,'boolean-value',O),text=result.text.endsWith('\n')?result.text.slice(0,-1):result.text,value=text||raw||(formula??'');
    for(let index=0;index<count;index++){if(++column>10000||cells.length>=10000)fail('opendocument_repeat_limit');const rendered=name+'!R'+rowIndex+'C'+column+'\t'+value+'\n';ctx.add(rendered,result.units.length+1);output.push(rendered);cells.push(Object.freeze({text:value,...(type?{type}:{}),...(formula?{formula,cached:raw!==undefined||Boolean(text)}:{}),source:Object.freeze({...ctx.source('content.xml',cell),sheet:name,row:rowIndex,column}),valueSources:Object.freeze(result.units)}));}
   }
  }}
 }
 return Object.freeze({document:ctx.pkg.document,parser:'opendocument-literal-v1',text:output.join(''),cells:Object.freeze(cells),warnings:Object.freeze([...warnings])});
}
