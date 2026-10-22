// Disposable-LXC proof of a real systemd supervisor service restarting with an active worker.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeVault,openVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim();
const service='localai-document-supervisor-restart-proof.service',servicePath='/run/systemd/system/'+service;
assert.equal(existsSync(servicePath),false,'proof_service_already_exists');
const stateDir=mkdtempSync('/var/lib/localai-documents-restart-proof-'),runtime='localai-documents-restart-proof-'+randomBytes(4).toString('hex'),socketPath='/run/'+runtime+'/document.sock';
const beforePid=await show('localai.service','MainPID'),candidate='/opt/localai/documents/candidates/job-unit-proof';
let installed=false,startAttempted=false;
try{
 const vault=initializeVault(join(stateDir,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(stateDir,'jobs.sqlite'),{vault});
 const job=store.enqueue({namespace:'user:synthetic',scope:'private',kind:'extract',idempotencyKey:'service_restart_key_12345',name:'proof.txt',mime:'text/plain',bytes:Buffer.from('restart proof'),expiresAt:Date.now()+60000,options:{ocr:'off',language:'auto'}});store.close();
 let source=readFileSync(join(candidate,'localai-documents.service'),'utf8');
 source=source.replace('WorkingDirectory=/opt/localai/current','WorkingDirectory='+candidate).replace('ExecStart=/opt/localai/node/bin/node /opt/localai/current/services/documents/supervisor-main.mjs','ExecStart=/opt/localai/node/bin/node '+candidate+'/services/documents/supervisor-main.mjs').replace('StateDirectory=localai-documents\n','StateDirectory='+basename(stateDir)+'\n').replace('RuntimeDirectory=localai-documents\n','RuntimeDirectory='+runtime+'\n').replace('[Service]\n','[Service]\nEnvironment=TARGET_TEST_LXC=disposable\nEnvironment=LOCALAI_DOCUMENT_PROOF_STATE_DIR='+stateDir+'\nEnvironment=LOCALAI_DOCUMENT_PROOF_SOCKET='+socketPath+'\nEnvironment=LOCALAI_DOCUMENT_PROOF_WORKER='+candidate+'/tests/target/document-slow-worker.mjs\n');
 assert.ok(source.includes('Environment=LOCALAI_DOCUMENT_PROOF_SOCKET='+socketPath));writeFileSync(servicePath,source,{flag:'wx',mode:0o644});installed=true;
 await exec('/usr/bin/systemctl',['daemon-reload']);await exec('/usr/bin/systemd-analyze',['verify',servicePath],{timeout:10000});
 startAttempted=true;await exec('/usr/bin/systemctl',['start',service],{timeout:10000});
 let firstPid,workerUnit;
 for(let i=0;i<100;i++){
  firstPid=Number(await show(service,'MainPID'));
  const rows=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);
  workerUnit=rows.find(row=>row.active==='active'&&/^localai-document-job-[0-9a-f]{8}\.service$/.test(row.unit))?.unit;
  if(firstPid>0&&workerUnit)break;await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.ok(firstPid>0&&workerUnit,'active_worker_not_observed');
 if(process.env.TARGET_TEST_INJECT_BEFORE_KILL==='1')throw Error('proof_injected_failure');
 await exec('/usr/bin/systemctl',['kill','--kill-who=main','--signal=SIGKILL',service],{timeout:10000});
 assert.equal(await show(workerUnit,'ActiveState'),'active');
 let restarted=false,recovered=false;
 for(let i=0;i<200;i++){
  const currentPid=Number(await show(service,'MainPID'));
  if(currentPid>0&&currentPid!==firstPid)restarted=true;
  const check=openDocumentJobStore(join(stateDir,'jobs.sqlite'),{vault:openVault(join(stateDir,'master.key'))});
  try{const value=check.get(job.id,'user:synthetic','private');if(value?.status==='failed'&&value.errorCode==='interrupted_after_restart')recovered=true;}finally{check.close();}
  if(restarted&&recovered&&await show(workerUnit,'MainPID')==='0')break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.equal(restarted,true);assert.equal(recovered,true);assert.equal(await show(workerUnit,'MainPID'),'0');
 assert.equal(await show('localai.service','MainPID'),beforePid);
 console.log(JSON.stringify({gate:'native-document-service-restart',firstPid,restarted,orphanStopped:true,encryptedClaimRecovered:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{
 if(startAttempted){
  await exec('/usr/bin/systemctl',['stop',service],{timeout:20000}).catch(()=>{});
  const active=await show(service,'ActiveState').catch(()=>null),pid=await show(service,'MainPID').catch(()=>null);
  const rows=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);
  if(!['inactive','failed'].includes(active)||pid!=='0'||rows.some(row=>['active','activating','deactivating'].includes(row.active)))throw Error('proof_cleanup_unconfirmed');
 }
 if(installed){unlinkSync(servicePath);await exec('/usr/bin/systemctl',['daemon-reload']);}
 if(stateDir.startsWith('/var/lib/localai-documents-restart-proof-'))rmSync(stateDir,{recursive:true,force:true});
}
