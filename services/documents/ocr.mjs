import {createHash} from 'node:crypto';
import {inspectDocument,DocumentError} from './validation.mjs';
import {evaluateOcrText} from './quality.mjs';
const IDS=Object.freeze(['light-ocr','tesseract','paddleocr']),fail=code=>{throw new DocumentError(code);},hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function linesFor(result,page){
 if(!result||!Array.isArray(result.lines)||result.lines.length>1000)fail('invalid_ocr_result');let bytes=0;
 return Object.freeze(result.lines.map(line=>{
  if(!line||typeof line.text!=='string'||line.text.includes('\0')||(bytes+=Buffer.byteLength(line.text)+1)>1024**2||!Array.isArray(line.box)||line.box.length!==4||(line.confidence!==undefined&&(!Number.isFinite(line.confidence)||line.confidence<0||line.confidence>1)))fail('invalid_ocr_result');
  const box=Object.freeze(line.box.map(point=>{if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>page.width||point.y>page.height)fail('invalid_ocr_result');return Object.freeze({x:point.x,y:point.y});}));
  return Object.freeze({text:line.text,box,...(line.confidence===undefined?{}:{rawEngineConfidence:line.confidence})});
 }));
}
// Adapters must run in the bounded isolated worker and settle after cancellation.
// This coordinator neither grants admission nor installs a process sandbox.
export function createOcrChain(config){
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['adapters','order','disabled','mode','minCharacters'].includes(k)))fail('invalid_ocr_configuration');
 const order=config.order??IDS,disabled=config.disabled??[],mode=config.mode??'adaptive',minCharacters=config.minCharacters??3;
 if(!Array.isArray(order)||!order.length||order.length>3||order.some(id=>!IDS.includes(id))||new Set(order).size!==order.length||!Array.isArray(disabled)||disabled.some(id=>!IDS.includes(id))||new Set(disabled).size!==disabled.length||!['adaptive','primary-only'].includes(mode)||!config.adapters||typeof config.adapters!=='object'||Object.keys(config.adapters).some(id=>!IDS.includes(id)||typeof config.adapters[id]!=='function')||!Number.isSafeInteger(minCharacters)||minCharacters<1||minCharacters>100)fail('invalid_ocr_configuration');
 const fixedOrder=[...order],off=new Set(disabled),adapters={...config.adapters};
 return async function processPages(input,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['language','signal','maxTextBytes'].includes(k)))fail('invalid_ocr_options');const language=options.language??'auto',max=options.maxTextBytes??1024**2;
  if(!['auto','en','ar'].includes(language)||!Number.isSafeInteger(max)||max<1||max>1024**2||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))fail('invalid_ocr_options');if(options.signal?.aborted)fail('ocr_cancelled');
  if(!Array.isArray(input)||!input.length||input.length>100)fail('invalid_ocr_pages');let imageBytes=0;
  const pages=input.map((page,index)=>{
   if(!page||!Number.isSafeInteger(page.index)||page.index<1||page.index>100||(index>0&&page.index<=input[index-1].index)||!Number.isSafeInteger(page.width)||!Number.isSafeInteger(page.height)||page.width<1||page.height<1||page.width>2000||page.height>2000||!(page.bytes instanceof Uint8Array)||page.bytes.buffer instanceof SharedArrayBuffer||!/^([a-f0-9]{64})$/.test(page.documentSha256))fail('invalid_ocr_page');
   const bytes=Buffer.from(page.bytes);if((imageBytes+=bytes.length)>20*1024**2||hash(bytes)!==page.sha256)fail('invalid_ocr_page');if(inspectDocument({name:'normalized.png',bytes}).format!=='png')fail('invalid_ocr_page');return {index:page.index,width:page.width,height:page.height,bytes,sha256:page.sha256,documentSha256:page.documentSha256};
  });
  let total=0;const results=[];
  for(const page of pages){
   const attempts=[];let selected,selectedQuality;
   for(const id of mode==='primary-only'?fixedOrder.slice(0,1):fixedOrder){
    if(options.signal?.aborted)fail('ocr_cancelled');if(off.has(id)||!adapters[id]){attempts.push(Object.freeze({engine:id,status:off.has(id)?'disabled':'unavailable'}));continue;}
    const started=performance.now();let lines,text,quality;const observed=selectedQuality?.signals,attemptLanguage=language==='auto'&&id==='paddleocr'?(observed?.arabic>=minCharacters?'ar':observed?.latin>=minCharacters?'en':'auto'):language;
    try{lines=linesFor(await adapters[id]({...page,bytes:Buffer.from(page.bytes)},{language:attemptLanguage,signal:options.signal}),page);if(options.signal?.aborted)fail('ocr_cancelled');text=lines.map(line=>line.text).join('\n');total+=Buffer.byteLength(text);if(total>max)fail('text_output_limit');quality=evaluateOcrText(text,{language,minCharacters});}
    catch(error){if(options.signal?.aborted||error?.code==='ocr_cancelled')fail('ocr_cancelled');if(error?.code==='text_output_limit')throw error;if(error?.code==='ocr_language_hint_required'){attempts.push(Object.freeze({engine:id,status:'language-hint-required',error:'ocr_language_hint_required',elapsedMs:Math.round(performance.now()-started)}));continue;}attempts.push(Object.freeze({engine:id,status:'failed',error:['invalid_ocr_result','document_tool_timeout','document_tool_output_limit','document_tool_spawn_failed'].includes(error?.code)?error.code:'ocr_engine_failed',elapsedMs:Math.round(performance.now()-started)}));continue;}
    const attempt=Object.freeze({engine:id,status:quality.acceptable?'accepted':'quality-rejected',text,lines,quality,elapsedMs:Math.round(performance.now()-started),language:attemptLanguage});attempts.push(attempt);
    if(!selected||quality.acceptable){selected=attempt;selectedQuality=quality;}if(quality.acceptable){if(language!=='auto'||mode==='primary-only')break;const accepted=attempts.filter(a=>a.status==='accepted');if(accepted.length>=2&&accepted.at(-2).text.normalize('NFC').replace(/\s+/gu,' ').trim()===text.normalize('NFC').replace(/\s+/gu,' ').trim())break;}
   }
   const variants=new Set(attempts.filter(a=>a.text?.trim()).map(a=>a.text.normalize('NFC').replace(/\s+/gu,' ').trim())),conflict=variants.size>1,engine=selected?.engine,text=selected?.text??'';
   const units=Object.freeze((selected?.lines??[]).map(line=>Object.freeze({text:line.text,source:Object.freeze({kind:'ocr-line',documentSha256:page.documentSha256,page:page.index,normalizedSha256:page.sha256,engine,box:line.box,unit:'normalized-image-pixels'}),...(line.rawEngineConfidence===undefined?{}:{rawEngineConfidence:line.rawEngineConfidence})})));
   results.push(Object.freeze({index:page.index,engine,text,units,attempts:Object.freeze(attempts),conflict,status:selectedQuality?.acceptable?'quality-accepted':'requires-review',manualReviewRequired:true,accuracyVerified:false}));
  }
  return Object.freeze({pages:Object.freeze(results),warnings:Object.freeze(['ocr_structural_quality_is_not_accuracy','ocr_text_requires_review','raw_engine_confidence_not_comparable']),order:Object.freeze([...fixedOrder])});
 };
}
