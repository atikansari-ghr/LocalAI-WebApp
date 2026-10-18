import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import manifest from '../services/inference/starter-manifest.json' with {type:'json'};
import {provisionStarter} from '../installer/install-ai.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'localai-provision-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {base:join(dir,'runtime'),modelRoot:join(dir,'models')};}
function synthetic(){const copy=structuredClone(manifest),data=Buffer.from('GGUF synthetic asset');for(const a of copy.assets){a.bytes=data.length;a.sha256=createHash('sha256').update(data).digest('hex');}return {copy,data};}
test('provisioning records only fully verified candidate assets and never declares runtime compatibility',async t=>{
 const paths=fixture(t),{copy,data}=synthetic();
 const result=await provisionStarter(copy,{...paths,fetchImpl:async()=>new Response(data)});
 assert.equal(result.qualification,'downloaded-unqualified');assert.equal(result.assets.length,3);
 for(const asset of result.assets)assert.deepEqual(readFileSync(asset.path),data);
 assert.equal(JSON.parse(readFileSync(result.reportPath)).qualification,'downloaded-unqualified');
});
test('a failed provision does not publish a candidate report',async t=>{
 const paths=fixture(t),{copy,data}=synthetic();let calls=0;
 await assert.rejects(provisionStarter(copy,{...paths,fetchImpl:async()=>new Response(++calls===1?data:Buffer.from('corrupt'))}));
 assert.equal(existsSync(join(paths.base,'candidates')),false);
});
