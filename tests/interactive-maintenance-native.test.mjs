import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';
import {requireInitialNativeServices} from '../installer/interactive-maintenance-native.mjs';

test('Native command skips loaded-state preflight when a prior journal needs restoration',()=>{
 const root=mkdtempSync(join(tmpdir(),'localai-native-maintenance-')),journal=join(root,'maintenance.json');
 try{
  const calls=[],control={capture:unit=>{calls.push(unit);return {available:true,active:false,enabled:false};}};
  assert.equal(requireInitialNativeServices({journal,control}),false);
  assert.deepEqual(calls,RECOVERY_UNITS);
  writeFileSync(journal,'interrupted');calls.length=0;
  assert.equal(requireInitialNativeServices({journal,control}),true);
  assert.deepEqual(calls,[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
