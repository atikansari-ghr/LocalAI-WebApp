import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {addAbortSignal} from 'node:stream';
import {inspectDocument,DocumentError} from './validation.mjs';
const require=createRequire(new URL('./parsers/package.json',import.meta.url)),yauzl=require('yauzl');
const fail=code=>{throw new DocumentError(code);};
export const ZIP_LIMITS=Object.freeze({maxEntries:100,maxEntryBytes:10*1024**2,maxExpandedBytes:50*1024**2,maxCompressionRatio:100,maxArchiveDepth:2,timeoutMs:10000});
const DOCUMENTS=new Set(['txt','md','markdown','json','csv','ics','html','htm','xml','eml','pdf','rtf','png','jpg','jpeg','webp','tif','tiff','docx','xlsx','pptx','odt','ods','odp','zip','xls','msg']);
const EXECUTABLES=new Set(['exe','dll','com','bat','cmd','ps1','sh','js','mjs','cjs','py','so','dylib','class','jar','hta','scr','lnk','msi','vbs','wsf']);
function policyFor(limits){
 if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(key=>!Object.hasOwn(ZIP_LIMITS,key)))fail('invalid_archive_limits');
 const result={...ZIP_LIMITS,...limits};for(const [key,value]of Object.entries(result))if(!Number.isSafeInteger(value)||value<(key==='maxArchiveDepth'?0:1)||value>ZIP_LIMITS[key])fail('invalid_archive_limits');return result;
}
function footerOf(bytes,limit){
 let end=-1;for(let index=bytes.length-22;index>=Math.max(0,bytes.length-65557);index--)if(bytes.readUInt32LE(index)===0x06054b50&&index+22+bytes.readUInt16LE(index+20)===bytes.length){end=index;break;}
 if(end<0)fail('archive_invalid');
 const disk=bytes.readUInt16LE(end+4),centralDisk=bytes.readUInt16LE(end+6),diskEntries=bytes.readUInt16LE(end+8),count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 if(disk||centralDisk||diskEntries!==count)fail('archive_multidisk_unsupported');if(count===65535||size===0xffffffff||offset===0xffffffff)fail('archive_zip64_unsupported');if(count>limit)fail('archive_entry_limit');if(offset+size!==end)fail('archive_invalid');
 let cursor=offset;for(let index=0;index<count;index++){
  if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)fail('archive_invalid');
  const flags=bytes.readUInt16LE(cursor+8),nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),next=cursor+46+nameLength+extraLength+commentLength;
  if(next>end||nameLength>512)fail('archive_invalid');
  if(flags&0x800){try{new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+nameLength));}catch{fail('archive_invalid_name');}}
  const extraEnd=cursor+46+nameLength+extraLength;let extra=cursor+46+nameLength;
  while(extra<extraEnd){
   if(extra+4>extraEnd)fail('archive_invalid');const id=bytes.readUInt16LE(extra),length=bytes.readUInt16LE(extra+2);if(extra+4+length>extraEnd)fail('archive_invalid');
   if(id===0x7075){if(length<5||bytes[extra+4]!==1)fail('archive_invalid_name');try{new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(extra+9,extra+4+length));}catch{fail('archive_invalid_name');}}
   extra+=4+length;
  }
  cursor=next;
 }if(cursor!==end)fail('archive_invalid');return {count,offset};
}
function archivePath(value,directory){
 const name=value.normalize('NFC'),path=directory?name.slice(0,-1):name,parts=path.split('/');
 if(!path||Buffer.byteLength(path)>512||parts.length>16||/[\\:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(path)||parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))fail('archive_unsafe_path');
 return {name:directory?path+'/':path,key:path.toLowerCase(),path};
}
function executableBytes(bytes){if(bytes.length>=4&&['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(bytes.subarray(0,4).toString('hex')))return true;return bytes.subarray(0,4).equals(Buffer.from([127,69,76,70]))||(bytes.length>=64&&bytes[0]===77&&bytes[1]===90)||bytes.subarray(0,2).toString()==='#!';}
async function readArchive(input,state,depth){
 state.check();if(depth>state.policy.maxArchiveDepth)fail('archive_depth_limit');
 const document=inspectDocument(input);if(document.format!=='zip')fail('office_parser_unavailable');
 const bytes=Buffer.from(input.bytes),footer=footerOf(bytes,state.policy.maxEntries-state.entries);state.check();
 const zip=await yauzl.fromBufferPromise(bytes,{autoClose:false,decodeStrings:true,validateEntrySizes:true,strictFileNames:true});
 const entries=[],paths=new Map(),ranges=[];let observed=0;
 try{
  for await(const entry of zip.eachEntry()){
   state.check();observed++;if(++state.entries>state.policy.maxEntries)fail('archive_entry_limit');
   const directory=entry.fileName.endsWith('/'),path=archivePath(entry.fileName,directory),mode=(entry.externalFileAttributes>>>16)&0xffff,type=mode&0o170000;
   if((entry.externalFileAttributes&0x400)||(type&&type!==(directory?0o040000:0o100000))||(!directory&&(mode&0o111)))fail('archive_special_file');
   if(paths.has(path.key)||[...paths].some(([key,isDirectory])=>(path.key.startsWith(key+'/')&&!isDirectory)||(!directory&&key.startsWith(path.key+'/'))))fail('archive_path_collision');paths.set(path.key,directory);
   if(entry.generalPurposeBitFlag&0x41)fail('archive_encrypted');if(entry.generalPurposeBitFlag&~0x80e||![0,8].includes(entry.compressionMethod))fail('archive_compression_unsupported');if(entry.versionNeededToExtract>20)fail('archive_zip64_unsupported');
   const size=entry.uncompressedSize,compressed=entry.compressedSize;
   if(!Number.isSafeInteger(size)||size<0||!Number.isSafeInteger(compressed)||compressed<0||compressed>bytes.length)fail('archive_invalid_size');
   if(size>state.policy.maxEntryBytes)fail('archive_entry_size_limit');if(state.expanded+size>state.policy.maxExpandedBytes)fail('archive_expanded_limit');
   if(size>0&&(!compressed||size/compressed>state.policy.maxCompressionRatio))fail('archive_compression_ratio');
   if(directory&&(size||compressed))fail('archive_invalid_directory');
   const extension=path.path.slice(path.path.lastIndexOf('.')+1).toLowerCase();if(!directory&&(EXECUTABLES.has(extension)||!DOCUMENTS.has(extension)))fail('archive_entry_format_unsupported');
   const local=await zip.readLocalFileHeaderPromise(entry);state.check();
   const localName=yauzl.getFileNameLowLevel(local.generalPurposeBitFlag,local.fileName,entry.extraFields,true);
   if(localName!==entry.fileName||local.generalPurposeBitFlag!==entry.generalPurposeBitFlag||local.compressionMethod!==entry.compressionMethod)fail('archive_header_mismatch');
   const descriptor=Boolean(entry.generalPurposeBitFlag&8);
   for(const [actual,expected]of [[local.crc32,entry.crc32],[local.compressedSize,compressed],[local.uncompressedSize,size]])if(actual!==expected&&!(descriptor&&actual===0))fail('archive_header_mismatch');
   const start=entry.relativeOffsetOfLocalHeader;let end=local.fileDataStart+compressed;
   if(descriptor){
    if(end+12>footer.offset)fail('archive_descriptor_mismatch');
    const signed=bytes.readUInt32LE(end)===0x08074b50,at=end+(signed?4:0);
    if(at+12>footer.offset||bytes.readUInt32LE(at)!==entry.crc32||bytes.readUInt32LE(at+4)!==compressed||bytes.readUInt32LE(at+8)!==size)fail('archive_descriptor_mismatch');
    end=at+12;
   }
   if(!Number.isSafeInteger(start)||start<0||end>footer.offset||ranges.some(range=>start<range.end&&end>range.start))fail('archive_overlapping_records');ranges.push({start,end});
   let content=Buffer.alloc(0),checksum=0;
   if(!directory){
    const stream=addAbortSignal(state.signal,await zip.openReadStreamPromise(entry)),chunks=[];let actual=0;
    for await(const chunk of stream){state.check();actual+=chunk.length;state.expanded+=chunk.length;if(actual>state.policy.maxEntryBytes)fail('archive_entry_size_limit');if(state.expanded>state.policy.maxExpandedBytes)fail('archive_expanded_limit');checksum=crc32(chunk,checksum);chunks.push(chunk);}
    if(actual!==size)fail('archive_size_mismatch');content=Buffer.concat(chunks,actual);
    if(executableBytes(content))fail('archive_executable_content');
   }
   if(checksum!==entry.crc32)fail('archive_crc_mismatch');
   const archive=!directory&&extension==='zip'?await readArchive({name:path.path.split('/').at(-1),bytes:content},state,depth+1):undefined;
   entries.push(Object.freeze({path:path.name,directory,size,sha256:createHash('sha256').update(content).digest('hex'),content,...(archive?{archive}:{}),structure:directory?'directory':archive?'zip-structure-and-crc-passed':'requires-parser-validation'}));
  }
  if(observed!==footer.count)fail('archive_entry_count_mismatch');state.check();
  return Object.freeze({document,validation:'zip-structure-and-crc-passed',entries:Object.freeze(entries)});
 }finally{zip.close();}
}
export async function readZipDocument(input,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['limits','signal'].includes(key)))fail('invalid_archive_options');
 const policy=policyFor(options.limits??{}),caller=options.signal;if(caller!==undefined&&!(caller instanceof AbortSignal))fail('invalid_archive_signal');
 const controller=new AbortController(),deadline=performance.now()+policy.timeoutMs;let timedOut=false;
 const abort=()=>controller.abort(),timer=setTimeout(()=>{timedOut=true;controller.abort();},policy.timeoutMs);timer.unref();caller?.addEventListener('abort',abort,{once:true});if(caller?.aborted)abort();
 const state={policy,signal:controller.signal,entries:0,expanded:0,check(){if(performance.now()>=deadline){timedOut=true;fail('archive_timeout');}controller.signal.throwIfAborted();}};
 try{return await readArchive(input,state,0);}catch(error){if(caller?.aborted)fail('archive_cancelled');if(timedOut)fail('archive_timeout');if(error instanceof DocumentError)throw error;fail('archive_invalid');}
 finally{clearTimeout(timer);caller?.removeEventListener('abort',abort);controller.abort();}
}
