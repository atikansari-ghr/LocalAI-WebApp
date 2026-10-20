import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {invokeDocumentWorker,validDocumentWorkerRequest} from './worker-protocol.mjs';

const exec=promisify(execFile),fail=code=>new Error(code);
async function deadline(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(code)),ms);})]);}finally{clearTimeout(timer);}}

// Root-supervisor candidate. Caller supplies a root-owned, qualified worker
// path; document requests never select an executable, unit or socket path.
export async function runNativeDocumentUnit({request,signal,workerPath,timeoutMs=120000}){
 if(process.platform!=='linux'||process.getuid?.()!==0)throw fail('native_supervisor_required');
 if(typeof workerPath!=='string'||!isAbsolute(workerPath)||!workerPath.startsWith('/opt/localai/')||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000||signal!==undefined&&!(signal instanceof AbortSignal))throw new TypeError('invalid_document_unit_configuration');
 if(!validDocumentWorkerRequest(request))throw new TypeError('invalid_document_worker_request');
 const worker=lstatSync(workerPath);if(!worker.isFile()||worker.uid!==0||(worker.mode&0o022)!==0)throw fail('unsafe_document_worker');
 for(let parent=dirname(workerPath);parent!=='/';parent=dirname(parent)){const entry=lstatSync(parent);if(!entry.isDirectory()||entry.uid!==0||(entry.mode&0o022)!==0)throw fail('unsafe_document_worker');}
 if(signal?.aborted)throw fail('document_cancelled');
 const runtime='localai-document-job-'+randomBytes(4).toString('hex'),unit=runtime+'.service',socketPath='/run/'+runtime+'/worker.sock';
 const args=['--wait','--collect','--pipe','--unit='+unit,'-p','Slice=localai-ai.slice','-p','DynamicUser=yes','-p','RuntimeDirectory='+runtime,'-p','RuntimeDirectoryMode=0700','-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectHome=yes','-p','ProtectSystem=strict','-p','NoNewPrivileges=yes','-p','RestrictSUIDSGID=yes','-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=100%','-p','TasksMax=32','-p','RuntimeMaxSec=120','-p','InaccessiblePaths=/var/lib/localai /var/lib/localai-models /opt/localai/ai /etc/localai /run/credentials','-E','LOCALAI_DOCUMENT_SOCKET='+socketPath,'/opt/localai/node/bin/node',workerPath];
 const child=spawn('/usr/bin/systemd-run',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
 let output='',outputBytes=0,fatalError,fatalReject,readyResolve,readyReject,readySettled=false,exitResolve,exitReject,exitSettled=false;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),exited=new Promise((resolve,reject)=>{exitResolve=resolve;exitReject=reject;});void ready.catch(()=>{});void exited.catch(()=>{});
 const fatal=new Promise((_,reject)=>{fatalReject=reject;});void fatal.catch(()=>{});
 const observe=promise=>Promise.race([promise,fatal]);
 const settleReady=error=>{if(readySettled)return;readySettled=true;if(error)readyReject(error);else readyResolve();};
 const collect=chunk=>{if(fatalError)return;if(outputBytes+chunk.length>65536){fatalError=fail('document_worker_output_limit');fatalReject(fatalError);settleReady(fatalError);return;}outputBytes+=chunk.length;output+=chunk.toString();if(output.includes('document_worker_ready'))settleReady();};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 child.once('error',error=>{settleReady(error);if(!exitSettled){exitSettled=true;exitReject(error);}});
 child.once('close',code=>{settleReady(fail('document_worker_unavailable'));if(!exitSettled){exitSettled=true;exitResolve(code);}});
 const cancel=()=>settleReady(fail('document_cancelled'));signal?.addEventListener('abort',cancel,{once:true});
 async function stopped(){const response=await exec('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=MainPID','--no-pager'],{timeout:5000,maxBuffer:8192});const lines=response.stdout.trim().split(/\r?\n/);if(lines.length!==2||!lines.includes('MainPID=0')||!lines.some(line=>line==='ActiveState=inactive'||line==='ActiveState=failed'))throw fail('native_cleanup_unconfirmed');}
 try{
  await deadline(observe(ready),10000,'document_worker_start_timeout');
  if(signal?.aborted)throw fail('document_cancelled');
  const result=await observe(invokeDocumentWorker({socketPath,request,signal,timeoutMs}));
  if(await deadline(observe(exited),10000,'document_worker_exit_timeout')!==0)throw fail('document_worker_failed');
  await observe(stopped());if(fatalError)throw fatalError;if(signal?.aborted)throw fail('document_cancelled');
  return Object.freeze({result,unit,cleanupConfirmed:true});
 }catch(error){
  await exec('/usr/bin/systemctl',['stop',unit],{timeout:10000,maxBuffer:8192}).catch(()=>{});
  try{await deadline(exited,10000,'document_worker_exit_timeout');await stopped();}catch{throw fail('native_cleanup_unconfirmed');}
  throw error;
 }finally{signal?.removeEventListener('abort',cancel);child.kill();}
}
