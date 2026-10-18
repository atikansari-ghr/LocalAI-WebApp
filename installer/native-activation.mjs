import {lstatSync,mkdirSync,readFileSync,openSync,writeFileSync,fchmodSync,fchownSync,fsyncSync,closeSync,renameSync,unlinkSync,fstatSync,constants} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const NATIVE_SERVICES=Object.freeze(['localai-chat.service','localai-embedding.service','localai.service']);
const owner=()=>process.getuid?.()??0,group=()=>process.getgid?.()??0;
function directorySync(path){if(process.platform==='win32')return;const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function atomicFile(path,content,{mode=0o600,uid=owner(),gid=group()}={}){
 mkdirSync(dirname(path),{recursive:true,mode:0o755});const temporary=path+'.'+randomUUID(),fd=openSync(temporary,'wx',mode);
 try{writeFileSync(fd,content);fchmodSync(fd,mode);if(process.platform!=='win32')fchownSync(fd,uid,gid);fsyncSync(fd);}finally{closeSync(fd);}
 try{renameSync(temporary,path);directorySync(dirname(path));}finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function snapshot(path){
 try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024**2||(process.platform!=='win32'&&(stat.uid!==owner()||(stat.mode&0o022)!==0)))throw new Error('Unsafe activation target');return {data:readFileSync(path).toString('base64'),mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid};}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function validatePaths(paths){if(!Array.isArray(paths)||paths.length<1||paths.length>8||new Set(paths).size!==paths.length||paths.some(path=>typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path))throw new Error('Explicit canonical activation paths required');}
function serviceState(value){if(!value||Object.keys(value).sort().join(',')!=='active,available,enabled'||Object.values(value).some(v=>typeof v!=='boolean')||(!value.available&&(value.active||value.enabled)))throw new Error('Invalid service snapshot');return {...value};}
export function readNativeJournal(journal){
 const fd=openSync(journal,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>8*1024**2||(process.platform!=='win32'&&(stat.uid!==owner()||(stat.mode&0o077)!==0)))throw new Error('Unsafe recovery journal');return JSON.parse(readFileSync(fd,'utf8'));}
 finally{closeSync(fd);}
}
function validateJournal(record,allowedPaths){
 validatePaths(allowedPaths);
 if(!record||Object.keys(record).sort().join(',')!=='files,revision,schemaVersion,services'||record.schemaVersion!==1||(record.revision!==null&&!/^[a-f0-9]{40}$/.test(record.revision))||!Array.isArray(record.files)||record.files.length!==allowedPaths.length||new Set(record.files.map(file=>file.path)).size!==allowedPaths.length)throw new Error('Invalid recovery journal');
 for(const file of record.files){if(!allowedPaths.includes(file.path)||Object.keys(file).sort().join(',')!=='path,previous')throw new Error('Unexpected recovery path');if(file.previous!==null){const p=file.previous;if(!p||Object.keys(p).sort().join(',')!=='data,gid,mode,uid'||typeof p.data!=='string'||p.data.length>1500000||Buffer.from(p.data,'base64').toString('base64')!==p.data||![p.mode,p.uid,p.gid].every(n=>Number.isSafeInteger(n)&&n>=0)||p.mode>0o777)throw new Error('Invalid prior file snapshot');}}
 if(!record.services||Object.keys(record.services).sort().join(',')!==[...NATIVE_SERVICES].sort().join(','))throw new Error('Invalid recovery services');for(const name of NATIVE_SERVICES)serviceState(record.services[name]);
 return record;
}
export async function recoverNativeRuntime({journal,allowedPaths,control}){
 const record=validateJournal(readNativeJournal(journal),allowedPaths);
 for(const name of NATIVE_SERVICES){await control.stop(name);await control.setEnabled(name,false);}
 for(const file of record.files){if(file.previous===null){try{unlinkSync(file.path);directorySync(dirname(file.path));}catch(error){if(error.code!=='ENOENT')throw error;}}else atomicFile(file.path,Buffer.from(file.previous.data,'base64'),file.previous);}
 await control.reload();
 for(const name of NATIVE_SERVICES){const previous=record.services[name];await control.setEnabled(name,previous.enabled);if(previous.active)await control.restart(name);else await control.stop(name);}
 unlinkSync(journal);directorySync(dirname(journal));
}
export async function activateNativeRuntime({journal,allowedPaths,updates,control,verify,revision=null}){
 validatePaths(allowedPaths);
 if(!Array.isArray(updates)||updates.length!==allowedPaths.length||new Set(updates.map(update=>update.path)).size!==allowedPaths.length||updates.some(update=>!allowedPaths.includes(update.path)||!Number.isSafeInteger(update.mode)||update.mode<0||update.mode>0o777||(update.mode&0o022)!==0||!(typeof update.content==='string'||Buffer.isBuffer(update.content))||Buffer.byteLength(update.content)>1024**2))throw new Error('Invalid activation update');
 try{lstatSync(journal);throw new Error('Pending native activation must be recovered first');}catch(error){if(error.code!=='ENOENT')throw error;}
 const files=allowedPaths.map(path=>({path,previous:snapshot(path)})),services={};for(const name of NATIVE_SERVICES)services[name]=serviceState(await control.capture(name));
 const record=validateJournal({schemaVersion:1,revision,files,services},allowedPaths);atomicFile(journal,JSON.stringify(record));
 try{
  for(const name of NATIVE_SERVICES.slice(0,2))await control.stop(name);
  for(const update of updates)atomicFile(update.path,update.content,update);
  await control.reload();
  for(const name of NATIVE_SERVICES.slice(0,2)){await control.setEnabled(name,true);await control.restart(name);}
  await control.restart('localai.service');await verify();
  unlinkSync(journal);directorySync(dirname(journal));
 }catch(error){try{await recoverNativeRuntime({journal,allowedPaths,control});}catch(recovery){throw new AggregateError([error,recovery],'Activation and recovery failed; protected journal retained');}throw error;}
}
