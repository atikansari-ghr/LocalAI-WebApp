import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {createResourceAdmission} from '../services/resources/admission.mjs';
import {createInteractiveLeaseServer,withInteractiveLease} from '../services/resources/interactive-lease.mjs';

const linux=(name,fn)=>test(name,{skip:process.platform==='win32'},fn);
const safe=()=>({availableBytes:2*1024**3,swapUsedBytes:0,memoryPressure:0,hostSwapGrowthBytes:0});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

linux('Cross-process chat lease preempts a document and waits for confirmed cleanup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o750);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe,monitorIntervalMs:20});let started=deferred(),cleanup=deferred(),entered=false;
 const background=admission.runBackground(signal=>new Promise(resolve=>{started.resolve();signal.addEventListener('abort',async()=>{await cleanup.promise;resolve('cleaned');},{once:true});}));
 const server=await createInteractiveLeaseServer({socketPath,admission});
 try{
  await started.promise;
  const chat=withInteractiveLease(async signal=>{assert.equal(signal.aborted,false);entered=true;return 'chat';},{socketPath,timeoutMs:1000});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(entered,false);assert.equal(admission.snapshot().backgroundAborting,true);
  cleanup.resolve();await assert.rejects(background,/background_preempted/);assert.equal(await chat,'chat');assert.equal(entered,true);
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('Closing a waiting gateway lease removes it without consuming an interactive slot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o750);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe});const held=deferred(),entered=deferred();
 const first=admission.runInteractive(async()=>{entered.resolve();await held.promise;});const server=await createInteractiveLeaseServer({socketPath,admission});
 try{
  await entered.promise;const controller=new AbortController();const queued=withInteractiveLease(()=>assert.fail('cancelled lease entered'),{socketPath,signal:controller.signal,timeoutMs:1000});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(admission.snapshot().queuedInteractive,1);
  controller.abort();await assert.rejects(queued,/admission_cancelled/);
  for(let attempt=0;attempt<50&&admission.snapshot().queuedInteractive;attempt++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(admission.snapshot().queuedInteractive,0);
 }finally{held.resolve();await first;await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('A stalled local lease handshake cannot occupy a connection indefinitely',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o750);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe});const server=await createInteractiveLeaseServer({socketPath,admission,handshakeMs:20});
 try{
  const socket=createConnection(socketPath);await new Promise(resolve=>socket.once('connect',resolve));socket.write('lea');
  await Promise.race([new Promise(resolve=>socket.once('close',resolve)),new Promise((_,reject)=>setTimeout(()=>reject(new Error('handshake_stalled')),500))]);
  assert.equal(await withInteractiveLease(()=>42,{socketPath,timeoutMs:500}),42);
 }finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});

linux('Losing the supervisor socket aborts work holding a granted lease',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o750);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe}),server=await createInteractiveLeaseServer({socketPath,admission});const entered=deferred();
 try{
  const work=withInteractiveLease(signal=>new Promise((_,reject)=>{entered.resolve();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}),{socketPath,timeoutMs:500});
  await entered.promise;await server.close();await assert.rejects(work,/admission_lease_lost/);
 }finally{await server.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});

linux('A worker result racing a lost lease is rejected rather than reported as success',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-lease-'));chmodSync(dir,0o750);const socketPath=join(dir,'lease.sock');
 const admission=createResourceAdmission({resources:safe}),server=await createInteractiveLeaseServer({socketPath,admission});const entered=deferred();
 try{
  const work=withInteractiveLease(signal=>new Promise(resolve=>{entered.resolve();signal.addEventListener('abort',()=>resolve('late success'),{once:true});}),{socketPath,timeoutMs:500});
  await entered.promise;await server.close();await assert.rejects(work,/admission_lease_lost/);
 }finally{await server.close().catch(()=>{});rmSync(dir,{recursive:true,force:true});}
});
