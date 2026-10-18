import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createInferenceClient} from '../services/inference/client.mjs';

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
