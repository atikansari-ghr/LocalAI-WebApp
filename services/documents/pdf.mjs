import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectDocument,DocumentError,decodeDocumentUtf8} from './validation.mjs';
import {runDocumentTool} from './tool-process.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),{SaxesParser}=require('saxes');
const fail=code=>{throw new DocumentError(code);},NS='http://www.w3.org/1999/xhtml';
const DOCTYPE='<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
function field(info,key){const values=[...info.matchAll(new RegExp('^'+key+':[^\\S\\r\\n]*(.*)$','gm'))];if(values.length!==1)fail('invalid_pdf_metadata');return values[0][1].trim();}
function outputLimit(options){if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['maxTextBytes'].includes(k)))fail('invalid_pdf_limits');const max=options.maxTextBytes??1024**2;if(!Number.isSafeInteger(max)||max<1||max>1024**2)fail('invalid_pdf_limits');return max;}
export function decodePopplerOutput(input,document,options={}){
 const max=outputLimit(options);if(!input||['info','bbox','images'].some(k=>typeof input[k]!=='string'))fail('invalid_pdf_output');
 if(Buffer.byteLength(input.info)>65536||Buffer.byteLength(input.bbox)>10*1024**2||Buffer.byteLength(input.images)>65536)fail('invalid_pdf_output');
 const countText=field(input.info,'Pages'),count=Number(countText);if(!/^[1-9][0-9]*$/.test(countText)||count>100)fail('pdf_page_limit');if(field(input.info,'Encrypted')!=='no')fail('encrypted_document_unsupported');if(field(input.info,'JavaScript')!=='no')fail('pdf_active_content_forbidden');
 const imageCounts=new Map();let images=0,pixels=0;
 for(const row of input.images.split(/\r?\n/)){if(!row.trim()||/^\s*page\s+num\s+type\s+width\s+height/.test(row)||/^-+$/.test(row.trim()))continue;const values=row.trim().split(/\s+/),[page,num,type,width,height]=values;const p=Number(page),w=Number(width),h=Number(height);if(!/^\d+$/.test(page)||!/^\d+$/.test(num)||!['image','mask','smask'].includes(type)||p<1||p>count||!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w*h>40000000||++images>1000||(pixels+=w*h)>100000000)fail('pdf_image_limit');imageCounts.set(p,(imageCounts.get(p)??0)+1);}
 let xml=input.bbox;if(xml.startsWith(DOCTYPE))xml=xml.slice(DOCTYPE.length);const parser=new SaxesParser({xmlns:true}),stack=[],pages=[];let current,word,nodes=0,total=0,unitCount=0;
 const append=value=>{total+=Buffer.byteLength(value);if(total>max)fail('text_output_limit');current.parts.push(value);};
 parser.on('doctype',()=>fail('xml_doctype_forbidden'));parser.on('error',()=>fail('invalid_pdf_layout'));
 parser.on('opentag',tag=>{
  if(++nodes>100000||stack.length>=32||Object.keys(tag.attributes).length>256)fail('pdf_layout_limit');const parent=stack.at(-1);stack.push(tag);
  const attrs={};for(const attribute of Object.values(tag.attributes))if(!attribute.uri)attrs[attribute.local]=attribute.value;
  if(tag.uri!==NS)fail('invalid_pdf_layout');
  if(tag.local==='page'){
   if(parent?.local!=='doc'||current||pages.length>=count)fail('invalid_pdf_layout');const width=Number(attrs.width),height=Number(attrs.height);if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>14400||height>14400)fail('pdf_page_size_limit');current={index:pages.length+1,width,height,parts:[],units:[]};
  }
  if(tag.local==='word'){
   if(parent?.local!=='line'||!current||word)fail('invalid_pdf_layout');const box=['xMin','yMin','xMax','yMax'].map(k=>Number(attrs[k]));if(box.some(v=>!Number.isFinite(v))||box[0]<0||box[1]<0||box[2]<box[0]||box[3]<box[1]||box[2]>current.width+0.001||box[3]>current.height+0.001)fail('pdf_coordinate_invalid');word={text:'',box};
  }
 });
 parser.on('text',value=>{if(word){word.text+=value;if(word.text.length>65536)fail('text_line_limit');}});
 parser.on('cdata',value=>{if(word)word.text+=value;});
 parser.on('closetag',tag=>{
  if(tag.local==='word'){if(++unitCount>10000)fail('text_unit_limit');if(current.parts.length&&!current.parts.at(-1).endsWith('\n'))append(' ');append(word.text);current.units.push(Object.freeze({text:word.text,source:Object.freeze({kind:'pdf-native-word',documentSha256:document.sha256,page:current.index,box:Object.freeze(word.box),unit:'pdf-points-top-left'})}));word=undefined;}
  if(tag.local==='line'&&current&&current.parts.length&&!current.parts.at(-1).endsWith('\n'))append('\n');
  if(tag.local==='page'){const text=current.parts.join(''),hasImages=imageCounts.has(current.index),status=text?hasImages?'native-and-images-review':'native-text':hasImages?'requires-ocr':'requires-visual-review';pages.push(Object.freeze({index:current.index,width:current.width,height:current.height,text,units:Object.freeze(current.units),imageCount:imageCounts.get(current.index)??0,status}));current=undefined;}
  stack.pop();
 });
 try{parser.write(xml).close();}catch(error){if(error instanceof DocumentError)throw error;fail('invalid_pdf_layout');}if(pages.length!==count||current||word)fail('invalid_pdf_layout');
 return Object.freeze({pages:Object.freeze(pages),warnings:Object.freeze(['pdf_native_word_spacing_reconstructed','pdf_embedded_files_annotations_and_links_not_extracted','pdf_bitmap_inventory_does_not_classify_vector_content'])});
}
export function createPdfParser(config){
 if(!config||Object.keys(config).some(k=>!['binDir','libraryDir','fontConfig','tempRoot'].includes(k))||['binDir','libraryDir','fontConfig'].some(k=>typeof config[k]!=='string'||!isAbsolute(config[k]))||(config.tempRoot!==undefined&&!isAbsolute(config.tempRoot)))fail('invalid_pdf_tool_configuration');
 const fixed={...config};
 return async function parsePdf(input,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['signal','maxTextBytes','rasterize'].includes(k)))fail('invalid_pdf_options');const max=outputLimit({maxTextBytes:options.maxTextBytes});if(options.rasterize!==undefined&&typeof options.rasterize!=='boolean')fail('invalid_pdf_options');if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail('invalid_pdf_signal');if(options.signal?.aborted)fail('document_tool_cancelled');
  const document=inspectDocument(input);if(document.format!=='pdf')fail('pdf_parser_unavailable');const bytes=Buffer.from(input.bytes),started=performance.now(),directory=await mkdtemp(join(fixed.tempRoot??tmpdir(),'localai-pdf-'));
  try{
   const file=join(directory,'input.pdf');await writeFile(file,bytes,{mode:0o600,flag:'wx'});
   const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:directory,TMPDIR:directory,XDG_CACHE_HOME:directory,LD_LIBRARY_PATH:fixed.libraryDir,FONTCONFIG_FILE:fixed.fontConfig};
   async function run(name,args,maxStdoutBytes){const remaining=30000-(performance.now()-started);if(remaining<=0)fail('document_tool_timeout');return runDocumentTool(join(fixed.binDir,name),args,{env,cwd:directory,signal:options.signal,timeoutMs:Math.max(1,Math.floor(remaining)),maxStdoutBytes,maxStderrBytes:65536});}
   const info=await run('pdfinfo',[file],65536);if(info.code!==0){if(/incorrect password/i.test(info.stderr.toString()))fail('encrypted_document_unsupported');fail('invalid_pdf');}
   // Reject excessive pages/encryption before text extraction or image decoding.
   const infoText=decodeDocumentUtf8(info.stdout),count=Number(field(infoText,'Pages'));if(!Number.isSafeInteger(count)||count<1||count>100)fail('pdf_page_limit');if(field(infoText,'Encrypted')!=='no')fail('encrypted_document_unsupported');if(field(infoText,'JavaScript')!=='no')fail('pdf_active_content_forbidden');
   const imageResult=await run('pdfimages',['-list',file],65536);if(imageResult.code!==0)fail('invalid_pdf');
   const text=await run('pdftotext',['-bbox-layout','-enc','UTF-8',file,'-'],10*1024**2);if(text.code!==0)fail('invalid_pdf');
   const decoded=decodePopplerOutput({info:infoText,bbox:decodeDocumentUtf8(text.stdout),images:decodeDocumentUtf8(imageResult.stdout)},document,{maxTextBytes:max}),rasters=[];let rasterBytes=0;
   if(options.rasterize)for(const page of decoded.pages){const image=await run('pdftoppm',['-f',String(page.index),'-l',String(page.index),'-singlefile','-scale-to','2000','-png',file],20*1024**2);if(image.code!==0)fail('pdf_raster_failed');rasterBytes+=image.stdout.length;if(rasterBytes>20*1024**2)fail('pdf_raster_limit');const metadata=inspectDocument({name:'page.png',bytes:image.stdout});rasters.push(Object.freeze({page:page.index,bytes:image.stdout,sha256:metadata.sha256}));}
   return Object.freeze({document,parser:'poppler-25.03.0-candidate',pages:decoded.pages,rasters:Object.freeze(rasters),warnings:decoded.warnings});
  }finally{await rm(directory,{recursive:true,force:true});}
 };
}
