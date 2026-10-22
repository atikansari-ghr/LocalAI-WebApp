import {createConnection} from 'node:net';

const MAX_REQUEST=14*1024*1024,MAX_RESPONSE=5*1024*1024;
const fail=code=>new Error(code);

// Gateway-side candidate. The production caller uses only the fixed local
// socket; public HTTP identity and capability checks precede this call.
export function callDocumentSupervisor(command,{socketPath='/run/localai-documents/document.sock',signal,timeoutMs=15000}={}){
 if(typeof socketPath!=='string'||!socketPath.startsWith('/')||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000||signal!==undefined&&!(signal instanceof AbortSignal))return Promise.reject(fail('invalid_document_supervisor_client'));
 let request;try{request=JSON.stringify(command)+'\n';}catch{return Promise.reject(fail('invalid_document_supervisor_client'));}
 if(Buffer.byteLength(request)>MAX_REQUEST)return Promise.reject(fail('invalid_document_supervisor_client'));
 if(signal?.aborted)return Promise.reject(fail('document_cancelled'));
 return new Promise((resolve,reject)=>{
  const socket=createConnection(socketPath);let done=false,bytes=0;const chunks=[];
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.destroy();if(error)reject(error);else resolve(value);};
  const abort=()=>finish(fail('document_cancelled'));
  const timer=setTimeout(()=>finish(fail('document_supervisor_timeout')),timeoutMs);timer.unref();signal?.addEventListener('abort',abort,{once:true});
  socket.once('connect',()=>socket.write(request));
  socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_RESPONSE+1){finish(fail('document_supervisor_response_limit'));return;}chunks.push(chunk);});
  socket.once('end',()=>{if(done)return;try{const buffer=Buffer.concat(chunks,bytes);if(buffer.length<2||buffer.at(-1)!==10||buffer.subarray(0,-1).includes(10))throw fail('document_supervisor_invalid_response');const message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,-1)));if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).length!==1||!Object.hasOwn(message,'data')&&!Object.hasOwn(message,'error'))throw fail('document_supervisor_invalid_response');if(Object.hasOwn(message,'error')){if(typeof message.error!=='string'||!/^[a-z][a-z0-9_]{1,63}$/.test(message.error))throw fail('document_supervisor_invalid_response');finish(fail(message.error));}else finish(null,message.data);}catch(error){finish(error instanceof Error?error:fail('document_supervisor_invalid_response'));}});
  socket.once('error',()=>finish(fail('document_supervisor_unavailable')));
  socket.once('close',()=>{if(!done)finish(fail('document_supervisor_disconnected'));});
 });
}
