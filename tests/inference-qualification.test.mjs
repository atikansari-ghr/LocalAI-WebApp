import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeNativeRuntimeFingerprint,computeRuntimeFingerprint,validateQualification,assertProtectedRecord,loadQualifiedInference,parseNativeTestSummary,combineNativeQualification,computeEnvironmentFingerprint} from '../services/inference/qualification.mjs';

test('extracted runtime identity binds executable and library bytes independently of the archive',t=>{
 const root=mkdtempSync(join(tmpdir(),'lai-native-bytes-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'llama-server'),'qualified executable');writeFileSync(join(root,'library.so'),'qualified library');
 const initial=computeNativeRuntimeFingerprint(root,{requireRoot:false});
 writeFileSync(join(root,'library.so'),'different compatible library');
 assert.notEqual(computeNativeRuntimeFingerprint(root,{requireRoot:false}),initial);
 writeFileSync(join(root,'library.so'),'qualified library');assert.equal(computeNativeRuntimeFingerprint(root,{requireRoot:false}),initial);
 writeFileSync(join(root,'llama-server'),'replacement executable');assert.notEqual(computeNativeRuntimeFingerprint(root,{requireRoot:false}),initial);
});

const expected={sourceCommit:'a'.repeat(40),sourceFingerprint:'b'.repeat(64),starterManifest:'c'.repeat(64),fallbackManifest:'d'.repeat(64),environmentFingerprint:'e'.repeat(64)};
const required=['english-chat','arabic-chat','english-arabic-embeddings','native-sse-stream','gateway-adapter-real-tokenizer-context-cancellation-and-reuse','idle-sleep-and-lazy-reload','native-worker-crash-restart-and-vault-isolation','real-fallback-with-primary-http-fault-circuit-cooldown-and-recovery','child-listeners-isolated-and-unrelated-user-denied','isolated-native-activation-rollback'];
const record=()=>({schemaVersion:1,scope:'private-preview',...expected,suite:{tests:92,passed:92,failed:0,skipped:0,cancelled:0},checks:required});
test('private qualification binds exact source artifacts and complete non-skipped checks',()=>{
 assert.ok(Object.isFrozen(validateQualification(record(),expected)));
 for(const replacement of [{sourceCommit:'e'.repeat(40)},{sourceFingerprint:'f'.repeat(64)},{fallbackManifest:'e'.repeat(64)},{environmentFingerprint:'f'.repeat(64)},{scope:'production'},{force:true},{checks:required.slice(1)},{suite:{tests:92,passed:91,failed:0,skipped:1,cancelled:0}}])assert.throws(()=>validateQualification({...record(),...replacement},expected));
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
test('qualification consumes complete native runner output and both matching native reports',()=>{
 const suite=parseNativeTestSummary('TAP version 13\n# tests 96\n# pass 96\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n');assert.deepEqual(suite,{tests:96,passed:96,failed:0,cancelled:0,skipped:0});
 for(const output of ['','# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n','# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n'])assert.throws(()=>parseNativeTestSummary(output));
 const workers={qualification:'workers-loaded-unqualified',manifestSha256:expected.starterManifest,checks:required.slice(0,7).map(check=>({check}))};
 const router={qualification:'router-tested-unqualified',starterManifest:expected.starterManifest,fallbackManifest:expected.fallbackManifest,checks:required.slice(7,9).map(check=>({check}))},activation={qualification:'activation-fixture-tested',checks:[{check:'isolated-native-activation-rollback'}]};
 const report=combineNativeQualification({identity:expected,suite,workers,router,activation});assert.equal(report.scope,'private-preview');assert.equal(report.suite.passed,96);
 assert.throws(()=>combineNativeQualification({identity:expected,suite,workers,activation,router:{...router,fallbackManifest:'e'.repeat(64)}}));
 assert.throws(()=>combineNativeQualification({identity:expected,suite,workers:{...workers,checks:[]},router,activation}));
 assert.throws(()=>combineNativeQualification({identity:expected,suite,workers,router}));
});
test('qualification binds the target and package inventory without treating transient CPU load as a new machine',()=>{
 const files={'/etc/machine-id':'a'.repeat(32),'/etc/os-release':'ID=debian\nVERSION_ID=13','/proc/sys/kernel/osrelease':'test-kernel','/var/lib/dpkg/status':'Package: libgomp1\nVersion: test','/proc/cpuinfo':'model name: Test CPU\nflags: avx2 sse\ncpu MHz: 500','/proc/meminfo':'MemTotal: 6291456 kB\nMemAvailable: 1000000 kB'};
 const read=path=>files[path],initial=computeEnvironmentFingerprint({read});
 files['/proc/cpuinfo']=files['/proc/cpuinfo'].replace('500','1000');files['/proc/meminfo']=files['/proc/meminfo'].replace('1000000','2000000');assert.equal(computeEnvironmentFingerprint({read}),initial);
 files['/var/lib/dpkg/status']+='\nPackage: changed';assert.notEqual(computeEnvironmentFingerprint({read}),initial);
});
