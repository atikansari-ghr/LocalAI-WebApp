import test from 'node:test';
import assert from 'node:assert/strict';
import {RECOVERY_UNITS,parseStoppedMaskedUnit,verifyOfflineSystemdUnits} from '../services/resources/interactive-lease-recovery.mjs';

const good='LoadState=masked\nUnitFileState=masked-runtime\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\n';

test('Offline recovery requires four exact stopped and masked services',async()=>{
 assert.deepEqual(RECOVERY_UNITS,['localai.service','localai-chat.service','localai-embedding.service','localai-document-supervisor.service']);
 assert.equal(parseStoppedMaskedUnit(good),true);
 let checks=0;assert.equal(await verifyOfflineSystemdUnits(async()=>{checks++;return good;}),true);assert.equal(checks,8);
});
test('Offline recovery rejects unmasked, running or lingering service state',()=>{
 for(const state of [good.replace('masked-runtime','enabled'),good.replace('ActiveState=inactive','ActiveState=active'),good.replace('MainPID=0','MainPID=23'),good.replace('ControlPID=0','ControlPID=3'),good.replace('ControlGroup=\n','ControlGroup=/system.slice/localai.service\n'),good.replace('SubState=dead','SubState=running'),good.replace('LoadState=masked','LoadState=not-found')])assert.throws(()=>parseStoppedMaskedUnit(state),/interactive_recovery_required/);
});
test('Offline recovery rejects missing, duplicate and malformed systemd fields',()=>{
 for(const state of [good.replace('MainPID=0\n',''),good+'MainPID=0\n',good.replace('MainPID=0','MainPID=oops'),good.replace('ControlGroup=\n','ControlGroup=   \n'),good+'Unexpected=x\n'])assert.throws(()=>parseStoppedMaskedUnit(state),/interactive_recovery_required/);
});
test('Offline recovery rechecks all units and refuses a transition',async()=>{
 let checks=0;await assert.rejects(verifyOfflineSystemdUnits(async()=>{checks++;return checks===8?good.replace('ActiveState=inactive','ActiveState=active'):good;}),/interactive_recovery_required/);assert.equal(checks,8);
});
