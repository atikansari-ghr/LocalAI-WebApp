import {connect} from 'node:net';

const REQUEST_LIMIT=14*1024**2,RESPONSE_LIMIT=4*1024**2;
const fail=code=>new Error(code);
function frame(value,limit){const body=Buffer.from(JSON.stringify(value));if(body.length>limit)throw fail('document_worker_output_limit');const header=Buffer.alloc(4);header.writeUInt32BE(body.length);return Buffer.concat([header,body]);}
function readFrame(socket,limit){return new Promise((resolve,reject)=>{
 let header=Buffer.alloc(4),headerBytes=0,chunks=[],bodyBytes=0,expected=null,done=false;
 const cleanup=()=>{socket.off('data',onData);socket.off('end',onEnd);socket.off('close',onEnd);socket.off('error',onError);};
 const finish=(error,value)=>{if(done)return;done=true;cleanup();if(error)reject(error);else resolve(value);};
 const onEnd=()=>finish(fail('document_worker_incomplete'));
 const onError=()=>finish(fail('document_worker_unavailable'));
 const onData=chunk=>{let offset=0;if(headerBytes<4){const count=Math.min(4-headerBytes,chunk.length);chunk.copy(header,headerBytes,0,count);headerBytes+=count;offset=count;if(headerBytes===4){expected=header.readUInt32BE(0);if(expected<1||expected>limit)return finish(fail('document_worker_input_limit'));}}
  if(offset<chunk.length){const piece=chunk.subarray(offset);bodyBytes+=piece.length;if(bodyBytes>expected)return finish(fail('document_worker_invalid_frame'));chunks.push(piece);}
  if(expected!==null&&bodyBytes===expected){try{finish(null,JSON.parse(Buffer.concat(chunks,bodyBytes).toString('utf8')));}catch{finish(fail('document_worker_invalid_frame'));}}
 };
 socket.on('data',onData);socket.once('end',onEnd);socket.once('close',onEnd);socket.once('error',onError);
});}
function validRequest(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','name','mime','content_base64','options'].includes(k))||!['ocr','extract'].includes(value.kind)||typeof value.name!=='string'||value.name.length<1||value.name.length>255||/[\\/\x00-\x1f\x7f]/.test(value.name)||typeof value.mime!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value.mime)||typeof value.content_base64!=='string'||value.content_base64.length<4||value.content_base64.length>13981016||value.content_base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.content_base64)||!value.options||typeof value.options!=='object'||Array.isArray(value.options)||Object.keys(value.options).some(k=>!['ocr','language'].includes(k))||!['auto','off','all'].includes(value.options.ocr??'auto')||!['auto','en','ar'].includes(value.options.language??'auto'))return false;const bytes=Buffer.from(value.content_base64,'base64');return bytes.length>=1&&bytes.length<=10*1024**2&&bytes.toString('base64')===value.content_base64;}
export async function invokeDocumentWorker({socketPath,request,signal,timeoutMs=120000}){
 if(typeof socketPath!=='string'||!socketPath||!validRequest(request)||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('invalid_document_worker_request');
 const timeout=AbortSignal.timeout(timeoutMs),socket=connect(socketPath);socket.on('error',()=>{});
 const abort=()=>socket.destroy();signal?.addEventListener('abort',abort,{once:true});timeout.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)throw fail('document_cancelled');
  await new Promise((resolve,reject)=>{
   let settled=false;
   const cleanup=()=>{socket.off('connect',onConnect);socket.off('error',onError);socket.off('close',onClose);signal?.removeEventListener('abort',onCancel);timeout.removeEventListener('abort',onTimeout);};
   const settle=(error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
   const onConnect=()=>settle();const onError=error=>settle(error);const onClose=()=>settle(fail('document_worker_unavailable'));
   const onCancel=()=>settle(fail('document_cancelled'));const onTimeout=()=>settle(fail('document_worker_timeout'));
   socket.once('connect',onConnect);socket.once('error',onError);socket.once('close',onClose);signal?.addEventListener('abort',onCancel,{once:true});timeout.addEventListener('abort',onTimeout,{once:true});
   if(signal?.aborted)onCancel();else if(timeout.aborted)onTimeout();
  });
  socket.write(frame(request,REQUEST_LIMIT));const reply=await readFrame(socket,RESPONSE_LIMIT);
  if(!reply||typeof reply!=='object'||Array.isArray(reply)||Object.keys(reply).some(k=>!['result','error'].includes(k))||(!Object.hasOwn(reply,'result')===!Object.hasOwn(reply,'error')))throw fail('document_worker_invalid_frame');
  if(reply.error)throw fail(typeof reply.error==='string'&&/^document_worker_[a-z_]+$/.test(reply.error)?reply.error:'document_worker_error');
  return reply.result;
 }catch(error){if(signal?.aborted)throw fail('document_cancelled');if(timeout.aborted)throw fail('document_worker_timeout');throw error;}
 finally{signal?.removeEventListener('abort',abort);timeout.removeEventListener('abort',abort);socket.destroy();}
}
export async function serveDocumentConnection(socket,processor){
 if(typeof processor!=='function')throw new TypeError('Document processor required');
 const controller=new AbortController();const onDisconnect=()=>controller.abort();socket.on('error',onDisconnect);socket.once('end',onDisconnect);socket.once('close',onDisconnect);
 try{
  const request=await readFrame(socket,REQUEST_LIMIT);if(!validRequest(request))throw fail('document_worker_invalid_frame');
  const result=await processor(request,controller.signal);if(controller.signal.aborted||socket.destroyed||!socket.writable)return;
  socket.write(frame({result},RESPONSE_LIMIT));
 }catch(error){if(!controller.signal.aborted&&!socket.destroyed&&socket.writable){const code=error?.message==='document_worker_output_limit'?'document_worker_output_limit':'document_worker_invalid_frame';try{socket.write(frame({error:code},RESPONSE_LIMIT));}catch{}}}
 finally{if(!socket.destroyed&&socket.writable)socket.end();else socket.destroy();}
}
