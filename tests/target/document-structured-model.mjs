// Explicit disposable Debian proof. This never activates a document route.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocumentProcessor} from '../../services/documents/parsers.mjs';
import {initializeVault,openVault} from '../../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../../services/documents/structured-jobs.mjs';
import {createStructuredJobRunner,createStructuredInferenceGenerator} from '../../services/documents/structured-runner.mjs';
import {createInferenceClient} from '../../services/inference/client.mjs';
import {createResourceAdmission} from '../../services/resources/admission.mjs';
import {createResourceReader} from '../../services/resources/snapshot.mjs';
import {createInteractiveLeaseServer,createInteractiveLeaseAdmission} from '../../services/resources/interactive-lease.mjs';
import {createInteractiveLeaseBarrier} from '../../services/resources/interactive-lease-barrier.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const show=name=>execFileSync('/usr/bin/systemctl',['show',name,'--property=MainPID','--value'],{encoding:'utf8'}).trim();
const before=show('localai.service'),dir=mkdtempSync(join(tmpdir(),'localai-structured-model-'));
const key=readFileSync('/run/credentials/localai.service/ai-backend-key','utf8').trim();
const resources=createResourceReader(),admission=createResourceAdmission({resources,monitorIntervalMs:100});
const socketPath=join(dir,'interactive.sock');
const barrier=createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')});
const lease=await createInteractiveLeaseServer({socketPath,admission,barrier});
let store;
try{
 const leased=createInteractiveLeaseAdmission({socketPath,timeoutMs:60000});
 // The runner owns one lease from claim through completion; the inference
 // client must not request a nested lease for this internal operation.
 const inference=createInferenceClient({key,timeoutMs:60000,resources:()=>({availableBytes:resources().containerAvailableBytes})});
 const report=await createDocumentProcessor()({name:'invoice.txt',mime:'text/plain',bytes:Buffer.from('Invoice INV-42\nDate 2024-02-29\nTotal 120.50 SAR\nفاتورة INV-42\n','utf8')});
 const schema={schemaVersion:1,schemaId:'invoice-proof',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'},date:{type:'string',format:'date'},total:{type:'string',format:'amount'}},required:['invoice','date','total']}};
 const observed={chat:async(...args)=>{const reply=await inference.chat(...args);process.stderr.write('synthetic_model_reply='+JSON.stringify(reply.choices?.[0]?.message?.content)+'\n');return reply;}};
 const vault=initializeVault(join(dir,'structured.key'),{encryptedStateExists:false});
 store=openStructuredJobStore(join(dir,'structured.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:proof',scope:'private',idempotencyKey:'native_invoice_12345',report,schema,expiresAt:Date.now()+86400000});
 const runner=createStructuredJobRunner({store,receipt:{id:job.id,namespace:'user:proof',scope:'private',claimCapability:job.claimCapability},admission:leased,barrier,generateCandidate:createStructuredInferenceGenerator({inference:observed})});
 const completed=await runner.step();assert.equal(completed.id,job.id);assert.equal(completed.status,'complete');
 store.close();store=null;
 const reopened=openStructuredJobStore(join(dir,'structured.sqlite'),{vault:openVault(join(dir,'structured.key'))});
 store=reopened;
 const result=reopened.result(job.id,'user:proof','private');
 assert.equal(result.fields.invoice.status,'found');assert.equal(result.fields.invoice.value,'INV-42');
 assert.equal(result.fields.date.status,'found');assert.equal(result.fields.total.status,'found');
 assert.equal(result.reviewRequired,true);assert.equal(show('localai.service'),before);assert.equal(resources().swapUsedBytes,0);
 process.stdout.write(JSON.stringify({gate:'native-structured-model-candidate',result,persistedAcrossReopen:true,gatewayPidUnchanged:true,swapUsedBytes:0,activated:false})+'\n');
}finally{store?.close();await lease.close();rmSync(dir,{recursive:true,force:true});}
