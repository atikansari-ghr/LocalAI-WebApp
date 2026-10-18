import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResourceProfile,readMemoryBudget} from '../services/inference/profiles.mjs';

test('operating profiles cap context and output without raising native concurrency or memory ceilings',()=>{
 const eco=selectResourceProfile('eco',{availableBytes:2*1024**3}),balanced=selectResourceProfile('balanced',{availableBytes:2*1024**3}),performance=selectResourceProfile('performance',{availableBytes:2*1024**3});
 assert.equal(eco.contextTokens,2048);assert.equal(eco.maxOutputTokens,256);
 assert.equal(balanced.contextTokens,4096);assert.equal(balanced.maxOutputTokens,512);
 assert.equal(performance.contextTokens,4096);assert.equal(performance.maxOutputTokens,1024);
 for(const mode of [eco,balanced,performance]){assert.equal(mode.concurrency,1);assert.equal(mode.emergency,false);assert.equal(mode.requestedMode,mode.effectiveMode);}
});
test('memory pressure overrides every selected mode and unknown measurements fail closed',()=>{
 for(const mode of ['eco','balanced','performance']){
  const result=selectResourceProfile(mode,{availableBytes:700*1024**2});assert.equal(result.contextTokens,1024);assert.equal(result.maxOutputTokens,128);assert.equal(result.emergency,true);assert.equal(result.requestedMode,mode);
  assert.throws(()=>selectResourceProfile(mode,{availableBytes:300*1024**2}),/resource_pressure/);
 }
 for(const value of [null,NaN,-1,Infinity])assert.throws(()=>selectResourceProfile('balanced',{availableBytes:value}));
 assert.throws(()=>selectResourceProfile('unknown',{availableBytes:2*1024**3}));
});
test('resource measurements honor the smaller of available memory and container headroom',()=>{
 const content={'/proc/meminfo':'MemAvailable: 2000000 kB\n','/sys/fs/cgroup/memory.max':'6442450944\n','/sys/fs/cgroup/memory.current':'6000000000\n'};
 assert.equal(readMemoryBudget({read:path=>content[path]}).availableBytes,442450944);
 content['/sys/fs/cgroup/memory.max']='max';assert.equal(readMemoryBudget({read:path=>content[path]}).availableBytes,2048000000);
 content['/sys/fs/cgroup/memory.current']='bad';assert.throws(()=>readMemoryBudget({read:path=>content[path]}));
});
