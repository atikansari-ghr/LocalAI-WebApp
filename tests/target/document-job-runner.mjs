// Root-only synthetic job lifecycle on the disposable Debian LXC.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {createDocumentJobRunner} from '../../services/documents/job-runner.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim();
const beforePid=await show('localai.service','MainPID'),dir=mkdtempSync(join(tmpdir(),'localai-job-runner-proof-'));
const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault});
try{
 const workerPath='/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs';
 const runner=createDocumentJobRunner({store,workerPath,timeoutMs:10000});
 const submit=(kind,key)=>store.enqueue({namespace:'user:synthetic',scope:'private',kind,idempotencyKey:key,name:'proof.txt',mime:'text/plain',bytes:Buffer.from('مرحبا native job'),expiresAt:Date.now()+60000,options:{ocr:'off',language:'auto'}});
 const good=submit('extract','native_good_key_12345');
 assert.equal((await runner.step()).status,'complete');assert.equal(store.result(good.id,'user:synthetic','private').text,'مرحبا native job');
 const bad=submit('ocr','native_bad_key_123456');
 await assert.rejects(runner.step(),/document_worker_invalid_frame/);assert.deepEqual({status:store.get(bad.id,'user:synthetic','private').status,error:store.get(bad.id,'user:synthetic','private').errorCode},{status:'failed',error:'document_worker_invalid_frame'});
 assert.equal(await runner.step(),null);assert.equal(store.get(bad.id,'user:synthetic','private').errorCode,'document_worker_invalid_frame');
 const slow=submit('extract','native_slow_key_12345'),slowRunner=createDocumentJobRunner({store,workerPath:'/opt/localai/documents/candidates/job-unit-proof/tests/target/document-slow-worker.mjs',timeoutMs:15000});
 const running=slowRunner.step();let observed=false;
 for(let attempt=0;attempt<100;attempt++){const rows=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);if(rows.some(row=>row.active==='active')){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal(observed,true);assert.equal(slowRunner.cancel(slow.id,'user:other','private'),false);assert.equal(slowRunner.cancel(slow.id,'user:synthetic','private'),true);
 await assert.rejects(running,/document_cancelled/);assert.equal(store.get(slow.id,'user:synthetic','private').status,'cancelled');
 assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');
 const inventory=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);
 assert.equal(inventory.some(row=>['active','activating','deactivating'].includes(row.active)),false);
 console.log(JSON.stringify({gate:'native-document-job-runner',completed:true,failedAfterConfirmedCleanup:true,cancelledActiveUnit:true,noActiveUnits:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{store.close();rmSync(dir,{recursive:true,force:true});}
