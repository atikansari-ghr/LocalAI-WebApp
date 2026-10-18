import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../services/inference/fallback-manifest.json' with {type:'json'};
import {validateFallbackModel} from '../services/inference/assets.mjs';

test('fallback provisioning requires pinned official chat weights with independently bounded context',()=>{
 assert.equal(validateFallbackModel(manifest).modelId,'localai-chat-fallback');
 for(const replacement of [{task:'embeddings'},{id:'chat'},{contextTokens:8192},{license:'unknown'},{revision:'main'},{url:'http://example.com/model.gguf'}])assert.throws(()=>validateFallbackModel({...manifest,...replacement}));
});
