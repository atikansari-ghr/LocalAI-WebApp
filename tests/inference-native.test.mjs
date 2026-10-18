import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkerArguments,renderWorkerUnit,buildChatRouterArguments,renderChatRouterPresets,renderChatRouterUnit} from '../services/inference/native.mjs';

const paths={model:'/var/lib/localai-models/hash/model.gguf',credential:'/run/credentials/localai-chat.service/ai-backend-key'};
test('workers use private CPU inference with bounded resources and no prompt logging',()=>{
 const args=buildWorkerArguments('chat',paths);
 const value=flag=>args[args.indexOf(flag)+1];
 assert.equal(value('--host'),'/run/localai-chat/inference.sock');assert.ok(!args.includes('--port'));
 assert.equal(value('--n-gpu-layers'),'0');assert.equal(value('--parallel'),'1');
 assert.equal(value('--ctx-size'),'4096');assert.equal(value('--threads'),'3');
 assert.equal(value('--cache-ram'),'0');assert.equal(value('--api-key-file'),paths.credential);
 for(const flag of ['--offline','--no-webui','--log-disable','--no-context-shift'])assert.ok(args.includes(flag));
});
test('embedding worker uses last pooling and bounded batches on a separate private port',()=>{
 const args=buildWorkerArguments('embedding',paths),value=flag=>args[args.indexOf(flag)+1];
 assert.ok(args.includes('--embedding'));assert.equal(value('--pooling'),'last');
 assert.equal(value('--embd-normalize'),'2');assert.equal(value('--host'),'/run/localai-embedding/inference.sock');
 assert.equal(value('--ctx-size'),'2048');assert.equal(value('--ubatch-size'),'256');
 assert.equal(value('--threads'),'1');
});
test('workers unload idle models by default and allow only bounded operator sleep intervals',()=>{
 const args=buildWorkerArguments('chat',paths);assert.equal(args[args.indexOf('--sleep-idle-seconds')+1],'900');
 const short=buildWorkerArguments('embedding',paths,{idleSeconds:5});assert.equal(short[short.indexOf('--sleep-idle-seconds')+1],'5');
 for(const idleSeconds of [-1,0,4,86401,NaN,'900'])assert.throws(()=>buildWorkerArguments('chat',paths,{idleSeconds}));
 assert.throws(()=>buildWorkerArguments('chat',paths,{host:'0.0.0.0'}));
});
test('worker arguments reject external binds, arbitrary overrides and unsafe or missing paths',()=>{
 for(const profile of ['other',null,{}])assert.throws(()=>buildWorkerArguments(profile,paths));
 for(const model of ['', '../model.gguf','/tmp/a\nmodel','/tmp/a%model','C:/model.gguf'])assert.throws(()=>buildWorkerArguments('chat',{...paths,model}));
 assert.throws(()=>buildWorkerArguments('chat',{model:paths.model}));
 for(const extra of [{host:'0.0.0.0'},{context:99999},{parallel:4},{port:80}])assert.throws(()=>buildWorkerArguments('chat',{...paths,...extra}));
});
test('native units isolate gateway secrets and enforce aggregate slice membership',()=>{
 const unit=renderWorkerUnit('chat',{...paths,runtime:'/opt/localai/ai/runtimes/llama-b11669'});
 for(const directive of ['User=localai-inference','Group=localai-runtime','Slice=localai-ai.slice','ProtectSystem=strict','ProtectHome=true','InaccessiblePaths=/var/lib/localai /etc/localai','NoNewPrivileges=true','MemoryMax=4G','CPUQuota=300%','LoadCredentialEncrypted=ai-backend-key:/etc/credstore.encrypted/localai-ai-key'])assert.ok(unit.includes(directive),directive);
 assert.ok(unit.includes('--api-key-file %d/ai-backend-key'));
 assert.ok(unit.includes('PrivateNetwork=true'));assert.ok(unit.includes('RuntimeDirectoryMode=0750'));assert.ok(unit.includes('Group=localai-runtime'));assert.ok(unit.includes('RuntimeDirectory=localai-chat'));
 assert.ok(unit.includes('MemorySwapMax=0'));
 assert.ok(!unit.includes(paths.credential));
 assert.throws(()=>renderWorkerUnit('chat',{...paths,runtime:'/tmp/a%PATH'}));
});
test('local fallback router loads at most one known chat model within the same isolated service budget',()=>{
 const options={preset:'/opt/localai/ai/router/models.ini',credential:paths.credential},args=buildChatRouterArguments(options);
 assert.equal(args[args.indexOf('--models-max')+1],'1');assert.equal(args[args.indexOf('--models-preset')+1],options.preset);assert.ok(!args.includes('--model'));assert.ok(args.includes('--offline'));
 const preset=renderChatRouterPresets({primary:'/var/lib/localai-models/hash/primary.gguf',fallback:'/var/lib/localai-models/hash/fallback.gguf'});
 assert.ok(preset.includes('[localai-chat]'));assert.ok(preset.includes('[localai-chat-fallback]'));assert.ok(!preset.includes('hf-repo'));
 assert.throws(()=>renderChatRouterPresets({primary:'/tmp/a\n[malicious]',fallback:'/tmp/model.gguf'}));
 const unit=renderChatRouterUnit({runtime:'/opt/localai/ai/runtimes/llama-b11669',...options});assert.ok(unit.includes('MemoryMax=4G'));assert.ok(unit.includes('--models-max 1'));assert.ok(unit.includes('User=localai-inference'));
});
