// Disposable Debian proof: real rich document worker yields to real local chat.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {createDocumentJobRunner} from '../../services/documents/job-runner.mjs';
import {createResourceAdmission} from '../../services/resources/admission.mjs';
import {createResourceReader} from '../../services/resources/snapshot.mjs';
import {createInteractiveLeaseServer,createInteractiveLeaseAdmission} from '../../services/resources/interactive-lease.mjs';
import {createInferenceClient} from '../../services/inference/client.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const show=(name,key)=>execFileSync('/usr/bin/systemctl',['show',name,'--property='+key,'--value'],{encoding:'utf8'}).trim();
const units=()=>JSON.parse(execFileSync('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'],{encoding:'utf8'}));
const beforePid=show('localai.service','MainPID'),dir=mkdtempSync(join(tmpdir(),'localai-rich-preempt-proof-'));
const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault}),resources=createResourceReader(),admission=createResourceAdmission({resources,monitorIntervalMs:100}),socketPath=join(dir,'interactive.sock');
const key=(await readFile('/run/credentials/localai.service/ai-backend-key','utf8')).trim();assert.match(key,/^[A-Za-z0-9_-]{43}$/);
const lease=await createInteractiveLeaseServer({socketPath,admission});
let runner;
try{
 const workerPath='/opt/localai/documents/candidates/processor/probe/tests/target/document-rich-worker.mjs';runner=createDocumentJobRunner({store,workerPath,timeoutMs:120000});
 const job=store.enqueue({namespace:'user:synthetic',scope:'private',kind:'extract',idempotencyKey:'rich_preempt_key_12345',name:'two-pages.tiff',mime:'image/tiff',bytes:readFileSync('/root/localai-phase4-validation/tests/fixtures/documents/two-pages.tiff'),expiresAt:Date.now()+300000,options:{ocr:'all',language:'ar'}});
 const events=[],background=admission.runBackground(async signal=>{
  const cancel=()=>{events.push('background-abort');runner.cancel(job.id,'user:synthetic','private');};signal.addEventListener('abort',cancel,{once:true});
  try{return await runner.step();}finally{signal.removeEventListener('abort',cancel);events.push('worker-finished');}
 }),backgroundResult=background.then(()=>null,error=>error);let backgroundDone=false;void backgroundResult.finally(()=>{backgroundDone=true;});
 let active=false;for(let i=0;i<100;i++){if(units().some(row=>row.active==='active')){active=true;break;}if(backgroundDone)break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.equal(active,true,'document unit did not become active');events.push('worker-active');
 const leased=createInteractiveLeaseAdmission({socketPath,timeoutMs:60000});
 const shared={runInteractive:(work,options)=>leased.runInteractive(async signal=>{events.push('interactive-admitted');assert.ok(events.includes('worker-finished'));return work(signal);},options)};
 const client=createInferenceClient({key,admission:shared,timeoutMs:60000,resources:()=>({availableBytes:resources().containerAvailableBytes})});
 const started=performance.now(),reply=await client.chat({messages:[{role:'user',content:'Reply briefly with: LOCAL AI PRIORITY OK'}],max_tokens:24});events.push('chat-finished');
 assert.ok(reply.choices[0].message.content.trim());assert.equal((await backgroundResult)?.code,'background_preempted');
 assert.equal(store.get(job.id,'user:synthetic','private').status,'cancelled');assert.deepEqual(store.requestDelete(job.id,'user:synthetic','private'),{deleted:true});
 assert.equal(show('localai.service','MainPID'),beforePid);assert.equal(show('localai.service','ActiveState'),'active');assert.equal(resources().swapUsedBytes,0);assert.equal(units().some(row=>['active','activating','deactivating'].includes(row.active)),false);
 console.log(JSON.stringify({gate:'native-rich-document-lease-preemption',events,elapsedMs:Math.round(performance.now()-started),realChatCompleted:true,documentCancelledAfterUnitExit:true,unixLease:true,swapUsedBytes:0,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{
 await lease.close();await runner?.stop();if(units().some(row=>['active','activating','deactivating'].includes(row.active)))throw Error('proof_cleanup_unconfirmed');
 store.close();rmSync(dir,{recursive:true,force:true});
}
