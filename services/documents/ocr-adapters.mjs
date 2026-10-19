import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {DocumentError,decodeDocumentUtf8,inspectDocument} from './validation.mjs';
import {runDocumentTool} from './tool-process.mjs';
const fail=code=>{throw new DocumentError(code);},HEADER='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
export function decodeTesseractTsv(text,page){
 if(typeof text!=='string'||Buffer.byteLength(text)>4*1024**2||!page||!Number.isSafeInteger(page.width)||!Number.isSafeInteger(page.height)||page.width<1||page.height<1)fail('invalid_tesseract_output');
 const rows=text.trimEnd().split('\n');if(rows.shift()!==HEADER||rows.length>10000)fail('invalid_tesseract_output');const lines=[];
 for(const row of rows){const cells=row.split('\t');if(cells.length!==12)fail('invalid_tesseract_output');if(cells[0]!=='5'||!cells[11].trim())continue;const [left,top,width,height,confidence]=cells.slice(6,11).map(Number);if(![left,top,width,height].every(Number.isSafeInteger)||left<0||top<0||width<1||height<1||left+width>page.width||top+height>page.height||!Number.isFinite(confidence)||confidence<0||confidence>100||lines.length>=1000)fail('invalid_tesseract_output');lines.push({text:cells[11],confidence:confidence/100,box:[{x:left,y:top},{x:left+width,y:top},{x:left+width,y:top+height},{x:left,y:top+height}]});}
 return {lines};
}
export function createNativeOcrAdapters(config){
 const keys=['lightRoot','tesseractRoot','paddleRoot','python','node','lightWorker','paddleWorker'];if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>![...keys,'tempRoot'].includes(k))||keys.some(k=>typeof config[k]!=='string'||!isAbsolute(config[k]))||(config.tempRoot!==undefined&&!isAbsolute(config.tempRoot)))fail('invalid_ocr_adapter_configuration');const fixed={...config};
 return Object.freeze(Object.fromEntries(['light-ocr','tesseract','paddleocr'].map(id=>[id,async(page,options={})=>{
  if(!options||Object.keys(options).some(k=>!['language','signal'].includes(k))||!['auto','en','ar'].includes(options.language??'auto')||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))fail('invalid_ocr_adapter_options');if(options.signal?.aborted)fail('document_tool_cancelled');
  const document=inspectDocument({name:'page.png',bytes:page.bytes});if(document.format!=='png'||!Number.isSafeInteger(page.width)||!Number.isSafeInteger(page.height)||page.width<1||page.height<1||page.width>2000||page.height>2000)fail('invalid_ocr_page');
  const directory=await mkdtemp(join(fixed.tempRoot??tmpdir(),'localai-ocr-'));
  try{
   const file=join(directory,'page.png');await writeFile(file,Buffer.from(page.bytes),{mode:0o600,flag:'wx'});const language=options.language??'auto',env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:directory,TMPDIR:directory,OMP_THREAD_LIMIT:'1',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1',PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:'True',CUDA_VISIBLE_DEVICES:''};let command,args;
   if(id==='light-ocr'){command=fixed.node;args=['--max-old-space-size=192',fixed.lightWorker,fixed.lightRoot,file];}
   else if(id==='tesseract'){command=join(fixed.tesseractRoot,'root/usr/bin/tesseract');env.LD_LIBRARY_PATH=join(fixed.tesseractRoot,'root/usr/lib/x86_64-linux-gnu');args=[file,'stdout','--tessdata-dir',join(fixed.tesseractRoot,'root/usr/share/tesseract-ocr/5/tessdata'),'-l',language==='en'?'eng':language==='ar'?'ara':'eng+ara','--oem','1','--psm','6','tsv'];}
   else{if(language==='auto')fail('ocr_language_hint_required');command=fixed.python;env.LD_LIBRARY_PATH=join(fixed.paddleRoot,'native/usr/lib/x86_64-linux-gnu');args=['-I',fixed.paddleWorker,fixed.paddleRoot,file,language];}
   const result=await runDocumentTool(command,args,{env,cwd:directory,signal:options.signal,timeoutMs:30000,maxStdoutBytes:4*1024**2,maxStderrBytes:65536});if(result.code!==0)fail('ocr_engine_failed');const text=decodeDocumentUtf8(result.stdout);if(id==='tesseract')return decodeTesseractTsv(text,page);let report;try{report=JSON.parse(text);}catch{fail('invalid_ocr_result');}if(report.engine!==id||report.width!==page.width||report.height!==page.height||!Array.isArray(report.lines))fail('invalid_ocr_result');return {lines:report.lines};
  }finally{await rm(directory,{recursive:true,force:true});}
 }])));
}
