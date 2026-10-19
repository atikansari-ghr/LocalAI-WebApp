import {createRequire} from 'node:module';
import {inspectDocument,DocumentError} from './validation.mjs';
import {parseMarkupDocument} from './markup.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),MsgReader=require('@kenjiuno/msgreader').default;
const fail=code=>{throw new DocumentError(code);};
function binaryHtml(parsed){
 const bytes=parsed.html;if(!(bytes instanceof Uint8Array)||bytes.length>10*1024**2)fail('invalid_msg');
 const codepage=parsed.internetCodepage??parsed.messageCodepage??65001;
 const label=codepage===65001?'utf-8':codepage===1200?'utf-16le':codepage===1201?'utf-16be':Number.isInteger(codepage)&&codepage>=1250&&codepage<=1258?'windows-'+codepage:undefined;
 if(!label)fail('msg_html_encoding_unsupported');try{return new TextDecoder(label,{fatal:true}).decode(bytes);}catch{fail('msg_html_encoding_unsupported');}
}
// Pure decoding entry point for the isolated worker. Never call it in a public gateway process.
export function parseMsgDocument(input,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='maxTextBytes'))fail('invalid_msg_options');const max=options.maxTextBytes??1024**2;if(!Number.isSafeInteger(max)||max<1||max>1024**2)fail('invalid_msg_limits');
 const document=inspectDocument(input);if(document.format!=='msg')fail('msg_parser_unavailable');let parsed;const bytes=new Uint8Array(input.bytes);if(bytes.length<512)fail('invalid_msg');
 try{parsed=new MsgReader(bytes.buffer).getFileData();}catch{fail('invalid_msg');}if(!parsed||parsed.error||typeof parsed.messageClass!=='string'||!parsed.messageClass||parsed.messageClass.length>256)fail('invalid_msg');
 const warnings=new Set(['msg_sender_metadata_not_authenticated','msg_decoded_content_has_no_raw_byte_offsets','msg_attachments_not_extracted']);let text=typeof parsed.body==='string'?parsed.body:'',representation='plain';
 if(!text&&typeof parsed.bodyHtml==='string'){text=parseMarkupDocument({name:'body.html',bytes:Buffer.from(parsed.bodyHtml)}).text;representation='html-to-text';}
 if(!text&&parsed.html instanceof Uint8Array){text=parseMarkupDocument({name:'body.html',bytes:Buffer.from(binaryHtml(parsed))}).text;representation='html-to-text';}
 if(!text&&parsed.compressedRtf)fail('msg_rtf_only_unsupported');
 if(text.includes('\0'))fail('invalid_msg');if(Buffer.byteLength(text)>max)fail('text_output_limit');const subject=typeof parsed.subject==='string'?parsed.subject:'';if(Buffer.byteLength(subject)>65536)fail('msg_metadata_limit');
 const raw=parsed.attachments??[];if(!Array.isArray(raw)||raw.length>20)fail('msg_attachment_limit');const attachments=raw.map((attachment,index)=>{
  const original=attachment.fileName??attachment.fileNameShort??'',name=typeof original==='string'?original.normalize('NFC'):'';
  const safe=name&&Buffer.byteLength(name)<=255&&!/[\\/:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)&&!['.','..'].includes(name)?name:'attachment-'+(index+1)+'.bin';if(safe!==original)warnings.add('msg_attachment_name_replaced');
  return Object.freeze({name:safe,structure:'requires-attachment-extraction',source:Object.freeze({kind:'msg-attachment-metadata',documentSha256:document.sha256,index:index+1})});
 });
 const units=text?[Object.freeze({text,source:Object.freeze({kind:'decoded-msg-body',documentSha256:document.sha256,representation,unit:'decoded-body'})})]:[];
 return Object.freeze({document,parser:'msgreader-1.29.0',subject,text,units:Object.freeze(units),attachments:Object.freeze(attachments),warnings:Object.freeze([...warnings])});
}
