import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeRuntimeFingerprint,validateQualification,assertProtectedRecord,loadQualifiedInference} from '../services/inference/qualification.mjs';

const expected={sourceCommit:'a'.repeat(40),sourceFingerprint:'b'.repeat(64),starterManifest:'c'.repeat(64),fallbackManifest:'d'.repeat(64)};
const required=['english-chat','arabic-chat','english-arabic-embeddings','native-sse-stream','gateway-adapter-real-tokenizer-context-cancellation-and-reuse','idle-sleep-and-lazy-reload','native-worker-crash-restart-and-vault-isolation','real-fallback-with-primary-http-fault-circuit-cooldown-and-recovery','child-listeners-isolated-and-unrelated-user-denied'];
const record=()=>({schemaVersion:1,scope:'private-preview',...expected,suite:{tests:92,passed:92,failed:0,skipped:0,cancelled:0},checks:required});
test('private qualification binds exact source artifacts and complete non-skipped checks',()=>{
 assert.ok(Object.isFrozen(validateQualification(record(),expected)));
 for(const replacement of [{sourceCommit:'e'.repeat(40)},{sourceFingerprint:'f'.repeat(64)},{fallbackManifest:'e'.repeat(64)},{scope:'production'},{force:true},{checks:required.slice(1)},{suite:{tests:92,passed:91,failed:0,skipped:1,cancelled:0}}])assert.throws(()=>validateQualification({...record(),...replacement},expected));
 assert.throws(()=>validateQualification({...record(),checks:[...required,'invented-check']},expected));
});
test('runtime fingerprint changes with any code path or dependency-lock change',t=>{
 const root=mkdtempSync(join(tmpdir(),'lai-fingerprint-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const directory of ['apps','packages','services','migrations','installer']){mkdirSync(join(root,directory));writeFileSync(join(root,directory,'entry.mjs'),'export const value=1;');}
 writeFileSync(join(root,'package.json'),'{}');writeFileSync(join(root,'package-lock.json'),'{}');
 const original=computeRuntimeFingerprint(root);writeFileSync(join(root,'services','entry.mjs'),'export const value=2;');assert.notEqual(computeRuntimeFingerprint(root),original);
 writeFileSync(join(root,'services','entry.mjs'),'export const value=1;');assert.equal(computeRuntimeFingerprint(root),original);
 writeFileSync(join(root,'package-lock.json'),'{"changed":true}');assert.notEqual(computeRuntimeFingerprint(root),original);
});
test('protected qualification metadata rejects non-root owners links and group/world-writable records',()=>{
 const metadata={uid:0,mode:0o100640,nlink:1,isFile:()=>true,isSymbolicLink:()=>false};assert.doesNotThrow(()=>assertProtectedRecord(metadata));
 for(const replacement of [{uid:1000},{mode:0o100660},{mode:0o100642},{nlink:2},{isFile:()=>false},{isSymbolicLink:()=>true}])assert.throws(()=>assertProtectedRecord({...metadata,...replacement}));
});
test('missing activation stays disabled and untrusted qualification cannot instantiate an adapter',t=>{
 const dir=mkdtempSync(join(tmpdir(),'lai-qualification-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const reportPath=join(dir,'inference.json');assert.equal(loadQualifiedInference({reportPath,sourceRoot:dir}),null);
 writeFileSync(reportPath,JSON.stringify({force:true}),{mode:0o600});assert.throws(()=>loadQualifiedInference({reportPath,sourceRoot:dir,credentialsDirectory:dir,onFallback:()=>{}}));
 writeFileSync(reportPath,JSON.stringify({qualification:record(),units:{chat:'a'.repeat(64),embedding:'b'.repeat(64),slice:'c'.repeat(64)}}));
 assert.throws(()=>loadQualifiedInference({reportPath,sourceRoot:dir,credentialsDirectory:dir,onFallback:()=>{}}));
});
