import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceAdmission} from '../services/resources/admission.mjs';
import {createDocumentSupervisorScheduler} from '../services/documents/supervisor-scheduler.mjs';

test('Persistent supervisor recovers first but postpones a queued claim below memory reserve',async()=>{
 let available=700*1024**2,claims=0,recovered=0;
 const admission=createResourceAdmission({resources:()=>({availableBytes:available,swapUsedBytes:0,memoryPressure:0})});
 const scheduler=createDocumentSupervisorScheduler({runner:{prepare:async()=>{recovered++;},step:async()=>{claims++;return {status:'complete'};}},admission,barrier:{isClear:()=>true}});
 await scheduler.prepare();assert.equal(recovered,1);
 await assert.rejects(scheduler.step(),/background_resource_pressure/);assert.equal(claims,0);
 available=900*1024**2;assert.deepEqual(await scheduler.step(),{status:'complete'});assert.equal(claims,1);
});
test('Persistent supervisor passes a live pressure-abort signal into its worker step',async()=>{
 let pressure=0,started;const began=new Promise(resolve=>{started=resolve;});
 const admission=createResourceAdmission({resources:()=>({availableBytes:900*1024**2,swapUsedBytes:0,memoryPressure:pressure}),monitorIntervalMs:10});
 const scheduler=createDocumentSupervisorScheduler({runner:{prepare:async()=>{},step:({signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}},admission,barrier:{isClear:()=>true}});
 const work=scheduler.step();await began;pressure=30;await assert.rejects(work,/background_resource_pressure/);
});
test('A durable unclean chat lease blocks background claims after supervisor restart',async()=>{
 let claims=0,clear=false;const admission=createResourceAdmission({resources:()=>({availableBytes:2*1024**3,swapUsedBytes:0,memoryPressure:0})});
 const scheduler=createDocumentSupervisorScheduler({runner:{prepare:async()=>{},step:async()=>{claims++;return null;}},admission,barrier:{isClear:()=>clear}});
 await scheduler.prepare();await assert.rejects(scheduler.step(),/interactive_recovery_required/);assert.equal(claims,0);
 clear=true;assert.equal(await scheduler.step(),null);assert.equal(claims,1);
});
