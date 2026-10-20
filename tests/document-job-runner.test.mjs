import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentJobRunner} from '../services/documents/job-runner.mjs';

function claim(id){return {id,namespace:'user:test',scope:'private',kind:'extract',name:'x.txt',mime:'text/plain',bytes:Buffer.from('x'),options:{ocr:'off',language:'auto'},token:'claim-token'};}

test('Recovery finishes before the first claim and completion follows worker cleanup',async()=>{
 const order=[],pending=[claim('one')],store={recoverInterrupted:()=>order.push('claims-recovered'),claim:()=>{order.push('claim');return pending.shift()??null;},get:()=>({status:'running'}),complete:(_id,_token,result,proof)=>{order.push('complete');assert.equal(proof.nativeCleanupConfirmed,true);assert.equal(result.text,'x');return {status:'complete'};},fail:()=>assert.fail('unexpected failure'),finishCancellation:()=>assert.fail('unexpected cancellation'),cancel:()=>false};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>{order.push('units-stopped');await onStopped();},launch:async({request})=>{order.push('launch');assert.equal(request.content_base64,'eA==');return {result:{text:'x'},cleanupConfirmed:true};}});
 assert.deepEqual(await runner.step(),{status:'complete'});assert.deepEqual(order,['units-stopped','claims-recovered','claim','launch','complete']);
 assert.equal(await runner.step(),null);assert.equal(order.at(-1),'claim');
});

test('A failed launch forces unit recovery before another claim',async()=>{
 const order=[],pending=[claim('one'),claim('two')];let recovery=0;
 const store={recoverInterrupted:()=>order.push('claims-recovered'),claim:()=>{order.push('claim');return pending.shift()??null;},get:()=>({status:'running'}),complete:()=>({status:'complete'}),fail:()=>assert.fail('unexpected confirmed failure'),finishCancellation:()=>assert.fail('unexpected cancellation'),cancel:()=>false};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>{order.push('units-stopped');recovery++;await onStopped();},launch:async()=>{order.push('launch');if(recovery===1)throw Error('document_worker_failed');return {result:{text:'safe'},cleanupConfirmed:true};}});
 await assert.rejects(runner.step(),/document_worker_failed/);
 await runner.step();assert.equal(recovery,2);assert.deepEqual(order,['units-stopped','claims-recovered','claim','launch','units-stopped','claims-recovered','claim','launch']);
});

test('Verified worker cleanup records its bounded error before another step',async()=>{
 let status='running',savedCode,claims=0;
 const store={recoverInterrupted:()=>{},claim:()=>++claims===1?claim('one'):null,get:()=>({status}),complete:()=>assert.fail('unexpected completion'),finishCancellation:()=>assert.fail('unexpected cancellation'),fail:(_id,_token,code,proof)=>{assert.equal(proof.nativeCleanupConfirmed,true);savedCode=code;status='failed';},cancel:()=>false};
 const error=Object.assign(new Error('document_worker_invalid_frame'),{cleanupConfirmed:true});
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>onStopped(),launch:async()=>{throw error;}});
 await assert.rejects(runner.step(),/document_worker_invalid_frame/);
 assert.equal(status,'failed');assert.equal(savedCode,'document_worker_invalid_frame');
});

test('Cancellation cannot be completed as a successful result',async()=>{
 let status='cancelling';const job=claim('one'),store={recoverInterrupted:()=>{},claim:()=>job,get:()=>({status}),finishCancellation:(_id,_token,proof)=>{assert.equal(proof.nativeCleanupConfirmed,true);status='cancelled';},complete:()=>assert.fail('completed cancelled job'),fail:()=>assert.fail('failed cancelled job'),cancel:()=>false};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>onStopped(),launch:async()=>({result:{text:'late'},cleanupConfirmed:true})});
 assert.deepEqual(await runner.step(),{status:'cancelled'});
});

test('Overlapping steps serialize one claim and launch at a time',async()=>{
 let release,started;const wait=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});let claims=0,launches=0;
 const store={recoverInterrupted:()=>{},claim:()=>{claims++;return claim(String(claims));},get:()=>({status:'running'}),complete:()=>({status:'complete'}),fail:()=>assert.fail('unexpected failure'),finishCancellation:()=>assert.fail('unexpected cancellation'),cancel:()=>false};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>onStopped(),launch:async()=>{launches++;started();await wait;return {result:{},cleanupConfirmed:true};}});
 const first=runner.step(),second=runner.step();await began;assert.equal(claims,1);assert.equal(launches,1);release();await Promise.all([first,second]);assert.equal(claims,2);assert.equal(launches,2);
});

test('Authorized cancellation aborts the active unit and finalizes only after cleanup',async()=>{
 let status='running',begin;const started=new Promise(resolve=>{begin=resolve;}),job=claim('one');
 const store={recoverInterrupted:()=>{},claim:()=>job,get:()=>({status}),complete:()=>assert.fail('completed cancelled job'),fail:()=>assert.fail('failed cancelled job'),finishCancellation:(_id,_token,proof)=>{assert.equal(proof.nativeCleanupConfirmed,true);status='cancelled';},cancel:(_id,namespace,scope)=>{if(namespace!=='user:test'||scope!=='private')return false;status='cancelling';return true;}};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>onStopped(),launch:async({signal})=>{begin();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('document_cancelled'),{cleanupConfirmed:true})),{once:true}));}});
 const running=runner.step();await started;
 assert.equal(runner.cancel('one','user:other','private'),false);assert.equal(status,'running');
 assert.equal(runner.cancel('one','user:test','private'),true);await assert.rejects(running,/document_cancelled/);
 assert.equal(status,'cancelled');
});

test('Supervisor stop aborts active work and rechecks native cleanup before returning',async()=>{
 let begin,recovered=0,claimed=0;const started=new Promise(resolve=>{begin=resolve;});
 const store={recoverInterrupted:()=>{recovered++;},claim:()=>{claimed++;return claim('one');},get:()=>({status:'running'}),complete:()=>assert.fail('unexpected completion'),fail:()=>{},finishCancellation:()=>assert.fail('unexpected cancellation'),cancel:()=>false};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>onStopped(),launch:async({signal})=>{begin();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('document_cancelled'),{cleanupConfirmed:true})),{once:true}));}});
 const active=runner.step();await started;
 await runner.stop();await assert.rejects(active,/document_cancelled/);assert.equal(recovered,2);
 await assert.rejects(runner.step(),/document_runner_stopping/);assert.equal(claimed,1);
});

test('Stop during startup recovery cannot claim or launch a job',async()=>{
 let entered,release,claims=0,launches=0;const started=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
 const store={recoverInterrupted:()=>{},claim:()=>{claims++;return claim('one');},get:()=>({status:'running'}),complete:()=>({status:'complete'}),fail:()=>{},finishCancellation:()=>{},cancel:()=>false};
 const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/worker.mjs',recover:async({onStopped})=>{entered();await blocked;await onStopped();},launch:async()=>{launches++;return {result:{},cleanupConfirmed:true};}});
 const step=runner.step();await started;const stopped=runner.stop();release();
 await assert.rejects(step,/document_runner_stopping/);await stopped;assert.equal(claims,0);assert.equal(launches,0);
});
