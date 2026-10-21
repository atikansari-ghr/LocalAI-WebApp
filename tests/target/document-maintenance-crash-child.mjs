// Started only by document-maintenance-unit-files.mjs against disposable units.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {beginInteractiveMaintenance} from '../../installer/interactive-maintenance-transaction.mjs';
import {readDocumentWorkerInventory,readSystemdUnit,verifyOfflineDocumentWorkers,verifyOfflineSystemdUnits} from '../../services/resources/interactive-lease-recovery.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const suffix=process.argv[2],directory=process.argv[3];
assert.match(suffix,/^[0-9a-f]{8}$/);assert.match(directory,/^\/root\/localai-maintenance-proof-[A-Za-z0-9]+$/);
const units=['gateway','chat','embedding','supervisor'].map(role=>`localai-recovery-${suffix}-${role}.service`);
const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:20000,maxBuffer:8192});
const capture=unit=>{
 const fields=Object.fromEntries(systemctl('show',unit,'--property=LoadState','--property=ActiveState','--property=UnitFileState','--no-pager').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
 assert.equal(fields.LoadState,'loaded');assert.ok(['active','inactive'].includes(fields.ActiveState));assert.ok(['enabled','disabled'].includes(fields.UnitFileState));
 return {available:true,active:fields.ActiveState==='active',enabled:fields.UnitFileState==='enabled'};
};
const control={capture,stop:unit=>systemctl('stop',unit),reload:()=>systemctl('daemon-reload'),restore:()=>{throw new Error('unexpected_child_restore');},verifyRestored:()=>{throw new Error('unexpected_child_restore');}};
await beginInteractiveMaintenance({journal:join(directory,'maintenance.json'),unitDirectory:'/etc/systemd/system',units,control,recoverWorkers:()=>verifyOfflineDocumentWorkers(readDocumentWorkerInventory),verifyOffline:async()=>{await verifyOfflineSystemdUnits(readSystemdUnit,units);await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);return true;}});
process.kill(process.pid,'SIGKILL');
