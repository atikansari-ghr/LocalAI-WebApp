import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {invokeDocumentWorker} from '../services/documents/worker-protocol.mjs';
import {startDocumentWorker} from '../services/documents/worker-server.mjs';

const request={kind:'extract',name:'sample.txt',mime:'text/plain',content_base64:Buffer.from('مرحبا hello').toString('base64'),options:{ocr:'off',language:'auto'}};
async function socketFixture(t){if(process.platform==='win32')return '\\\\.\\pipe\\localai-one-shot-'+randomUUID()+'\\worker.sock';const directory=await mkdtemp(join(tmpdir(),'localai-one-shot-'+randomUUID()));t.after(()=>rm(directory,{recursive:true,force:true}));return join(directory,'worker.sock');}

test('One-shot worker serves one request and closes its listener',async t=>{
 const socketPath=await socketFixture(t),worker=await startDocumentWorker({socketPath,processor:async input=>({text:Buffer.from(input.content_base64,'base64').toString('utf8')})});
 assert.deepEqual(await invokeDocumentWorker({socketPath,request}),{text:'مرحبا hello'});
 await worker.done;
 await assert.rejects(invokeDocumentWorker({socketPath,request,timeoutMs:200}));
 if(process.platform!=='win32')await assert.rejects(stat(socketPath),{code:'ENOENT'});
});

test('A disconnected caller completes worker cleanup without running another request',async t=>{
 const socketPath=await socketFixture(t);let entered;const started=new Promise(resolve=>entered=resolve);
 const worker=await startDocumentWorker({socketPath,processor:async(_input,signal)=>{entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {text:'late'};}});
 const controller=new AbortController(),pending=invokeDocumentWorker({socketPath,request,signal:controller.signal});await started;controller.abort();await assert.rejects(pending,/document_cancelled/);
 await Promise.race([worker.done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('worker_cleanup_stalled')),500))]);
});
test('Worker completion waits for cancellation cleanup after the socket closes',async t=>{
 const socketPath=await socketFixture(t);let entered,release;const started=new Promise(resolve=>entered=resolve),cleanup=new Promise(resolve=>release=resolve);let cleaned=false;
 const worker=await startDocumentWorker({socketPath,processor:async(_input,signal)=>{entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));await cleanup;cleaned=true;return {text:'late'};}});
 const controller=new AbortController(),pending=invokeDocumentWorker({socketPath,request,signal:controller.signal});await started;controller.abort();await assert.rejects(pending,/document_cancelled/);
 assert.equal(await Promise.race([worker.done.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),30))]),false);
 release();await worker.done;assert.equal(cleaned,true);
});
test('A failed socket bind does not leave an unhandled worker completion',async t=>{
 const socketPath=await socketFixture(t),first=await startDocumentWorker({socketPath,processor:async()=>({text:'ok'})});
 await assert.rejects(startDocumentWorker({socketPath,processor:async()=>({text:'bad'})}),/EADDRINUSE/);
 await invokeDocumentWorker({socketPath,request});await first.done;
});
