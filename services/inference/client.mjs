export class InferenceError extends Error{
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new InferenceError(code,status);};
function endpoint(value){
 if(typeof value==='string'&&value.startsWith('unix:')){const path=value.slice(5);if(!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.sock$/.test(path)||path.split('/').some(part=>part==='.'||part==='..'))throw new TypeError('Unsafe Unix worker socket');return value;}
 const url=new URL(value);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new TypeError('Private loopback worker endpoint required');return url.origin;
}
export function requestPrivateWorker(base,path,{method='GET',headers={},body,signal}={}){
 const target=endpoint(base);
 if(!/^\/[a-zA-Z0-9/_-]+(?:\?[a-zA-Z0-9%=_-]+)?$/.test(path))throw new TypeError('Unsafe worker route');
 if(!target.startsWith('unix:'))return fetch(target+path,{method,headers,body,signal,redirect:'error'});
 return new Promise((resolve,reject)=>{
  // A worker can close/recreate its socket after streaming, sleeping or restart.
  // Fresh local IPC connections avoid reusing a half-closed HTTP pool socket.
  const request=httpRequest({socketPath:target.slice(5),path,method,headers,signal,agent:false},incoming=>{
   resolve(new Response(Readable.toWeb(incoming),{status:incoming.statusCode,headers:{'content-type':incoming.headers['content-type']??'application/octet-stream'}}));
  });
  request.once('error',reject);request.end(body);
 });
}
function fields(value,allowed){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!allowed.includes(key)))fail('unsupported_parameter');}
function text(value,max=32768){if(typeof value!=='string'||!value.trim()||value.length>max)fail('invalid_input');return value;}
async function boundedJson(response,limit=2*1024**2){
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)fail('worker_response_too_large',502);chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function publicChat(result,model='localai-chat'){
 if(!result||!Array.isArray(result.choices))fail('invalid_worker_response',502);
 return {id:result.id,object:result.object,created:result.created,model,choices:result.choices,...(result.usage?{usage:result.usage}:{})};
}
async function relayStream(response,onChunk,signal,model){
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,pending='',complete=false;
 const deliver=async chunk=>{
  signal.throwIfAborted();let abort;
  const cancelled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
  try{await Promise.race([Promise.resolve().then(()=>onChunk(chunk)),cancelled]);}
  finally{signal.removeEventListener('abort',abort);}
 };
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>8*1024**2)fail('worker_response_too_large',502);
   pending+=decoder.decode(value,{stream:true});
   let boundary;
   while((boundary=pending.indexOf('\n'))!==-1){
    const line=pending.slice(0,boundary).replace(/\r$/,'');pending=pending.slice(boundary+1);
    if(line.length>65536)fail('worker_response_too_large',502);
    if(!line||line.startsWith(':'))continue;
    if(!line.startsWith('data: ')||complete)fail('invalid_worker_stream',502);
    const data=line.slice(6);
    if(data==='[DONE]'){complete=true;await deliver(Buffer.from('data: [DONE]\n\n'));}
    else{let event;try{event=JSON.parse(data);}catch{fail('invalid_worker_stream',502);}await deliver(Buffer.from('data: '+JSON.stringify(publicChat(event,model))+'\n\n'));}
   }
   if(pending.length>65536)fail('worker_response_too_large',502);
  }
  pending+=decoder.decode();if(!complete||pending.trim())fail('incomplete_worker_stream',502);
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createInferenceClient({key,chatEndpoint='unix:/run/localai-chat/inference.sock',embeddingEndpoint='unix:/run/localai-embedding/inference.sock',timeoutMs=120000,mode='balanced',resources=readMemoryBudget,fallbackEnabled=false,onFallback,now=Date.now}={}){
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw new TypeError('Internal worker credential required');
 const chatBase=endpoint(chatEndpoint),embeddingBase=endpoint(embeddingEndpoint);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('Invalid inference deadline');
 selectResourceProfile(mode,{availableBytes:2*1024**3});
 if(typeof resources!=='function')throw new TypeError('Resource measurements required');
 if(typeof fallbackEnabled!=='boolean'||typeof now!=='function'||(fallbackEnabled&&typeof onFallback!=='function'))throw new TypeError('Enabled fallback requires qualification and an audit callback');
 const policy=()=>{try{return selectResourceProfile(mode,resources());}catch(error){fail(error.message==='resource_pressure'?'resource_pressure':'resource_measurement_unavailable',503);}};
 let busy=false;
 let primaryFailures=0,primaryRetryAt=0;
 async function admitted(work,signal){
  if(busy)fail('inference_busy',429);busy=true;
  const controller=new AbortController(),combined=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  try{return await work(combined);}
  catch(error){
   if(error instanceof InferenceError)throw error;
   if(signal?.aborted)throw signal.reason;
   if(combined.aborted)fail('inference_timeout',504);
   fail('worker_unavailable',502);
  }finally{controller.abort();busy=false;}
 }
 async function post(base,path,body,signal){
  const response=await requestPrivateWorker(base,path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok){await response.body?.cancel();fail('worker_unavailable',502);}return response;
 }
 async function tokenCount(base,content,signal,model='localai-embedding'){
  const result=await boundedJson(await post(base,'/tokenize',{model,content,add_special:true},signal));
  if(!Array.isArray(result.tokens)||result.tokens.some(token=>!Number.isInteger(token)))fail('invalid_tokenizer_response',502);
  return result.tokens.length;
 }
 return {
  get busy(){return busy;},
  async chat(input,{signal,onChunk}={}){
   fields(input,['model','messages','max_tokens','temperature','top_p','stream']);
   if(input.model!==undefined&&input.model!=='localai-chat')fail('unsupported_model');
   if(!Array.isArray(input.messages)||input.messages.length<1||input.messages.length>64)fail('invalid_messages');
   let length=0;const messages=input.messages.map(message=>{fields(message,['role','content']);if(!['system','user','assistant'].includes(message.role))fail('invalid_role');const content=text(message.content);length+=content.length;return {role:message.role,content};});
   if(length>32768)fail('invalid_input');
   const initialPolicy=policy(),max=input.max_tokens??Math.min(256,initialPolicy.maxOutputTokens),temperature=input.temperature??0.7,topP=input.top_p??0.9;
   if(!Number.isInteger(max)||max<1||max>initialPolicy.maxOutputTokens||!Number.isFinite(temperature)||temperature<0||temperature>2||!Number.isFinite(topP)||topP<=0||topP>1)fail('invalid_generation_limits');
   if(input.stream!==undefined&&typeof input.stream!=='boolean')fail('invalid_stream');
   if(input.stream&&typeof onChunk!=='function')fail('stream_consumer_required');
   const callerSignal=signal;
   return admitted(async signal=>{
    let delivered=false;
    const runModel=async model=>{
    const formatted=await boundedJson(await post(chatBase,'/apply-template',{model,messages,add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}},signal));
    if(typeof formatted.prompt!=='string')fail('invalid_template_response',502);
    const count=await tokenCount(chatBase,formatted.prompt,signal,model);
    const currentPolicy=policy();
    if(max>currentPolicy.maxOutputTokens)fail('resource_pressure',503);
    if(count+max>Math.min(model==='localai-chat-fallback'?2048:4096,initialPolicy.contextTokens,currentPolicy.contextTokens))fail('context_exceeded');
    const response=await post(chatBase,'/v1/chat/completions',{model,messages,max_tokens:max,temperature,top_p:topP,stream:input.stream??false,cache_prompt:false,chat_template_kwargs:{enable_thinking:false}},signal);
    if(!input.stream)return publicChat(await boundedJson(response),model);
    if(!response.headers.get('content-type')?.startsWith('text/event-stream')){await response.body.cancel();fail('invalid_worker_stream',502);}
    await relayStream(response,chunk=>{delivered=true;return onChunk(chunk);},signal,model);
    return null;
    };
    const fallback=async reason=>{onFallback({from:'localai-chat',to:'localai-chat-fallback',reason});return runModel('localai-chat-fallback');};
    if(fallbackEnabled&&(initialPolicy.emergency||primaryRetryAt>now()))return fallback(initialPolicy.emergency?'resource_pressure':'circuit_open');
    try{const result=await runModel('localai-chat');primaryFailures=0;primaryRetryAt=0;return result;}
    catch(error){
     if(callerSignal?.aborted||(error instanceof InferenceError&&error.status<500))throw error;
     primaryFailures++;if(primaryFailures>=3)primaryRetryAt=now()+60000;
     if(signal.aborted||delivered||!fallbackEnabled)throw error;
     return fallback('primary_unavailable');
    }
   },signal);
  },
  async embeddings(input,{signal}={}){
   fields(input,['model','input','encoding_format']);
   if(input.model!==undefined&&input.model!=='localai-embedding')fail('unsupported_model');
   if(input.encoding_format!==undefined&&input.encoding_format!=='float')fail('unsupported_parameter');
   const inputs=Array.isArray(input.input)?input.input:[input.input];if(inputs.length<1||inputs.length>16)fail('invalid_input');inputs.forEach(value=>text(value,8192));
   return admitted(async signal=>{
    policy();
    // Keep each input within the native physical batch until longer inputs qualify.
    for(const value of inputs)if(await tokenCount(embeddingBase,value,signal)>256)fail('embedding_context_exceeded');
    const result=await boundedJson(await post(embeddingBase,'/v1/embeddings',{input:inputs,encoding_format:'float'},signal));
    if(!Array.isArray(result.data)||result.data.length!==inputs.length||result.data.some(item=>!Array.isArray(item.embedding)||item.embedding.length!==1024||item.embedding.some(n=>!Number.isFinite(n))))fail('invalid_embedding_response',502);
    return {...result,model:'localai-embedding'};
   },signal);
  }
 };
}
import {selectResourceProfile,readMemoryBudget} from './profiles.mjs';
import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
