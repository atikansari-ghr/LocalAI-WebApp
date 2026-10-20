// Explicit disposable Debian proof. This never activates a document route.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocumentProcessor} from '../../services/documents/parsers.mjs';
import {runStructuredExtractionCandidate} from '../../services/documents/structured-extract.mjs';
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
const lease=await createInteractiveLeaseServer({socketPath,admission,barrier:createInteractiveLeaseBarrier({path:join(dir,'interactive.lock')})});
try{
 const leased=createInteractiveLeaseAdmission({socketPath,timeoutMs:60000});
 const inference=createInferenceClient({key,admission:leased,timeoutMs:60000,resources:()=>({availableBytes:resources().containerAvailableBytes})});
 const report=await createDocumentProcessor()({name:'invoice.txt',mime:'text/plain',bytes:Buffer.from('Invoice INV-42\nDate 2024-02-29\nTotal 120.50 SAR\nفاتورة INV-42\n','utf8')});
 const schema={schemaVersion:1,schemaId:'invoice-proof',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'},date:{type:'string',format:'date'},total:{type:'string',format:'amount'}},required:['invoice','date','total']}};
 const observed={chat:async(...args)=>{const reply=await inference.chat(...args);process.stderr.write('synthetic_model_reply='+JSON.stringify(reply.choices?.[0]?.message?.content)+'\n');return reply;}};
 const result=await runStructuredExtractionCandidate({report,schema,inference:observed});
 assert.equal(result.fields.invoice.status,'found');assert.equal(result.fields.invoice.value,'INV-42');
 assert.equal(result.fields.date.status,'found');assert.equal(result.fields.total.status,'found');
 assert.equal(result.reviewRequired,true);assert.equal(show('localai.service'),before);assert.equal(resources().swapUsedBytes,0);
 process.stdout.write(JSON.stringify({gate:'native-structured-model-candidate',result,gatewayPidUnchanged:true,swapUsedBytes:0,activated:false})+'\n');
}finally{await lease.close();rmSync(dir,{recursive:true,force:true});}
