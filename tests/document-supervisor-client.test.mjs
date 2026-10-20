import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {callDocumentSupervisor} from '../services/documents/supervisor-client.mjs';

test('Gateway candidate client sends one frame and accepts one bounded response',{skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-doc-client-')),path=join(dir,'doc.sock');const server=createServer(socket=>{socket.on('data',chunk=>{assert.deepEqual(JSON.parse(chunk.toString()),{op:'status',id:'job'});socket.end('{"data":{"status":"queued"}}\n');});});
 await new Promise(resolve=>server.listen(path,resolve));
 try{assert.deepEqual(await callDocumentSupervisor({op:'status',id:'job'},{socketPath:path}),{status:'queued'});}
 finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('Gateway candidate client rejects disconnected and oversized responses',{skip:process.platform==='win32'},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-doc-client-bad-')),path=join(dir,'doc.sock');let count=0;
 const server=createServer(socket=>{socket.on('data',()=>{if(count++===0)socket.destroy();else socket.end('x'.repeat(5*1024*1024+2));});});await new Promise(resolve=>server.listen(path,resolve));
 try{await assert.rejects(callDocumentSupervisor({op:'status'},{socketPath:path,timeoutMs:1000}));await assert.rejects(callDocumentSupervisor({op:'status'},{socketPath:path,timeoutMs:1000}),/document_supervisor_response_limit/);}
 finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
