import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverDocumentUnits} from '../services/documents/unit-recovery.mjs';

const unit='localai-document-job-a1b2c3d4.service';
test('Interrupted jobs are released only after matching units are stopped and checked',async()=>{
 const calls=[];let listed=0,confirmed=false;
 const run=async(_command,args)=>{calls.push(args);if(args[0]==='list-units')return {stdout:JSON.stringify(listed++?[]:[{unit,active:'active'}])};if(args[0]==='stop')return {stdout:''};if(args[0]==='show')return {stdout:'MainPID=0\nActiveState=inactive\n'};throw Error('unexpected_command');};
 const result=await recoverDocumentUnits({run,onStopped:()=>{confirmed=true;}});
 assert.deepEqual(result.stopped,[unit]);assert.equal(confirmed,true);assert.equal(calls.filter(args=>args[0]==='stop').length,1);
});
test('A stop error or surviving PID never confirms native cleanup',async()=>{
 let confirmed=false;const inventory=()=>({stdout:JSON.stringify([{unit,active:'active'}])});
 const stopped=async(_command,args)=>{if(args[0]==='list-units')return inventory();if(args[0]==='stop')throw Error('cannot_stop');throw Error('unexpected');};
 await assert.rejects(recoverDocumentUnits({run:stopped,onStopped:()=>{confirmed=true;}}),/cannot_stop/);assert.equal(confirmed,false);
 let listed=0;const surviving=async(_command,args)=>{if(args[0]==='list-units')return {stdout:JSON.stringify(listed++?[]:[{unit,active:'active'}])};if(args[0]==='stop')return {stdout:''};return {stdout:'MainPID=123\nActiveState=active\n'};};
 await assert.rejects(recoverDocumentUnits({run:surviving,onStopped:()=>{confirmed=true;}}),/native_cleanup_unconfirmed/);assert.equal(confirmed,false);
});
test('Inventory cannot authorize another unit or hide a newly active unit',async()=>{
 let confirmed=false;
 const foreign=async()=>({stdout:JSON.stringify([{unit:'localai.service',active:'active'}])});
 await assert.rejects(recoverDocumentUnits({run:foreign,onStopped:()=>{confirmed=true;}}),/native_unit_inventory_invalid/);
 const race=async(_command,args)=>{if(args[0]==='list-units')return {stdout:JSON.stringify([{unit,active:'active'}])};if(args[0]==='stop')return {stdout:''};return {stdout:'MainPID=0\nActiveState=inactive\n'};};
 await assert.rejects(recoverDocumentUnits({run:race,onStopped:()=>{confirmed=true;}}),/native_cleanup_unconfirmed/);assert.equal(confirmed,false);
});
