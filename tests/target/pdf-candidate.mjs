import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {readFile,readdir,mkdtemp,rm,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {createPdfParser} from '../../services/documents/pdf.mjs';
import {runDocumentTool} from '../../services/documents/tool-process.mjs';
assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.notEqual(process.getuid(),0);
for(const path of ['/var/lib/localai','/var/lib/localai-models','/opt/localai/ai','/etc/localai'])await assert.rejects(access(path,constants.R_OK|constants.X_OK),error=>['EACCES','ENOENT'].includes(error.code));
const groupDirectory=await mkdtemp(tmpdir()+'/localai-process-test-'),pidFile=groupDirectory+'/child.pid',controller=new AbortController();
try{
 const script='const {spawn}=require("node:child_process"),fs=require("node:fs");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);';
 const pending=runDocumentTool(process.execPath,['-e',script,pidFile],{signal:controller.signal});let pid;
 for(let retry=0;retry<100;retry++){try{pid=Number(await readFile(pidFile,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
 assert.ok(Number.isSafeInteger(pid)&&pid>1);controller.abort();await assert.rejects(pending,/document_tool_cancelled/);
 let alive=true;for(let retry=0;retry<100;retry++){try{const status=await readFile('/proc/'+pid+'/stat','utf8');if(status.split(') ')[1][0]==='Z'){alive=false;break;}}catch(error){if(error.code==='ENOENT'){alive=false;break;}throw error;}await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(alive,false);
}finally{controller.abort();await rm(groupDirectory,{recursive:true,force:true});}
const base='/opt/localai/documents/candidates/poppler-25.03.0',root=base+'/root',lock=JSON.parse(await readFile(new URL('../../services/documents/poppler-packages.json',import.meta.url),'utf8'));
for(const item of lock.packages){const bytes=await readFile(base+'/debs/'+item.file);assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);}
for(const name of ['pdfinfo','pdftotext','pdfimages','pdftoppm']){const result=await runDocumentTool(root+'/usr/bin/'+name,['-v'],{env:{PATH:'/usr/bin:/bin',LD_LIBRARY_PATH:root+'/usr/lib/x86_64-linux-gnu'}});assert.equal(result.code,0);assert.match(result.stderr.toString(),/version 25\.03\.0/);}
const parse=createPdfParser({binDir:root+'/usr/bin',libraryDir:root+'/usr/lib/x86_64-linux-gnu',fontConfig:base+'/fonts.conf'}),files=new URL('../fixtures/documents/',import.meta.url),input=async name=>({name,bytes:await readFile(new URL(name,files))}),before=(await readdir(tmpdir())).filter(n=>n.startsWith('localai-pdf-'));
const started=performance.now(),result=await parse(await input('mixed-pages.pdf'),{rasterize:true});
assert.deepEqual(result.pages.map(p=>p.status),['native-text','requires-ocr','native-and-images-review']);assert.match(result.pages[0].text,/LOCAL AI NATIVE TEXT 1234/);assert.equal(result.rasters.length,3);assert.deepEqual(result.rasters.map(p=>p.page),[1,2,3]);assert.ok(result.rasters.every(p=>p.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))));
await assert.rejects(parse(await input('encrypted.pdf')),/encrypted_document_unsupported/);await assert.rejects(parse(await input('truncated.pdf')),/invalid_pdf/);await assert.rejects(parse(await input('mixed-pages.pdf'),{maxTextBytes:2}),/text_output_limit/);await assert.rejects(parse(await input('mixed-pages.pdf'),{signal:AbortSignal.abort()}),/cancelled/);
assert.deepEqual((await readdir(tmpdir())).filter(n=>n.startsWith('localai-pdf-')),before);
let memory={};try{const group=(await readFile('/proc/self/cgroup','utf8')).trim().split('::')[1],path='/sys/fs/cgroup'+group;memory={peak:Number(await readFile(path+'/memory.peak','utf8')),swapPeak:Number(await readFile(path+'/memory.swap.peak','utf8'))};assert.equal(memory.swapPeak,0);}catch(error){if(error.name==='AssertionError')throw error;}
console.log(JSON.stringify({gate:'private-poppler-candidate',version:'25.03.0',packagesVerified:lock.packages.length,pages:result.pages.map(p=>({index:p.index,status:p.status,wordCount:p.units.length})),rasters:result.rasters.map(p=>({page:p.page,bytes:p.bytes.length,sha256:p.sha256})),durationMs:Math.round(performance.now()-started),memory,activated:false,fullPhaseGate:'blocked'}));
