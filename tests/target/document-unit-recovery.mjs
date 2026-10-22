// Root-only synthetic restart proof; never opens enrolled state.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {recoverDocumentUnits} from '../../services/documents/unit-recovery.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),unit='localai-document-proof-recovery-'+randomUUID().slice(0,8)+'.service';
const show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim();
const beforePid=await show('localai.service','MainPID'),directory=await mkdtemp(join(tmpdir(),'localai-restart-proof-'));
const vault=initializeVault(join(directory,'master.key'),{encryptedStateExists:false}),store=openDocumentJobStore(join(directory,'jobs.sqlite'),{vault});
const job=store.enqueue({namespace:'app:synthetic',scope:'private',kind:'extract',idempotencyKey:'restartproofkey12345',name:'restart.txt',mime:'text/plain',bytes:Buffer.from('synthetic restart'),expiresAt:Date.now()+60000}),claim=store.claim();
assert.equal(job.id,claim.id);
try{
 await exec('/usr/bin/systemd-run',['--unit='+unit,'--collect','-p','DynamicUser=yes','-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectHome=yes','-p','ProtectSystem=strict','-p','NoNewPrivileges=yes','-p','MemoryMax=64M','-p','MemorySwapMax=0','-p','RuntimeMaxSec=120','/usr/bin/sleep','120']);
 let pid=0;for(let n=0;n<50;n++){pid=Number(await show(unit,'MainPID'));if(pid>1)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(pid>1);
 assert.throws(()=>store.recoverInterrupted({nativeCleanupConfirmed:false}),/native_cleanup_required/);
 const report=await recoverDocumentUnits({prefix:'localai-document-proof-recovery-',onStopped:()=>store.recoverInterrupted({nativeCleanupConfirmed:true})});
 assert.ok(report.stopped.includes(unit));assert.equal(store.get(job.id,'app:synthetic','private').status,'failed');
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');
 console.log(JSON.stringify({gate:'native-document-restart-cleanup',unit,unitStoppedBeforeJobRecovery:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{await exec('/usr/bin/systemctl',['stop',unit]).catch(()=>{});store.close();await rm(directory,{recursive:true,force:true});}
