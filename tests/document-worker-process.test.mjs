import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {invokeDocumentWorker} from '../services/documents/worker-protocol.mjs';
async function deadline(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(code)),ms);})]);}finally{clearTimeout(timer);}}

test('One-shot document process extracts multilingual literal text and exits cleanly',async t=>{
 const directory=process.platform==='win32'?null:await mkdtemp(join(tmpdir(),'localai-worker-process-'));
 if(directory)t.after(()=>rm(directory,{recursive:true,force:true}));
 const socketPath=process.platform==='win32'?'\\\\.\\pipe\\localai-worker-'+randomUUID()+'\\worker.sock':join(directory,'worker.sock');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../services/documents/workers/document-worker.mjs',import.meta.url))],{env:{...process.env,LOCALAI_DOCUMENT_SOCKET:socketPath},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const exited=new Promise(resolve=>child.once('exit',resolve));
 await deadline(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('document_worker_ready'))resolve();});child.once('exit',code=>reject(new Error('worker_exited_'+code)));}),3000,'worker_start_timeout');
 const result=await invokeDocumentWorker({socketPath,request:{kind:'extract',name:'note.txt',mime:'text/plain',content_base64:Buffer.from('Hello مرحبا').toString('base64'),options:{ocr:'off',language:'auto'}}});
 assert.equal(result.text,'Hello مرحبا');assert.equal(result.parser,'localai-txt-v1');
 const exit=await deadline(exited,3000,'worker_exit_timeout');assert.equal(exit,0);
});
