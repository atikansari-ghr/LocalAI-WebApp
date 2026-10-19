import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceAdmission} from '../services/resources/admission.mjs';
const healthy=()=>({availableBytes:2*1024**3,swapUsedBytes:0,memoryPressure:0});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('Interactive work preempts background and waits for actual worker cleanup before taking its slot',async()=>{
 const admission=createResourceAdmission({resources:healthy}),started=deferred(),cleanup=deferred(),events=[];
 const document=admission.runBackground(async signal=>{events.push('document');started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));events.push('abort');await cleanup.promise;events.push('clean');});
 await started.promise;const rejected=assert.rejects(document,/background_preempted/),chat=admission.runInteractive(async()=>{events.push('chat');return 'ok';});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['document','abort']);cleanup.resolve();assert.equal(await chat,'ok');await rejected;assert.deepEqual(events,['document','abort','clean','chat']);assert.equal(admission.snapshot().active,null);
});
test('Background admission postpones under resource pressure or interactive backlog without running work',async()=>{
 for(const resources of [()=>({...healthy(),availableBytes:700*1024**2}),()=>({...healthy(),availableBytes:100}),()=>({...healthy(),swapUsedBytes:1}),()=>({...healthy(),memoryPressure:21}),()=>{throw new Error('private details');}]){let ran=false;await assert.rejects(createResourceAdmission({resources}).runBackground(()=>{ran=true;}),/background_resource_pressure|resource_measurement_unavailable/);assert.equal(ran,false);}
 let admitted=false;await createResourceAdmission({resources:()=>({...healthy(),availableBytes:900*1024**2})}).runBackground(()=>{admitted=true;});assert.equal(admitted,true);
 const admission=createResourceAdmission({resources:healthy}),gate=deferred(),chat=admission.runInteractive(()=>gate.promise);await assert.rejects(admission.runBackground(()=>{}),/background_postponed/);gate.resolve();await chat;
});
test('An admitted capped worker may consume its reserved budget but stops at the remaining safety floor',async()=>{
 let availableBytes=900*1024**2;const admission=createResourceAdmission({monitorIntervalMs:10,resources:()=>({...healthy(),availableBytes})}),started=deferred();
 const pending=admission.runBackground(async signal=>{started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));});await started.promise;
 availableBytes=400*1024**2;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(admission.snapshot().active,'background');
 const rejected=assert.rejects(pending,/background_resource_pressure/);availableBytes=200*1024**2;await new Promise(resolve=>setTimeout(resolve,30));await rejected;
});
test('Admission bounds interactive queue handles cancellation and releases slots after failure',async()=>{
 const admission=createResourceAdmission({resources:healthy,maxInteractiveQueue:1}),gate=deferred(),first=admission.runInteractive(()=>gate.promise),controller=new AbortController(),second=admission.runInteractive(()=>{}, {signal:controller.signal});await assert.rejects(admission.runInteractive(()=>{}),/admission_queue_full/);const rejected=assert.rejects(second,/admission_cancelled/);controller.abort();await rejected;gate.resolve();await first;await assert.rejects(admission.runBackground(async()=>{throw new Error('failure');}),/failure/);assert.equal(admission.snapshot().active,null);
});

test('Background resource monitoring aborts active work and host swap growth postpones new work',async()=>{
 let pressure=false;const admission=createResourceAdmission({monitorIntervalMs:10,resources:()=>({...healthy(),memoryPressure:pressure?30:0})}),started=deferred(),pending=admission.runBackground(async signal=>{started.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));});await started.promise;const rejected=assert.rejects(pending,/background_resource_pressure/);pressure=true;await new Promise(resolve=>setTimeout(resolve,30));await rejected;await assert.rejects(createResourceAdmission({resources:()=>({...healthy(),hostSwapGrowthBytes:1})}).runBackground(()=>{}),/background_resource_pressure/);
});
