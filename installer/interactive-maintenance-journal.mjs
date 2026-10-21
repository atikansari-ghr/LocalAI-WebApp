import {randomUUID} from 'node:crypto';
import {constants,closeSync,existsSync,fchmodSync,fchownSync,fstatSync,fsyncSync,linkSync,lstatSync,openSync,readFileSync,readlinkSync,renameSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';

const fail=code=>new Error(code);
const own=()=>process.getuid?.();
function selectedUnits(units){
 if(units===undefined)return RECOVERY_UNITS;
 if(!Array.isArray(units)||units.length!==4||units.some(unit=>typeof unit!=='string'))throw fail('invalid_interactive_maintenance_units');
 if(units.every((unit,index)=>unit===RECOVERY_UNITS[index]))return RECOVERY_UNITS;
 const match=/^localai-recovery-([0-9a-f]{8})-gateway\.service$/.exec(units[0]);
 if(process.env.TARGET_TEST_LXC!=='disposable'||process.platform!=='linux'||own()!==0||!match||units.some((unit,index)=>unit!==`localai-recovery-${match[1]}-${['gateway','chat','embedding','supervisor'][index]}.service`))throw fail('invalid_interactive_maintenance_units');
 return Object.freeze([...units]);
}
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
  const before=fstatSync(fd);
  if(!before.isFile()||before.nlink!==1||before.uid!==own()||(before.mode&0o022)!==0||before.size>1024**2)throw fail('unsafe_interactive_maintenance_unit');
  const data=readFileSync(fd),after=lstatSync(path);
  if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mode!==before.mode||after.uid!==before.uid||after.nlink!==1||data.length!==before.size)throw fail('unsafe_interactive_maintenance_unit');
  return {data:data.toString('base64'),mode:before.mode&0o777,uid:before.uid,gid:before.gid};
 }catch(error){if(error?.code==='ENOENT')return null;throw fail('unsafe_interactive_maintenance_unit');}
 finally{if(fd!==undefined)closeSync(fd);}
}
function validServices(serviceStates,files,units){
 if(!serviceStates||typeof serviceStates!=='object'||Object.keys(serviceStates).sort().join(',')!==[...units].sort().join(','))throw fail('unsafe_interactive_maintenance_service_state');
 for(let index=0;index<units.length;index++){
  const state=serviceStates[units[index]];
  if(!state||Object.keys(state).sort().join(',')!=='active,available,enabled'||Object.values(state).some(value=>typeof value!=='boolean')||state.available!==Boolean(files[index].previous)||!state.available&&(state.active||state.enabled))throw fail('unsafe_interactive_maintenance_service_state');
 }
 return serviceStates;
}
function validRecord(record,unitDirectory,units){
 if(!record||Object.keys(record).sort().join(',')!=='createdAt,files,schemaVersion,services,unitDirectory'||record.schemaVersion!==2||record.unitDirectory!==unitDirectory||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||!Array.isArray(record.files)||record.files.length!==units.length)throw fail('unsafe_interactive_maintenance_journal');
 for(let index=0;index<units.length;index++){
  const file=record.files[index];if(!file||Object.keys(file).sort().join(',')!=='previous,unit'||file.unit!==units[index])throw fail('unsafe_interactive_maintenance_journal');
  const previous=file.previous;if(previous===null)continue;
  if(!previous||Object.keys(previous).sort().join(',')!=='data,gid,mode,uid'||typeof previous.data!=='string'||previous.data.length>1400000||Buffer.from(previous.data,'base64').toString('base64')!==previous.data||![previous.mode,previous.uid,previous.gid].every(value=>Number.isSafeInteger(value)&&value>=0)||previous.mode>0o777||(previous.mode&0o022)!==0)throw fail('unsafe_interactive_maintenance_journal');
 }
 validServices(record.services,record.files,units);
 return record;
}

export function prepareInteractiveMaintenanceJournal({journal,unitDirectory,serviceStates,units}){
 units=selectedUnits(units);
 safeJournalLocation(journal);safeDirectory(unitDirectory);
 try{lstatSync(journal);throw fail('interactive_maintenance_journal_exists');}catch(error){if(error?.code!=='ENOENT')throw error;}
 const files=units.map(unit=>({unit,previous:snapshot(join(unitDirectory,unit))}));
 const services=validServices(serviceStates,files,units);
 const record=validRecord({schemaVersion:2,createdAt:new Date().toISOString(),unitDirectory,files,services},unitDirectory,units);
 const temporary=join(dirname(journal),'.maintenance-'+randomUUID());let fd;
 try{
  fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(record));fchmodSync(fd,0o600);fsyncSync(fd);closeSync(fd);fd=undefined;
  linkSync(temporary,journal);syncDirectory(dirname(journal));
 }finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
 return record;
}

export function readInteractiveMaintenanceJournal({journal,unitDirectory,units}){
 units=selectedUnits(units);
 safeJournalLocation(journal);safeDirectory(unitDirectory);
 let fd;
 try{
  fd=openSync(journal,constants.O_RDONLY|constants.O_NOFOLLOW);const state=fstatSync(fd);
  if(!state.isFile()||state.nlink!==1||state.uid!==own()||(state.mode&0o077)!==0||state.size>8*1024**2)throw fail('unsafe_interactive_maintenance_journal');
  return validRecord(JSON.parse(readFileSync(fd,'utf8')),unitDirectory,units);
 }catch{throw fail('unsafe_interactive_maintenance_journal');}
 finally{if(fd!==undefined)closeSync(fd);}
}

function currentState(path,previous){
 let state;try{state=lstatSync(path);}catch(error){if(error?.code==='ENOENT')return 'missing';throw fail('interactive_maintenance_unit_changed');}
 if(state.isSymbolicLink()){
  if(state.uid===own()&&state.nlink===1&&readlinkSync(path)==='/dev/null')return 'masked';
  throw fail('interactive_maintenance_unit_changed');
 }
 if(previous===null)throw fail('interactive_maintenance_unit_changed');
 let observed;try{observed=snapshot(path);}catch{throw fail('interactive_maintenance_unit_changed');}
 if(!observed||observed.data!==previous.data||observed.mode!==previous.mode||observed.uid!==previous.uid||observed.gid!==previous.gid)throw fail('interactive_maintenance_unit_changed');
 return 'original';
}
function installMask(path,hadOriginal){
 if(!hadOriginal){symlinkSync('/dev/null',path);syncDirectory(dirname(path));return;}
 const temporary=join(dirname(path),'.'+basename(path)+'.mask-'+randomUUID());
 try{symlinkSync('/dev/null',temporary);renameSync(temporary,path);syncDirectory(dirname(path));}
 finally{try{unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT')throw error;}}
}
export function applyInteractiveUnitMasks({journal,unitDirectory,units}){
 const record=readInteractiveMaintenanceJournal({journal,unitDirectory,units});
 for(const file of record.files){const state=currentState(join(unitDirectory,file.unit),file.previous);if(state!==(file.previous?'original':'missing'))throw fail('interactive_maintenance_unit_changed');}
 for(const file of record.files)installMask(join(unitDirectory,file.unit),file.previous!==null);
 return record;
}
function restoreFile(path,previous){
 if(previous===null){unlinkSync(path);syncDirectory(dirname(path));return;}
 const temporary=join(dirname(path),'.'+basename(path)+'.restore-'+randomUUID());let fd;
 try{
  fd=openSync(temporary,'wx',previous.mode);writeFileSync(fd,Buffer.from(previous.data,'base64'));fchmodSync(fd,previous.mode);fchownSync(fd,previous.uid,previous.gid);fsyncSync(fd);closeSync(fd);fd=undefined;
  renameSync(temporary,path);syncDirectory(dirname(path));
 }finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch(error){if(error?.code!=='ENOENT')throw error;}}
}
export function restoreInteractiveUnitFiles({journal,unitDirectory,units}){
 const record=readInteractiveMaintenanceJournal({journal,unitDirectory,units});
 const states=record.files.map(file=>currentState(join(unitDirectory,file.unit),file.previous));
 for(let index=0;index<record.files.length;index++){
  const file=record.files[index],state=states[index];
  if(file.previous===null&&state!=='missing'&&state!=='masked'||file.previous!==null&&state!=='original'&&state!=='masked')throw fail('interactive_maintenance_unit_changed');
 }
 for(let index=0;index<record.files.length;index++)if(states[index]==='masked')restoreFile(join(unitDirectory,record.files[index].unit),record.files[index].previous);
 return record;
}
