// Root-only disposable proof for the main one-shot worker with a temporary cohort manifest.
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {createDocumentJobRunner} from '../../services/documents/job-runner.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const manifest='/opt/localai/documents/cohort.json';assert.equal(existsSync(manifest),false);
const pid=execFileSync('/usr/bin/systemctl',['show','localai.service','--property=MainPID','--value'],{encoding:'utf8'}).trim(),dir=mkdtempSync(join(tmpdir(),'localai-cohort-worker-proof-'));
const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault});let runner,created=false;
try{
 const base='/opt/localai/ocr/candidates';writeFileSync(manifest,JSON.stringify({version:1,popplerRoot:'/opt/localai/documents/candidates/poppler-25.03.0',legacyRoot:'/opt/localai/documents/candidates/legacy-tools',lightRoot:base+'/light-ocr-0.5.8',tesseractRoot:base+'/tesseract-5.5.0',paddleRoot:base+'/paddleocr-3.7.0',paddlePython:base+'/paddleocr-3.7.0/venv/bin/python'}),{flag:'wx',mode:0o644});created=true;
 runner=createDocumentJobRunner({store,workerPath:'/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs',timeoutMs:120000});
 const job=store.enqueue({namespace:'user:synthetic',scope:'private',kind:'extract',idempotencyKey:'cohort_worker_key_12345',name:'mixed-pages.pdf',mime:'application/pdf',bytes:readFileSync('/root/localai-phase4-validation/tests/fixtures/documents/mixed-pages.pdf'),expiresAt:Date.now()+300000,options:{ocr:'auto',language:'ar'}});
 assert.equal((await runner.step()).status,'complete');const result=store.result(job.id,'user:synthetic','private');assert.match(result.text,/مرحبا\s+بالعالم/);assert.deepEqual(store.requestDelete(job.id,'user:synthetic','private'),{deleted:true});
 assert.equal(execFileSync('/usr/bin/systemctl',['show','localai.service','--property=MainPID','--value'],{encoding:'utf8'}).trim(),pid);
 console.log(JSON.stringify({gate:'native-installed-cohort-worker-candidate',mixedPdf:true,deleted:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{
 await runner?.stop();const units=JSON.parse(execFileSync('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'],{encoding:'utf8'}));
 if(units.some(row=>['active','activating','deactivating'].includes(row.active)))throw Error('proof_cleanup_unconfirmed');
 store.close();if(created)rmSync(manifest);rmSync(dir,{recursive:true,force:true});
}
