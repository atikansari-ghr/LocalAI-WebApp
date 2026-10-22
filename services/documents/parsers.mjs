import {inspectDocument,DocumentError} from './validation.mjs';
import {parseTextDocument} from './text.mjs';
import {parseMarkupDocument} from './markup.mjs';
import {parseWordDocument} from './word.mjs';
import {parseSpreadsheetDocument} from './spreadsheet.mjs';
import {parsePresentationDocument} from './presentation.mjs';
import {parseOpenDocument} from './opendocument.mjs';
import {parseEmailDocument} from './email.mjs';
import {readZipDocument} from './containers.mjs';
const fail=code=>{throw new DocumentError(code);};
// Internal worker composition only: callers cannot provide executable paths or adapters.
export function createDocumentProcessor(config={}){
 if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['pdf','image','legacy','ocr'].includes(k)||typeof config[k]!=='function'))fail('invalid_document_configuration');const fixed={...config};
 return async function processDocument(input,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['ocr','language','signal','maxTextBytes'].includes(k)))fail('invalid_document_options');const mode=options.ocr??'auto',language=options.language??'auto',max=options.maxTextBytes??1024**2;
  if(!['auto','off','all'].includes(mode)||!['auto','en','ar'].includes(language)||!Number.isSafeInteger(max)||max<1||max>1024**2||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))fail('invalid_document_options');const check=()=>{if(options.signal?.aborted)fail('document_cancelled');};check();
  const document=inspectDocument(input),owned={name:document.name,bytes:Buffer.from(input.bytes)},common={maxTextBytes:max,signal:options.signal};let result;
  if(['txt','md','json','csv','ics'].includes(document.format))result=parseTextDocument(owned,{maxTextBytes:max});
  else if(['html','xml'].includes(document.format))result=parseMarkupDocument(owned,{maxTextBytes:max});
  else if(document.format==='docx')result=await parseWordDocument(owned,common);
  else if(document.format==='xlsx')result=await parseSpreadsheetDocument(owned,common);
  else if(document.format==='pptx')result=await parsePresentationDocument(owned,common);
  else if(['odt','ods','odp'].includes(document.format))result=await parseOpenDocument(owned,common);
  else if(document.format==='eml'){const mail=await parseEmailDocument(owned,common);result={...mail,attachments:mail.attachments.map(({content,...metadata})=>metadata)};}
  else if(['rtf','xls','msg'].includes(document.format)){if(!fixed.legacy)fail('legacy_worker_unavailable');result=await fixed.legacy(owned,common);}
  else if(document.format==='zip'){
   const archive=await readZipDocument(owned,{signal:options.signal}),manifest=value=>({document:value.document,validation:value.validation,entries:value.entries.map(({content,archive,...entry})=>({...entry,...(archive?{archive:manifest(archive)}:{})}))});
   result={...manifest(archive),parser:'bounded-zip-manifest-v1',text:'',warnings:['zip_contents_not_recursively_parsed'],manualReviewRequired:true};
  }else{
   const pdf=document.format==='pdf',parser=pdf?fixed.pdf:fixed.image;if(!parser)fail(pdf?'pdf_worker_unavailable':'image_worker_unavailable');
   const parsed=await parser(owned,pdf?{...common,rasterize:mode==='auto'?'needed':mode==='all'}:{signal:options.signal});if(parsed.document?.sha256!==document.sha256||!Array.isArray(parsed.pages)||!parsed.pages.length||parsed.pages.length>100)fail('invalid_document_report');
   const candidates=[],pageResults=parsed.pages.map((page,index)=>{
    if(page.index!==index+1)fail('invalid_document_report');const nativeText=pdf?page.text:'',needs=mode!=='off'&&(!pdf||mode==='all'||page.status!=='native-text');
    if(needs){const raster=pdf?parsed.rasters?.find(r=>r.page===page.index):page;if(!raster)fail('document_raster_missing');candidates.push({index:page.index,width:pdf?undefined:page.width,height:pdf?undefined:page.height,bytes:raster.bytes,sha256:raster.sha256,documentSha256:document.sha256});
     // PDF output dimensions must come from the rendered PNG header, not PDF points.
     if(pdf){const bytes=Buffer.from(raster.bytes);if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('invalid_document_raster');candidates.at(-1).width=bytes.readUInt32BE(16);candidates.at(-1).height=bytes.readUInt32BE(20);}
    }
    const {bytes,...metadata}=page;return {...metadata,text:nativeText??'',nativeText:nativeText??'',manualReviewRequired:!pdf||page.status!=='native-text',status:pdf?page.status:'requires-ocr'};
   });
   if(candidates.length){if(!fixed.ocr)fail('ocr_worker_unavailable');const recognized=await fixed.ocr(candidates,{language,signal:options.signal,maxTextBytes:max});if(!Array.isArray(recognized.pages)||recognized.pages.length!==candidates.length)fail('invalid_document_report');
    for(let i=0;i<candidates.length;i++){const ocr=recognized.pages[i],page=pageResults[candidates[i].index-1];if(ocr.index!==page.index||typeof ocr.text!=='string'||!Array.isArray(ocr.units))fail('invalid_document_report');page.ocr={...ocr,page:page.index};page.text=[page.nativeText,ocr.text].filter(Boolean).join('\n');page.manualReviewRequired=true;page.status=page.nativeText?'native-and-ocr-evidence':ocr.status;}
   }
   result={document,parser:parsed.parser,text:pageResults.map(page=>page.text).join('\n'),pages:pageResults,warnings:[...parsed.warnings,'native_and_ocr_are_separate_evidence_not_semantically_merged'],manualReviewRequired:pageResults.some(page=>page.manualReviewRequired)};
  }
  check();if(result.document?.sha256!==document.sha256||typeof result.text!=='string')fail('invalid_document_report');if(Buffer.byteLength(result.text)>max)fail('text_output_limit');if(Buffer.byteLength(JSON.stringify(result))>4*1024**2)fail('document_result_limit');return Object.freeze(result);
 };
}
