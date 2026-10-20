import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {dirname,posix} from 'node:path';
import {createDocumentProcessor} from './parsers.mjs';
import {createPdfParser} from './pdf.mjs';
import {createImageNormalizer} from './images.mjs';
import {createLegacyParser} from './legacy.mjs';
import {createOcrChain} from './ocr.mjs';
import {createNativeOcrAdapters} from './ocr-adapters.mjs';

const fields=['version','popplerRoot','legacyRoot','lightRoot','tesseractRoot','paddleRoot','paddlePython'];
const invalid=()=>new Error('invalid_document_cohort');
function validate(cohort){
 if(!cohort||typeof cohort!=='object'||Array.isArray(cohort)||Object.keys(cohort).length!==fields.length||fields.some(key=>!Object.hasOwn(cohort,key))||cohort.version!==1)throw invalid();
 for(const key of fields.slice(1)){const value=cohort[key];if(typeof value!=='string'||!value.startsWith('/opt/localai/')||value.length>512||/[\x00-\x1f\x7f]/.test(value)||posix.normalize(value)!==value||value.endsWith('/'))throw invalid();}
 return cohort;
}
function verifyRootOwnedFile(path){
 if(process.platform!=='linux'||!path.startsWith('/opt/localai/'))return;
 const file=lstatSync(path);if(!file.isFile()||file.uid!==0||(file.mode&0o022)!==0)throw invalid();
 for(let parent=dirname(path);parent!=='/';parent=dirname(parent)){const entry=lstatSync(parent);if(!entry.isDirectory()||entry.uid!==0||(entry.mode&0o022)!==0)throw invalid();}
}
// The manifest path comes only from the fixed worker entrypoint, never from a document request.
export function loadDocumentCohortProcessor(path){
 if(typeof path!=='string'||!path)throw invalid();
 if(!existsSync(path))return createDocumentProcessor();
 verifyRootOwnedFile(path);
 const raw=readFileSync(path);if(raw.length<2||raw.length>4096)throw invalid();
 let cohort;try{cohort=JSON.parse(raw.toString('utf8'));}catch{throw invalid();}
 return createDocumentCohortProcessor(cohort);
}
export function createDocumentCohortProcessor(input){
 const cohort=validate(input);
 // Windows verifies the manifest grammar, but native tools are Linux-only.
 if(process.platform!=='linux')return createDocumentProcessor();
 const workers=new URL('./workers/',import.meta.url),ocr=createNativeOcrAdapters({lightRoot:cohort.lightRoot,tesseractRoot:cohort.tesseractRoot,paddleRoot:cohort.paddleRoot,python:cohort.paddlePython,node:'/opt/localai/node/bin/node',lightWorker:new URL('light-ocr.mjs',workers).pathname,paddleWorker:new URL('paddle-ocr.py',workers).pathname});
 return createDocumentProcessor({pdf:createPdfParser({binDir:cohort.popplerRoot+'/root/usr/bin',libraryDir:cohort.popplerRoot+'/root/usr/lib/x86_64-linux-gnu',fontConfig:cohort.popplerRoot+'/fonts.conf'}),image:createImageNormalizer({python:cohort.paddlePython,worker:new URL('image-worker.py',workers).pathname}),legacy:createLegacyParser({binDir:cohort.legacyRoot+'/root/usr/bin',dataDir:cohort.legacyRoot+'/root/usr/share',msgWorker:new URL('msg-worker.mjs',workers).pathname}),ocr:createOcrChain({adapters:ocr})});
}
