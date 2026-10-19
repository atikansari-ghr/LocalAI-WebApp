import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceReader} from '../services/resources/snapshot.mjs';
const root='/sys/fs/cgroup',slice=root+'/localai.slice/localai-ai.slice';
function fixture(){const files=new Map([['/proc/meminfo','MemTotal: 6291456 kB\nMemAvailable: 4194304 kB\n'],[root+'/memory.current',String(3*1024**3)],[root+'/memory.max','max'],[root+'/memory.stat',`anon 1073741824
file 0
inactive_file 0
`],[root+'/memory.swap.current','1024'],[root+'/memory.pressure','some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n'],[slice+'/memory.current',String(3*1024**3)],[slice+'/memory.max',String(5*1024**3)],[slice+'/memory.stat',`anon 1073741824
file 0
inactive_file 0
`],[slice+'/memory.swap.current','0'],[slice+'/memory.pressure','some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n']]);return {files,read:path=>{if(!files.has(path))throw new Error('missing');return files.get(path);}};}
test('Resource reader accounts for container charges and shared worker slice rather than gateway leaf limit',()=>{
 const {read}=fixture(),value=createResourceReader({read})();assert.equal(value.availableBytes,2*1024**3);assert.equal(value.swapUsedBytes,0);assert.equal(value.existingHostSwapBytes,1024);assert.equal(value.hostSwapGrowthBytes,0);assert.equal(value.memoryPressure,0);
});
test('Resource reader fails closed on malformed metrics and retains recent host swap growth cooldown',()=>{
 const {files,read}=fixture();let now=100000;const sample=createResourceReader({read,now:()=>now});sample();files.set(root+'/memory.swap.current','2048');assert.equal(sample().hostSwapGrowthBytes,1024);now+=1000;assert.equal(sample().hostSwapGrowthBytes,1024);now+=60001;assert.equal(sample().hostSwapGrowthBytes,0);files.set(slice+'/memory.pressure','corrupt');assert.throws(sample,/resource_measurement_unavailable/);
});

test('Resource reader exposes container and worker reserves separately for already loaded inference',()=>{
 const {files,read}=fixture();files.set(slice+'/memory.current',String(4.75*1024**3));const value=createResourceReader({read})();assert.equal(value.availableBytes,0.25*1024**3);assert.equal(value.containerAvailableBytes,3*1024**3);assert.equal(value.workerSliceAvailableBytes,0.25*1024**3);
});

test('Reclaimable inactive file cache is excluded from new-worker headroom without discounting anonymous memory',()=>{
 const {files,read}=fixture();files.set(root+'/memory.current',String(5.5*1024**3));files.set(root+'/memory.stat',`anon 2684354560
file 2147483648
inactive_file 2147483648
`);files.set(slice+'/memory.current',String(4.75*1024**3));files.set(slice+'/memory.stat',`anon 2684354560
file 1073741824
inactive_file 1073741824
`);const value=createResourceReader({read})();assert.equal(value.containerAvailableBytes,2.5*1024**3);assert.equal(value.workerSliceAvailableBytes,1.25*1024**3);assert.equal(value.availableBytes,1.25*1024**3);
});
