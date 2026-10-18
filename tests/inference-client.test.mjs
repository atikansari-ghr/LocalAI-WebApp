import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInferenceClient as createClient} from '../services/inference/client.mjs';
const createInferenceClient=options=>createClient({resources:()=>({availableBytes:2*1024**3}),...options});

async function fixture(t,handler){
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;await handler(req,res,raw?JSON.parse(raw):{});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 return 'http://127.0.0.1:'+server.address().port;
}
test('client checks real tokenizer counts and forwards only bounded chat parameters',async t=>{
 const seen=[];const endpoint=await fixture(t,(req,res,body)=>{
  seen.push({path:req.url,body,key:req.headers.authorization});res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/apply-template'?{prompt:'formatted'}:req.url==='/tokenize'?{tokens:[1,2,3]}:{choices:[{message:{content:'ok'}}]}));
 });
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,embeddingEndpoint:endpoint});
 const result=await client.chat({model:'localai-chat',messages:[{role:'user',content:'hello'}],max_tokens:32});
 assert.equal(result.choices[0].message.content,'ok');assert.deepEqual(seen.map(x=>x.path),['/apply-template','/tokenize','/v1/chat/completions']);
 assert.ok(seen.every(x=>x.key==='Bearer '+'a'.repeat(43)));
 assert.equal(seen[2].body.cache_prompt,false);assert.deepEqual(seen[2].body.chat_template_kwargs,{enable_thinking:false});
 await assert.rejects(client.chat({messages:[{role:'user',content:'hi'}],n_predict:99999}),/parameter/);
});
test('context exhaustion blocks inference rather than silently truncating input',async t=>{
 const paths=[];const endpoint=await fixture(t,(req,res)=>{paths.push(req.url);res.end(JSON.stringify(req.url==='/apply-template'?{prompt:'long'}:{tokens:Array(4090).fill(1)}));});
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,embeddingEndpoint:endpoint});
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}],max_tokens:32}),/context/);assert.ok(!paths.includes('/v1/chat/completions'));
});
test('one aggregate slot rejects overload and releases capacity after cancellation',async t=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);
 const endpoint=await fixture(t,(req,res)=>{if(req.url==='/apply-template'){entered();return;}res.end('{}');});
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,embeddingEndpoint:endpoint,timeoutMs:5000});
 const controller=new AbortController(),first=client.chat({messages:[{role:'user',content:'hello'}]},{signal:controller.signal});
 await ready;await assert.rejects(client.embeddings({input:'hello'}),/busy/);controller.abort();await assert.rejects(first);
 assert.equal(client.busy,false);
});
test('worker endpoints and API keys cannot redirect requests off loopback',()=>{
 for(const endpoint of ['http://example.com','https://127.0.0.1:8081','http://127.0.0.1:8081/path','http://user@127.0.0.1:8081','http://0.0.0.0:8081'])assert.throws(()=>createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint}));
 assert.throws(()=>createInferenceClient({key:'bad'}));
});
test('stream disconnect cancels the worker body and frees admission for another request',async t=>{
 let disconnected;const closed=new Promise(resolve=>disconnected=resolve);
 const endpoint=await fixture(t,(req,res)=>{
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:'formatted'}));
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:[1]}));
  res.setHeader('Content-Type','text/event-stream');res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');res.on('close',disconnected);
 });
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,embeddingEndpoint:endpoint}),controller=new AbortController();
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}],stream:true},{signal:controller.signal,onChunk:()=>controller.abort()}));
 await closed;assert.equal(client.busy,false);
});
test('a stalled response body is bounded by the total inference deadline',async t=>{
 const endpoint=await fixture(t,(req,res)=>{res.setHeader('Content-Type','application/json');res.write('{');});
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,timeoutMs:100});
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}]}),error=>error.code==='inference_timeout'&&error.status===504);assert.equal(client.busy,false);
});
test('streaming uses the public model ID and rejects incomplete SSE responses',async t=>{
 let incomplete=false;
 const endpoint=await fixture(t,(req,res)=>{
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:'formatted'}));
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:[1]}));
  res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({model:'/private/model.gguf',choices:[{delta:{content:'hello'}}]})+'\n\n'+(incomplete?'':'data: [DONE]\n\n'));
 });
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint});let output='';
 const input={messages:[{role:'user',content:'hello'}],stream:true};
 await client.chat(input,{onChunk:chunk=>{output+=Buffer.from(chunk).toString();}});
 assert.ok(!output.includes('/private/'));assert.ok(output.includes('localai-chat'));assert.ok(output.endsWith('data: [DONE]\n\n'));
 incomplete=true;await assert.rejects(client.chat(input,{onChunk:()=>{}}),/incomplete/);assert.equal(client.busy,false);
});
test('a downstream consumer stalled by backpressure cannot hold admission beyond the deadline',async t=>{
 const endpoint=await fixture(t,(req,res)=>{
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:'formatted'}));
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:[1]}));
  res.setHeader('Content-Type','text/event-stream');res.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
 });
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,timeoutMs:100});
 const operation=client.chat({messages:[{role:'user',content:'hello'}],stream:true},{onChunk:()=>new Promise(()=>{})});
 const result=await Promise.race([operation.then(()=>false,()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),500))]);
 assert.equal(result,true);assert.equal(client.busy,false);
});
test('selected resource profiles enforce smaller budgets and emergency pressure blocks worker requests',async t=>{
 let requests=0,availableBytes=2*1024**3;
 const endpoint=await fixture(t,(req,res)=>{requests++;res.end(JSON.stringify(req.url==='/apply-template'?{prompt:'formatted'}:req.url==='/tokenize'?{tokens:Array(1800).fill(1)}:{choices:[{message:{content:'ok'}}]}));});
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,mode:'eco',resources:()=>({availableBytes})});
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}],max_tokens:300}),/generation/);assert.equal(requests,0);
 await client.chat({messages:[{role:'user',content:'hello'}],max_tokens:128});
 availableBytes=700*1024**2;await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}],max_tokens:128}),/context/);
 const previous=requests;availableBytes=300*1024**2;
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}]}),error=>error.code==='resource_pressure'&&error.status===503);assert.equal(requests,previous);assert.equal(client.busy,false);
});
test('qualified local fallback uses a circuit cooldown and reports the actual model without changing user context',async t=>{
 let now=1000,primaryAttempts=0,tokenModel;const events=[];
 const endpoint=await fixture(t,(req,res,body)=>{
  if(body.model==='localai-chat'&&req.url==='/apply-template'){primaryAttempts++;res.statusCode=503;return res.end('{}');}
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:'formatted'}));
  if(req.url==='/tokenize'){tokenModel=body.model;return res.end(JSON.stringify({tokens:[1]}));}
  res.end(JSON.stringify({choices:[{message:{content:'fallback answer'}}]}));
 });
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,fallbackEnabled:true,onFallback:event=>events.push(event),now:()=>now});
 for(let i=0;i<4;i++){const result=await client.chat({messages:[{role:'user',content:'hello'}]});assert.equal(result.model,'localai-chat-fallback');}
 assert.equal(primaryAttempts,3);assert.equal(tokenModel,'localai-chat-fallback');assert.equal(events.length,4);assert.ok(events.every(event=>event.to==='localai-chat-fallback'));
 now+=60001;await client.chat({messages:[{role:'user',content:'hello'}]});assert.equal(primaryAttempts,4);
 assert.throws(()=>createInferenceClient({key:'a'.repeat(43),fallbackEnabled:true}));
});
test('fallback never retries a partially delivered stream',async t=>{
 const models=[];const endpoint=await fixture(t,(req,res,body)=>{
  models.push(body.model);
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:'formatted'}));
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:[1]}));
  res.setHeader('Content-Type','text/event-stream');res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
 });
 const events=[],client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,fallbackEnabled:true,onFallback:event=>events.push(event)});
 await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}],stream:true},{onChunk:()=>{}}),/incomplete/);
 assert.deepEqual(events,[]);assert.ok(models.every(model=>model==='localai-chat'));assert.equal(client.busy,false);
});
test('internal primary deadlines open the circuit for the next request without retrying the timed-out request',async t=>{
 let primary=0,fallback=0;
 const endpoint=await fixture(t,(req,res,body)=>{
  if(body.model==='localai-chat'){primary++;return;}
  if(req.url==='/apply-template')return res.end(JSON.stringify({prompt:'formatted'}));
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:[1]}));
  fallback++;res.end(JSON.stringify({choices:[{message:{content:'ready'}}]}));
 });
 const events=[],client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,timeoutMs:100,fallbackEnabled:true,onFallback:event=>events.push(event)});
 for(let i=0;i<3;i++)await assert.rejects(client.chat({messages:[{role:'user',content:'hello'}]}),/inference_timeout/);
 assert.equal(primary,3);assert.equal(fallback,0);
 const result=await client.chat({messages:[{role:'user',content:'hello'}]});assert.equal(result.model,'localai-chat-fallback');assert.equal(primary,3);assert.equal(fallback,1);assert.equal(events.length,1);
});
test('private Unix transport carries authenticated requests without opening a TCP worker port',{skip:process.platform==='win32'?'Native Linux Unix-socket transport':false},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'lai-')),path=join(dir,'worker.sock');
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(43));res.end(JSON.stringify(req.url==='/apply-template'?{prompt:'formatted'}:req.url==='/tokenize'?{tokens:[1]}:{choices:[{message:{content:'ready'}}]}));});
 await new Promise(resolve=>server.listen(path,resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:'unix:'+path});
 const result=await client.chat({messages:[{role:'user',content:'hello'}]});assert.equal(result.choices[0].message.content,'ready');
 for(const endpoint of ['unix:relative.sock','unix:/tmp/../private.sock','unix:/tmp/worker.sock?x','unix:/tmp/worker'])assert.throws(()=>createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint}));
});
test('failed partial streams influence subsequent circuit decisions while their current requests never retry',async t=>{
 let primary=0;
 const endpoint=await fixture(t,(req,res,body)=>{
  if(req.url==='/apply-template'){if(body.model==='localai-chat')primary++;return res.end(JSON.stringify({prompt:'formatted'}));}
  if(req.url==='/tokenize')return res.end(JSON.stringify({tokens:[1]}));
  res.setHeader('Content-Type','text/event-stream');res.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'+(body.model==='localai-chat'?'':'data: [DONE]\n\n'));
 });
 const events=[],client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,fallbackEnabled:true,onFallback:event=>events.push(event)}),input={messages:[{role:'user',content:'hello'}],stream:true};
 for(let i=0;i<3;i++)await assert.rejects(client.chat(input,{onChunk:()=>{}}),/incomplete/);
 assert.equal(primary,3);assert.equal(events.length,0);
 let output='';await client.chat(input,{onChunk:chunk=>{output+=Buffer.from(chunk).toString();}});assert.equal(primary,3);assert.equal(events.length,1);assert.ok(output.includes('localai-chat-fallback'));
});
test('health checks verify both private workers without taking the generation slot',async t=>{
 let healthy=true;const endpoint=await fixture(t,(req,res)=>{res.statusCode=healthy?200:503;res.end(JSON.stringify({status:'ok'}));});
 const client=createInferenceClient({key:'a'.repeat(43),chatEndpoint:endpoint,embeddingEndpoint:endpoint});assert.equal(await client.health(),true);assert.equal(client.busy,false);
 healthy=false;assert.equal(await client.health(),false);assert.equal(client.busy,false);
});
