// Disposable Debian source-only proof. Never starts or changes the installed document service.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdtempSync,readFileSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {callDocumentSupervisor} from '../../services/documents/supervisor-client.mjs';
import {openVault} from '../../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../../services/documents/structured-jobs.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const show=unit=>execFileSync('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value'],{encoding:'utf8',timeout:10000}).trim();
const digest=()=>createHash('sha256').update(readFileSync('/var/lib/dpkg/status')).digest('hex');
const before={gateway:show('localai.service'),chat:show('localai-chat.service'),embedding:show('localai-embedding.service'),packages:digest()};
const stateDir=mkdtempSync('/var/lib/localai-documents-structured-proof-'),runtime=mkdtempSync('/run/localai-documents-structured-proof-'),socketPath=join(runtime,'document.sock');
chmodSync(stateDir,0o700);chmodSync(runtime,0o750);
const workerPath='/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs';
assert.equal(existsSync(workerPath),true);
const main=fileURLToPath(new URL('../../services/documents/supervisor-main.mjs',import.meta.url));
const schema={schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}};
const report={document:{sha256:'a'.repeat(64)},units:[{text:'Private invoice INV-42',source:{kind:'text'}}]};
const waitExit=(processHandle,timeoutMs)=>new Promise((resolve,reject)=>{
 if(processHandle.exitCode!==null||processHandle.signalCode!==null){resolve();return;}
 const timer=setTimeout(()=>reject(Error('supervisor_stop_timeout')),timeoutMs);
 processHandle.once('exit',()=>{clearTimeout(timer);resolve();});
});
let child,missing,stderr='';
try{
 child=spawn(process.execPath,[main],{env:{...process.env,TARGET_TEST_LXC:'disposable',LOCALAI_DOCUMENT_PROOF_STATE_DIR:stateDir,LOCALAI_DOCUMENT_PROOF_WORKER:workerPath,LOCALAI_DOCUMENT_PROOF_SOCKET:socketPath},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>stderr+=chunk);
 for(let attempt=0;attempt<100&&!existsSync(socketPath);attempt++){
  if(child.exitCode!==null)throw Error('supervisor_exited: '+stderr);
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.equal(existsSync(socketPath),true,'supervisor_socket_missing: '+stderr);
 const submit={op:'submit-structured',namespace:'user:proof',scope:'private',idempotencyKey:'native_supervisor_key_12345',report,schema};
 const job=await callDocumentSupervisor(submit,{socketPath});assert.equal(job.status,'queued');
 assert.equal((await callDocumentSupervisor(submit,{socketPath})).id,job.id);
 assert.equal(await callDocumentSupervisor({op:'structured-status',id:job.id,namespace:'user:other',scope:'private'},{socketPath}),null);
 assert.equal((await callDocumentSupervisor({op:'structured-status',id:job.id,namespace:'user:proof',scope:'private'},{socketPath})).status,'queued');
 child.kill('SIGTERM');
 await waitExit(child,10000);child=null;
 const store=openStructuredJobStore(join(stateDir,'structured.sqlite'),{vault:openVault(join(stateDir,'master.key'))});
 try{assert.equal(store.get(job.id,'user:proof','private').status,'queued');assert.equal(store.get(job.id,'user:other','private'),null);}finally{store.close();}
 renameSync(join(stateDir,'structured.sqlite'),join(stateDir,'structured.sqlite.missing-proof'));
 missing=spawn(process.execPath,[main],{env:{...process.env,TARGET_TEST_LXC:'disposable',LOCALAI_DOCUMENT_PROOF_STATE_DIR:stateDir,LOCALAI_DOCUMENT_PROOF_WORKER:workerPath,LOCALAI_DOCUMENT_PROOF_SOCKET:socketPath},stdio:['ignore','ignore','pipe']});
 let rejection='';missing.stderr.on('data',chunk=>rejection+=chunk);
 await waitExit(missing,3000);missing=null;
 assert.match(rejection,/document_state_recovery_required/);
 assert.equal(existsSync(join(stateDir,'structured.sqlite')),false);
 assert.deepEqual({gateway:show('localai.service'),chat:show('localai-chat.service'),embedding:show('localai-embedding.service'),packages:digest()},before);
 process.stdout.write(JSON.stringify({gate:'native-structured-supervisor',durable:true,scoped:true,idempotent:true,missingStoreFailsClosed:true,liveServicesAndPackagesUnchanged:true,activated:false})+'\n');
}finally{for(const processHandle of [child,missing])if(processHandle){processHandle.kill('SIGTERM');try{await waitExit(processHandle,3000);}catch{processHandle.kill('SIGKILL');await waitExit(processHandle,3000);}}rmSync(runtime,{recursive:true,force:true});rmSync(stateDir,{recursive:true,force:true});}
