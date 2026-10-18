import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../installer/preflight.mjs';
const valid={os:'debian',version:'13',arch:'x64',cpus:4,memoryBytes:6*1024**3,diskBytes:100*1024**3,freeBytes:70*1024**3,systemd:true};
test('installer rejects unsupported environments without mutating the host',()=>{
  assert.deepEqual(preflight(valid).errors,[]);
  for(const change of [{os:'ubuntu'},{version:'12'},{arch:'riscv64'},{cpus:2},{memoryBytes:3*1024**3},{diskBytes:40*1024**3},{freeBytes:1024**3},{systemd:false}]) {
    assert.ok(preflight({...valid,...change}).errors.length>0,JSON.stringify(change));
  }
});
test('preflight rejects missing and nonfinite resource measurements',()=>{
  for(const field of ['cpus','memoryBytes','diskBytes','freeBytes'])for(const value of [undefined,NaN,-1,Infinity])assert.ok(preflight({...valid,[field]:value}).errors.length);
});
