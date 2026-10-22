import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {inspectDocument,DocumentError} from './validation.mjs';
import {parseMarkupDocument} from './markup.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),PostalMime=require('postal-mime');
const fail=code=>{throw new DocumentError(code);};
function safeName(value,index){const name=typeof value==='string'?value.normalize('NFC'):'';return name&&Buffer.byteLength(name)<=255&&!/[\\/:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)&&!['.','..'].includes(name)?name:'attachment-'+index+'.bin';}
export async function parseEmailDocument(input,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['signal','maxTextBytes'].includes(k)))fail('invalid_email_options');
 const max=options.maxTextBytes??1024**2;if(!Number.isSafeInteger(max)||max<1||max>1024**2)fail('invalid_email_limits');if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail('invalid_email_signal');
 const started=performance.now(),check=()=>{if(options.signal?.aborted)fail('archive_cancelled');if(performance.now()-started>10000)fail('email_timeout');};check();
 const document=inspectDocument(input);if(document.format!=='eml')fail('email_parser_unavailable');const bytes=Buffer.from(input.bytes),raw=bytes.toString('latin1'),separator=/\r?\n\r?\n/.exec(raw);if(!separator||separator.index>65536)fail('invalid_email');
 const header=raw.slice(0,separator.index);if(!/^[!-9;-~]+:/.test(header)||header.split(/\r?\n/).some((line,index)=>index===0?!/^[!-9;-~]+:/.test(line):!/^(?:[!-9;-~]+:|[ \t])/.test(line)))fail('invalid_email');
 let parsed;try{parsed=await PostalMime.parse(bytes,{maxNestingDepth:16,maxHeadersSize:65536,maxPartCount:100,maxRfc822NestingDepth:0,maxForwardedAddresses:100,forceRfc822Attachments:true,attachmentEncoding:'arraybuffer'});}catch{fail('invalid_email');}check();
 const ctypes=parsed.headers.filter(h=>h.key==='content-type');if(ctypes.length>1||parsed.headers.filter(h=>h.key==='content-transfer-encoding').length>1)fail('invalid_email');
 if(ctypes.some(h=>/^(?:multipart\/encrypted|application\/(?:x-)?pkcs7-mime)(?:\s*;|$)/i.test(h.value)))fail('encrypted_email_unsupported');
 const warnings=new Set(['email_decoded_body_has_no_raw_byte_offsets','email_sender_metadata_not_authenticated','email_attachments_not_recursively_parsed']);let text=parsed.text??'',representation='plain';
 if(!text&&parsed.html){const html=parseMarkupDocument({name:'body.html',bytes:Buffer.from(parsed.html)},{maxTextBytes:1024**2});text=html.text;representation='html-to-text';for(const warning of html.warnings)warnings.add(warning);}
 if(Buffer.byteLength(text)>max)fail('text_output_limit');
 const subject=parsed.subject??'';if(Buffer.byteLength(subject)>65536)fail('email_metadata_limit');
 if(parsed.attachments.length>20)fail('email_attachment_limit');let total=0;
 const attachments=parsed.attachments.map((attachment,index)=>{
  check();const content=Buffer.from(attachment.content),name=safeName(attachment.filename,index+1);total+=content.length;if(content.length>10*1024**2||total>10*1024**2)fail('email_attachment_size_limit');if(name!==attachment.filename)warnings.add('email_attachment_name_replaced');if(attachment.rfc822DepthExceeded)warnings.add('email_nested_message_uninspected');
  const representation=['text/calendar','application/ics'].includes(attachment.mimeType)?'normalized-utf8-calendar':'mime-transfer-decoded';
  return Object.freeze({name,mediaType:attachment.mimeType,size:content.length,sha256:createHash('sha256').update(content).digest('hex'),content,representation,structure:'requires-parser-validation',source:Object.freeze({kind:'decoded-email-attachment',messageSha256:document.sha256,index:index+1})});
 });check();
 const units=text?[Object.freeze({text,source:Object.freeze({kind:'decoded-email-body',messageSha256:document.sha256,representation,unit:'decoded-body'})})]:[];
 return Object.freeze({document,parser:'postal-mime-4.0.11',subject,text,units:Object.freeze(units),attachments:Object.freeze(attachments),warnings:Object.freeze([...warnings])});
}
