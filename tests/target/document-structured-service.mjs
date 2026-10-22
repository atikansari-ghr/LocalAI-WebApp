// Disposable Debian proof with the installed document service's sandbox limits.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {basename,join} from 'node:path';
import {promisify} from 'node:util';
import {openVault} from '../../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../../services/documents/structured-jobs.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const candidate=process.env.TARGET_PHASE4_CANDIDATE;
assert.match(candidate??'',/^\/opt\/localai\/documents\/candidates\/structured-socket-proof-[0-9a-f]{7}$/);
assert.equal(existsSync(join(candidate,'services/documents/supervisor-main.mjs')),true);
const exec=promisify(execFile),show=async(unit)=>(await exec('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value'],{timeout:10000})).stdout.trim();
const digest=()=>createHash('sha256').update(readFileSync('/var/lib/dpkg/status')).digest('hex');
const before={gateway:await show('localai.service'),chat:await show('localai-chat.service'),embedding:await show('localai-embedding.service'),packages:digest()};
const stateDir=mkdtempSync('/var/lib/localai-documents-structured-unit-proof-'),runtime='localai-documents-structured-proof-'+randomBytes(4).toString('hex'),unit=runtime+'.service',socketPath='/run/'+runtime+'/document.sock';
const workerPath='/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs';
const schema={schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}};
const report={document:{sha256:'a'.repeat(64)},units:[{text:'Private invoice INV-42',source:{kind:'text'}}]};
let started=false;
try{
 const args=['--unit='+unit,'-p','User=root','-p','Group=localai','-p','StateDirectory='+basename(stateDir),'-p','StateDirectoryMode=0700','-p','RuntimeDirectory='+runtime,'-p','RuntimeDirectoryMode=0750','-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','NoNewPrivileges=yes','-p','RestrictSUIDSGID=yes','-p','RestrictAddressFamilies=AF_UNIX','-p','MemoryMax=256M','-p','MemorySwapMax=0','-p','TasksMax=32','-p','CPUQuota=100%','-p','InaccessiblePaths=/var/lib/localai /var/lib/localai-models /opt/localai/ai /etc/localai /run/credentials','-E','TARGET_TEST_LXC=disposable','-E','LOCALAI_DOCUMENT_PROOF_STATE_DIR='+stateDir,'-E','LOCALAI_DOCUMENT_PROOF_SOCKET='+socketPath,'-E','LOCALAI_DOCUMENT_PROOF_WORKER='+workerPath,'/opt/localai/node/bin/node',candidate+'/services/documents/supervisor-main.mjs'];
 await exec('/usr/bin/systemd-run',args,{timeout:10000});started=true;
 for(let i=0;i<100&&!existsSync(socketPath);i++){
  if(await show(unit)==='0')throw Error('structured_service_exited');
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.equal(existsSync(socketPath),true);
 const uid=Number((await exec('/usr/bin/id',['-u','localai'])).stdout.trim()),gid=Number((await exec('/usr/bin/id',['-g','localai'])).stdout.trim());
 const script=`import {callDocumentSupervisor} from 'file://${candidate}/services/documents/supervisor-client.mjs';const command=JSON.parse(Buffer.from(process.argv[2],'base64url'));process.stdout.write(JSON.stringify(await callDocumentSupervisor(command,{socketPath:process.argv[1]})));`;
 const call=async command=>JSON.parse((await exec('/opt/localai/node/bin/node',['--input-type=module','-e',script,socketPath,Buffer.from(JSON.stringify(command)).toString('base64url')],{uid,gid,timeout:10000})).stdout);
 const submit={op:'submit-structured',namespace:'user:proof',scope:'private',idempotencyKey:'restricted_socket_key_12345',report,schema};
 const job=await call(submit);assert.equal(job.status,'queued');assert.equal((await call(submit)).id,job.id);
 assert.equal(await call({op:'structured-status',id:job.id,namespace:'user:other',scope:'private'}),null);
 assert.equal((await call({op:'structured-status',id:job.id,namespace:'user:proof',scope:'private'})).status,'queued');
 const receipt={op:'claim-owned-structured',id:job.id,namespace:'user:proof',scope:'private',claimCapability:job.claimCapability};
 assert.equal(await call({...receipt,namespace:'user:other'}),null);
 assert.equal(await call({...receipt,claimCapability:'0'.repeat(64)}),null);
 const claim=await call(receipt);assert.equal(claim.id,job.id);assert.equal(claim.report.units[0].text,'Private invoice INV-42');
 assert.equal((await call({op:'complete-structured',id:claim.id,token:claim.token,modelText:'{"fields":{"invoice":[{"value":"INV-42","evidenceIds":["u0001"]}]}}'})).status,'complete');
 assert.equal((await call({op:'structured-status',id:job.id,namespace:'user:proof',scope:'private'})).result.fields.invoice.value,'INV-42');
 assert.equal(await call({op:'structured-status',id:job.id,namespace:'user:other',scope:'private'}),null);
 await exec('/usr/bin/systemctl',['stop',unit],{timeout:15000});started=false;
 const store=openStructuredJobStore(join(stateDir,'structured.sqlite'),{vault:openVault(join(stateDir,'master.key'))});
 try{assert.equal(store.get(job.id,'user:proof','private').status,'complete');assert.equal(store.result(job.id,'user:proof','private').fields.invoice.value,'INV-42');}finally{store.close();}
 assert.deepEqual({gateway:await show('localai.service'),chat:await show('localai-chat.service'),embedding:await show('localai-embedding.service'),packages:digest()},before);
 process.stdout.write(JSON.stringify({gate:'native-structured-systemd-service',localaiAccountAccess:true,restrictedService:true,scopeIsolation:true,ownerBoundClaim:true,durable:true,liveServicesAndPackagesUnchanged:true,activated:false})+'\n');
}finally{if(started)await exec('/usr/bin/systemctl',['stop',unit],{timeout:15000});assert.equal(await show(unit),'0');rmSync(stateDir,{recursive:true,force:true});}
