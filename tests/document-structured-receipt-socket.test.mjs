import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {initializeVault} from '../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../services/documents/structured-jobs.mjs';

const fixture=()=>({schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}});

test('dedicated receipt socket returns one pending capability without report content', {skip:process.platform==='win32'}, async()=>{
 const {createStructuredReceiptSocket,requestStructuredReceipt}=await import('../services/documents/supervisor-socket.mjs');
 const dir=mkdtempSync(join(tmpdir(),'localai-receipt-socket-')),socketDir=join(dir,'socket');mkdirSync(socketDir,{mode:0o750});chmodSync(socketDir,0o750);
 const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false});
 const store=openStructuredJobStore(join(dir,'jobs.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:one',scope:'private',idempotencyKey:'receipt_socket_12345',report:{document:{sha256:'a'.repeat(64)},units:[{text:'Private invoice INV-42',source:{kind:'text'}}]},schema:fixture(),expiresAt:Date.now()+60000});
 let server,clear=true,stopping=false;
 try{
  const socketPath=join(socketDir,'receipts.sock');
  server=await createStructuredReceiptSocket({socketPath,executorGid:process.getgid(),structuredStore:store,barrier:{isClear:()=>clear},isStopping:()=>stopping});
  assert.deepEqual(await requestStructuredReceipt({socketPath}),{id:job.id,namespace:'user:one',scope:'private',claimCapability:job.claimCapability});
  assert.equal((await requestStructuredReceipt({socketPath})).id,job.id);
  clear=false;await assert.rejects(requestStructuredReceipt({socketPath}),/interactive_recovery_required/);
  clear=true;stopping=true;await assert.rejects(requestStructuredReceipt({socketPath}),/document_runner_stopping/);stopping=false;
  const claim=store.claimOwned({id:job.id,namespace:'user:one',scope:'private',claimCapability:job.claimCapability});assert.ok(claim);
  assert.equal(await requestStructuredReceipt({socketPath}),null);
 }finally{await new Promise(resolve=>server?.close(resolve)??resolve());store.close();rmSync(dir,{recursive:true,force:true});}
});

test('receipt socket bounds idle clients and releases a slot after disconnect', {skip:process.platform==='win32'}, async()=>{
 const {createStructuredReceiptSocket,requestStructuredReceipt}=await import('../services/documents/supervisor-socket.mjs');
 const dir=mkdtempSync(join(tmpdir(),'localai-receipt-limit-'));chmodSync(dir,0o750);
 const socketPath=join(dir,'receipts.sock'),parked=[];
 let server;
 try{
  server=await createStructuredReceiptSocket({socketPath,executorGid:process.getgid(),structuredStore:{pendingReceipts:()=>[]},barrier:{isClear:()=>true}});
  for(let i=0;i<2;i++)parked.push(await new Promise((resolve,reject)=>{const socket=createConnection(socketPath);socket.once('connect',()=>resolve(socket));socket.once('error',reject);}));
  const overflow=createConnection(socketPath);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{overflow.destroy();reject(new Error('receipt_socket_not_bounded'));},500);overflow.once('close',()=>{clearTimeout(timer);resolve();});overflow.once('error',()=>{});});
  parked.pop().destroy();
  let recovered=false;for(let i=0;i<20&&!recovered;i++){
   try{assert.equal(await requestStructuredReceipt({socketPath}),null);recovered=true;}
   catch(error){if(error.message!=='structured_receipt_unavailable')throw error;await new Promise(resolve=>setTimeout(resolve,10));}
  }
  assert.equal(recovered,true);
 }finally{for(const socket of parked)socket.destroy();if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('valid requests cannot pin receipt slots with a half-open connection', {skip:process.platform==='win32'}, async()=>{
 const {createStructuredReceiptSocket,requestStructuredReceipt}=await import('../services/documents/supervisor-socket.mjs');
 const dir=mkdtempSync(join(tmpdir(),'localai-receipt-half-open-'));chmodSync(dir,0o750);
 const socketPath=join(dir,'receipts.sock'),peers=[];let server;
 try{
  server=await createStructuredReceiptSocket({socketPath,executorGid:process.getgid(),structuredStore:{pendingReceipts:()=>[]},barrier:{isClear:()=>true}});
  for(let i=0;i<2;i++){
   const socket=createConnection({path:socketPath,allowHalfOpen:true});peers.push(socket);
   const ended=new Promise(resolve=>socket.once('end',resolve));
   await new Promise((resolve,reject)=>{socket.once('connect',()=>socket.write('next\n'));socket.once('data',resolve);socket.once('error',reject);});
   await ended;
  }
  let recovered=false;for(let i=0;i<20&&!recovered;i++){
   try{assert.equal(await requestStructuredReceipt({socketPath}),null);recovered=true;}
   catch(error){if(error.message!=='structured_receipt_unavailable')throw error;await new Promise(resolve=>setTimeout(resolve,10));}
  }
  assert.equal(recovered,true);
 }finally{for(const peer of peers)peer.destroy();if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
