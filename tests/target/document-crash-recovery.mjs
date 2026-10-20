// Root-only actual supervisor-process crash proof on the disposable LXC.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {initializeVault,openVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {createDocumentJobRunner} from '../../services/documents/job-runner.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim();
const beforePid=await show('localai.service','MainPID'),dir=mkdtempSync(join(tmpdir(),'localai-crash-proof-'));
let child,unit,store;
try{
 const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false});
 store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:synthetic',scope:'private',kind:'extract',idempotencyKey:'native_crash_key_12345',name:'proof.txt',mime:'text/plain',bytes:Buffer.from('crash proof'),expiresAt:Date.now()+60000,options:{ocr:'off',language:'auto'}});store.close();store=null;
 child=spawn('/opt/localai/node/bin/node',[join(import.meta.dirname,'document-crash-child.mjs'),dir],{env:{...process.env,TARGET_TEST_LXC:'disposable'},stdio:'ignore'});
 for(let attempt=0;attempt<100;attempt++){
  const rows=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);
  unit=rows.find(row=>row.active==='active'&&/^localai-document-job-[0-9a-f]{8}\.service$/.test(row.unit))?.unit;
  if(unit)break;if(child.exitCode!==null||child.signalCode!==null)throw Error('synthetic_supervisor_exited_early');await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.ok(unit,'synthetic_worker_never_started');const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 assert.equal(await show(unit,'ActiveState'),'active');assert.ok(Number(await show(unit,'MainPID'))>0,'orphan_worker_did_not_survive_supervisor_crash');
 store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault:openVault(join(dir,'master.key'))});
 assert.equal(store.get(job.id,'user:synthetic','private').status,'running');
 const resumed=createDocumentJobRunner({store,workerPath:'/opt/localai/documents/candidates/job-unit-proof/tests/target/document-slow-worker.mjs',timeoutMs:15000});
 assert.equal(await resumed.step(),null);
 assert.deepEqual({status:store.get(job.id,'user:synthetic','private').status,error:store.get(job.id,'user:synthetic','private').errorCode},{status:'failed',error:'interrupted_after_restart'});
 assert.equal(await show(unit,'MainPID'),'0');assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');
 console.log(JSON.stringify({gate:'native-document-crash-recovery',unit,orphanStopped:true,claimRecovered:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{
 if(child?.exitCode===null)child.kill('SIGKILL');
 if(unit&&/^localai-document-job-[0-9a-f]{8}\.service$/.test(unit))await exec('/usr/bin/systemctl',['stop',unit]).catch(()=>{});
 store?.close();rmSync(dir,{recursive:true,force:true});
}
