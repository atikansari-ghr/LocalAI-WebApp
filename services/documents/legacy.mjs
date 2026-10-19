import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectDocument,decodeDocumentUtf8,DocumentError} from './validation.mjs';
import {parseTextDocument} from './text.mjs';
import {parseMarkupDocument} from './markup.mjs';
import {runDocumentTool} from './tool-process.mjs';
const fail=code=>{throw new DocumentError(code);},SEP='\u001e';
function textLimit(options){if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='maxTextBytes'))fail('invalid_legacy_limits');const max=options.maxTextBytes??1024**2;if(!Number.isSafeInteger(max)||max<1||max>1024**2)fail('invalid_legacy_limits');return max;}
export function decodeLegacyCsv(text,document,options={}){
 const max=textLimit(options);if(typeof text!=='string'||!text.endsWith(SEP))fail('invalid_legacy_csv');if(Buffer.byteLength(text)>max)fail('text_output_limit');const chunks=[];let start=0,quoted=false;
 for(let index=0;index<text.length;index++){const char=text[index];if(char==='"'){if(quoted&&text[index+1]==='"'){index++;continue;}quoted=!quoted;}else if(char===SEP&&!quoted){chunks.push(text.slice(start,index));start=index+1;if(chunks.length>100)fail('legacy_sheet_limit');}}
 if(quoted||start!==text.length)fail('invalid_legacy_csv');let count=0;const conversionSha256=createHash('sha256').update(text).digest('hex');
 const sheets=chunks.map((chunk,index)=>{const parsed=chunk?parseTextDocument({name:'sheet.csv',bytes:Buffer.from(chunk)},{maxTextBytes:max}):{text:'',units:[]};const cells=parsed.units.map(unit=>{if(++count>10000)fail('text_unit_limit');return Object.freeze({text:unit.text,source:Object.freeze({...unit.source,kind:'legacy-xls-cell',documentSha256:document.sha256,conversionSha256,sheet:index+1,scope:'converted-worksheet',unit:'converted-csv-utf16'})});});return Object.freeze({index:index+1,text:parsed.text,cells:Object.freeze(cells)});});
 return Object.freeze({text:sheets.map(s=>s.text).join('\n'),sheets:Object.freeze(sheets),warnings:Object.freeze(['legacy_xls_sheet_names_not_extracted','legacy_xls_values_may_be_cached','legacy_xls_offsets_reference_converted_csv'])});
}
export function validateRtfStructure(input){
 const bytes=Buffer.from(input);if(bytes.length>10*1024**2||bytes.subarray(0,5).toString()!=='{\\rtf')fail('invalid_rtf');let depth=0,groups=0,closed=false,pictures=false;
 for(let index=0;index<bytes.length;index++){
  const byte=bytes[index];if(closed){if(![9,10,13,32].includes(byte))fail('invalid_rtf');continue;}
  if(byte===123){if(++depth>128||++groups>10000)fail('rtf_structure_limit');continue;}if(byte===125){if(--depth<0)fail('invalid_rtf');if(depth===0)closed=true;continue;}if(byte!==92)continue;
  if(++index>=bytes.length)fail('invalid_rtf');const char=bytes[index];if([92,123,125].includes(char))continue;
  if(char===39){if(index+2>=bytes.length||!/^\p{ASCII_Hex_Digit}{2}$/u.test(bytes.subarray(index+1,index+3).toString('ascii')))fail('invalid_rtf');index+=2;continue;}
  if(!((char>=65&&char<=90)||(char>=97&&char<=122)))continue;
  const wordStart=index;while(index<bytes.length&&((bytes[index]>=65&&bytes[index]<=90)||(bytes[index]>=97&&bytes[index]<=122)))index++;const word=bytes.subarray(wordStart,index).toString('ascii').toLowerCase();if(word.length>64)fail('invalid_rtf');
  let sign=1;if(bytes[index]===45){sign=-1;index++;}const numberStart=index;while(index<bytes.length&&bytes[index]>=48&&bytes[index]<=57)index++;if(index-numberStart>12)fail('invalid_rtf');const number=index>numberStart?sign*Number(bytes.subarray(numberStart,index).toString()):undefined;if(bytes[index]===32)index++;
  if(['object','objdata'].includes(word))fail('rtf_embedded_object_forbidden');if(word==='pict')pictures=true;
  if(word==='bin'){if(!Number.isSafeInteger(number)||number<0||number>10*1024**2||index+number>bytes.length)fail('invalid_rtf');index+=number;}
  index--;
 }
 if(depth!==0||!closed)fail('invalid_rtf');return Object.freeze({valid:true,containsPictures:pictures});
}
export function createLegacyParser(config){
 if(!config||Object.keys(config).some(k=>!['binDir','dataDir','msgWorker','node','tempRoot'].includes(k))||['binDir','dataDir','msgWorker'].some(k=>typeof config[k]!=='string'||!isAbsolute(config[k])||/[\r\n]/.test(config[k]))||(config.node!==undefined&&!isAbsolute(config.node))||(config.tempRoot!==undefined&&!isAbsolute(config.tempRoot)))fail('invalid_legacy_configuration');const fixed={...config,node:config.node??process.execPath};
 return async function parseLegacy(input,options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['signal','maxTextBytes'].includes(k)))fail('invalid_legacy_options');const max=textLimit({maxTextBytes:options.maxTextBytes});if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail('invalid_legacy_signal');if(options.signal?.aborted)fail('document_tool_cancelled');
  const document=inspectDocument(input);if(!['rtf','xls','msg'].includes(document.format))fail('legacy_parser_unavailable');const bytes=Buffer.from(input.bytes),rtf=document.format==='rtf'?validateRtfStructure(bytes):undefined,directory=await mkdtemp(join(fixed.tempRoot??tmpdir(),'localai-legacy-'));
  try{
   const file=join(directory,'input.'+document.format);await writeFile(file,bytes,{mode:0o600,flag:'wx'});const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:directory,TMPDIR:directory};let command,args;
   if(document.format==='rtf'){command=join(fixed.binDir,'unrtf');args=['-P',join(fixed.dataDir,'unrtf'),'--html','--nopict',file];}
   else if(document.format==='xls'){await writeFile(join(directory,'.catdocrc'),'charset_path='+join(fixed.dataDir,'catdoc')+'\nmap_path='+join(fixed.dataDir,'catdoc')+'\nsource_charset=cp1252\ntarget_charset=utf-8\n',{mode:0o600,flag:'wx'});command=join(fixed.binDir,'xls2csv');args=['-d','utf-8','-q','3','-b',SEP,file];}
   else{command=fixed.node;args=['--max-old-space-size=192','--max-semi-space-size=8',fixed.msgWorker,file];}
   const result=await runDocumentTool(command,args,{env,cwd:directory,signal:options.signal,timeoutMs:30000,maxStdoutBytes:document.format==='msg'?4*1024**2:10*1024**2,maxStderrBytes:65536});if(options.signal?.aborted)fail('document_tool_cancelled');
   if(document.format==='msg'){
    let report;try{report=JSON.parse(decodeDocumentUtf8(result.stdout));}catch{fail('invalid_msg_report');}
    if(result.code!==0){if(['invalid_msg','text_output_limit','msg_metadata_limit','msg_attachment_limit','msg_rtf_only_unsupported','msg_html_encoding_unsupported'].includes(report?.error))fail(report.error);fail('invalid_msg');}
    if(report.document?.sha256!==document.sha256||report.parser!=='msgreader-1.29.0'||typeof report.text!=='string'||typeof report.subject!=='string'||Buffer.byteLength(report.subject)>65536||!Array.isArray(report.attachments)||report.attachments.length>20)fail('invalid_msg_report');
    if(Buffer.byteLength(report.text)>max)fail('text_output_limit');return Object.freeze({...report,document});
   }
   if(result.code!==0)fail('invalid_legacy_document');const output=decodeDocumentUtf8(result.stdout);
   if(document.format==='xls')return Object.freeze({document,parser:'xls2csv-0.95-candidate',...decodeLegacyCsv(output,document,{maxTextBytes:max})});
   const html=parseMarkupDocument({name:'converted.html',bytes:result.stdout},{maxTextBytes:10*1024**2,maxFileBytes:10*1024**2});if(Buffer.byteLength(html.text)>max)fail('text_output_limit');const conversionSha256=createHash('sha256').update(result.stdout).digest('hex');
   return Object.freeze({document,parser:'unrtf-0.21.10-html-candidate',text:html.text,units:Object.freeze(html.units.map(unit=>Object.freeze({text:unit.text,source:Object.freeze({...unit.source,kind:'converted-rtf-html-text',documentSha256:document.sha256,conversionSha256,unit:'converted-html-utf16'})}))),warnings:Object.freeze([...html.warnings,'rtf_layout_fields_and_images_not_reconstructed',...(rtf.containsPictures?['rtf_embedded_images_not_extracted']:[])])});
  }finally{await rm(directory,{recursive:true,force:true});}
 };
}
