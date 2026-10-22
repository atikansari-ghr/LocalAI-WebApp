// Root-only synthetic proof. Never points at the enrolled document state.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {invokeDocumentWorker} from '../../services/documents/worker-protocol.mjs';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
async function deadline(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),ms);})]);}finally{clearTimeout(timer);}}

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),tag=randomUUID().slice(0,8),runtime='localai-document-proof-'+tag,unit=runtime+'.service',socketPath='/run/'+runtime+'/worker.sock';
const show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim(),beforePid=await show('localai.service','MainPID');
const directory=await mkdtemp(join(tmpdir(),'localai-native-job-proof-'));
const vault=initializeVault(join(directory,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(directory,'jobs.sqlite'),{vault});
const input=Buffer.from('مرحبا Native Worker'),job=store.enqueue({namespace:'app:synthetic',scope:'private',kind:'extract',idempotencyKey:'nativeproofkey12345',name:'native.txt',mime:'text/plain',bytes:input,expiresAt:Date.now()+60000,options:{ocr:'off',language:'auto'}}),claim=store.claim();
assert.equal(claim.id,job.id);
let child,output='',settled=false;
try{
 const args=['--wait','--collect','--pipe','--unit='+unit,
  '-p','Slice=localai-ai.slice','-p','DynamicUser=yes','-p','Group=localai-runtime','-p','RuntimeDirectory='+runtime,'-p','RuntimeDirectoryMode=0750',
  '-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectHome=yes','-p','ProtectSystem=strict',
  '-p','NoNewPrivileges=yes','-p','RestrictSUIDSGID=yes','-p','MemoryMax=256M','-p','MemorySwapMax=0','-p','CPUQuota=100%','-p','TasksMax=32','-p','RuntimeMaxSec=120',
  '-p','InaccessiblePaths=/var/lib/localai /var/lib/localai-models /opt/localai/ai /etc/localai /run/credentials',
  '-E','LOCALAI_DOCUMENT_SOCKET='+socketPath,'/opt/localai/node/bin/node','/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs'];
 child=spawn('/usr/bin/systemd-run',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('close',resolve));
 const ready=new Promise((resolve,reject)=>{const collect=chunk=>{output+=chunk.toString();if(output.length>65536){child.kill();reject(new Error('worker_output_limit'));}if(output.includes('document_worker_ready'))resolve();};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',reject);child.once('close',code=>{if(!settled)reject(new Error('worker_exited_before_ready_'+code+' '+output.slice(-500)));});});
 await deadline(ready,10000,'native_worker_start_timeout');settled=true;
 const result=await invokeDocumentWorker({socketPath,request:{kind:claim.kind,name:claim.name,mime:claim.mime,content_base64:claim.bytes.toString('base64'),options:claim.options},timeoutMs:10000});
 assert.equal(result.text,'مرحبا Native Worker');assert.equal(result.parser,'localai-txt-v1');
 assert.throws(()=>store.complete(claim.id,claim.token,result),/native_cleanup_required/);
 assert.equal(store.get(job.id,'app:synthetic','private').status,'running');
 assert.equal(await deadline(exited,10000,'native_worker_exit_timeout'),0);
 store.complete(claim.id,claim.token,result,{nativeCleanupConfirmed:true});
 assert.deepEqual(store.result(job.id,'app:synthetic','private'),result);
 store.close();const raw=Buffer.concat((await Promise.all((await readdir(directory)).filter(name=>name.startsWith('jobs.sqlite')).map(name=>readFile(join(directory,name)))))).toString('utf8');
 assert.equal(raw.includes('مرحبا Native Worker'),false);
 assert.match(output,/Memory peak: .*swap: 0B/);assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');
 console.log(JSON.stringify({gate:'native-encrypted-job-one-shot-worker',unit,resultParser:result.parser,jobCompleteAfterUnitExit:true,zeroSwap:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{await exec('/usr/bin/systemctl',['stop',unit]).catch(()=>{});child?.kill();try{store.close();}catch{}await rm(directory,{recursive:true,force:true});}
