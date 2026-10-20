import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {createResourceAdmission} from '../services/resources/admission.mjs';
import {createInteractiveLeaseServer,withInteractiveLease} from '../services/resources/interactive-lease.mjs';
import {createInteractiveLeaseBarrier} from '../services/resources/interactive-lease-barrier.mjs';

const linux=(name,fn)=>test(name,{skip:process.platform==='win32'},fn);
const safe=()=>({availableBytes:2*1024**3,swapUsedBytes:0,memoryPressure:0,hostSwapGrowthBytes:0});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

linux('Cross-process chat lease preempts a document and waits for confirmed cleanup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe,monitorIntervalMs:20});let started=deferred(),cleanup=deferred(),entered=false;
 const background=admission.runBackground(signal=>new Promise(resolve=>{started.resolve();signal.addEventListener('abort',async()=>{await cleanup.promise;resolve('cleaned');},{once:true});}));
 const barrier=createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')}),server=await createInteractiveLeaseServer({socketPath,admission,barrier});
 try{
  await started.promise;
  const chat=withInteractiveLease(async signal=>{assert.equal(signal.aborted,false);entered=true;return 'chat';},{socketPath,timeoutMs:1000});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(entered,false);assert.equal(admission.snapshot().backgroundAborting,true);
  cleanup.resolve();await assert.rejects(background,/background_preempted/);assert.equal(await chat,'chat');assert.equal(entered,true);assert.equal(barrier.isClear(),true);
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('Closing a waiting gateway lease removes it without consuming an interactive slot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe});const held=deferred(),entered=deferred();
 const first=admission.runInteractive(async()=>{entered.resolve();await held.promise;});const server=await createInteractiveLeaseServer({socketPath,admission,barrier:createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')})});
 try{
  await entered.promise;const controller=new AbortController();const queued=withInteractiveLease(()=>assert.fail('cancelled lease entered'),{socketPath,signal:controller.signal,timeoutMs:1000});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(admission.snapshot().queuedInteractive,1);
  controller.abort();await assert.rejects(queued,/admission_cancelled/);
  for(let attempt=0;attempt<50&&admission.snapshot().queuedInteractive;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(admission.snapshot().queuedInteractive,0);
 }finally{held.resolve();await first;await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('A stalled local lease handshake cannot occupy a connection indefinitely',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe});const server=await createInteractiveLeaseServer({socketPath,admission,barrier:createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')}),handshakeMs:20});
 try{
  const socket=createConnection(socketPath);await new Promise(resolve=>socket.once('connect',resolve));socket.write('lea');
  await Promise.race([new Promise(resolve=>socket.once('close',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('handshake_stalled')),500))]);
  assert.equal(await withInteractiveLease(()=>42,{socketPath,timeoutMs:500}),42);
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('Losing the supervisor socket aborts work holding a granted lease',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe}),server=await createInteractiveLeaseServer({socketPath,admission,barrier:createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')})});const entered=deferred();
 try{
  const work=withInteractiveLease(signal=>new Promise((_,reject)=>{entered.resolve();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}),{socketPath,timeoutMs:500});
  await entered.promise;await server.close();await assert.rejects(work,/admission_lease_lost/);
 }finally{await server.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});

linux('A worker result racing a lost lease is rejected rather than reported as success',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe}),server=await createInteractiveLeaseServer({socketPath,admission,barrier:createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')})});const entered=deferred();
 try{
  const work=withInteractiveLease(signal=>new Promise(resolve=>{entered.resolve();signal.addEventListener('abort',()=>resolve('late success'),{once:true});}),{socketPath,timeoutMs:500});
  await entered.promise;await server.close();await assert.rejects(work,/admission_lease_lost/);
 }finally{await server.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});

linux('An unclean granted lease remains blocked across a new barrier instance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock'),path=join(dir,'interactive.lock');
 const admission=createResourceAdmission({resources:safe}),barrier=createInteractiveLeaseBarrier({path}),server=await createInteractiveLeaseServer({socketPath,admission,barrier}),entered=deferred();
 try{
  const work=withInteractiveLease(signal=>new Promise((_,reject)=>{entered.resolve();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}),{socketPath,timeoutMs:500});const rejected=assert.rejects(work,/admission_lease_lost/);
  await entered.promise;assert.equal(barrier.isClear(),false);await server.close();await rejected;
  assert.equal(createInteractiveLeaseBarrier({path}).isClear(),false);
 }finally{await server.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});

linux('A settled inference error releases its marker through the completion handshake',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock'),path=join(dir,'interactive.lock');
 const admission=createResourceAdmission({resources:safe}),barrier=createInteractiveLeaseBarrier({path}),server=await createInteractiveLeaseServer({socketPath,admission,barrier});
 try{await assert.rejects(withInteractiveLease(()=>{throw new Error('inference_failed');},{socketPath,timeoutMs:500}),/inference_failed/);assert.equal(barrier.isClear(),true);}
 finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('A duplicate lease frame while queued cannot create a second durable grant',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o700);const socketPath=join(dir,'lease.sock'),path=join(dir,'interactive.lock');
 const admission=createResourceAdmission({resources:safe}),barrier=createInteractiveLeaseBarrier({path}),held=deferred(),entered=deferred();
 const first=admission.runInteractive(async()=>{entered.resolve();await held.promise;});const server=await createInteractiveLeaseServer({socketPath,admission,barrier});
 try{
  await entered.promise;const socket=createConnection(socketPath);await new Promise(resolve=>socket.once('connect',resolve));socket.write('lease\n');
  for(let attempt=0;attempt<50&&admission.snapshot().queuedInteractive<1;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(admission.snapshot().queuedInteractive,1);socket.write('lease\n');
  await Promise.race([new Promise(resolve=>socket.once('close',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('duplicate_lease_open')),500))]);
  held.resolve();await first;assert.equal(barrier.isClear(),true);
 }finally{held.resolve();await first;await server.close();rmSync(dir,{recursive:true,force:true});}
});
