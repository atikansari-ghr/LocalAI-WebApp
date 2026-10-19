import {createRequire} from 'node:module';
import posix from 'node:path/posix';
import {inspectOfficePackage} from './office.mjs';
import {parseMarkupDocument} from './markup.mjs';
import {decodeDocumentUtf8,DocumentError} from './validation.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),{SaxesParser}=require('saxes');
export const OFFICE_REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const fail=code=>{throw new DocumentError(code);};
export const children=(node,ns,local)=>node.children.filter(n=>n.ns===ns&&n.local===local);
export function one(node,ns,local){const list=children(node,ns,local);if(list.length>1)fail('office_duplicate_element');return list[0];}
export function descendants(node,ns,local){return [...walk(node)].filter(n=>n.ns===ns&&n.local===local);}
export function* walk(node){yield node;for(const child of node.children)yield* walk(child);}
export const attr=(node,name,ns='')=>node.attributes.find(a=>a.uri===ns&&a.local===name)?.value;
export function fragments(node){return node.sequence.flatMap(item=>item.node?fragments(item.node):[item.unit]);}
export function literal(node){return fragments(node).map(u=>u.text).join('');}
export function xmlTree(part,check=()=>{}){
 check();const markup=parseMarkupDocument({name:'part.xml',bytes:part.content}),units=new Map(),source=decodeDocumentUtf8(part.content);
 for(const unit of markup.units){const list=units.get(unit.source.path)??[];list.push(Object.freeze({text:unit.text,source:Object.freeze({...unit.source,part:part.path,partSha256:part.sha256})}));units.set(unit.source.path,list);}
 const stack=[],roots=new Map();let root;const parser=new SaxesParser({xmlns:true});parser.on('error',()=>fail('invalid_xml'));
 parser.on('opentag',tag=>{
  check();const parent=stack.at(-1),siblings=parent?.ordinals??roots,ordinal=(siblings.get(tag.name)??0)+1;siblings.set(tag.name,ordinal);
  const path=(parent?.path??'')+'/'+tag.name+'['+ordinal+']',node={ns:tag.uri,local:tag.local,path,offset:source.lastIndexOf('<',parser.position-1),attributes:Object.values(tag.attributes),children:[],ordinals:new Map(),units:units.get(path)??[]};if(parent)parent.children.push(node);else root=node;stack.push(node);
 });
 parser.on('closetag',()=>{const node=stack.pop();node.sequence=[...node.units.map(unit=>({offset:unit.source.start,unit})),...node.children.map(child=>({offset:child.offset,node:child}))].sort((a,b)=>a.offset-b.offset);});parser.write(source).close();return root;
}
export async function officeContext(input,options,format,inspect=inspectOfficePackage){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['signal','limits','maxTextBytes'].includes(k)))fail('invalid_office_options');
 const max=options.maxTextBytes??1024**2;if(!Number.isSafeInteger(max)||max<1||max>1024**2)fail('invalid_office_limits');
 const started=performance.now(),check=()=>{if(options.signal?.aborted)fail('archive_cancelled');if(performance.now()-started>Math.min(options.limits?.timeoutMs??10000,10000))fail('archive_timeout');};
 const pkg=await inspect(input,{...(options.signal!==undefined?{signal:options.signal}:{}),...(options.limits!==undefined?{limits:options.limits}:{})});if(pkg.document.format!==format)fail('office_parser_unavailable');check();
 const parts=new Map(pkg.parts.map(p=>[p.path,p]));let size=0,refs=0;
 function read(path){check();const part=parts.get(path);if(!part)fail('office_part_missing');return xmlTree(part,check);}
 function relationships(owner){const path=posix.join(posix.dirname(owner),'_rels',posix.basename(owner)+'.rels'),result=new Map();if(!parts.has(path))return result;const root=read(path);for(const node of root.children){const target=attr(node,'Target'),resolved=target.startsWith('/')?target.slice(1):posix.normalize(posix.join(posix.dirname(owner),target));result.set(attr(node,'Id'),{type:attr(node,'Type'),target:resolved});}return result;}
 return {pkg,check,read,relationships,add(text,count=1){check();size+=Buffer.byteLength(text);refs+=count;if(size>max)fail('text_output_limit');if(refs>10000)fail('text_unit_limit');},source(path,node){return Object.freeze({kind:'office-element',unit:'element',part:path,partSha256:parts.get(path).sha256,path:node.path});}};
}
