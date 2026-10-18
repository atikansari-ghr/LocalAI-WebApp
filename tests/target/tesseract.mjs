// Synthetic native fallback benchmark; never modifies installed packages/state.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
if(process.platform!=='linux'||process.getuid()===0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Disposable unprivileged Linux sandbox required');
const base='/opt/localai/ocr/candidates/tesseract-5.5.0',binary=base+'/root/usr/bin/tesseract',tessdata=base+'/root/usr/share/tesseract-ocr/5/tessdata';
const env={...process.env,LD_LIBRARY_PATH:base+'/root/usr/lib/x86_64-linux-gnu',OMP_THREAD_LIMIT:'1',OMP_NUM_THREADS:'1'};
const run=args=>execFileSync(binary,args,{env,encoding:'utf8',timeout:60000,maxBuffer:1024**2});
const version=run(['--version']).split('\n')[0];assert.equal(version,'tesseract 5.5.0');
const expectedHashes={english:'8a936d1ec24cc4c888cd3841498ee8f2790081cdab78d9210ca282e8916885cd',arabic:'b65d42a93ee4b50c2dadfe9f970a62ad583145a9e63914fdf5d3b5cb7fae735e'},results=[];
for(const [sample,language]of [['english','eng'],['arabic','ara']]){
 const path=base+'/fixtures/'+sample+'.png';assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),expectedHashes[sample]);
 const started=performance.now(),tsv=run([path,'stdout','--tessdata-dir',tessdata,'-l',language,'--oem','1','--psm','6','tsv']);
 const rows=tsv.trimEnd().split('\n');assert.equal(rows.shift(),'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext');
 const words=rows.map(row=>row.split('\t')).filter(fields=>fields[0]==='5'&&fields.slice(11).join('\t').trim()).map(fields=>({text:fields.slice(11).join('\t'),confidence:Number(fields[10])/100,left:Number(fields[6]),top:Number(fields[7]),width:Number(fields[8]),height:Number(fields[9])}));
 assert.ok(words.length>0);for(const word of words){assert.ok(Number.isFinite(word.confidence)&&word.confidence>=0&&word.confidence<=1);assert.ok(word.left>=0&&word.top>=0&&word.width>0&&word.height>0&&word.left+word.width<=900&&word.top+word.height<=140);}
 const text=words.map(word=>word.text).join(' ');if(language==='eng'){assert.match(text,/LOCAL AI TEST 1234/);}else{assert.match(text,/مرحبا/);assert.match(text,/بالعالم/);}
 results.push({language,elapsedMs:Math.round(performance.now()-started),syntheticText:text,wordCount:words.length,coordinateProvenance:true});
}
console.log(JSON.stringify({scope:'isolated-ocr-candidate',engine:'tesseract',version,acceptedLanguages:['en','ar'],results,cpuThreads:1,activated:false,fullOcrGate:'blocked'}));
