import {createHash} from 'node:crypto';

export class DocumentError extends Error{constructor(code){super(code);this.name='DocumentError';this.code=code;}}
const fail=code=>{throw new DocumentError(code);};
export const DOCUMENT_LIMITS=Object.freeze({maxFileBytes:10*1024**2,maxTextBytes:1024**2});
const formats={
 txt:['text/plain','text'],md:['text/markdown','text','text/plain'],markdown:['text/markdown','text','text/plain'],
 json:['application/json','text'],csv:['text/csv','text','application/csv'],ics:['text/calendar','text'],
 html:['text/html','text'],htm:['text/html','text'],xml:['application/xml','text','text/xml'],eml:['message/rfc822','text'],
 pdf:['application/pdf','pdf'],rtf:['application/rtf','rtf','text/rtf'],
 png:['image/png','png'],jpg:['image/jpeg','jpeg'],jpeg:['image/jpeg','jpeg'],webp:['image/webp','webp'],tif:['image/tiff','tiff'],tiff:['image/tiff','tiff'],
 docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document','zip'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','zip'],pptx:['application/vnd.openxmlformats-officedocument.presentationml.presentation','zip'],
 odt:['application/vnd.oasis.opendocument.text','zip'],ods:['application/vnd.oasis.opendocument.spreadsheet','zip'],odp:['application/vnd.oasis.opendocument.presentation','zip'],zip:['application/zip','zip','application/x-zip-compressed'],
 xls:['application/vnd.ms-excel','ole'],msg:['application/vnd.ms-outlook','ole']
};
const prefix=(bytes,value)=>bytes.subarray(0,value.length).equals(Buffer.from(value));
function binaryKind(bytes){
 if(prefix(bytes,'%PDF-'))return 'pdf';
 if(prefix(bytes,[137,80,78,71,13,10,26,10]))return 'png';
 if(prefix(bytes,[255,216,255]))return 'jpeg';
 if(prefix(bytes,'RIFF')&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'webp';
 if(prefix(bytes,[73,73,42,0])||prefix(bytes,[77,77,0,42]))return 'tiff';
 if(prefix(bytes,[80,75,3,4])||prefix(bytes,[80,75,5,6]))return 'zip';
 if(prefix(bytes,[208,207,17,224,161,177,26,225]))return 'ole';
 if(prefix(bytes,'{\\rtf'))return 'rtf';
 return null;
}
export function decodeDocumentUtf8(bytes){
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))fail('invalid_text');return text;}
 catch(error){if(error instanceof DocumentError)throw error;fail('invalid_utf8');}
}
export function inspectDocument(input,limits={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['name','mime','bytes'].includes(key)))fail('invalid_document');
 if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(key=>!Object.hasOwn(DOCUMENT_LIMITS,key)))fail('invalid_limits');
 const policy={...DOCUMENT_LIMITS,...limits};
 if(Object.values(policy).some(value=>!Number.isSafeInteger(value)||value<1||value>50*1024**2))fail('invalid_limits');
 if(typeof input.name!=='string')fail('invalid_name');const name=input.name.normalize('NFC');
 if(!name||Buffer.byteLength(name)>255||/[\\/:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)||name==='.'||name==='..')fail('invalid_name');
 const dot=name.lastIndexOf('.');if(dot<1)fail('unsupported_format');
 const extension=name.slice(dot+1).toLowerCase(),format=Object.hasOwn(formats,extension)?formats[extension]:null;
 if(!format)fail('unsupported_format');
 const [mediaType,kind,...aliases]=format;
 if(input.mime!==undefined&&(typeof input.mime!=='string'||![mediaType,...aliases].includes(input.mime.split(';')[0].trim().toLowerCase())))fail('media_type_mismatch');
 if(!(input.bytes instanceof Uint8Array)||input.bytes.byteLength<1||input.bytes.buffer instanceof SharedArrayBuffer)fail('invalid_bytes');
 if(input.bytes.byteLength>policy.maxFileBytes||(kind==='text'&&input.bytes.byteLength>policy.maxTextBytes))fail('document_too_large');
 const bytes=Buffer.from(input.bytes),detected=binaryKind(bytes);
 if(kind==='text'){if(detected)fail('magic_mismatch');decodeDocumentUtf8(bytes);}
 else if(detected!==kind)fail('magic_mismatch');
 return Object.freeze({name,format:({markdown:'md',htm:'html',jpg:'jpeg',tif:'tiff'})[extension]??extension,kind,mediaType,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),structure:kind==='zip'||kind==='ole'?'requires-container-validation':'requires-parser-validation'});
}
