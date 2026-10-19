import test from 'node:test';
import assert from 'node:assert/strict';
import {runDocumentTool} from '../services/documents/tool-process.mjs';
test('Document process captures bounded binary output without a shell and retains exit status',async()=>{
 const result=await runDocumentTool(process.execPath,['-e','process.stdout.write(Buffer.from([0,1,255]));process.exitCode=7']);assert.deepEqual([...result.stdout],[0,1,255]);assert.equal(result.code,7);
});
test('Document process terminates on output overflow timeout and caller cancellation',async()=>{
 await assert.rejects(runDocumentTool(process.execPath,['-e','process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'],{maxStdoutBytes:10}),/document_tool_output_limit/);
 await assert.rejects(runDocumentTool(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}),/document_tool_timeout/);
 const controller=new AbortController(),pending=runDocumentTool(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});setTimeout(()=>controller.abort(),50);await assert.rejects(pending,/document_tool_cancelled/);
 assert.equal((await runDocumentTool(process.execPath,['-e','process.stdout.write("reused")'])).stdout.toString(),'reused');
});
