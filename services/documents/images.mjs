import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm,open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectDocument,DocumentError,decodeDocumentUtf8} from './validation.mjs';
import {runDocumentTool} from './tool-process.mjs';
const FORMATS={png:'PNG',jpeg:'JPEG',webp:'WEBP',tiff:'TIFF'},fail=code=>{throw new DocumentError(code);};
export function decodeImageReport(report,document){
 if(!report||report.version!=='13.0.0'||report.format!==FORMATS[document.format]||!Array.isArray(report.frames)||!report.frames.length||report.frames.length>100)fail('invalid_image_report');let pixels=0,total=0;
 const pages=report.frames.map((frame,index)=>{
  if(!frame||frame.page!==index+1||['originalWidth','originalHeight','width','height','bytes','orientation'].some(k=>!Number.isSafeInteger(frame[k])||frame[k]<1)||frame.orientation>8||frame.originalWidth*frame.originalHeight>20000000||(pixels+=frame.originalWidth*frame.originalHeight)>40000000||frame.width>2000||frame.height>2000||frame.width*frame.height>4000000||(total+=frame.bytes)>20*1024**2||typeof frame.sha256!=='string'||!/^[a-f0-9]{64}$/.test(frame.sha256))fail('invalid_image_report');
  const oriented=frame.orientation>=5?[frame.originalHeight,frame.originalWidth]:[frame.originalWidth,frame.originalHeight],scale=Math.min(1,2000/Math.max(...oriented));if(Math.abs(frame.width-oriented[0]*scale)>1.01||Math.abs(frame.height-oriented[1]*scale)>1.01)fail('invalid_image_report');
  return Object.freeze({index:index+1,width:frame.width,height:frame.height,size:frame.bytes,sha256:frame.sha256,source:Object.freeze({kind:'normalized-image',documentSha256:document.sha256,page:index+1,normalizedSha256:frame.sha256,originalSize:Object.freeze([frame.originalWidth,frame.originalHeight]),normalizedSize:Object.freeze([frame.width,frame.height]),orientation:frame.orientation,unit:'normalized-image-pixels'})});
 });return Object.freeze({pages:Object.freeze(pages)});
}
export function createImageNormalizer(config){
 if(!config||Object.keys(config).some(k=>!['python','worker','tempRoot'].includes(k))||['python','worker'].some(k=>typeof config[k]!=='string'||!isAbsolute(config[k]))||(config.tempRoot!==undefined&&!isAbsolute(config.tempRoot)))fail('invalid_image_worker_configuration');const fixed={...config};
 return async function normalizeImage(input,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='signal'))fail('invalid_image_options');if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail('invalid_image_signal');if(options.signal?.aborted)fail('document_tool_cancelled');
  const document=inspectDocument(input),format=FORMATS[document.format];if(!format)fail('image_parser_unavailable');const bytes=Buffer.from(input.bytes),started=performance.now(),directory=await mkdtemp(join(fixed.tempRoot??tmpdir(),'localai-image-'));
  const check=()=>{if(options.signal?.aborted)fail('document_tool_cancelled');if(performance.now()-started>30000)fail('document_tool_timeout');};
  try{
   const source=join(directory,'input.bin');await writeFile(source,bytes,{mode:0o600,flag:'wx'});
   const result=await runDocumentTool(fixed.python,['-I',fixed.worker,source,directory,format],{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:directory,TMPDIR:directory},cwd:directory,signal:options.signal,timeoutMs:30000,maxStdoutBytes:65536,maxStderrBytes:65536});check();
   let report;try{report=JSON.parse(decodeDocumentUtf8(result.stdout));}catch{fail('invalid_image_report');}
   if(result.code!==0){if(['image_pixel_limit','image_frame_limit','image_output_limit','image_format_mismatch','image_worker_version_mismatch','invalid_image'].includes(report?.error))fail(report.error);fail('invalid_image');}
   const decoded=decodeImageReport(report,document),pages=[];
   for(const page of decoded.pages){check();const name=join(directory,'page-'+page.index+'.png'),stat=await lstat(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==page.size)fail('invalid_image_report');const handle=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let content;try{content=await handle.readFile();}finally{await handle.close();}if(content.length!==page.size||createHash('sha256').update(content).digest('hex')!==page.sha256)fail('invalid_image_report');inspectDocument({name:'normalized.png',bytes:content},{maxFileBytes:20*1024**2});pages.push(Object.freeze({...page,bytes:content}));}
   check();return Object.freeze({document,parser:'pillow-13.0.0-candidate',pages:Object.freeze(pages),warnings:Object.freeze(['image_exif_orientation_applied','image_color_converted_to_rgb','image_transparency_flattened_white','image_long_edge_bounded_to_2000','image_output_metadata_removed'])});
  }finally{await rm(directory,{recursive:true,force:true});}
 };
}
