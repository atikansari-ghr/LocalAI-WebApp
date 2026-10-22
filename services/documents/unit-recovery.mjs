import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile),defaultRun=(command,args)=>exec(command,args,{timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
const fail=code=>new Error(code);
const PREFIXES=new Set(['localai-document-job-','localai-document-proof-recovery-']);

// Called only while the privileged supervisor holds its startup lock. Its
// result permits the separate job store to recover interrupted claims.
export async function recoverDocumentUnits({prefix='localai-document-job-',run=defaultRun,onStopped=()=>{}}={}){
 if(!PREFIXES.has(prefix)||typeof run!=='function'||typeof onStopped!=='function')throw new TypeError('invalid_document_recovery_configuration');
 if(run===defaultRun&&(process.platform!=='linux'||process.getuid?.()!==0))throw fail('native_supervisor_required');
 const name=new RegExp('^'+prefix+'[0-9a-f]{8}\\.service$'),command='/usr/bin/systemctl';
 async function inventory(){
  const response=await run(command,['list-units','--all','--type=service','--output=json','--no-pager',prefix+'*.service']);
  if(typeof response?.stdout!=='string'||response.stdout.length>65536)throw fail('native_unit_inventory_invalid');
  let rows;try{rows=JSON.parse(response.stdout);}catch{throw fail('native_unit_inventory_invalid');}
  if(!Array.isArray(rows)||rows.length>64||rows.some(row=>!row||typeof row.unit!=='string'||!name.test(row.unit)||!['active','activating','deactivating','reloading','inactive','failed'].includes(row.active))||new Set(rows.map(row=>row.unit)).size!==rows.length)throw fail('native_unit_inventory_invalid');
  return rows;
 }
 async function check(unit){
  const response=await run(command,['show',unit,'--property=ActiveState','--property=MainPID','--no-pager']);
  const lines=typeof response?.stdout==='string'?response.stdout.trim().split(/\r?\n/):[];
  if(lines.length!==2||!lines.some(line=>line==='MainPID=0')||!lines.some(line=>line==='ActiveState=inactive'||line==='ActiveState=failed'))throw fail('native_cleanup_unconfirmed');
 }
 const first=await inventory();
 for(const row of first)await run(command,['stop',row.unit]);
 for(const row of first)await check(row.unit);
 const second=await inventory(),known=new Set(first.map(row=>row.unit));
 if(second.some(row=>!known.has(row.unit)||!['inactive','failed'].includes(row.active)))throw fail('native_cleanup_unconfirmed');
 for(const row of second)await check(row.unit);
 await onStopped();
 return Object.freeze({stopped:Object.freeze(first.map(row=>row.unit))});
}
