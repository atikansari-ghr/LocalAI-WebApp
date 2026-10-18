export class InferenceError extends Error{
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const fail=(code,status)=>{throw new InferenceError(code,status);};
function endpoint(value){const url=new URL(value);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new TypeError('Private loopback worker endpoint required');return url.origin;}
function fields(value,allowed){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!allowed.includes(key)))fail('unsupported_parameter');}
function text(value,max=32768){if(typeof value!=='string'||!value.trim()||value.length>max)fail('invalid_input');return value;}
async function boundedJson(response,limit=2*1024**2){
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)fail('worker_response_too_large',502);chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function publicChat(result){
 if(!result||!Array.isArray(result.choices))fail('invalid_worker_response',502);
 return {id:result.id,object:result.object,created:result.created,model:'localai-chat',choices:result.choices,...(result.usage?{usage:result.usage}:{})};
}
async function relayStream(response,onChunk,signal){
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
    else{let event;try{event=JSON.parse(data);}catch{fail('invalid_worker_stream',502);}await deliver(Buffer.from('data: '+JSON.stringify(publicChat(event))+'\n\n'));}
   }
   if(pending.length>65536)fail('worker_response_too_large',502);
  }
  pending+=decoder.decode();if(!complete||pending.trim())fail('incomplete_worker_stream',502);
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createInferenceClient({key,chatEndpoint='http://127.0.0.1:8081',embeddingEndpoint='http://127.0.0.1:8082',timeoutMs=120000}={}){
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw new TypeError('Internal worker credential required');
 const chatBase=endpoint(chatEndpoint),embeddingBase=endpoint(embeddingEndpoint);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('Invalid inference deadline');
 let busy=false;
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
  const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal,redirect:'error'});
  if(!response.ok){await response.body?.cancel();fail('worker_unavailable',502);}return response;
 }
 async function tokenCount(base,content,signal){
  const result=await boundedJson(await post(base,'/tokenize',{content,add_special:true},signal));
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
   const max=input.max_tokens??256,temperature=input.temperature??0.7,topP=input.top_p??0.9;
   if(!Number.isInteger(max)||max<1||max>1024||!Number.isFinite(temperature)||temperature<0||temperature>2||!Number.isFinite(topP)||topP<=0||topP>1)fail('invalid_generation_limits');
   if(input.stream!==undefined&&typeof input.stream!=='boolean')fail('invalid_stream');
   if(input.stream&&typeof onChunk!=='function')fail('stream_consumer_required');
   return admitted(async signal=>{
    const formatted=await boundedJson(await post(chatBase,'/apply-template',{messages,add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}},signal));
    if(typeof formatted.prompt!=='string')fail('invalid_template_response',502);
    const count=await tokenCount(chatBase,formatted.prompt,signal);
    if(count+max>4096)fail('context_exceeded');
    const response=await post(chatBase,'/v1/chat/completions',{messages,max_tokens:max,temperature,top_p:topP,stream:input.stream??false,cache_prompt:false,chat_template_kwargs:{enable_thinking:false}},signal);
    if(!input.stream)return publicChat(await boundedJson(response));
    if(!response.headers.get('content-type')?.startsWith('text/event-stream')){await response.body.cancel();fail('invalid_worker_stream',502);}
    await relayStream(response,onChunk,signal);
    return null;
   },signal);
  },
  async embeddings(input,{signal}={}){
   fields(input,['model','input','encoding_format']);
   if(input.model!==undefined&&input.model!=='localai-embedding')fail('unsupported_model');
   if(input.encoding_format!==undefined&&input.encoding_format!=='float')fail('unsupported_parameter');
   const inputs=Array.isArray(input.input)?input.input:[input.input];if(inputs.length<1||inputs.length>16)fail('invalid_input');inputs.forEach(value=>text(value,8192));
   return admitted(async signal=>{
    // Keep each input within the native physical batch until longer inputs qualify.
    for(const value of inputs)if(await tokenCount(embeddingBase,value,signal)>256)fail('embedding_context_exceeded');
    const result=await boundedJson(await post(embeddingBase,'/v1/embeddings',{input:inputs,encoding_format:'float'},signal));
    if(!Array.isArray(result.data)||result.data.length!==inputs.length||result.data.some(item=>!Array.isArray(item.embedding)||item.embedding.length!==1024||item.embedding.some(n=>!Number.isFinite(n))))fail('invalid_embedding_response',502);
    return {...result,model:'localai-embedding'};
   },signal);
  }
 };
}
