// Target-only fixture for cancelling an active transient document unit.
import {startDocumentWorker} from '../../services/documents/worker-server.mjs';

const worker=await startDocumentWorker({socketPath:process.env.LOCALAI_DOCUMENT_SOCKET,processor:async(_request,signal)=>new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>resolve({text:'late'}),10000);
 signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'));},{once:true});
})});
process.stdout.write('document_worker_ready\n');
await worker.done;
