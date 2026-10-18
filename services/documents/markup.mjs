import {createRequire} from 'node:module';
import {inspectDocument,decodeDocumentUtf8,DocumentError} from './validation.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url));
const {Parser}=require('htmlparser2'),{SaxesParser}=require('saxes');
const fail=code=>{throw new DocumentError(code);};
const INACTIVE=new Set(['script','style','template','iframe','object','embed','svg','math']);
const BLOCKS=new Set(['p','div','section','article','header','footer','h1','h2','h3','h4','h5','h6','table','tr','li','ul','ol','br','hr','pre']);
function collector(limit){
 const units=[],parts=[];let bytes=0;
 const append=text=>{bytes+=Buffer.byteLength(text);if(bytes>limit)fail('text_output_limit');parts.push(text);};
 return {units,parts,add(text,source){if(!text)return;if(text.length>65536)fail('text_line_limit');if(units.length>=10000)fail('text_unit_limit');units.push(Object.freeze({text,source:Object.freeze({...source,unit:'utf16'})}));append(text);},boundary(){if(parts.length&&!parts.at(-1).endsWith('\n'))append('\n');}};
}
function htmlText(text,limit){
 const result=collector(limit),stack=[],warnings=new Set(['html_source_order_not_rendered']);let nodes=0;
 const parser=new Parser({
  onopentag(name,attributes){
   if(++nodes>10000||stack.length>=32||Object.keys(attributes).length>256)fail('markup_structure_limit');
   const blocked=Boolean(stack.at(-1)?.blocked)||INACTIVE.has(name);if(INACTIVE.has(name))warnings.add('active_embedded_content_omitted');
   if(['img','video','audio','source'].includes(name))warnings.add('embedded_media_not_extracted');
   if(!blocked&&BLOCKS.has(name))result.boundary();stack.push({name,blocked});
  },
  onclosetag(name){const frame=stack.pop();if(!frame?.blocked&&BLOCKS.has(name))result.boundary();},
  ontext(value){if(!stack.at(-1)?.blocked)result.add(value,{kind:'html-text',start:parser.startIndex,end:parser.endIndex+1});}
 },{decodeEntities:true,recognizeSelfClosing:true});
 parser.end(text);return {text:result.parts.join('').trim(),units:result.units,warnings:[...warnings]};
}
function validateXml(text){
 const parser=new SaxesParser({xmlns:true});let depth=0,nodes=0;
 parser.on('doctype',()=>fail('xml_doctype_forbidden'));
 parser.on('opentag',tag=>{if(++depth>32||++nodes>10000||Object.keys(tag.attributes).length>256)fail('markup_structure_limit');});
 parser.on('closetag',()=>{depth--;});parser.on('error',()=>fail('invalid_xml'));
 parser.write(text).close();
}
function decodeXmlText(text){
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return text.replace(/\r\n?/g,'\n').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,(_,entity)=>{
  if(entity[0]!=='#')return named[entity];return String.fromCodePoint(entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1)));
 });
}
function xmlText(text,limit){
 validateXml(text);const result=collector(limit),stack=[],roots=new Map();let index=0;
 const source=(start,end)=>({kind:'xml-text',path:stack.at(-1)?.path??'/',start,end});
 while(index<text.length){
  if(text[index]!=='<'){
   let end=text.indexOf('<',index);if(end<0)end=text.length;const value=decodeXmlText(text.slice(index,end));
   if(stack.length)result.add(value,source(index,end));index=end;continue;
  }
  if(text.startsWith('<!--',index)){index=text.indexOf('-->',index)+3;continue;}
  if(text.startsWith('<?',index)){index=text.indexOf('?>',index)+2;continue;}
  if(text.startsWith('<![CDATA[',index)){
   const start=index+9,end=text.indexOf(']]>',start);result.add(text.slice(start,end).replace(/\r\n?/g,'\n'),source(start,end));index=end+3;continue;
  }
  let end=index+1,quote=null;
  for(;end<text.length;end++){const char=text[end];if(quote){if(char===quote)quote=null;}else if(char==='"'||char==="'")quote=char;else if(char==='>')break;}
  const tag=text.slice(index,end+1);
  if(tag.startsWith('</'))stack.pop();
  else{
   const name=tag.match(/^<([^\u0009\u000a\u000d\u0020/>]+)/u)[1],siblings=stack.at(-1)?.children??roots,ordinal=(siblings.get(name)??0)+1;siblings.set(name,ordinal);
   if(!tag.endsWith('/>'))stack.push({path:(stack.at(-1)?.path??'')+'/'+name+'['+ordinal+']',children:new Map()});
  }
  index=end+1;
 }
 return {text:result.parts.join(''),units:result.units,warnings:['xml_source_order_not_rendered','xml_external_references_not_resolved']};
}
export function parseMarkupDocument(input,limits={}){
 const document=inspectDocument(input,limits);if(!['html','xml'].includes(document.format))fail('parser_unavailable');
 const text=decodeDocumentUtf8(Buffer.from(input.bytes)),limit=limits.maxTextBytes??1024**2;
 let parsed;try{parsed=document.format==='html'?htmlText(text,limit):xmlText(text,limit);}catch(error){if(error instanceof DocumentError)throw error;fail('invalid_'+document.format);}
 return Object.freeze({document,parser:document.format==='html'?'htmlparser2-12.0.0':'saxes-6.0.0',text:parsed.text,units:Object.freeze(parsed.units),warnings:Object.freeze(parsed.warnings)});
}
