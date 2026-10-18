import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readlinkSync,readdirSync} from 'node:fs';
import {renderChatRouterPresets,renderChatRouterUnit} from '../../services/inference/native.mjs';
import fallback from '../../services/inference/fallback-manifest.json' with {type:'json'};
import starter from '../../services/inference/starter-manifest.json' with {type:'json'};
import {provisionStarter,provisionFallback} from '../../installer/install-ai.mjs';
import {createServer} from 'node:http';
import {createInferenceClient,requestPrivateWorker} from '../../services/inference/client.mjs';
const endpoint='unix:/run/localai-chat/inference.sock';

if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable test LXC required');
const run=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',timeout:180000,...options}).trim();
if(spawnSync('getent',['group','localai-runtime'],{stdio:'ignore'}).status!==0)run('groupadd',['--system','localai-runtime']);
for(const service of ['localai-chat.service','localai-embedding.service','localai-router-validation.service'])assert.notEqual(spawnSync('systemctl',['is-active','--quiet',service]).status,0,'Stop prior private workers first');
assert.equal(existsSync('/etc/localai/inference.json'),false,'Public runtime must remain inactive during candidate qualification');
const gatewayPid=run('systemctl',['show','localai.service','-p','MainPID','--value']);assert.ok(Number(gatewayPid)>0);
const primary=await provisionStarter(starter),small=await provisionFallback(fallback),fallbackPath=small.assets[0].path;
const modelDirectory=fallbackPath.slice(0,fallbackPath.lastIndexOf('/'));
run('chown',['root:localai-inference',modelDirectory,fallbackPath]);run('chmod',['0750',modelDirectory]);run('chmod',['0640',fallbackPath]);
mkdirSync('/opt/localai/ai/router-validation',{recursive:true,mode:0o750});run('chown',['root:localai-inference','/opt/localai/ai/router-validation']);
const preset='/opt/localai/ai/router-validation/models.ini';writeFileSync(preset,renderChatRouterPresets({primary:primary.assets.find(a=>a.id==='chat').path,fallback:fallbackPath}),{mode:0o640});run('chown',['root:localai-inference',preset]);
const unit='/etc/systemd/system/localai-router-validation.service';writeFileSync(unit,renderChatRouterUnit({runtime:'/opt/localai/ai/runtimes/llama-b11669',preset,credential:'/run/credentials/placeholder/ai-backend-key'},{idleSeconds:5}),{mode:0o644});
run('systemd-analyze',['verify',unit]);run('systemctl',['daemon-reload']);
const secret=run('systemd-creds',['decrypt','--name=ai-backend-key','/etc/credstore.encrypted/localai-ai-key','-']);
const post=async(path,body)=>{const response=await requestPrivateWorker(endpoint,path,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const data=await response.json();assert.equal(response.status,200,'Native router request failed');return data;};
try{
 run('systemctl',['start','localai-router-validation.service','localai-embedding.service']);
 let ready=false;for(let i=0;i<30;i++){try{const response=await requestPrivateWorker(endpoint,'/health',{signal:AbortSignal.timeout(1000)});await response.body?.cancel();if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}assert.ok(ready);
 const checks=[];
 for(const model of ['localai-chat','localai-chat-fallback','localai-chat']){
  for(const prompt of ['Reply with ready.','اذكر كلمة عربية واحدة عن السماء.']){
   const result=await post('/v1/chat/completions',{model,messages:[{role:'user',content:prompt}],max_tokens:32,temperature:0,chat_template_kwargs:{enable_thinking:false}});
   assert.ok(result.choices?.[0]?.message?.content?.trim());if(prompt.startsWith('اذكر'))assert.match(result.choices[0].message.content,/[\u0600-\u06ff]/);
  }
  const formatted=await post('/apply-template',{model,messages:[{role:'user',content:'ready'}],add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}});assert.equal(typeof formatted.prompt,'string');
  const tokens=await post('/tokenize',{model,content:formatted.prompt,add_special:true});assert.ok(tokens.tokens.length>0);
  const listing=await requestPrivateWorker(endpoint,'/models',{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(5000)});const listed=await listing.json();assert.equal(listing.status,200);
  assert.ok(listed.data.filter(item=>['loaded','loading'].includes(item.status?.value)).length<=1,'Native router exceeded one loaded chat model');
  checks.push({model,check:'english-arabic-chat-template-tokenizer'});
 }
 // Inject a primary-only HTTP outage while the fallback still executes on the real native router.
 // No model files or user state are changed by fault injection.
 let blocked=true,attempts=0,now=1000;const events=[];
 const proxy=createServer(async(req,res)=>{
  try{
   const buffers=[];for await(const chunk of req)buffers.push(chunk);const body=JSON.parse(Buffer.concat(buffers));
   if(body.model==='localai-chat'&&req.url==='/apply-template'){attempts++;if(blocked){res.writeHead(503);res.end('{}');return;}}
   const response=await requestPrivateWorker(endpoint,req.url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
   res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json'});res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(502);res.end('{}');}
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{
  const client=createInferenceClient({key:secret,chatEndpoint:'http://127.0.0.1:'+proxy.address().port,fallbackEnabled:true,onFallback:event=>events.push(event),now:()=>now});
  for(let i=0;i<4;i++){
   const result=await client.chat({messages:[{role:'user',content:'Reply with ready.'}],max_tokens:16});assert.equal(result.model,'localai-chat-fallback');assert.ok(result.choices[0].message.content);
  }
  assert.equal(attempts,3);assert.equal(events.length,4);
  blocked=false;now+=60001;
  const restored=await client.chat({messages:[{role:'user',content:'Reply with ready.'}],max_tokens:16});assert.equal(restored.model,'localai-chat');assert.ok(restored.choices[0].message.content);assert.equal(attempts,4);
  checks.push({check:'real-fallback-with-primary-http-fault-circuit-cooldown-and-recovery',auditEvents:events.length});
 }finally{proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
 const routerPid=run('systemctl',['show','localai-router-validation.service','-p','MainPID','--value']);
 assert.notEqual(readlinkSync('/proc/'+routerPid+'/ns/net'),readlinkSync('/proc/1/ns/net'));
 const childPids=[...new Set(readdirSync('/proc/'+routerPid+'/task').flatMap(tid=>{try{return readFileSync('/proc/'+routerPid+'/task/'+tid+'/children','utf8').trim().split(/\s+/).filter(Boolean);}catch(error){if(error.code==='ENOENT')return [];throw error;}}))];assert.ok(childPids.length>0);
 const hostListeners=run('ss',['-ltnp']);for(const pid of childPids){assert.equal(readlinkSync('/proc/'+pid+'/ns/net'),readlinkSync('/proc/'+routerPid+'/ns/net'));assert.ok(!hostListeners.includes('pid='+pid+','));}
 const denied=spawnSync('runuser',['-u','nobody','--',process.execPath,'--input-type=module','--eval',"import {connect} from 'node:net';const socket=connect('/run/localai-chat/inference.sock');socket.on('connect',()=>{console.log('CONNECTED');socket.destroy();});socket.on('error',error=>console.log(error.code));"],{encoding:'utf8',timeout:5000});assert.equal(denied.stdout.trim(),'EACCES');
 assert.equal(run('runuser',['-u','localai','-g','localai-runtime','--','curl','--silent','--output','/dev/null','--write-out','%{http_code}','--unix-socket','/run/localai-chat/inference.sock','http://localhost/v1/models']),'401');
 checks.push({check:'child-listeners-isolated-and-unrelated-user-denied'});
 assert.equal(run('systemctl',['show','localai-ai.slice','-p','MemorySwapCurrent','--value']),'0');
 assert.equal(run('systemctl',['show','localai.service','-p','MainPID','--value']),gatewayPid);
 const report={qualification:'router-tested-unqualified',starterManifest:primary.manifestSha256,fallbackManifest:small.manifestSha256,checks,memory:run('systemctl',['show','localai-ai.slice','-p','MemoryCurrent','-p','MemoryPeak','-p','MemorySwapCurrent'])};
 mkdirSync('.localai',{recursive:true,mode:0o700});writeFileSync('.localai/router.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}finally{run('systemctl',['stop','localai-router-validation.service','localai-embedding.service']);}
