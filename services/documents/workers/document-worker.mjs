import {createDocumentProcessor} from '../parsers.mjs';
import {startDocumentWorker} from '../worker-server.mjs';

const processDocument=createDocumentProcessor();
try{
 const worker=await startDocumentWorker({socketPath:process.env.LOCALAI_DOCUMENT_SOCKET,processor:async(request,signal)=>{
  if(request.kind!=='extract')throw new Error('document_worker_invalid_frame');
  return processDocument({name:request.name,mime:request.mime,bytes:Buffer.from(request.content_base64,'base64')},{...request.options,signal});
 }});
 process.stdout.write('document_worker_ready\n');
 await worker.done;
}catch{
 process.stderr.write('document_worker_failed\n');
 process.exitCode=1;
}
