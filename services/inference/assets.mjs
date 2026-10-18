import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,lstat,mkdir,link,unlink} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';

const common=['id','kind','filename','url','bytes','sha256','license','licenseUrl','source'];
function keys(value,allowed){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('Unknown manifest fields');}
function secureUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('HTTPS source required');return url;}
function validateAsset(asset){
 keys(asset,[...common,...(asset.kind==='runtime'?['version']:['task','modelId','repository','revision','quantization','contextTokens'])]);
 if(!['runtime','model'].includes(asset.kind)||!/^[a-z0-9-]{1,40}$/.test(asset.id)||!/^[A-Za-z0-9_.-]+$/.test(asset.filename)||asset.filename.startsWith('.'))throw new Error('Unsafe asset identity');
 if(!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>4*1024**3||!/^[a-f0-9]{64}$/.test(asset.sha256))throw new Error('Exact bounded asset size and SHA256 required');
 if(!['MIT','Apache-2.0'].includes(asset.license))throw new Error('Unverified license');
 const url=secureUrl(asset.url),licenseUrl=secureUrl(asset.licenseUrl),source=secureUrl(asset.source);
 if(asset.kind==='runtime'){
  if(!/^b\d+$/.test(asset.version)||asset.filename!==`llama-${asset.version}-bin-ubuntu-x64.tar.gz`||url.hostname!=='github.com'||url.pathname!==`/ggml-org/llama.cpp/releases/download/${asset.version}/${asset.filename}`)throw new Error('Pinned official CPU runtime required');
  if(asset.license!=='MIT'||licenseUrl.hostname!=='github.com'||!/^\/ggml-org\/llama.cpp\/blob\/[a-f0-9]{40}\/LICENSE$/.test(licenseUrl.pathname)||source.hostname!=='api.github.com'||source.pathname!==`/repos/ggml-org/llama.cpp/releases/tags/${asset.version}`)throw new Error('Official runtime license evidence required');
 }else{
  if(!['chat','embeddings'].includes(asset.task)||!/^localai-[a-z0-9-]+$/.test(asset.modelId)||!/^Qwen\/[A-Za-z0-9_.-]+$/.test(asset.repository)||!/^[a-f0-9]{40}$/.test(asset.revision)||!['Q4_K_M','Q8_0'].includes(asset.quantization))throw new Error('Pinned official model required');
  if(!Number.isInteger(asset.contextTokens)||asset.contextTokens<256||asset.contextTokens>8192||asset.contextTokens%256)throw new Error('Bounded starter context required');
  if(url.hostname!=='huggingface.co'||url.pathname!==`/${asset.repository}/resolve/${asset.revision}/${asset.filename}`||!asset.filename.endsWith('.gguf'))throw new Error('Model URL must match pinned revision');
  if(asset.license!=='Apache-2.0'||licenseUrl.hostname!=='huggingface.co'||!licenseUrl.pathname.startsWith(`/${asset.repository}/blob/${asset.revision}/`)||source.hostname!=='huggingface.co'||source.pathname!==`/api/models/${asset.repository}`)throw new Error('Official model license evidence required');
 }
 if(url.search||url.hash||url.href!==asset.url)throw new Error('Canonical artifact URL required');
 return asset;
}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function validateFallbackModel(value){
 validateAsset(value);
 if(value.id!=='chat-fallback'||value.kind!=='model'||value.task!=='chat'||value.modelId!=='localai-chat-fallback'||value.contextTokens>2048)throw new Error('Bounded chat fallback required');
 return freeze(structuredClone(value));
}
export function validateStarterManifest(value){
 keys(value,['schemaVersion','checkedAt','platform','qualification','assets']);
 if(value.schemaVersion!==1||value.platform!=='linux-x64'||value.qualification!=='pending-real-target-tests'||!/^\d{4}-\d{2}-\d{2}$/.test(value.checkedAt)||!Array.isArray(value.assets)||value.assets.length!==3)throw new Error('Unsupported starter manifest');
 const ids=new Set();for(const asset of value.assets){validateAsset(asset);if(ids.has(asset.id))throw new Error('Duplicate asset');ids.add(asset.id);}
 if(value.assets.find(a=>a.id==='llama-cpu')?.kind!=='runtime'||value.assets.find(a=>a.id==='chat')?.task!=='chat'||value.assets.find(a=>a.id==='embedding')?.task!=='embeddings')throw new Error('Complete starter assets required');
 return freeze(structuredClone(value));
}
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
function downloadUrl(value){const url=secureUrl(value),host=url.hostname; if(!['github.com','huggingface.co'].includes(host)&&!host.endsWith('.githubusercontent.com')&&!host.endsWith('.hf.co')&&!host.endsWith('.huggingface.co'))throw new Error('Untrusted artifact redirect');return url.href;}

export async function downloadAsset(asset,destination,{fetchImpl=fetch,signal,onProgress}={}){
 validateAsset(asset);
 try{
  const stat=await lstat(destination);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==asset.bytes||await hashFile(destination)!==asset.sha256)throw new Error('Existing asset is not verified; preserved for inspection');
  return {path:destination,reused:true,bytes:stat.size,sha256:asset.sha256};
 }catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(dirname(destination),{recursive:true,mode:0o750});
 const temporary=join(dirname(destination),'.'+basename(destination)+'.partial-'+randomUUID());
 const file=await open(temporary,'wx',0o600);let reader,abort;
 const deadline=AbortSignal.timeout(10*60000),active=signal?AbortSignal.any([signal,deadline]):deadline;
 try{
  let url=downloadUrl(asset.url),response;
  for(let redirects=0;redirects<=5;redirects++){
   active.throwIfAborted();response=await fetchImpl(url,{redirect:'manual',signal:active,headers:{'Accept-Encoding':'identity'}});
   if(![301,302,303,307,308].includes(response.status))break;
   const location=response.headers.get('location');await response.body?.cancel();
   if(!location||redirects===5)throw new Error('Artifact redirect limit');url=downloadUrl(new URL(location,url).href);
  }
  if(response.status!==200||!response.body){await response.body?.cancel();throw new Error('Artifact download failed');}
  const declared=response.headers.get('content-length');if(declared!==null&&Number(declared)!==asset.bytes){await response.body.cancel();throw new Error('Artifact length mismatch');}
  reader=response.body.getReader();abort=()=>{void reader.cancel(active.reason).catch(()=>{});};active.addEventListener('abort',abort,{once:true});active.throwIfAborted();
  const hash=createHash('sha256');let bytes=0;
  while(true){const {done,value}=await reader.read();active.throwIfAborted();if(done)break;bytes+=value.byteLength;if(bytes>asset.bytes)throw new Error('Artifact exceeds declared size');hash.update(value);await file.writeFile(value);onProgress?.({id:asset.id,bytes,total:asset.bytes});}
  if(bytes!==asset.bytes||hash.digest('hex')!==asset.sha256)throw new Error('Artifact integrity mismatch');
  await file.sync();await file.close();active.throwIfAborted();
  await link(temporary,destination);return {path:destination,reused:false,bytes,sha256:asset.sha256};
 }finally{
  if(abort)active.removeEventListener('abort',abort);
  if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}
  try{await file.close();}catch{}try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
