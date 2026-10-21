import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readlinkSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';
import {beginInteractiveMaintenance,finishInteractiveMaintenance} from '../installer/interactive-maintenance-transaction.mjs';
import {runInteractiveMaintenance} from '../installer/interactive-maintenance-operator.mjs';
import {createInteractiveLeaseBarrier} from '../services/resources/interactive-lease-barrier.mjs';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'localai-maintenance-flow-'));chmodSync(root,0o700);
 const unitDirectory=join(root,'units'),journalDirectory=join(root,'journal');mkdirSync(unitDirectory,{mode:0o755});mkdirSync(journalDirectory,{mode:0o700});
 for(const unit of RECOVERY_UNITS.slice(0,3))writeFileSync(join(unitDirectory,unit),'[Service]\nExecStart=/bin/true\n',{mode:0o644});
 const journal=join(journalDirectory,'maintenance.json'),states=Object.fromEntries(RECOVERY_UNITS.map((unit,index)=>[unit,{available:index<3,active:index<2,enabled:index<3}]));
 const calls=[];let failRestore=false,failVerify=false;
 const control={
  capture:async unit=>({...states[unit]}),
  stop:async unit=>{calls.push('stop:'+unit);states[unit].active=false;},
  reload:async()=>{calls.push('reload');},
  restore:async(unit,prior)=>{calls.push('restore:'+unit);if(failRestore&&unit===RECOVERY_UNITS[1])throw new Error('restore_failed');states[unit]={...prior};},
  verifyRestored:async prior=>{calls.push('verify-restored');for(const unit of RECOVERY_UNITS)assert.deepEqual(states[unit],prior[unit]);},
 };
 const verifyOffline=async()=>{calls.push('verify-offline');if(failVerify)throw new Error('offline_proof_failed');for(const unit of RECOVERY_UNITS){const path=join(unitDirectory,unit);assert.equal(lstatSync(path).isSymbolicLink(),true);assert.equal(readlinkSync(path),'/dev/null');assert.equal(states[unit].active,false);}return true;};
 const recoverWorkers=async()=>{calls.push('recover-workers');};
 return {root,unitDirectory,journal,states,calls,control,verifyOffline,recoverWorkers,setFailRestore:value=>{failRestore=value;},setFailVerify:value=>{failVerify=value;},cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('Maintenance begins offline then restores exact prior files and service states',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  await beginInteractiveMaintenance(f);assert.equal(existsSync(f.journal),true);
  assert.ok(f.calls.indexOf('recover-workers')>f.calls.indexOf('reload'));
  assert.ok(f.calls.indexOf('verify-offline')>f.calls.indexOf('recover-workers'));
  await finishInteractiveMaintenance(f);assert.equal(existsSync(f.journal),false);
  for(const unit of RECOVERY_UNITS.slice(0,3))assert.equal(readFileSync(join(f.unitDirectory,unit),'utf8'),'[Service]\nExecStart=/bin/true\n');
  assert.equal(existsSync(join(f.unitDirectory,RECOVERY_UNITS[3])),false);
  assert.equal(f.states[RECOVERY_UNITS[0]].active,true);
 }finally{f.cleanup();}
});

test('Failed offline proof restores prior state and retains no successful recovery',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  f.setFailVerify(true);
  await assert.rejects(beginInteractiveMaintenance(f),/offline_proof_failed/);
  assert.equal(existsSync(f.journal),false);assert.equal(f.states[RECOVERY_UNITS[0]].active,true);
  assert.equal(lstatSync(join(f.unitDirectory,RECOVERY_UNITS[0])).isFile(),true);
 }finally{f.cleanup();}
});

test('Interrupted or failed restoration retains journal and can be retried',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  await beginInteractiveMaintenance(f);f.setFailRestore(true);
  await assert.rejects(finishInteractiveMaintenance(f),/restore_failed/);
  assert.equal(existsSync(f.journal),true);
  f.setFailRestore(false);await finishInteractiveMaintenance(f);
  assert.equal(existsSync(f.journal),false);assert.equal(f.states[RECOVERY_UNITS[1]].active,true);
 }finally{f.cleanup();}
});

test('A new begin restores an interrupted journal before capturing fresh states',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  await beginInteractiveMaintenance(f);
  const priorRestoreCount=f.calls.filter(call=>call.startsWith('restore:')).length;
  await beginInteractiveMaintenance(f);
  assert.equal(existsSync(f.journal),true);
  assert.equal(f.calls.filter(call=>call.startsWith('restore:')).length,priorRestoreCount+RECOVERY_UNITS.length);
  assert.equal(f.calls.filter(call=>call==='verify-offline').length,2);
  await finishInteractiveMaintenance(f);
  assert.equal(f.states[RECOVERY_UNITS[0]].active,true);
 }finally{f.cleanup();}
});

test('Operator keeps claims blocked after marker removal until journaled restore succeeds',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  const barrier=createInteractiveLeaseBarrier({path:join(f.root,'journal','interactive.lock'),journalPath:f.journal});
  barrier.begin();f.setFailRestore(true);
  await assert.rejects(runInteractiveMaintenance({...f,barrier}),/restore_failed/);
  assert.equal(existsSync(f.journal),true);assert.equal(barrier.isClear(),false);
  f.setFailRestore(false);
  assert.deepEqual(await runInteractiveMaintenance({...f,barrier}),{restored:true,recovered:false});
  assert.equal(existsSync(f.journal),false);assert.equal(barrier.isClear(),true);
  assert.equal(f.states[RECOVERY_UNITS[0]].active,true);
 }finally{f.cleanup();}
});

test('Operator clears a marker only inside a verified offline window',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  const barrier=createInteractiveLeaseBarrier({path:join(f.root,'journal','interactive.lock'),journalPath:f.journal});
  barrier.begin();
  assert.deepEqual(await runInteractiveMaintenance({...f,barrier}),{restored:true,recovered:true});
  assert.equal(barrier.isClear(),true);assert.equal(existsSync(f.journal),false);
  assert.equal(f.calls.filter(call=>call==='verify-offline').length,2);
  assert.equal(f.states[RECOVERY_UNITS[0]].active,true);
 }finally{f.cleanup();}
});

test('Operator refuses a marker-only barrier before touching service state',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  const path=join(f.root,'journal','interactive.lock');
  const barrier=createInteractiveLeaseBarrier({path});barrier.begin();
  await assert.rejects(runInteractiveMaintenance({...f,barrier}),/invalid_interactive_maintenance_barrier/);
  assert.equal(existsSync(path),true);assert.equal(existsSync(f.journal),false);
  assert.deepEqual(f.calls,[]);
 }finally{f.cleanup();}
});

test('Operator refuses a journal-backed barrier for a different journal',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  const other=join(f.root,'other');mkdirSync(other,{mode:0o700});
  const barrier=createInteractiveLeaseBarrier({path:join(other,'interactive.lock'),journalPath:join(other,'maintenance.json')});barrier.begin();
  await assert.rejects(runInteractiveMaintenance({...f,barrier}),/invalid_interactive_maintenance_barrier/);
  assert.equal(existsSync(f.journal),false);assert.deepEqual(f.calls,[]);
 }finally{f.cleanup();}
});
