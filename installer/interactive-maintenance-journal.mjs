import {randomUUID} from 'node:crypto';
import {constants,closeSync,existsSync,fchmodSync,fstatSync,fsyncSync,linkSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';

const fail=code=>new Error(code);
const own=()=>process.getuid?.();
function safeDirectory(path,{privateDirectory=false}={}){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||own()===undefined)throw fail('unsafe_interactive_maintenance_journal_directory');
 const state=lstatSync(path);
 if(!state.isDirectory()||state.isSymbolicLink()||state.uid!==own()||(state.mode&(privateDirectory?0o077:0o022))!==0)throw fail(privateDirectory?'unsafe_interactive_maintenance_journal_directory':'unsafe_interactive_maintenance_unit_directory');
}
function syncDirectory(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function safeJournalLocation(journal){
 if(typeof journal!=='string'||!isAbsolute(journal)||resolve(journal)!==journal||basename(journal)!=='maintenance.json')throw fail('unsafe_interactive_maintenance_journal_directory');
 safeDirectory(dirname(journal),{privateDirectory:true});
}
function snapshot(path){
 let fd;
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const before=fstatSync(fd),data=readFileSync(fd),after=lstatSync(path);
  if(!before.isFile()||before.nlink!==1||before.uid!==own()||(before.mode&0o022)!==0||before.size>1024**2||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mode!==before.mode||after.uid!==before.uid||after.nlink!==1)throw fail('unsafe_interactive_maintenance_unit');
  return {data:data.toString('base64'),mode:before.mode&0o777,uid:before.uid,gid:before.gid};
 }catch(error){if(error?.code==='ENOENT')return null;throw fail('unsafe_interactive_maintenance_unit');}
 finally{if(fd!==undefined)closeSync(fd);}
}
function validRecord(record,unitDirectory){
 if(!record||Object.keys(record).sort().join(',')!=='createdAt,files,schemaVersion,unitDirectory'||record.schemaVersion!==1||record.unitDirectory!==unitDirectory||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||!Array.isArray(record.files)||record.files.length!==RECOVERY_UNITS.length)throw fail('unsafe_interactive_maintenance_journal');
 for(let index=0;index<RECOVERY_UNITS.length;index++){
  const file=record.files[index];if(!file||Object.keys(file).sort().join(',')!=='previous,unit'||file.unit!==RECOVERY_UNITS[index])throw fail('unsafe_interactive_maintenance_journal');
  const previous=file.previous;if(previous===null)continue;
  if(!previous||Object.keys(previous).sort().join(',')!=='data,gid,mode,uid'||typeof previous.data!=='string'||previous.data.length>1400000||Buffer.from(previous.data,'base64').toString('base64')!==previous.data||![previous.mode,previous.uid,previous.gid].every(value=>Number.isSafeInteger(value)&&value>=0)||previous.mode>0o777||(previous.mode&0o022)!==0)throw fail('unsafe_interactive_maintenance_journal');
 }
 return record;
}

export function prepareInteractiveMaintenanceJournal({journal,unitDirectory}){
 safeJournalLocation(journal);safeDirectory(unitDirectory);
 try{lstatSync(journal);throw fail('interactive_maintenance_journal_exists');}catch(error){if(error?.code!=='ENOENT')throw error;}
 const record=validRecord({schemaVersion:1,createdAt:new Date().toISOString(),unitDirectory,files:RECOVERY_UNITS.map(unit=>({unit,previous:snapshot(join(unitDirectory,unit))}))},unitDirectory);
 const temporary=join(dirname(journal),'.maintenance-'+randomUUID());let fd;
 try{
  fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(record));fchmodSync(fd,0o600);fsyncSync(fd);closeSync(fd);fd=undefined;
  linkSync(temporary,journal);syncDirectory(dirname(journal));
 }finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
 return record;
}

export function readInteractiveMaintenanceJournal({journal,unitDirectory}){
 safeJournalLocation(journal);safeDirectory(unitDirectory);
 let fd;
 try{
  fd=openSync(journal,constants.O_RDONLY|constants.O_NOFOLLOW);const state=fstatSync(fd);
  if(!state.isFile()||state.nlink!==1||state.uid!==own()||(state.mode&0o077)!==0||state.size>8*1024**2)throw fail('unsafe_interactive_maintenance_journal');
  return validRecord(JSON.parse(readFileSync(fd,'utf8')),unitDirectory);
 }catch{throw fail('unsafe_interactive_maintenance_journal');}
 finally{if(fd!==undefined)closeSync(fd);}
}
