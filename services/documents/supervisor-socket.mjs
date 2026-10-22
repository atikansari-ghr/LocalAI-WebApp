import {createConnection,createServer} from 'node:net';
import {chmodSync,chownSync,lstatSync} from 'node:fs';
import {basename,dirname} from 'node:path';
import {dispatchDocumentMessage} from './supervisor-protocol.mjs';

const MAX_FRAME=14*1024*1024,MAX_REPLY=5*1024*1024,MAX_CLIENTS=4;
const MAX_RECEIPT_CLIENTS=2;
const errorCode=error=>error instanceof TypeError?'invalid_document_supervisor_message':typeof error?.message==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(error.message)?error.message:'document_service_failed';

// One newline-delimited JSON request per connection. The socket's parent and
// owning group are supplied by systemd; gateway code cannot choose this path.
export async function createDocumentSupervisorSocket({socketPath,store,runner,structuredStore,isStopping=()=>false,deadlineMs=15000}){
 if(process.platform==='win32'||typeof socketPath!=='string'||!socketPath.startsWith('/')||!store||!runner||!Number.isSafeInteger(deadlineMs)||deadlineMs<100||deadlineMs>15000)throw new TypeError('invalid_document_socket_configuration');
 const parent=lstatSync(dirname(socketPath));if(!parent.isDirectory()||parent.uid!==process.getuid()||parent.gid!==process.getgid()||(parent.mode&0o027)!==0)throw new Error('unsafe_document_socket_directory');
 const clients=new Set();
 const server=createServer(socket=>{
  if(clients.size>=MAX_CLIENTS){socket.destroy();return;}clients.add(socket);socket.once('close',()=>clients.delete(socket));
  let chunks=[],bytes=0,done=false;
  const deadline=setTimeout(()=>socket.destroy(),deadlineMs);deadline.unref();socket.once('close',()=>clearTimeout(deadline));
  socket.setTimeout(15000,()=>socket.destroy());
  const reply=message=>{if(done)return;done=true;clearTimeout(deadline);chunks=[];let payload=JSON.stringify(message);if(Buffer.byteLength(payload)>MAX_REPLY)payload=JSON.stringify({error:'document_result_too_large'});socket.end(payload+'\n');};
  socket.on('data',chunk=>{
   if(done)return;bytes+=chunk.length;if(bytes>MAX_FRAME){reply({error:'invalid_document_supervisor_message'});return;}
   if(chunk.includes(10)){
    chunks.push(chunk);const buffer=Buffer.concat(chunks,bytes),end=buffer.indexOf(10);
    if(end!==buffer.length-1){reply({error:'invalid_document_supervisor_message'});return;}
    try{if(isStopping())throw new Error('document_runner_stopping');const command=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,end)));reply({data:dispatchDocumentMessage(command,{store,runner,structuredStore})});}
    catch(error){reply({error:errorCode(error)});}
   }else chunks.push(chunk);
  });
  socket.on('end',()=>{if(!done)reply({error:'invalid_document_supervisor_message'});});
  socket.on('error',()=>{});
 });
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
  chmodSync(socketPath,0o660);if(!lstatSync(socketPath).isSocket())throw new Error('unsafe_document_socket');
  return server;
 }catch(error){server.close();throw error;}
}

// A separate root-owned socket directory grants only the dedicated executor
// group access to pending capabilities. Never mount this in the gateway unit.
export async function createStructuredReceiptSocket({socketPath,executorGid,structuredStore,barrier,isStopping=()=>false,deadlineMs=15000}={}){
 if(process.platform==='win32'||typeof socketPath!=='string'||!socketPath.startsWith('/')||basename(socketPath)!=='receipts.sock'||!Number.isSafeInteger(executorGid)||executorGid<0||typeof structuredStore?.pendingReceipts!=='function'||typeof barrier?.isClear!=='function'||typeof isStopping!=='function'||!Number.isSafeInteger(deadlineMs)||deadlineMs<100||deadlineMs>15000)throw new TypeError('invalid_structured_receipt_socket');
 const parent=lstatSync(dirname(socketPath));
 if(!parent.isDirectory()||parent.uid!==process.getuid()||parent.gid!==executorGid||(parent.mode&0o7777)!==0o750)throw new Error('unsafe_structured_receipt_directory');
 const clients=new Set();
 const server=createServer(socket=>{
  if(clients.size>=MAX_RECEIPT_CLIENTS){socket.destroy();return;}
  clients.add(socket);socket.once('close',()=>clients.delete(socket));
  let frame='',done=false;const timer=setTimeout(()=>socket.destroy(),deadlineMs);timer.unref();
  const reply=data=>{if(done)return;done=true;socket.end(JSON.stringify(data)+'\n',()=>socket.destroy());};
  socket.once('close',()=>clearTimeout(timer));socket.on('error',()=>{});
  socket.on('data',chunk=>{
   if(done)return;frame+=chunk.toString('utf8');
   if(frame.length>5||frame.includes('\n')&&frame!=='next\n'){reply({error:'invalid_structured_receipt_request'});return;}
   if(frame!=='next\n')return;
   try{
    if(isStopping())throw new Error('document_runner_stopping');
    if(!barrier.isClear())throw new Error('interactive_recovery_required');
    reply({data:structuredStore.pendingReceipts({limit:1})[0]??null});
   }catch(error){reply({error:typeof error?.message==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(error.message)?error.message:'structured_receipt_unavailable'});}
  });
  socket.on('end',()=>{if(!done)reply({error:'invalid_structured_receipt_request'});});
 });
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
  const state=lstatSync(socketPath);if(!state.isSocket()||state.uid!==process.getuid())throw new Error('unsafe_structured_receipt_socket');
  if(state.gid!==executorGid)chownSync(socketPath,process.getuid(),executorGid);
  chmodSync(socketPath,0o660);
  return server;
 }catch(error){server.close();throw error;}
}

export function requestStructuredReceipt({socketPath,timeoutMs=15000}={}){
 if(process.platform==='win32'||typeof socketPath!=='string'||!socketPath.startsWith('/')||basename(socketPath)!=='receipts.sock'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)return Promise.reject(new TypeError('invalid_structured_receipt_client'));
 return new Promise((resolve,reject)=>{
  const socket=createConnection(socketPath);let bytes=0,done=false;const chunks=[];
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();if(error)reject(error);else resolve(value);};
  const timer=setTimeout(()=>finish(new Error('structured_receipt_timeout')),timeoutMs);timer.unref();
  socket.once('connect',()=>socket.write('next\n'));
  socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>512)finish(new Error('structured_receipt_invalid_response'));else chunks.push(chunk);});
  socket.once('end',()=>{
   try{
    const raw=Buffer.concat(chunks,bytes);if(raw.length<2||raw.at(-1)!==10||raw.subarray(0,-1).includes(10))throw new Error('structured_receipt_invalid_response');
    const message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.subarray(0,-1)));
    if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).length!==1)throw new Error('structured_receipt_invalid_response');
    if(Object.hasOwn(message,'error')){if(typeof message.error!=='string'||!/^[a-z][a-z0-9_]{1,63}$/.test(message.error))throw new Error('structured_receipt_invalid_response');throw new Error(message.error);}
    if(!Object.hasOwn(message,'data'))throw new Error('structured_receipt_invalid_response');
    const receipt=message.data;
    if(receipt!==null&&(typeof receipt!=='object'||Array.isArray(receipt)||Object.keys(receipt).length!==4||typeof receipt.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(receipt.id)||typeof receipt.namespace!=='string'||!/^(?:app|user):[A-Za-z0-9_-]{1,128}$/.test(receipt.namespace)||typeof receipt.scope!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(receipt.scope)||typeof receipt.claimCapability!=='string'||!/^[a-f0-9]{64}$/.test(receipt.claimCapability)))throw new Error('structured_receipt_invalid_response');
    finish(null,receipt);
   }catch(error){finish(error);}
  });
  socket.once('error',()=>finish(new Error('structured_receipt_unavailable')));
  socket.once('close',()=>{if(!done)finish(new Error('structured_receipt_disconnected'));});
 });
}
