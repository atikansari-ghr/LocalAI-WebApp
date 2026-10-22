import {createServer} from 'node:net';
import {chmodSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {dispatchDocumentMessage} from './supervisor-protocol.mjs';

const MAX_FRAME=14*1024*1024,MAX_REPLY=5*1024*1024,MAX_CLIENTS=4;
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
