import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {invokeDocumentWorker,serveDocumentConnection} from '../services/documents/worker-protocol.mjs';

async function fixture(t,processor){
 const path=process.platform==='win32'?'\\\\.\\pipe\\localai-document-'+randomUUID():join(tmpdir(),'localai-document-'+randomUUID()+'.sock');
 const server=createServer(socket=>{void serveDocumentConnection(socket,processor);});server.listen(path);await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));return path;
}
test('A single bounded local worker frame returns only a checked result',async t=>{
 const seen=[];const socketPath=await fixture(t,async(request)=>{seen.push(request);return {text:'synthetic extracted text',manualReviewRequired:true};});
 const result=await invokeDocumentWorker({socketPath,request:{kind:'extract',name:'proof.txt',mime:'text/plain',content_base64:Buffer.from('private bytes').toString('base64'),options:{ocr:'off',language:'en'}}});
 assert.deepEqual(result,{text:'synthetic extracted text',manualReviewRequired:true});assert.equal(seen.length,1);assert.equal(seen[0].content_base64,Buffer.from('private bytes').toString('base64'));
});
test('Disconnect aborts document work and malformed or oversized responses fail closed',async t=>{
 let started;const entered=new Promise(resolve=>started=resolve);let cancelled=false;
 const socketPath=await fixture(t,async(_request,signal)=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));cancelled=true;return {text:'late'};});
 const controller=new AbortController(),pending=invokeDocumentWorker({socketPath,request:{kind:'ocr',name:'a.txt',mime:'text/plain',content_base64:'eA==',options:{}},signal:controller.signal});await entered;controller.abort();await assert.rejects(pending,/document_cancelled/);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(cancelled,true);
 const badPath=await fixture(t,async()=>({text:'x'.repeat(4*1024**2+1)}));
 await assert.rejects(invokeDocumentWorker({socketPath:badPath,request:{kind:'ocr',name:'a.txt',mime:'text/plain',content_base64:'eA==',options:{}}}),/document_worker_output_limit/);
});
test('Protocol rejects noncanonical base64 and path-like names before connecting to a worker',async()=>{
 const base={kind:'extract',name:'safe.txt',mime:'text/plain',content_base64:'eA==',options:{}};
 for(const request of [{...base,content_base64:'eA'},{...base,name:'../private.txt'},{...base,mime:'text/plain; charset=utf-8'}]){
  await assert.rejects(invokeDocumentWorker({socketPath:'missing-local-socket',request}),/invalid_document_worker_request/);
 }
});
test('Cancellation during connection settles promptly',async t=>{
 const socketPath=await fixture(t,async()=>({text:'should not run'}));
 const controller=new AbortController();
 const pending=invokeDocumentWorker({socketPath,request:{kind:'ocr',name:'a.txt',mime:'text/plain',content_base64:'eA==',options:{}},signal:controller.signal,timeoutMs:100});
 controller.abort();
 await assert.rejects(Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(new Error('connection_cancel_stalled')),300))]),/document_cancelled/);
});
test('Worker survives a disconnected client before a frame is complete',async t=>{
 const socketPath=await fixture(t,async()=>({text:'should not run'}));
 const client=connect(socketPath);await once(client,'connect');client.write(Buffer.from([0,0,0,50,123]));client.destroy();
 await new Promise(resolve=>setTimeout(resolve,25));
 const result=await invokeDocumentWorker({socketPath,request:{kind:'extract',name:'a.txt',mime:'text/plain',content_base64:'eA==',options:{}}});
 assert.deepEqual(result,{text:'should not run'});
});
test('A processor throwing a non-error value returns a safe worker failure',async t=>{
 const socketPath=await fixture(t,async()=>{throw null;});
 await assert.rejects(invokeDocumentWorker({socketPath,request:{kind:'extract',name:'a.txt',mime:'text/plain',content_base64:'eA==',options:{}}}),/document_worker_invalid_frame/);
});
