import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNativeUnitDefinitions,assertNativeEffectiveSettings} from '../services/inference/systemd.mjs';

const names=['localai-chat.service','localai-embedding.service','localai-ai.slice'];
test('native unit definitions reject effective drop-ins and alternate fragments',()=>{
 const inspect=(name,key)=>key==='FragmentPath'?'/etc/systemd/system/'+name:'';
 assert.doesNotThrow(()=>assertNativeUnitDefinitions(inspect));
 for(const unit of names){
  assert.throws(()=>assertNativeUnitDefinitions((name,key)=>name===unit&&key==='DropInPaths'?'/etc/systemd/system/'+name+'.d/override.conf':inspect(name,key)),/override/);
  assert.throws(()=>assertNativeUnitDefinitions((name,key)=>name===unit&&key==='FragmentPath'?'/run/systemd/system/'+name:inspect(name,key)),/fragment/);
 }
});
test('effective native limits reject unlimited swap before activation can commit',()=>{
 assert.throws(()=>assertNativeEffectiveSettings((name,key)=>key==='MemorySwapMax'?'infinity':''),/configuration/);
});
