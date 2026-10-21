import {randomBytes} from 'node:crypto';
import {constants,closeSync,fstatSync,fsyncSync,lstatSync,openSync,readFileSync,unlinkSync,writeSync} from 'node:fs';
import {basename,dirname,isAbsolute} from 'node:path';

const blocked=()=>new Error('interactive_recovery_required');
const syncDirectory=directory=>{const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
const maintenanceBindings=new WeakMap();

export function assertInteractiveMaintenanceBarrier(barrier,journal){
 if(typeof journal!=='string'||!isAbsolute(journal)||!maintenanceBindings.has(barrier)||maintenanceBindings.get(barrier)!==journal)throw new TypeError('invalid_interactive_maintenance_barrier');
}

// An unclean lease leaves this root-owned marker in place across supervisor
// restarts. Background claims must remain stopped until a separate verified
// recovery procedure clears it; merely reopening the service cannot do so.
export function createInteractiveLeaseBarrier({path,journalPath}={}){
 if(process.platform==='win32'||typeof path!=='string'||!isAbsolute(path))throw new TypeError('invalid_interactive_lease_barrier');
 const directory=dirname(path),parent=lstatSync(directory);
 if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o077)!==0)throw new Error('unsafe_interactive_lease_barrier_directory');
 if(journalPath!==undefined&&(typeof journalPath!=='string'||!isAbsolute(journalPath)||dirname(journalPath)!==directory||basename(journalPath)!=='maintenance.json'))throw new TypeError('invalid_interactive_lease_barrier');
 const present=file=>{try{lstatSync(file);return true;}catch(error){if(error?.code==='ENOENT')return false;throw blocked();}};
 const barrier=Object.freeze({
  isClear(){return !present(path)&&!(journalPath&&present(journalPath));},
  begin(){
   const token=randomBytes(32).toString('hex');let fd;
   try{fd=openSync(path,'wx',0o600);writeSync(fd,token);fsyncSync(fd);}
   catch(error){if(error?.code==='EEXIST')throw blocked();throw error;}
   finally{if(fd!==undefined)closeSync(fd);}
   syncDirectory(directory);return token;
  },
  finish(token){
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw blocked();
   let state;try{state=lstatSync(path);if(!state.isFile()||state.uid!==process.getuid()||(state.mode&0o077)!==0||readFileSync(path,'utf8')!==token)throw blocked();}
   catch{throw blocked();}
   unlinkSync(path);syncDirectory(directory);
  },
  async recover(verifyStopped){
   if(typeof verifyStopped!=='function')throw new TypeError('invalid_interactive_recovery_verifier');
   let fd;
   try{
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=fstatSync(fd),token=readFileSync(fd,'utf8');
    if(!before.isFile()||before.nlink!==1||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.size!==64||!/^[a-f0-9]{64}$/.test(token))throw blocked();
    if(await verifyStopped()!==true)throw blocked();
    const after=lstatSync(path);
    if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mode!==before.mode||after.uid!==before.uid||readFileSync(path,'utf8')!==token)throw blocked();
    unlinkSync(path);syncDirectory(directory);
   }catch{throw blocked();}
   finally{if(fd!==undefined)closeSync(fd);}
  }
 });
 maintenanceBindings.set(barrier,journalPath);
 return barrier;
}
