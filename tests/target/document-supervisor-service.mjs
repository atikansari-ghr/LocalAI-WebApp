// Root-only inactive service proof on the disposable Debian LXC.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeVault,openVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim();
const beforePid=await show('localai.service','MainPID'),dir=mkdtempSync('/var/lib/localai-documents-proof-'),unit='localai-document-supervisor-proof-'+randomBytes(4).toString('hex')+'.service',runtime=unit.slice(0,-8),socketPath='/run/'+runtime+'/document.sock';
let started=false;
try{
 await assert.rejects(exec('/opt/localai/node/bin/node',['/opt/localai/documents/candidates/job-unit-proof/services/documents/supervisor-main.mjs'],{env:{...process.env,TARGET_TEST_LXC:'disposable',LOCALAI_DOCUMENT_PROOF_STATE_DIR:dir,LOCALAI_DOCUMENT_PROOF_SOCKET:socketPath,LOCALAI_DOCUMENT_PROOF_WORKER:'/opt/localai/documents/missing-worker.mjs'},timeout:5000}),/ENOENT/);
 assert.equal(existsSync(join(dir,'master.key')),false);
 const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:synthetic',scope:'private',kind:'extract',idempotencyKey:'native_service_key_12345',name:'proof.txt',mime:'text/plain',bytes:Buffer.from('مرحبا service'),expiresAt:Date.now()+60000,options:{ocr:'off',language:'auto'}});store.close();
 const args=['--unit='+unit,'-p','User=root','-p','Group=localai','-p','StateDirectory='+basename(dir),'-p','StateDirectoryMode=0700','-p','RuntimeDirectory='+runtime,'-p','RuntimeDirectoryMode=0750','-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','NoNewPrivileges=yes','-p','RestrictAddressFamilies=AF_UNIX','-p','MemoryMax=256M','-p','MemorySwapMax=0','-p','TasksMax=32','-p','CPUQuota=100%','-p','InaccessiblePaths=/var/lib/localai /var/lib/localai-models /opt/localai/ai /etc/localai /run/credentials','-E','TARGET_TEST_LXC=disposable','-E','LOCALAI_DOCUMENT_PROOF_STATE_DIR='+dir,'-E','LOCALAI_DOCUMENT_PROOF_SOCKET='+socketPath,'-E','LOCALAI_DOCUMENT_PROOF_WORKER=/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs','/opt/localai/node/bin/node','/opt/localai/documents/candidates/job-unit-proof/services/documents/supervisor-main.mjs'];
 await exec('/usr/bin/systemd-run',args,{timeout:10000,maxBuffer:8192});started=true;
 let completed=false;
 for(let attempt=0;attempt<100;attempt++){
  const check=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault:openVault(join(dir,'master.key'))});
  try{if(check.get(job.id,'user:synthetic','private')?.status==='complete'){assert.equal(check.result(job.id,'user:synthetic','private').text,'مرحبا service');completed=true;break;}}finally{check.close();}
  if(await show(unit,'ActiveState')!=='active')throw Error('document_supervisor_exited');await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(completed,true);assert.equal(await show(unit,'ActiveState'),'active');assert.ok(Number(await show(unit,'MainPID'))>0);
 const uid=Number((await exec('/usr/bin/id',['-u','localai'])).stdout.trim()),gid=Number((await exec('/usr/bin/id',['-g','localai'])).stdout.trim());
 const client="import {createConnection} from 'node:net';const s=createConnection(process.argv[1]);let result='';s.setTimeout(3000,()=>s.destroy(new Error('timeout')));s.on('data',chunk=>result+=chunk);s.on('end',()=>process.stdout.write(result));s.on('connect',()=>s.end(JSON.stringify({op:'status',id:process.argv[2],namespace:'user:synthetic',scope:process.argv[3]})+'\\n'));";
 const fetch=async scope=>JSON.parse((await exec('/opt/localai/node/bin/node',['--input-type=module','-e',client,socketPath,job.id,scope],{uid,gid,timeout:5000})).stdout);
 assert.equal((await fetch('private')).data.result.text,'مرحبا service');assert.equal((await fetch('other')).data,null);
 await exec('/usr/bin/systemctl',['stop',unit],{timeout:15000});started=false;
 assert.equal(await show(unit,'MainPID'),'0');assert.equal(await show('localai.service','MainPID'),beforePid);
 const inventory=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);assert.equal(inventory.some(row=>['active','activating','deactivating'].includes(row.active)),false);
 console.log(JSON.stringify({gate:'native-document-supervisor-service',unit,completed:true,gracefulStop:true,missingWorkerRejectedBeforeState:true,localaiSocketAccess:true,scopeIsolation:true,noActiveJobs:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{if(started)await exec('/usr/bin/systemctl',['stop',unit],{timeout:15000}).catch(()=>{});rmSync(dir,{recursive:true,force:true});}
