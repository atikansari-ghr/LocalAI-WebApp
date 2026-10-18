// Authenticated HTTP -> real private workers, with synthetic account state only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {loadConfig} from '../../packages/shared/config.mjs';
import {openState} from '../../packages/database/index.mjs';
import {openSecurityRepository} from '../../packages/auth/repository.mjs';
import {initializeVault,totp} from '../../packages/auth/crypto.mjs';
import {createAuthService} from '../../packages/auth/service.mjs';
import {createApplicationService} from '../../packages/auth/applications.mjs';
import {createGateway} from '../../apps/gateway/server.mjs';
import {createInferenceClient} from '../../services/inference/client.mjs';

if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable Debian root acceptance required');
assert.equal(existsSync('/etc/localai/inference.json'),true,'Activate the qualified private runtime first');
const run=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:30000}).trim();
const gatewayPid=run('systemctl',['show','localai.service','-p','MainPID','--value']);assert.ok(Number(gatewayPid)>0);
for(const unit of ['localai-chat.service','localai-embedding.service'])assert.equal(run('systemctl',['is-active',unit]),'active');
const directory=mkdtempSync('/tmp/localai-activated-api-'),state=openState(directory+'/state.sqlite'),repo=openSecurityRepository(directory+'/security.sqlite');
const vault=initializeVault(directory+'/master.key',{encryptedStateExists:repo.hasEncryptedState()}),auth=createAuthService({repo,vault}),apps=createApplicationService({repo,auth});
const key=run('systemd-creds',['decrypt','--name=ai-backend-key','/etc/credstore.encrypted/localai-ai-key','-']);
const inference=createInferenceClient({key,fallbackEnabled:true,onFallback:event=>repo.audit(Date.now(),'inference_fallback',null,event.to,event.reason)});
const config=loadConfig({LOCALAI_TRANSPORT:'proxy',LOCALAI_ORIGIN:'https://localai-runtime-validation.test',LOCALAI_TRUSTED_PROXIES:'127.0.0.1'});
const server=createGateway({state,config,repo,vault,auth,apps,inference}),jar=new Map();let csrf='';
server.listen(0,'127.0.0.1');await once(server,'listening');
function headers(extra,payload){return {host:'localai-runtime-validation.test','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.15',origin:'https://localai-runtime-validation.test',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json','x-csrf-token':csrf,...(payload===undefined?{}:{'content-length':Buffer.byteLength(payload)}),...extra};}
async function request(path,{method='GET',body,extra={}}={}){
 const payload=body===undefined?undefined:JSON.stringify(body);
 const result=await new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method,agent:false,headers:headers(extra,payload)},res=>{
   const chunks=[];let size=0;res.on('error',reject);res.on('data',chunk=>{size+=chunk.length;if(size>8*1024**2)res.destroy(new Error('Oversized fixture response'));else chunks.push(chunk);});
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
  });req.setTimeout(120000,()=>req.destroy(new Error('Fixture request deadline')));req.on('error',reject);req.end(payload);
 });
 for(const cookie of result.headers['set-cookie']??[]){const pair=cookie.split(';')[0],index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}
 try{result.value=JSON.parse(result.text);}catch{result.value=result.text;}
 if(result.value.csrf)csrf=result.value.csrf;return result;
}
try{
 assert.ok(await inference.health());
 assert.equal((await request('/v1/models',{extra:{cookie:''}})).status,401);
 await request('/auth/bootstrap');
 const pending=await request('/auth/setup/begin',{method:'POST',body:{code:auth.issueSetupCode(),username:'fixture-admin',password:'Synthetic-only-'+randomUUID()}});assert.equal(pending.status,200);
 assert.equal((await request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}})).status,200);
 const token=jar.get('__Host-localai-session'),application=apps.create(token,csrf,{name:'Synthetic native acceptance',capabilities:['models','chat','embeddings'],networks:['192.0.2.15/32']});
 const extra={authorization:'Bearer '+application.key,cookie:''};
 assert.equal((await request('/v1/models',{extra})).status,200);
 for(const content of ['Reply with ready.','اذكر كلمة عربية واحدة عن السماء.']){
  const result=await request('/v1/chat/completions',{method:'POST',extra,body:{messages:[{role:'user',content}],max_tokens:32,temperature:0}});
  assert.equal(result.status,200);assert.ok(result.value.choices?.[0]?.message?.content?.trim());assert.equal(result.value.model,'localai-chat');
  if(content.startsWith('اذكر'))assert.match(result.value.choices[0].message.content,/[\u0600-\u06ff]/);
 }
 const embedded=await request('/v1/embeddings',{method:'POST',extra,body:{input:['Synthetic document.','مستند تجريبي.']}});assert.equal(embedded.status,200);assert.equal(embedded.value.data.length,2);
 for(const item of embedded.value.data){assert.equal(item.embedding.length,1024);assert.ok(item.embedding.every(Number.isFinite));}
 const body={messages:[{role:'user',content:'Reply ready.'}],max_tokens:8};
 for(const denied of [{...extra,'x-forwarded-for':'192.0.2.16'},{...extra,origin:'https://evil.test'},{...extra,cookie:'__Host-localai-session='+token}])assert.equal((await request('/v1/chat/completions',{method:'POST',extra:denied,body})).status,403);
 const limited=apps.create(token,csrf,{name:'Synthetic limited capability',capabilities:['models'],networks:['192.0.2.15/32']});
 assert.equal((await request('/v1/embeddings',{method:'POST',extra:{authorization:'Bearer '+limited.key,cookie:''},body:{input:'denied'}})).status,403);
 assert.equal((await request('/v1/chat/completions',{method:'POST',extra:{'x-csrf-token':'incorrect'},body})).status,403);
 assert.equal((await request('/v1/chat/completions',{method:'POST',body})).status,200);
 assert.equal((await request('/v1/chat/completions',{method:'POST',extra,body:{messages:[{role:'user',content:'hello '.repeat(5000)}],max_tokens:8}})).status,400);
 const streamed=await request('/v1/chat/completions',{method:'POST',extra,body:{messages:[{role:'user',content:'Count from one to five.'}],max_tokens:32,stream:true}});assert.equal(streamed.status,200);assert.match(streamed.text,/data: \[DONE\]/);
 const chunks=streamed.text.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));assert.ok(chunks.some(chunk=>chunk.choices?.[0]?.delta?.content));assert.ok(chunks.every(chunk=>chunk.model==='localai-chat'));
 // Disconnect only after genuine generated content, then prove reuse through HTTP.
 await new Promise((resolve,reject)=>{
  const payload=JSON.stringify({messages:[{role:'user',content:'Count slowly from one to one hundred.'}],max_tokens:256,stream:true});let cancelled=false;
  const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/v1/chat/completions',method:'POST',agent:false,headers:headers(extra,payload)},res=>{
   if(res.statusCode!==200){res.resume();reject(new Error('Cancellation fixture request rejected'));return;}let pending='';res.on('error',error=>{if(!cancelled)reject(error);});
   res.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split('\n');pending=lines.pop();for(const line of lines)if(line.startsWith('data: {')&&JSON.parse(line.slice(6)).choices?.[0]?.delta?.content){cancelled=true;res.destroy();req.destroy();resolve();return;}});
   res.on('end',()=>{if(!cancelled)reject(new Error('Stream ended before cancellation fixture received content'));});
  });req.setTimeout(120000,()=>req.destroy(new Error('Cancellation fixture deadline')));req.on('error',error=>{if(!cancelled)reject(error);});req.end(payload);
 });
 for(let i=0;i<50&&inference.busy;i++)await new Promise(resolve=>setTimeout(resolve,100));assert.equal(inference.busy,false);
 assert.equal((await request('/v1/chat/completions',{method:'POST',extra,body})).status,200);
 apps.revoke(token,csrf,application.id);assert.equal((await request('/v1/models',{extra})).status,403);
 const ready=await request('/health/ready');assert.equal(ready.status,503);assert.deepEqual(ready.value.blockers,['release_not_qualified']);
 assert.equal(run('systemctl',['show','localai.service','-p','MainPID','--value']),gatewayPid);
 const report={scope:'private-preview',check:'authenticated-gateway-real-native-inference',englishArabicChat:true,embeddings1024:true,sse:true,cancellationAndReuse:true,applicationPolicies:true,browserCsrf:true,contextRejection:true,releaseStillBlocked:true,realAccountModified:false,realGatewayPidPreserved:true};
 mkdirSync('.localai',{recursive:true,mode:0o700});writeFileSync('.localai/activated-runtime.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repo.close();state.close();assert.ok(directory.startsWith('/tmp/localai-activated-api-'));rmSync(directory,{recursive:true,force:true});}
