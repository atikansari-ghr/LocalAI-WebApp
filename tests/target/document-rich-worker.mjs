// Disposable Debian candidate only: run the fixed native parser cohort through the one-shot worker socket.
import {createDocumentProcessor} from '../../services/documents/parsers.mjs';
import {createPdfParser} from '../../services/documents/pdf.mjs';
import {createImageNormalizer} from '../../services/documents/images.mjs';
import {createLegacyParser} from '../../services/documents/legacy.mjs';
import {createOcrChain} from '../../services/documents/ocr.mjs';
import {createNativeOcrAdapters} from '../../services/documents/ocr-adapters.mjs';
import {startDocumentWorker} from '../../services/documents/worker-server.mjs';
import {readFile} from 'node:fs/promises';

if(process.platform!=='linux'||process.getuid?.()===0||!process.env.LOCALAI_DOCUMENT_SOCKET?.startsWith('/run/localai-document-job-'))throw Error('disposable_native_worker_required');
const base='/opt/localai/ocr/candidates',python=base+'/paddleocr-3.7.0/venv/bin/python',poppler='/opt/localai/documents/candidates/poppler-25.03.0',legacy='/opt/localai/documents/candidates/legacy-tools';
const worker=new URL('../../services/documents/workers/',import.meta.url),adapters=createNativeOcrAdapters({lightRoot:base+'/light-ocr-0.5.8',tesseractRoot:base+'/tesseract-5.5.0',paddleRoot:base+'/paddleocr-3.7.0',python,node:'/opt/localai/node/bin/node',lightWorker:new URL('light-ocr.mjs',worker).pathname,paddleWorker:new URL('paddle-ocr.py',worker).pathname});
const processDocument=createDocumentProcessor({pdf:createPdfParser({binDir:poppler+'/root/usr/bin',libraryDir:poppler+'/root/usr/lib/x86_64-linux-gnu',fontConfig:poppler+'/fonts.conf'}),image:createImageNormalizer({python,worker:new URL('image-worker.py',worker).pathname}),legacy:createLegacyParser({binDir:legacy+'/root/usr/bin',dataDir:legacy+'/root/usr/share',msgWorker:new URL('msg-worker.mjs',worker).pathname}),ocr:createOcrChain({adapters})});
const server=await startDocumentWorker({socketPath:process.env.LOCALAI_DOCUMENT_SOCKET,processor:async(request,signal)=>{
 if(request.kind!=='extract')throw Error('document_worker_invalid_frame');
 const result=await processDocument({name:request.name,mime:request.mime,bytes:Buffer.from(request.content_base64,'base64')},{...request.options,signal});
 const group=(await readFile('/proc/self/cgroup','utf8')).trim().split('::')[1],path='/sys/fs/cgroup'+group;
 const memory={peak:Number(await readFile(path+'/memory.peak','utf8')),swapPeak:Number(await readFile(path+'/memory.swap.peak','utf8'))};
 return {...result,nativeProofMemory:memory};
}});
process.stdout.write('document_worker_ready\n');
await server.done;
