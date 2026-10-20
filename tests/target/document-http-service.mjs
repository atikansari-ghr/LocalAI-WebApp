// Root-only synthetic HTTP -> supervisor socket -> worker proof on disposable Debian.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {basename,join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadConfig} from '../../packages/shared/config.mjs';
import {openSecurityRepository} from '../../packages/auth/repository.mjs';
import {initializeVault,totp} from '../../packages/auth/crypto.mjs';
import {createAuthService} from '../../packages/auth/service.mjs';
import {createApplicationService} from '../../packages/auth/applications.mjs';
import {createPasskeyService} from '../../packages/auth/passkeys.mjs';
import {createBrowserHandler} from '../../apps/gateway/browser.mjs';
import {callDocumentSupervisor} from '../../services/documents/supervisor-client.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const exec=promisify(execFile),show=async(name,key)=>(await exec('/usr/bin/systemctl',['show',name,'--property='+key,'--value'])).stdout.trim();
const beforePid=await show('localai.service','MainPID'),stateDir=mkdtempSync('/var/lib/localai-documents-http-proof-'),authDir=mkdtempSync('/tmp/localai-document-auth-proof-');
const unit='localai-document-supervisor-http-proof-'+randomBytes(4).toString('hex')+'.service',runtime=unit.slice(0,-8),socketPath='/run/'+runtime+'/document.sock',candidate='/opt/localai/documents/candidates/job-unit-proof';
let started=false,server,repo;
try{
 const args=['--unit='+unit,'-p','User=root','-p','Group=localai','-p','StateDirectory='+basename(stateDir),'-p','StateDirectoryMode=0700','-p','RuntimeDirectory='+runtime,'-p','RuntimeDirectoryMode=0750','-p','PrivateNetwork=yes','-p','PrivateDevices=yes','-p','PrivateTmp=yes','-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','NoNewPrivileges=yes','-p','RestrictAddressFamilies=AF_UNIX','-p','MemoryMax=256M','-p','MemorySwapMax=0','-p','TasksMax=32','-p','CPUQuota=100%','-p','InaccessiblePaths=/var/lib/localai /var/lib/localai-models /opt/localai/ai /etc/localai /run/credentials','-E','TARGET_TEST_LXC=disposable','-E','LOCALAI_DOCUMENT_PROOF_STATE_DIR='+stateDir,'-E','LOCALAI_DOCUMENT_PROOF_SOCKET='+socketPath,'-E','LOCALAI_DOCUMENT_PROOF_WORKER=/opt/localai/documents/candidates/processor/probe/services/documents/workers/document-worker.mjs','/opt/localai/node/bin/node',candidate+'/services/documents/supervisor-main.mjs'];
 started=true;await exec('/usr/bin/systemd-run',args,{timeout:10000,maxBuffer:8192});
 for(let i=0;i<100;i++){if(await show(unit,'ActiveState')==='active'&&await show(unit,'MainPID')!=='0')break;await new Promise(resolve=>setTimeout(resolve,50));}
 assert.equal(await show(unit,'ActiveState'),'active');
 repo=openSecurityRepository(join(authDir,'platform.sqlite'));
 const vault=initializeVault(join(authDir,'master.key'),{encryptedStateExists:repo.hasEncryptedState()}),auth=createAuthService({repo,vault}),apps=createApplicationService({repo,auth}),passkeys=createPasskeyService({repo,auth,rpId:'localai.test',origin:'https://localai.test'});
 const config=loadConfig({LOCALAI_TRANSPORT:'proxy',LOCALAI_ORIGIN:'https://localai.test',LOCALAI_TRUSTED_PROXIES:'127.0.0.1'});
 server=createServer(createBrowserHandler({config,repo,auth,apps,passkeys,vault,documentClient:(command,options)=>callDocumentSupervisor(command,{...options,socketPath})}));server.listen(0,'127.0.0.1');await once(server,'listening');
 const jar=new Map();let csrf='';
 async function request(path,{method='GET',body,headers={}}={}){
  const payload=body===undefined?undefined:JSON.stringify(body);
  const response=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method,headers:{host:'localai.test','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.15',origin:'https://localai.test',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json','x-csrf-token':csrf,...(payload===undefined?{}:{'content-length':Buffer.byteLength(payload)}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const raw=Buffer.concat(chunks).toString();resolve({status:res.statusCode,cookies:res.headers['set-cookie']??[],body:raw?JSON.parse(raw):null});});});req.on('error',reject);req.end(payload);});
  for(const cookie of response.cookies){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  if(response.body?.csrf)csrf=response.body.csrf;return response;
 }
 await request('/auth/bootstrap');const pending=await request('/auth/setup/begin',{method:'POST',body:{code:auth.issueSetupCode(),username:'syntheticadmin',password:'correct horse battery staple'}});
 assert.equal(pending.status,200);assert.equal((await request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.body.totpSecret)}})).status,200);
 const submitted=await request('/v1/extract',{method:'POST',body:{name:'proof.txt',mime:'text/plain',content_base64:Buffer.from('مرحبا browser-to-worker').toString('base64'),scope:'private',ocr:'off'},headers:{'idempotency-key':'http_native_proof_12345'}});
 assert.equal(submitted.status,202);let result;
 for(let i=0;i<100;i++){const check=await request(submitted.body.status_url);assert.equal(check.status,200);if(check.body.status==='complete'){result=check.body.result;break;}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(result?.text,'مرحبا browser-to-worker');assert.equal(await show('localai.service','MainPID'),beforePid);
 assert.equal((await request('/v1/documents/'+submitted.body.id+'?scope=private',{method:'DELETE'})).status,204);
 assert.equal((await request(submitted.body.status_url)).status,404);
 console.log(JSON.stringify({gate:'native-document-http-service',submitted:true,completed:true,deleted:true,gatewayPidUnchanged:true,activated:false,phase4Gate:'blocked'}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));repo?.close();
 if(started){await exec('/usr/bin/systemctl',['stop',unit],{timeout:20000}).catch(()=>{});const active=await show(unit,'ActiveState').catch(()=>null),pid=await show(unit,'MainPID').catch(()=>null);const rows=JSON.parse((await exec('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'])).stdout);if(!['inactive','failed'].includes(active)||pid!=='0'||rows.some(row=>['active','activating','deactivating'].includes(row.active)))throw Error('proof_cleanup_unconfirmed');}
 if(stateDir.startsWith('/var/lib/localai-documents-http-proof-'))rmSync(stateDir,{recursive:true,force:true});if(authDir.startsWith('/tmp/localai-document-auth-proof-'))rmSync(authDir,{recursive:true,force:true});
}
