// Disposable Debian proof: only a synthetic private queue is affected.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeVault,openVault} from '../../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../../services/documents/structured-jobs.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const show=unit=>execFileSync('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value'],{encoding:'utf8',timeout:10000}).trim();
const digest=()=>createHash('sha256').update(readFileSync('/var/lib/dpkg/status')).digest('hex');
const before={gateway:show('localai.service'),chat:show('localai-chat.service'),embedding:show('localai-embedding.service'),packages:digest()};
const directory=mkdtempSync('/root/localai-structured-restart-');chmodSync(directory,0o700);
const schema={schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}};
const report={document:{sha256:'a'.repeat(64)},units:[{text:'Private invoice INV-42',source:{kind:'text'}}]};
let store;
try{
 const vault=initializeVault(join(directory,'master.key'),{encryptedStateExists:false});
 store=openStructuredJobStore(join(directory,'jobs.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:proof',scope:'private',idempotencyKey:'native_restart_12345',report,schema,expiresAt:Date.now()+86400000});
 const receipt={id:job.id,namespace:'user:proof',scope:'private',claimCapability:job.claimCapability};
 store.close();store=null;
 try{execFileSync(process.execPath,[fileURLToPath(new URL('./document-structured-restart-child.mjs',import.meta.url)),directory],{encoding:'utf8',timeout:15000,env:{...process.env,TARGET_STRUCTURED_PROOF_RECEIPT:JSON.stringify(receipt)}});assert.fail('child did not stop abruptly');}
 catch(error){assert.equal(error.signal,'SIGKILL');}
 store=openStructuredJobStore(join(directory,'jobs.sqlite'),{vault:openVault(join(directory,'master.key'))});
 assert.equal(store.claimOwned(receipt),null);assert.equal(store.get(job.id,'user:proof','private').status,'running');
 assert.throws(()=>store.recoverInterrupted(),/interactive_recovery_required/);
 assert.equal(store.recoverInterrupted({interactiveRecoveryConfirmed:true}),1);
 assert.equal(store.get(job.id,'user:proof','private').status,'failed');
 assert.equal(store.result(job.id,'user:proof','private'),null);
 assert.deepEqual({gateway:show('localai.service'),chat:show('localai-chat.service'),embedding:show('localai-embedding.service'),packages:digest()},before);
 process.stdout.write(JSON.stringify({gate:'native-structured-job-restart',claimPersisted:true,lateReplayBlocked:true,explicitRecoveryRequired:true,liveServicesAndPackagesUnchanged:true,activated:false})+'\n');
}finally{store?.close();rmSync(directory,{recursive:true,force:true});}
