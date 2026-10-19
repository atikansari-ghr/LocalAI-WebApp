// Root-only synthetic proof. Never points at the enrolled document state.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {invokeDocumentWorker} from '../../services/documents/worker-protocol.mjs';
async function deadline(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),ms);})]);}finally{clearTimeout(timer);}}

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),tag=randomUUID().slice(0,8),runtime='localai-document-proof-'+tag,unit=runtime+'.service',socketPath='/run/'+runtime+'/worker.sock';
const show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim(),beforePid=await show('localai.service','MainPID');
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
 const result=await invokeDocumentWorker({socketPath,request:{kind:'extract',name:'native.txt',mime:'text/plain',content_base64:Buffer.from('مرحبا Native Worker').toString('base64'),options:{ocr:'off',language:'auto'}},timeoutMs:10000});
 assert.equal(result.text,'مرحبا Native Worker');assert.equal(result.parser,'localai-txt-v1');
 assert.equal(await deadline(exited,10000,'native_worker_exit_timeout'),0);
 assert.match(output,/Memory peak: .*swap: 0B/);assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');
 console.log(JSON.stringify({gate:'native-one-shot-document-worker',unit,resultParser:result.parser,zeroSwap:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{await exec('/usr/bin/systemctl',['stop',unit]).catch(()=>{});child?.kill();}
