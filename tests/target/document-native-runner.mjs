// Root-only proof of the candidate runner on the disposable LXC.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runNativeDocumentUnit} from '../../services/documents/native-runner.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim(),beforePid=await show('localai.service','MainPID');
const workerPath='/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs';
const proof=await runNativeDocumentUnit({workerPath,request:{kind:'extract',name:'proof.txt',mime:'text/plain',content_base64:Buffer.from('مرحبا supervised worker').toString('base64'),options:{ocr:'off',language:'auto'}},timeoutMs:10000});
assert.equal(proof.result.text,'مرحبا supervised worker');assert.equal(proof.cleanupConfirmed,true);
assert.equal(await show(proof.unit,'MainPID'),'0');assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');
await assert.rejects(runNativeDocumentUnit({workerPath,request:{kind:'forged'},timeoutMs:10000}),/invalid_document_worker_request/);
await assert.rejects(runNativeDocumentUnit({workerPath,request:{kind:'ocr',name:'proof.txt',mime:'text/plain',content_base64:'eA==',options:{}},timeoutMs:10000}),/document_worker_invalid_frame/);
const controller=new AbortController(),cancelled=runNativeDocumentUnit({workerPath,request:{kind:'extract',name:'cancel.txt',mime:'text/plain',content_base64:'eA==',options:{}},signal:controller.signal,timeoutMs:10000});controller.abort();
await assert.rejects(cancelled,/document_cancelled/);
await assert.rejects(runNativeDocumentUnit({workerPath:'/opt/localai/documents/candidates/job-unit-proof/tests/target/document-noisy-worker.mjs',request:{kind:'extract',name:'noisy.txt',mime:'text/plain',content_base64:'eA==',options:{}},timeoutMs:10000}),/document_worker_output_limit/);
const inventory=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);
assert.equal(inventory.some(row=>row.active==='active'||row.active==='activating'||row.active==='deactivating'),false);
assert.equal(await show('localai.service','MainPID'),beforePid);
console.log(JSON.stringify({gate:'native-document-runner',unit:proof.unit,resultParser:proof.result.parser,cleanupConfirmed:true,failureUnitStopped:true,cancelledStartupStopped:true,outputLimitStopped:true,invalidRequestRejectedBeforeStart:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
