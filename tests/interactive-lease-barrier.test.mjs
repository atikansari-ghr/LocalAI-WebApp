import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,chmodSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInteractiveLeaseBarrier} from '../services/resources/interactive-lease-barrier.mjs';

const linux=(name,fn)=>test(name,{skip:process.platform==='win32'},fn);
linux('A completed lease clears its durable marker but an interrupted lease blocks recovery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-barrier-'));chmodSync(dir,0o700);const path=join(dir,'interactive.lock');
 try{
  const barrier=createInteractiveLeaseBarrier({path});assert.equal(barrier.isClear(),true);
  const first=barrier.begin();assert.equal(existsSync(path),true);assert.equal(barrier.isClear(),false);
  assert.throws(()=>barrier.begin(),/interactive_recovery_required/);
  assert.throws(()=>barrier.finish('wrong'),/interactive_recovery_required/);
  barrier.finish(first);assert.equal(barrier.isClear(),true);
  barrier.begin();assert.equal(createInteractiveLeaseBarrier({path}).isClear(),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
linux('Offline recovery keeps an interrupted marker until verification succeeds',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-barrier-'));chmodSync(dir,0o700);const path=join(dir,'interactive.lock');
 try{
  const barrier=createInteractiveLeaseBarrier({path});barrier.begin();
  await assert.rejects(barrier.recover(async()=>false),/interactive_recovery_required/);
  assert.equal(barrier.isClear(),false);
  await barrier.recover(async()=>true);assert.equal(barrier.isClear(),true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
linux('Offline recovery refuses a marker replaced while services are checked',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-barrier-'));chmodSync(dir,0o700);const path=join(dir,'interactive.lock');
 try{
  const barrier=createInteractiveLeaseBarrier({path});barrier.begin();
  await assert.rejects(barrier.recover(async()=>{renameSync(path,join(dir,'old.lock'));writeFileSync(path,'0'.repeat(64),{mode:0o600});return true;}),/interactive_recovery_required/);
  assert.equal(barrier.isClear(),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

linux('A pending maintenance journal blocks document claims after the lease marker is cleared',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-barrier-'));chmodSync(dir,0o700);
 const path=join(dir,'interactive.lock'),journalPath=join(dir,'maintenance.json');
 try{
  const barrier=createInteractiveLeaseBarrier({path,journalPath});
  const token=barrier.begin();writeFileSync(journalPath,'pending',{mode:0o600});
  barrier.finish(token);
  assert.equal(barrier.isClear(),false);
  rmSync(journalPath);assert.equal(barrier.isClear(),true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
