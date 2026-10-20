import {createServer,createConnection} from 'node:net';
import {chmodSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {AdmissionError} from './admission.mjs';

const MAX_CLIENTS=8;
const code=error=>typeof error?.message==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(error.message)?error.message:'admission_unavailable';

// The marker is durable before grant. Only an explicit completion after the
// inference request settles clears it; a disconnected client fails closed.
export async function createInteractiveLeaseServer({socketPath,admission,barrier,handshakeMs=15000}={}){
 if(process.platform==='win32'||typeof socketPath!=='string'||!socketPath.startsWith('/')||!admission||typeof admission.runInteractive!=='function'||!barrier||typeof barrier.begin!=='function'||typeof barrier.finish!=='function'||!Number.isSafeInteger(handshakeMs)||handshakeMs<10||handshakeMs>15000)throw new TypeError('invalid_interactive_lease_server');
 const parent=lstatSync(dirname(socketPath));if(!parent.isDirectory()||parent.uid!==process.getuid()||parent.gid!==process.getgid()||(parent.mode&0o027)!==0)throw new Error('unsafe_interactive_lease_directory');
 const clients=new Set();
 const server=createServer(socket=>{
  if(clients.size>=MAX_CLIENTS){socket.destroy();return;}clients.add(socket);
  const controller=new AbortController();let closed=false,phase='request',frame='',release,token;
  const deadline=setTimeout(()=>socket.destroy(),handshakeMs);deadline.unref();
  socket.once('close',()=>{closed=true;clearTimeout(deadline);controller.abort();release?.();clients.delete(socket);});socket.on('error',()=>{});
  socket.on('data',chunk=>{
   if(phase==='done'||phase==='waiting'){socket.destroy();return;}frame+=chunk.toString('utf8');
   if(frame.length>16||frame.includes('\n')&&frame.at(-1)!=='\n'){socket.destroy();return;}
   if(phase==='granted'){
    if(frame!=='done\n'){if(frame.includes('\n'))socket.destroy();return;}
    phase='done';try{barrier.finish(token);socket.end('released\n');release?.();}catch{socket.destroy();}return;
   }
   if(frame!=='lease\n'){if(frame.includes('\n'))socket.destroy();return;}
   phase='waiting';frame='';clearTimeout(deadline);
   void admission.runInteractive(async signal=>{
    if(closed||signal.aborted)throw new Error('admission_cancelled');
    token=barrier.begin();phase='granted';socket.write('granted\n');
    await new Promise(resolve=>{release=resolve;if(closed)resolve();});
   },{signal:controller.signal}).catch(error=>{if(!closed)socket.end('error:'+code(error)+'\n');});
  });
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});chmodSync(socketPath,0o660);if(!lstatSync(socketPath).isSocket())throw new Error('unsafe_interactive_lease_socket');}
 catch(error){server.close();throw error;}
 return Object.freeze({close:async()=>{for(const socket of clients)socket.destroy();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
}

// The caller's work must honor the provided signal. An explicit done/released
// exchange occurs only after work settles, including cancelled work.
export async function withInteractiveLease(work,{socketPath='/run/localai-documents/interactive.sock',signal,timeoutMs=120000}={}){
 if(typeof work!=='function'||typeof socketPath!=='string'||!socketPath.startsWith('/')||signal!==undefined&&!(signal instanceof AbortSignal)||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('invalid_interactive_lease_client');
 if(signal?.aborted)throw new Error('admission_cancelled');
 const socket=createConnection(socketPath),connection=new AbortController();let frame='',releaseFrame='',settled=false,granted=false,grantCleanup,releaseDone,releaseFailure,releaseTimer;
 const released=new Promise(resolve=>{releaseDone=resolve;});
 const grant=new Promise((resolve,reject)=>{
  const fail=error=>{if(settled)return;settled=true;reject(error);};
  const timer=setTimeout(()=>{fail(new Error('admission_timeout'));socket.destroy();},timeoutMs);timer.unref();
  const abort=()=>{fail(new Error('admission_cancelled'));socket.destroy();};signal?.addEventListener('abort',abort,{once:true});
  socket.once('connect',()=>socket.write('lease\n'));
  socket.on('data',chunk=>{
   if(granted){releaseFrame+=chunk.toString('utf8');if(releaseFrame==='released\n'){clearTimeout(releaseTimer);releaseDone();}else if(releaseFrame.length>16||releaseFrame.includes('\n')){releaseFailure=new Error('admission_invalid_reply');releaseDone();socket.destroy();}return;}
   frame+=chunk.toString('utf8');if(frame.length>96||frame.includes('\n')&&frame.at(-1)!=='\n'){fail(new Error('admission_invalid_reply'));socket.destroy();return;}
   if(!frame.endsWith('\n'))return;
   if(frame==='granted\n'){granted=true;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();}
   else{fail(new Error(/^error:[a-z][a-z0-9_]{1,63}\n$/.test(frame)?frame.slice(6,-1):'admission_invalid_reply'));socket.destroy();}
  });
  socket.once('error',()=>{fail(new Error('admission_unavailable'));if(granted){releaseFailure=new Error('admission_lease_lost');releaseDone();}});
  socket.once('close',()=>{connection.abort(new Error('admission_lease_lost'));fail(new Error('admission_unavailable'));if(granted){releaseFailure??=new Error('admission_lease_lost');releaseDone();}});
  grantCleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
 });
 try{
  await grant;const workSignal=AbortSignal.any([connection.signal,...(signal?[signal]:[])]);let result,workFailure;
  try{result=await work(workSignal);}catch(error){workFailure=error;}
  connection.signal.throwIfAborted();
  releaseTimer=setTimeout(()=>{releaseFailure=new Error('admission_timeout');releaseDone();socket.destroy();},15000);releaseTimer.unref();socket.write('done\n');await released;
  if(releaseFailure)throw releaseFailure;
  if(signal?.aborted)throw signal.reason??new Error('admission_cancelled');
  if(workFailure)throw workFailure;
  return result;
 }finally{clearTimeout(releaseTimer);grantCleanup?.();socket.destroy();}
}

export function createInteractiveLeaseAdmission({socketPath='/run/localai-documents/interactive.sock',timeoutMs=120000}={}){
 if(typeof socketPath!=='string'||!socketPath.startsWith('/')||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('invalid_interactive_lease_client');
 return Object.freeze({runInteractive:async(work,{signal}={})=>{
  try{return await withInteractiveLease(work,{socketPath,timeoutMs,signal});}
  catch(error){if(typeof error?.message==='string'&&/^admission_[a-z_]{1,55}$/.test(error.message))throw new AdmissionError(error.message);throw error;}
 }});
}
