import {execFileSync} from 'node:child_process';
import {fstatSync,lstatSync} from 'node:fs';

// flock operates on the inherited open file description. Re-locking each fd
// either confirms the shell's lock or acquires it for this Node process.
export function assertInheritedMaintenanceLocks({installPath='/opt/localai/install.lock',runtimePath='/run/lock/localai-ai.lock'}={}){
 if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('interactive_maintenance_locks_required');
 const stdio=Array.from({length:10},()=> 'ignore');stdio[8]=8;stdio[9]=9;
 for(const [fd,path] of [[9,installPath],[8,runtimePath]]){
  let open,file;
  try{open=fstatSync(fd);file=lstatSync(path);}
  catch{throw new Error('interactive_maintenance_locks_required');}
  if(!open.isFile()||!file.isFile()||file.isSymbolicLink()||open.dev!==file.dev||open.ino!==file.ino||open.uid!==0||file.uid!==0||open.nlink!==1||file.nlink!==1||(open.mode&0o022)!==0)throw new Error('interactive_maintenance_locks_required');
  try{execFileSync('/usr/bin/flock',['-n',String(fd),'/usr/bin/true'],{stdio,timeout:5000});}
  catch{throw new Error('interactive_maintenance_locks_required');}
 }
 return true;
}
