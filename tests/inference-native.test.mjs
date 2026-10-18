import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkerArguments,renderWorkerUnit} from '../services/inference/native.mjs';

const paths={model:'/var/lib/localai-models/hash/model.gguf',credential:'/run/credentials/localai-chat.service/ai-backend-key'};
test('workers use private CPU inference with bounded resources and no prompt logging',()=>{
 const args=buildWorkerArguments('chat',paths);
 const value=flag=>args[args.indexOf(flag)+1];
 assert.equal(value('--host'),'127.0.0.1');assert.equal(value('--port'),'8081');
 assert.equal(value('--n-gpu-layers'),'0');assert.equal(value('--parallel'),'1');
 assert.equal(value('--ctx-size'),'4096');assert.equal(value('--threads'),'3');
 assert.equal(value('--cache-ram'),'0');assert.equal(value('--api-key-file'),paths.credential);
 for(const flag of ['--offline','--no-webui','--log-disable','--no-context-shift'])assert.ok(args.includes(flag));
});
test('embedding worker uses last pooling and bounded batches on a separate private port',()=>{
 const args=buildWorkerArguments('embedding',paths),value=flag=>args[args.indexOf(flag)+1];
 assert.ok(args.includes('--embedding'));assert.equal(value('--pooling'),'last');
 assert.equal(value('--embd-normalize'),'2');assert.equal(value('--port'),'8082');
 assert.equal(value('--ctx-size'),'2048');assert.equal(value('--ubatch-size'),'256');
 assert.equal(value('--threads'),'1');
});
test('worker arguments reject external binds, arbitrary overrides and unsafe or missing paths',()=>{
 for(const profile of ['other',null,{}])assert.throws(()=>buildWorkerArguments(profile,paths));
 for(const model of ['', '../model.gguf','/tmp/a\nmodel','/tmp/a%model','C:/model.gguf'])assert.throws(()=>buildWorkerArguments('chat',{...paths,model}));
 assert.throws(()=>buildWorkerArguments('chat',{model:paths.model}));
 for(const extra of [{host:'0.0.0.0'},{context:99999},{parallel:4},{port:80}])assert.throws(()=>buildWorkerArguments('chat',{...paths,...extra}));
});
test('native units isolate gateway secrets and enforce aggregate slice membership',()=>{
 const unit=renderWorkerUnit('chat',{...paths,runtime:'/opt/localai/ai/runtimes/llama-b11669'});
 for(const directive of ['User=localai-inference','Group=localai-inference','Slice=localai-ai.slice','ProtectSystem=strict','ProtectHome=true','InaccessiblePaths=/var/lib/localai /etc/localai','NoNewPrivileges=true','MemoryMax=4G','CPUQuota=300%','LoadCredentialEncrypted=ai-backend-key:/etc/credstore.encrypted/localai-ai-key'])assert.ok(unit.includes(directive),directive);
 assert.ok(unit.includes('--api-key-file %d/ai-backend-key'));
 assert.ok(unit.includes('IPAddressDeny=any'));assert.ok(unit.includes('IPAddressAllow=localhost'));
 assert.ok(unit.includes('MemorySwapMax=0'));
 assert.ok(!unit.includes(paths.credential));
 assert.throws(()=>renderWorkerUnit('chat',{...paths,runtime:'/tmp/a%PATH'}));
});
