// Explicit native qualification harness. This does not activate the public API.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import manifest from '../../services/inference/starter-manifest.json' with {type:'json'};
import {provisionStarter} from '../../installer/install-ai.mjs';
import {renderWorkerUnit} from '../../services/inference/native.mjs';
import {createInferenceClient} from '../../services/inference/client.mjs';

if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable Debian test LXC required');
const run=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',timeout:180000,...options}).trim();
run(process.execPath,['installer/preflight.mjs']);
const gatewayPid=run('systemctl',['show','localai.service','--property=MainPID','--value']);
assert.ok(Number(gatewayPid)>0);
const candidate=await provisionStarter(manifest);
const runtime='/opt/localai/ai/runtimes/llama-b11669';
mkdirSync('/opt/localai/ai/runtimes',{recursive:true,mode:0o755});
// Root owns the extracted vendor distribution, including its original LICENSE.
// Always re-extract the just-verified, exact pinned archive before execution.
for(const service of ['localai-chat.service','localai-embedding.service']){
 const state=spawnSync('systemctl',['is-active','--quiet',service]);
 if(state.status===0)throw new Error('Stop existing private workers before rerunning qualification');
}
run('tar',['-xzf',candidate.assets.find(a=>a.id==='llama-cpu').path,'-C','/opt/localai/ai/runtimes']);
run('chown',['-R','root:root',runtime]);run('chmod',['-R','go-w',runtime]);run('chmod',['-R','a+rX',runtime]);
assert.ok(existsSync(runtime+'/LICENSE'));
const versionProbe=spawnSync(runtime+'/llama-server',['--version'],{encoding:'utf8',timeout:10000});
assert.equal(versionProbe.status,0);const version=(versionProbe.stdout+versionProbe.stderr).trim();assert.match(version,/build 11669, commit 620d2225c/);
const dependencies=run('ldd',[runtime+'/llama-server']);assert.doesNotMatch(dependencies,/not found/);
if(spawnSync('id',['localai-inference'],{stdio:'ignore'}).status!==0)run('useradd',['--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','localai-inference']);
run('chown',['root:localai-inference','/opt/localai/ai','/opt/localai/ai/runtimes']);
run('chmod',['0750','/opt/localai/ai','/opt/localai/ai/runtimes']);
const credential='/etc/credstore.encrypted/localai-ai-key';mkdirSync('/etc/credstore.encrypted',{recursive:true,mode:0o700});
if(!existsSync(credential)){
 const secret=randomBytes(32).toString('base64url');
 run('systemd-creds',['encrypt','--with-key=host','--name=ai-backend-key','-',credential],{input:secret+'\n'});
 chmodSync(credential,0o600);
}
// Validate existing encrypted credentials without displaying their plaintext.
const secret=run('systemd-creds',['decrypt','--name=ai-backend-key',credential,'-']);
assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
run('chown',['root:localai-inference','/var/lib/localai-models']);run('chmod',['0750','/var/lib/localai-models']);
for(const profile of ['chat','embedding']){
 const model=candidate.assets.find(a=>a.id===profile).path,dir=model.slice(0,model.lastIndexOf('/'));
 run('chown',['root:localai-inference',dir,model]);run('chmod',['0750',dir]);run('chmod',['0640',model]);
 const unit=renderWorkerUnit(profile,{runtime,model,credential:'/run/credentials/placeholder/ai-backend-key'});
 const file='/etc/systemd/system/localai-'+profile+'.service';
 if(existsSync(file)&&readFileSync(file,'utf8')!==unit)throw new Error('Existing worker unit differs; update/recovery qualification required');
 writeFileSync(file,unit,{mode:0o644});
}
const slice=readFileSync('installer/localai-ai.slice','utf8'),slicePath='/etc/systemd/system/localai-ai.slice';
if(existsSync(slicePath)&&readFileSync(slicePath,'utf8')!==slice)throw new Error('Existing inference slice differs');
writeFileSync(slicePath,slice,{mode:0o644});
run('systemd-analyze',['verify','/etc/systemd/system/localai-chat.service','/etc/systemd/system/localai-embedding.service','/etc/systemd/system/localai-ai.slice']);
run('systemctl',['daemon-reload']);
const started=[];
try{
 for(const profile of ['chat','embedding']){
  const service='localai-'+profile+'.service';run('systemctl',['start',service]);started.push(service);
  const port=profile==='chat'?8081:8082;let ready=false;
  for(let attempt=0;attempt<120;attempt++){
   try{const response=await fetch('http://127.0.0.1:'+port+'/health',{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(2000)});await response.body?.cancel();if(response.ok){ready=true;break;}}catch{}
   const state=spawnSync('systemctl',['is-active',service],{encoding:'utf8'}).stdout.trim();
   if(!['active','activating'].includes(state))throw new Error('Worker stopped during model loading');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.ok(ready,profile+' failed to load within two minutes');
 }
 const listeners=run('ss',['-ltn']);assert.match(listeners,/127\.0\.0\.1:8081/);assert.match(listeners,/127\.0\.0\.1:8082/);
 assert.doesNotMatch(listeners,/(?:0\.0\.0\.0|\*|\[::\]):808[12]/);
 // Real native requests use synthetic public test phrases only.
 const request=async(port,path,body)=>{
  const response=await fetch('http://127.0.0.1:'+port+path,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  assert.equal(response.status,200,'Native request failed: '+await (response.ok?Promise.resolve(''):response.text()));return response;
 };
 const checks=[];
 for(const prompt of ['Reply with one English word for the color of grass.','اذكر كلمة عربية واحدة عن لون السماء.']){
  const began=performance.now();
  const result=await (await request(8081,'/v1/chat/completions',{messages:[{role:'user',content:prompt}],max_tokens:32,temperature:0,chat_template_kwargs:{enable_thinking:false}})).json();
  const content=result.choices?.[0]?.message?.content;assert.ok(typeof content==='string'&&content.trim().length>0);
  if(checks.length===1)assert.match(content,/[\u0600-\u06ff]/);
  checks.push({check:checks.length===0?'english-chat':'arabic-chat',elapsedMs:Math.round(performance.now()-began),completionTokens:result.usage?.completion_tokens});
 }
 const embeddings=await (await request(8082,'/v1/embeddings',{input:['A document about family.','وثيقة عن العائلة.']})).json();
 assert.equal(embeddings.data?.length,2);
 for(const item of embeddings.data){assert.equal(item.embedding.length,1024);assert.ok(item.embedding.every(Number.isFinite));const norm=Math.sqrt(item.embedding.reduce((sum,n)=>sum+n*n,0));assert.ok(Math.abs(norm-1)<0.01,'Embedding must be normalized');}
 checks.push({check:'english-arabic-embeddings',dimensions:1024});
 const streamed=await request(8081,'/v1/chat/completions',{messages:[{role:'user',content:'Count from one to five.'}],stream:true,max_tokens:32,temperature:0,chat_template_kwargs:{enable_thinking:false}});
 const streamText=await streamed.text();assert.match(streamText,/data: \[DONE\]/);assert.match(streamText,/"content"\s*:/);
 checks.push({check:'native-sse-stream'});
 const client=createInferenceClient({key:secret});
 const adapted=await client.chat({messages:[{role:'user',content:'Reply with the word ready.'}],max_tokens:16});
 assert.ok(adapted.choices[0].message.content);assert.equal(adapted.model,'localai-chat');
 const embedded=await client.embeddings({input:['A family document.','وثيقة عائلية.']});assert.equal(embedded.data.length,2);
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello '.repeat(5000)}],max_tokens:32}),/context/);
 const cancellation=new AbortController();let chunks=0;
 await assert.rejects(client.chat({messages:[{role:'user',content:'Write a long story about a forest.'}],stream:true,max_tokens:1024},{signal:cancellation.signal,onChunk:chunk=>{const event=JSON.parse(Buffer.from(chunk).toString().slice(6));if(event.choices?.[0]?.delta?.content){chunks++;cancellation.abort();}}}));
 assert.ok(chunks>0);assert.equal(client.busy,false);
 const afterCancel=await client.chat({messages:[{role:'user',content:'Reply with the word ready.'}],max_tokens:16});assert.ok(afterCancel.choices[0].message.content);
 checks.push({check:'gateway-adapter-real-tokenizer-context-cancellation-and-reuse'});
 const unauthenticated=await fetch('http://127.0.0.1:8081/v1/models',{signal:AbortSignal.timeout(5000)});assert.equal(unauthenticated.status,401);await unauthenticated.body?.cancel();
 assert.equal(run('systemctl',['show','localai-ai.slice','--property=MemorySwapCurrent','--value']),'0');
 assert.equal(run('systemctl',['show','localai.service','--property=MainPID','--value']),gatewayPid);
 const report={qualification:'workers-loaded-unqualified',manifestSha256:candidate.manifestSha256,version,
  checks,memory:run('systemctl',['show','localai-ai.slice','--property=MemoryCurrent','--property=MemoryPeak','--property=MemorySwapCurrent']),
  note:'Synthetic native inference only; gateway admission/cancellation/restart qualification still required. Workers stopped after check.'};
 mkdirSync('.localai',{recursive:true,mode:0o700});writeFileSync('.localai/private-workers.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}finally{for(const service of started.reverse())run('systemctl',['stop',service]);}
