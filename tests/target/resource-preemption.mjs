// Root-only synthetic supervisor test: child document unit receives no credentials.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createResourceAdmission} from '../../services/resources/admission.mjs';
import {createResourceReader} from '../../services/resources/snapshot.mjs';
import {createInferenceClient} from '../../services/inference/client.mjs';
assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),unit='localai-priority-document-candidate.service',show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim(),beforePid=await show('localai.service','MainPID'),resources=createResourceReader(),admission=createResourceAdmission({resources}),events=[];
const key=(await readFile('/run/credentials/localai.service/ai-backend-key','utf8')).trim();assert.match(key,/^[A-Za-z0-9_-]{43}$/);
let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);let child,workerPid,outputBytes=0,observed=false;
const background=admission.runBackground(async signal=>new Promise((resolve,reject)=>{
 const args=['--wait','--pipe','--collect','--unit='+unit,'-p','Slice=localai-ai.slice','-p','DynamicUser=yes','-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectHome=yes','-p','ProtectSystem=strict','-p','NoNewPrivileges=yes','-p','RestrictSUIDSGID=yes','-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=100%','-p','TasksMax=32','-p','RuntimeMaxSec=120','-p','InaccessiblePaths=/var/lib/localai /var/lib/localai-models /opt/localai/ai /etc/localai /run/credentials','-E','TARGET_TEST_LXC=disposable','/opt/localai/node/bin/node','/opt/localai/documents/candidates/processor/probe/tests/target/document-processor-candidate.mjs'];
 child=spawn('/usr/bin/systemd-run',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});const cancel=()=>{events.push('background-abort');void exec('/usr/bin/systemctl',['stop',unit]).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 const data=chunk=>{outputBytes+=chunk.length;if(outputBytes>65536){cancel();reject(new Error('candidate_output_limit'));}if(!observed&&chunk.toString().includes('ocr-start')){observed=true;events.push('worker-started');readyResolve();}};child.stdout.on('data',data);child.stderr.on('data',data);child.on('error',reject);child.on('close',code=>{signal.removeEventListener('abort',cancel);events.push('unit-finished');if(code===0)resolve();else reject(new Error('candidate_unit_stopped'));});
})),backgroundResult=background.then(()=>{throw new Error('Background completed before preemption');},error=>error);
let readyTimer;
try{
 await Promise.race([ready,backgroundResult.then(reason=>{throw reason;}),new Promise((_,reject)=>{readyTimer=setTimeout(()=>reject(new Error('candidate_start_timeout')),20000);})]);clearTimeout(readyTimer);workerPid=Number(await show(unit,'MainPID'));assert.ok(workerPid>1);
 const shared={runInteractive:(work,options)=>admission.runInteractive(signal=>{events.push('interactive-admitted');assert.ok(events.indexOf('unit-finished')>=0);return work(signal);},options)},client=createInferenceClient({key,admission:shared,timeoutMs:60000,resources:()=>({availableBytes:resources().containerAvailableBytes})});const started=performance.now(),result=await client.chat({messages:[{role:'user',content:'Reply briefly with: LOCAL AI PRIORITY OK'}],max_tokens:24});events.push('chat-finished');assert.ok(result.choices[0].message.content.trim().length>0);assert.equal((await backgroundResult).code,'background_preempted');assert.ok(events.indexOf('unit-finished')<events.indexOf('chat-finished'));
 await assert.rejects(readFile('/proc/'+workerPid+'/stat'),error=>error.code==='ENOENT');assert.equal(await show('localai.service','MainPID'),beforePid);assert.equal(await show('localai.service','ActiveState'),'active');assert.equal(resources().swapUsedBytes,0);assert.equal(admission.snapshot().active,null);
 console.log(JSON.stringify({gate:'native-shared-resource-priority',events,elapsedMs:Math.round(performance.now()-started),realChatCompleted:true,backgroundUnitKilledBeforeChatCompletion:true,workerSwapBytes:0,gatewayPidUnchanged:true,activated:false,fullPhaseGate:'blocked'}));
}finally{clearTimeout(readyTimer);await exec('/usr/bin/systemctl',['stop',unit]).catch(()=>{});}
