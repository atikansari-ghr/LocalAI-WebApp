import test from 'node:test';
import assert from 'node:assert/strict';
import {RECOVERY_UNITS,parseStoppedMaskedUnit,verifyOfflineDocumentWorkers,verifyOfflineSystemdUnits} from '../services/resources/interactive-lease-recovery.mjs';

const good='LoadState=masked\nUnitFileState=masked-runtime\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nJob=\nNeedDaemonReload=no\n';

test('Offline recovery requires four exact stopped and masked services',async()=>{
 assert.deepEqual(RECOVERY_UNITS,['localai.service','localai-chat.service','localai-embedding.service','localai-documents.service']);
 assert.equal(parseStoppedMaskedUnit(good),true);
 let checks=0;assert.equal(await verifyOfflineSystemdUnits(async()=>{checks++;return good;}),true);assert.equal(checks,8);
});
test('Offline recovery rejects unmasked, running or lingering service state',()=>{
 for(const state of [good.replace('masked-runtime','enabled'),good.replace('ActiveState=inactive','ActiveState=active'),good.replace('MainPID=0','MainPID=23'),good.replace('ControlPID=0','ControlPID=3'),good.replace('ControlGroup=\n','ControlGroup=/system.slice/localai.service\n'),good.replace('SubState=dead','SubState=running'),good.replace('LoadState=masked','LoadState=not-found')])assert.throws(()=>parseStoppedMaskedUnit(state),/interactive_recovery_required/);
});
test('Offline recovery rejects missing, duplicate and malformed systemd fields',()=>{
 for(const state of [good.replace('MainPID=0\n',''),good.replace('Job=\n',''),good.replace('NeedDaemonReload=no\n',''),good+'MainPID=0\n',good.replace('MainPID=0','MainPID=oops'),good.replace('ControlGroup=\n','ControlGroup=   \n'),good.replace('Job=\n','Job=1\n'),good.replace('NeedDaemonReload=no','NeedDaemonReload=yes'),good.replace('NeedDaemonReload=no','NeedDaemonReload=unknown'),good+'Unexpected=x\n'])assert.throws(()=>parseStoppedMaskedUnit(state),/interactive_recovery_required/);
});
test('Offline recovery rechecks all units and refuses a transition',async()=>{
 let checks=0;await assert.rejects(verifyOfflineSystemdUnits(async()=>{checks++;return checks===8?good.replace('ActiveState=inactive','ActiveState=active'):good;}),/interactive_recovery_required/);assert.equal(checks,8);
});
test('Offline recovery requires two empty transient document worker inventories',async()=>{
 let checks=0;assert.equal(await verifyOfflineDocumentWorkers(async()=>{checks++;return '[]\n';}),true);assert.equal(checks,2);
 await assert.rejects(verifyOfflineDocumentWorkers(async()=>++checks%2?'[]':'[{"unit":"localai-document-job-12345678.service","active":"active"}]'),/interactive_recovery_required/);
});
test('Offline recovery rejects present, malformed and unavailable worker inventories',async()=>{
 for(const inventory of ['[{"unit":"localai-document-job-12345678.service","active":"active"}]','[{"unit":"localai-document-job-12345678.service","active":"inactive"}]','{}','[null]','bad','x'.repeat(65537)])await assert.rejects(verifyOfflineDocumentWorkers(async()=>inventory),/interactive_recovery_required/);
 await assert.rejects(verifyOfflineDocumentWorkers(async()=>{throw new Error('systemctl unavailable');}),/interactive_recovery_required/);
});
