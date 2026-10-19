import {createRequire} from 'node:module';
import {inspectOfficePackage} from './office.mjs';
import {parseMarkupDocument} from './markup.mjs';
import {DocumentError,decodeDocumentUtf8} from './validation.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),{SaxesParser}=require('saxes');
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const BLOCKED=new Set(['del','moveFrom','drawing','pict','object','txbxContent','altChunk']);
const fail=code=>{throw new DocumentError(code);};
export async function parseWordDocument(input,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['signal','limits','maxTextBytes'].includes(key)))fail('invalid_word_options');
 const max=options.maxTextBytes??1024**2;if(!Number.isSafeInteger(max)||max<1||max>1024**2)fail('invalid_word_limits');
 const started=performance.now(),timeout=options.limits?.timeoutMs??10000;
 const check=()=>{if(options.signal?.aborted)fail('archive_cancelled');if(performance.now()-started>Math.min(timeout,10000))fail('archive_timeout');};
 const archive=await inspectOfficePackage(input,{...(options.signal?{signal:options.signal}:{}),...(options.limits?{limits:options.limits}:{})});
 if(archive.document.format!=='docx')fail('word_parser_unavailable');check();
 const main=archive.parts.find(part=>part.path===archive.mainPart),source=decodeDocumentUtf8(main.content),markup=parseMarkupDocument({name:'part.xml',bytes:main.content});
 const byPath=new Map();for(const unit of markup.units){const list=byPath.get(unit.source.path)??[];list.push(unit);byPath.set(unit.source.path,list);}
 const stack=[],roots=new Map(),events=[],hidden=new Set(),warnings=new Set(['word_main_body_only','word_source_order_not_page_layout','word_styles_not_resolved']);let paragraph=0,run=0;
 const parser=new SaxesParser({xmlns:true});parser.on('error',()=>fail('invalid_xml'));
 parser.on('opentag',tag=>{
  check();const parent=stack.at(-1),siblings=parent?.children??roots,ordinal=(siblings.get(tag.name)??0)+1;siblings.set(tag.name,ordinal);
  const word=tag.uri===NS,path=(parent?.path??'')+'/'+tag.name+'['+ordinal+']',blocked=Boolean(parent?.blocked)||!word||BLOCKED.has(tag.local);
  if(!word||BLOCKED.has(tag.local))warnings.add('word_nonbody_or_embedded_content_not_extracted');
  if(word&&['del','moveFrom'].includes(tag.local))warnings.add('word_deleted_content_omitted');
  if(word&&['instrText','fldChar','fldSimple'].includes(tag.local))warnings.add('word_fields_not_recalculated');
  const body=Boolean(parent?.body)||(word&&tag.local==='body'&&stack.length===1&&parent?.local==='document'),frame={path,local:tag.local,word,body,blocked,children:new Map(),paragraph:parent?.paragraph,run:parent?.run,runPath:parent?.runPath};
  if(!blocked&&body&&tag.local==='p')frame.paragraph=++paragraph;
  if(!blocked&&body&&tag.local==='r'){frame.run=++run;frame.runPath=path;}
  if(word&&['vanish','webHidden'].includes(tag.local)&&frame.runPath){const value=Object.values(tag.attributes).find(a=>a.uri===NS&&a.local==='val')?.value;if(!['0','false','off'].includes(value)){hidden.add(frame.runPath);warnings.add('word_direct_hidden_runs_omitted');}}
  if(!blocked&&body&&frame.paragraph&&parent?.word&&parent.local==='r'){
   if(tag.local==='t')events.push({kind:'text',path,paragraph:frame.paragraph,run:frame.run,runPath:frame.runPath});
   if(['tab','br','cr'].includes(tag.local))events.push({kind:'separator',text:tag.local==='tab'?'\t':'\n',path,paragraph:frame.paragraph,run:frame.run,runPath:frame.runPath});
  }
  stack.push(frame);
 });
 parser.on('closetag',()=>{const frame=stack.pop();if(frame.word&&!frame.blocked&&frame.body&&frame.local==='p')events.push({kind:'paragraph'});});
 parser.write(source).close();check();
 const parts=[],units=[];let size=0;
 const append=text=>{size+=Buffer.byteLength(text);if(size>max)fail('text_output_limit');parts.push(text);};
 for(const event of events){
  check();if(event.runPath&&hidden.has(event.runPath))continue;
  if(event.kind==='paragraph'){append('\n');continue;}
  const sourceBase={part:main.path,partSha256:main.sha256,paragraph:event.paragraph,run:event.run};
  if(event.kind==='separator'){if(units.length>=10000)fail('text_unit_limit');units.push(Object.freeze({text:event.text,source:Object.freeze({...sourceBase,kind:'word-element',path:event.path,unit:'element'})}));append(event.text);continue;}
  for(const unit of byPath.get(event.path)??[]){if(units.length>=10000)fail('text_unit_limit');units.push(Object.freeze({text:unit.text,source:Object.freeze({...unit.source,...sourceBase})}));append(unit.text);}
 }
 return Object.freeze({document:archive.document,parser:'word-main-body-v1+saxes-6.0.0',text:parts.join(''),units:Object.freeze(units),warnings:Object.freeze([...warnings])});
}
