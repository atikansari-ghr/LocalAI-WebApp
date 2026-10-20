import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,chmodSync} from 'node:fs';
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
