// Root-only synthetic rich-format job proof on the disposable Debian LXC.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {createDocumentJobRunner} from '../../services/documents/job-runner.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const pid=execFileSync('/usr/bin/systemctl',['show','localai.service','--property=MainPID','--value'],{encoding:'utf8'}).trim(),dir=mkdtempSync(join(tmpdir(),'localai-rich-job-proof-'));
const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault});
let runner;
try{
 const workerPath='/opt/localai/documents/candidates/processor/probe/tests/target/document-rich-worker.mjs';runner=createDocumentJobRunner({store,workerPath,timeoutMs:120000});
 const load=name=>readFileSync('/root/localai-phase4-validation/tests/fixtures/documents/'+name);
 const cases=[{name:'mixed-pages.pdf',mime:'application/pdf',contains:/مرحبا\s+بالعالم/},{name:'two-pages.tiff',mime:'image/tiff',contains:/مرحبا\s+بالعالم/},{name:'multilingual.rtf',mime:'application/rtf',contains:/مرحبا/}],observed=[];
 for(const [index,item] of cases.entries()){
  const job=store.enqueue({namespace:'user:synthetic',scope:'private',kind:'extract',idempotencyKey:'rich_candidate_key_'+String(index).padStart(4,'0'),name:item.name,mime:item.mime,bytes:load(item.name),expiresAt:Date.now()+300000,options:{ocr:'auto',language:'ar'}});
  assert.equal((await runner.step()).status,'complete');
  const result=store.result(job.id,'user:synthetic','private');assert.match(result.text,item.contains);assert.equal(result.nativeProofMemory.swapPeak,0);assert.ok(result.nativeProofMemory.peak<512*1024**2);observed.push({format:item.name,...result.nativeProofMemory});
  assert.deepEqual(store.requestDelete(job.id,'user:synthetic','private'),{deleted:true});
 }
 assert.equal(execFileSync('/usr/bin/systemctl',['show','localai.service','--property=MainPID','--value'],{encoding:'utf8'}).trim(),pid);
 const units=JSON.parse(execFileSync('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'],{encoding:'utf8'}));
 assert.equal(units.some(row=>['active','activating','deactivating'].includes(row.active)),false);
 console.log(JSON.stringify({gate:'native-rich-document-job',formats:observed,deleted:true,noActiveUnits:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{
 await runner?.stop();
 const units=JSON.parse(execFileSync('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'],{encoding:'utf8'}));
 if(units.some(row=>['active','activating','deactivating'].includes(row.active)))throw Error('proof_cleanup_unconfirmed');
 store.close();rmSync(dir,{recursive:true,force:true});
}
