import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import manifest from '../services/inference/starter-manifest.json' with {type:'json'};
import {validateStarterManifest,downloadAsset} from '../services/inference/assets.mjs';
const data=Buffer.from('GGUF-synthetic-download-fixture');
const asset={...manifest.assets[1],bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'localai-assets-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('starter assets require pinned trusted HTTPS provenance licenses limits and safe filenames',()=>{
 const valid=validateStarterManifest(manifest);assert.ok(Object.isFrozen(valid.assets[0]));
 for(const change of [{url:'http://huggingface.co/model'},{url:'https://evil.test/model'},{licenseUrl:'https://evil.test/license'},{source:'https://evil.test/metadata'},{filename:'../escape.gguf'},{sha256:'invalid'},{bytes:5*1024**3},{license:'unknown'}]){
  const candidate=structuredClone(manifest);Object.assign(candidate.assets[1],change);assert.throws(()=>validateStarterManifest(candidate));
 }
 const missing=structuredClone(manifest);missing.assets.pop();assert.throws(()=>validateStarterManifest(missing));
});
test('downloads verify exact bytes and hash before exclusive publication and reuse verified assets',async t=>{
 const dir=fixture(t),path=join(dir,'model.gguf');let calls=0;
 const fetchImpl=async()=>{calls++;return new Response(data);};
 assert.equal((await downloadAsset(asset,path,{fetchImpl})).reused,false);
 assert.deepEqual(readFileSync(path),data);
 assert.equal((await downloadAsset(asset,path,{fetchImpl})).reused,true);assert.equal(calls,1);
 writeFileSync(path,'unrelated existing data');
 await assert.rejects(downloadAsset(asset,path,{fetchImpl}));assert.equal(readFileSync(path,'utf8'),'unrelated existing data');
});
test('corrupt truncated oversized and interrupted downloads leave no final or partial asset',async t=>{
 const dir=fixture(t);
 for(const [index,response]of [new Response(Buffer.alloc(data.length)),new Response(data.subarray(0,5)),new Response(Buffer.alloc(data.length+1)),new Response(new ReadableStream({start(c){c.error(new Error('synthetic interruption'));}}))].entries()){
  const path=join(dir,'model-'+index+'.gguf');await assert.rejects(downloadAsset(asset,path,{fetchImpl:async()=>response}));
  assert.deepEqual(readdirSync(dir),[]);
 }
 mkdirSync(join(dir,'directory'));await assert.rejects(downloadAsset(asset,join(dir,'directory'),{fetchImpl:async()=>new Response(data)}));
});
test('redirects are bounded and may not downgrade to insecure transport',async t=>{
 const dir=fixture(t);
 await assert.rejects(downloadAsset(asset,join(dir,'model.gguf'),{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://example.test/model'}})}));
 let calls=0;await assert.rejects(downloadAsset(asset,join(dir,'model.gguf'),{fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://huggingface.co/loop'}});}}));
 assert.ok(calls<=6);assert.deepEqual(readdirSync(dir),[]);
});

test('failed HTTP responses and cancelled stalled bodies are released and removed',async t=>{
 const dir=fixture(t);let cancelled=false;
 await assert.rejects(downloadAsset(asset,join(dir,'model.gguf'),{fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:503})}));
 assert.equal(cancelled,true);cancelled=false;
 const controller=new AbortController(),pending=downloadAsset(asset,join(dir,'model.gguf'),{signal:controller.signal,fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(data.subarray(0,4));},cancel(){cancelled=true;}}))});
 const timer=setTimeout(()=>controller.abort(),30);try{await assert.rejects(pending);}finally{clearTimeout(timer);}
 assert.equal(cancelled,true);assert.deepEqual(readdirSync(dir),[]);
});
