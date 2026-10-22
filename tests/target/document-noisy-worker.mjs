// Target-only fixture: emits more than the supervisor's diagnostic limit
// after signaling readiness, while keeping a request in progress.
import {startDocumentWorker} from '../../services/documents/worker-server.mjs';

const worker=await startDocumentWorker({
 socketPath:process.env.LOCALAI_DOCUMENT_SOCKET,
 processor:async()=>{await new Promise(resolve=>setTimeout(resolve,5000));return {text:'late'};},
});
process.stdout.write('document_worker_ready\n');
setTimeout(()=>process.stdout.write('X'.repeat(256*1024)),10);
await worker.done;
