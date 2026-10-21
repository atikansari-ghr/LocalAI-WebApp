import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeVault} from '../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../services/documents/structured-jobs.mjs';
import {createStructuredJobRunner,createStructuredInferenceGenerator} from '../services/documents/structured-runner.mjs';

const schema={schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}};
const report={document:{sha256:'a'.repeat(64)},units:[{text:'Invoice INV-42',source:{kind:'text'}}]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'localai-structured-runner-')),vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false}),store=openStructuredJobStore(join(dir,'jobs.sqlite'),{vault,now:()=>1000});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {store};}
const request=()=>({namespace:'user:one',scope:'private',idempotencyKey:'runner_key_123456',schema,report,expiresAt:5000});

test('private runner persists only source-checked model candidates and serializes claims',async t=>{
 const {store}=fixture(t);const job=store.enqueue(request());let calls=0;
 const runner=createStructuredJobRunner({store,barrier:{isClear:()=>true},generateCandidate:async ({report,signal})=>{calls++;assert.equal(report.units[0].text,'Invoice INV-42');assert.equal(signal.aborted,false);return '{"fields":{"invoice":[{"value":"INV-42","evidenceIds":["u0001"]}]}}';}});
 const [first,second]=await Promise.all([runner.step(),runner.step()]);
 assert.equal(first.id,job.id);assert.equal(first.status,'complete');assert.equal(second,null);assert.equal(calls,1);
 assert.equal(store.result(job.id,'user:one','private').fields.invoice.value,'INV-42');
});

test('model failure leaves its claim protected until separately confirmed recovery',async t=>{
 const {store}=fixture(t);const job=store.enqueue(request());let clear=false;
 const runner=createStructuredJobRunner({store,barrier:{isClear:()=>clear},generateCandidate:async()=>{throw new Error('model_unavailable');}});
 await assert.rejects(runner.step(),/interactive_recovery_required/);
 clear=true;await assert.rejects(runner.step(),/model_unavailable/);
 assert.equal(store.get(job.id,'user:one','private').status,'running');
 await assert.rejects(runner.step(),/structured_recovery_required/);
 assert.throws(()=>store.recoverInterrupted(),/interactive_recovery_required/);
 assert.equal(store.recoverInterrupted({interactiveRecoveryConfirmed:true}),1);
 assert.equal(store.get(job.id,'user:one','private').status,'failed');
});

test('inference generator keeps the checked candidate and source IDs for durable completion',async t=>{
 const {store}=fixture(t),job=store.enqueue(request());
 const inference={chat:async()=>({choices:[{message:{content:'{"fields":{"invoice":[{"value":"INV-42","evidenceIds":["u0001"]}]}}'}}]})};
 const runner=createStructuredJobRunner({store,barrier:{isClear:()=>true},generateCandidate:createStructuredInferenceGenerator({inference})});
 await runner.step();assert.equal(store.result(job.id,'user:one','private').fields.invoice.candidates[0].sources[0].documentSha256,'a'.repeat(64));
});

test('invalid model evidence never completes a durable claim',async t=>{
 const {store}=fixture(t),job=store.enqueue(request());
 const runner=createStructuredJobRunner({store,barrier:{isClear:()=>true},generateCandidate:async()=>'{"fields":{"invoice":[{"value":"INV-99","evidenceIds":["u0001"]}]}}'});
 await assert.rejects(runner.step(),/structured_result_invalid/);
 assert.equal(store.get(job.id,'user:one','private').status,'running');
 await assert.rejects(runner.step(),/structured_recovery_required/);
});

test('aborting an active model request retains the claim for explicit recovery',async t=>{
 const {store}=fixture(t),job=store.enqueue(request()),abort=new AbortController();let started;
 const ready=new Promise(resolve=>{started=resolve;});
 const runner=createStructuredJobRunner({store,barrier:{isClear:()=>true},generateCandidate:({signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('model_cancelled')),{once:true}));}});
 const task=runner.step({signal:abort.signal});await ready;abort.abort();
 await assert.rejects(task,/model_cancelled/);
 assert.equal(store.get(job.id,'user:one','private').status,'running');
 await assert.rejects(runner.step(),/structured_recovery_required/);
});
