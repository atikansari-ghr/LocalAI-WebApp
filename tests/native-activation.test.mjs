import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {activateNativeRuntime,recoverNativeRuntime} from '../installer/native-activation.mjs';

function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'lai-native-activation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const old=join(root,'old.service'),proof=join(root,'inference.json'),journal=join(root,'journal.json');writeFileSync(old,'prior unit');
 const initial={'localai-chat.service':{available:true,active:false,enabled:false},'localai-embedding.service':{available:true,active:false,enabled:false},'localai.service':{available:true,active:true,enabled:true}},states=structuredClone(initial);
 const control={capture:name=>({...states[name]}),stop:name=>{states[name].active=false;},setEnabled:(name,value)=>{states[name].enabled=value;},restart:name=>{states[name].active=true;},reload:()=>{}};
 return {root,old,proof,journal,initial,states,control,allowedPaths:[old,proof],updates:[{path:old,content:'new unit',mode:0o644},{path:proof,content:'synthetic qualified record',mode:0o600}]};
}
test('native activation commits only after verification and removes its recovery journal',async t=>{
 const f=fixture(t);let verified=false;await activateNativeRuntime({...f,verify:async()=>{assert.ok(existsSync(f.journal));assert.equal(readFileSync(f.old,'utf8'),'new unit');verified=true;}});
 assert.ok(verified);assert.equal(existsSync(f.journal),false);assert.equal(readFileSync(f.proof,'utf8'),'synthetic qualified record');assert.ok(f.states['localai-chat.service'].active);
});
test('a failed native activation restores exact prior files and enabled/active service states',async t=>{
 const f=fixture(t);await assert.rejects(activateNativeRuntime({...f,verify:async()=>{throw new Error('synthetic liveness failure');}}),/synthetic liveness failure/);
 assert.equal(readFileSync(f.old,'utf8'),'prior unit');assert.equal(existsSync(f.proof),false);assert.deepEqual(f.states,f.initial);assert.equal(existsSync(f.journal),false);
});
test('recovery remains durable if service restoration fails and can be retried',async t=>{
 const f=fixture(t);let failReload=true;f.control.reload=()=>{if(failReload)throw new Error('synthetic reload failure');};
 await assert.rejects(activateNativeRuntime({...f,verify:async()=>{}}));assert.ok(existsSync(f.journal));
 failReload=false;await recoverNativeRuntime(f);assert.equal(readFileSync(f.old,'utf8'),'prior unit');assert.equal(existsSync(f.proof),false);assert.deepEqual(f.states,f.initial);assert.equal(existsSync(f.journal),false);
});
test('unexpected target paths and writable configuration are rejected before activation mutation',async t=>{
 const f=fixture(t);await assert.rejects(activateNativeRuntime({...f,updates:[...f.updates,{path:join(f.root,'unexpected'),content:'bad',mode:0o644}],verify:async()=>{}}));
 await assert.rejects(activateNativeRuntime({...f,updates:f.updates.map(item=>({...item,mode:0o666})),verify:async()=>{}}));
 assert.equal(readFileSync(f.old,'utf8'),'prior unit');assert.equal(existsSync(f.proof),false);assert.equal(existsSync(f.journal),false);assert.deepEqual(f.states,f.initial);
});
test('a process interrupted after publication leaves a journal that restores prior files',async t=>{
 const f=fixture(t),moduleUrl=new URL('../installer/native-activation.mjs',import.meta.url).href;
 const code=`import {activateNativeRuntime} from ${JSON.stringify(moduleUrl)};const initial=${JSON.stringify(f.initial)};const control={capture:name=>initial[name],stop:()=>{},setEnabled:()=>{},restart:()=>{},reload:()=>{}};await activateNativeRuntime({journal:${JSON.stringify(f.journal)},allowedPaths:${JSON.stringify(f.allowedPaths)},updates:${JSON.stringify(f.updates)},control,verify:async()=>process.exit(23)});`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:10000});assert.equal(child.status,23);assert.ok(existsSync(f.journal));assert.equal(readFileSync(f.old,'utf8'),'new unit');
 await recoverNativeRuntime(f);assert.equal(readFileSync(f.old,'utf8'),'prior unit');assert.equal(existsSync(f.proof),false);assert.equal(existsSync(f.journal),false);
});
