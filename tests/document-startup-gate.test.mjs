import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentStartupGate} from '../services/documents/startup-gate.mjs';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('A document unit cannot launch until leftover units and claims finish recovery',async()=>{
 const recovery=deferred(),recoveryStarted=deferred(),events=[];
 const gate=createDocumentStartupGate({recover:async({onStopped})=>{events.push('recovery');recoveryStarted.resolve();await recovery.promise;await onStopped();},onStopped:()=>events.push('claims'),launch:async()=>{events.push('launch');return {cleanupConfirmed:true};}});
 const first=gate.run({request:'first'}),second=gate.run({request:'second'});
 await recoveryStarted.promise;assert.deepEqual(events,['recovery']);
 recovery.resolve();assert.deepEqual(await first,{cleanupConfirmed:true});assert.deepEqual(await second,{cleanupConfirmed:true});
 assert.deepEqual(events,['recovery','claims','launch','launch']);
});

test('Failed recovery blocks launch and a later attempt must repeat recovery',async()=>{
 let attempts=0,launches=0;
 const gate=createDocumentStartupGate({recover:async({onStopped})=>{if(++attempts===1)throw Error('native_cleanup_unconfirmed');await onStopped();},onStopped:()=>{},launch:async()=>{launches++;return {cleanupConfirmed:true};}});
 await assert.rejects(gate.run({}),/native_cleanup_unconfirmed/);assert.equal(launches,0);
 await gate.run({});assert.equal(attempts,2);assert.equal(launches,1);
});

test('The gate never runs two document units at once',async()=>{
 const running=deferred(),started=deferred();let launched=0;
 const gate=createDocumentStartupGate({recover:async({onStopped})=>onStopped(),onStopped:()=>{},launch:async()=>{launched++;started.resolve();await running.promise;return {cleanupConfirmed:true};}});
 const first=gate.run({}),second=gate.run({});await started.promise;
 assert.equal(launched,1);
 running.resolve();await Promise.all([first,second]);assert.equal(launched,2);
});

test('An unconfirmed worker cleanup forces recovery before the next launch',async()=>{
 let recovered=0,launched=0;
 const gate=createDocumentStartupGate({recover:async({onStopped})=>{recovered++;await onStopped();},onStopped:()=>{},launch:async()=>++launched===1?{cleanupConfirmed:false}:{cleanupConfirmed:true}});
 await assert.rejects(gate.run({}),/native_cleanup_unconfirmed/);
 assert.deepEqual(await gate.run({}),{cleanupConfirmed:true});assert.equal(recovered,2);
});
