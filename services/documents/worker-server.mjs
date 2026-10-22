import {createServer} from 'node:net';
import {rm} from 'node:fs/promises';
import {basename,isAbsolute} from 'node:path';
import {serveDocumentConnection} from './worker-protocol.mjs';

// The supervisor supplies a private runtime directory. This process accepts
// exactly one local request and exits after its socket has been cleaned up.
export async function startDocumentWorker({socketPath,processor,timeoutMs=120000}){
 if(typeof socketPath!=='string'||!isAbsolute(socketPath)||basename(socketPath)!=='worker.sock'||typeof processor!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('invalid_document_worker_configuration');
 const server=createServer({allowHalfOpen:false});let claimed=false,bound=false,closed=false,handlerFinished=false,resolveDone,rejectDone,idleTimer,finished=false,failure;
 const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});void done.catch(()=>{});
 const settle=(error)=>{if(finished)return;finished=true;clearTimeout(idleTimer);if(error)rejectDone(error);else resolveDone();};
 const complete=()=>{if(!bound||!closed||!handlerFinished)return;void (async()=>{if(process.platform!=='win32')await rm(socketPath,{force:true});settle(failure);})().catch(settle);};
 server.on('error',error=>{if(!bound)return;failure=error;if(!claimed)handlerFinished=true;server.close();complete();});
 server.on('close',()=>{closed=true;complete();});
 server.on('connection',socket=>{
  if(claimed){socket.destroy();return;}claimed=true;clearTimeout(idleTimer);server.close();
  const deadline=setTimeout(()=>socket.destroy(),timeoutMs);deadline.unref();
  const closed=new Promise(resolve=>socket.once('close',resolve));
  void serveDocumentConnection(socket,processor).then(()=>closed).catch(error=>{failure=error;socket.destroy();}).finally(()=>{clearTimeout(deadline);handlerFinished=true;complete();});
 });
 const previous=process.platform==='win32'?null:process.umask(0o117);
 try{await new Promise((resolve,reject)=>{const onError=error=>{server.off('error',onError);reject(error);};server.once('error',onError);server.listen(socketPath,()=>{server.off('error',onError);bound=true;resolve();});});}
 finally{if(previous!==null)process.umask(previous);}
 idleTimer=setTimeout(()=>{failure=new Error('document_worker_timeout');handlerFinished=true;server.close();},timeoutMs);idleTimer.unref();
 return Object.freeze({done});
}
