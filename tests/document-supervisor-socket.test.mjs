import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {createDocumentSupervisorSocket} from '../services/documents/supervisor-socket.mjs';

test('Private Unix socket accepts one bounded frame and closes after a response',{skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-doc-socket-')),path=join(dir,'doc.sock');let calls=0;
 const store={get:()=>{calls++;return {id:'123e4567-e89b-42d3-a456-426614174000',status:'queued',expiresAt:123};}},runner={cancel:()=>false};
 let server;const held=[];
 try{
  server=await createDocumentSupervisorSocket({socketPath:path,store,runner});
  assert.equal(statSync(path).mode&0o777,0o660);
  const exchange=payload=>new Promise((resolve,reject)=>{const client=createConnection(path);let reply='';client.setTimeout(3000,()=>client.destroy(new Error('socket_timeout')));client.on('error',reject);client.on('data',chunk=>reply+=chunk);client.on('end',()=>resolve(JSON.parse(reply)));client.on('connect',()=>client.end(payload));});
  const valid=JSON.stringify({op:'status',id:'123e4567-e89b-42d3-a456-426614174000',namespace:'user:owner',scope:'private'})+'\n';
  assert.equal((await exchange(valid)).data.status,'queued');assert.equal(calls,1);
  const oversized=await exchange('x'.repeat(14*1024*1024+1)+'\n').catch(error=>({error:error.code}));
  assert.ok(['invalid_document_supervisor_message','ECONNRESET','EPIPE'].includes(oversized.error));assert.equal(calls,1);
  for(let i=0;i<4;i++){const client=createConnection(path);client.on('error',()=>{});held.push(client);}await Promise.all(held.map(client=>new Promise(resolve=>client.once('connect',resolve))));
  let count=0;for(let attempt=0;attempt<20;attempt++){count=await new Promise((resolve,reject)=>server.getConnections((error,value)=>error?reject(error):resolve(value)));if(count===4)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(count,4);
  assert.equal(await new Promise(resolve=>{const extra=createConnection(path);extra.on('error',()=>resolve('rejected'));extra.on('close',()=>resolve('rejected'));extra.on('connect',()=>extra.write(valid));}),'rejected');
  for(const client of held)client.destroy();
 }finally{for(const client of held)client.destroy();if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('An absolute deadline releases all four slow-client slots',{skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-doc-deadline-')),path=join(dir,'doc.sock'),store={get:()=>({status:'queued'})},runner={cancel:()=>false};
 let server,ticker;const clients=[];
 try{
  server=await createDocumentSupervisorSocket({socketPath:path,store,runner,deadlineMs:100});
  for(let i=0;i<4;i++){const client=createConnection(path);client.on('error',()=>{});clients.push(client);}await Promise.all(clients.map(client=>new Promise(resolve=>client.once('connect',resolve))));
  ticker=setInterval(()=>{for(const client of clients)if(!client.destroyed)client.write(' ');},20);
  await Promise.all(clients.map(client=>new Promise(resolve=>client.once('close',resolve))));
  assert.equal(await new Promise((resolve,reject)=>server.getConnections((error,count)=>error?reject(error):resolve(count))),0);
 }finally{if(ticker)clearInterval(ticker);for(const client of clients)client.destroy();if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
