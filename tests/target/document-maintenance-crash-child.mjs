// Started only by document-maintenance-unit-files.mjs against disposable units.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,existsSync,fsyncSync,openSync,renameSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {beginInteractiveMaintenance,finishInteractiveMaintenance} from '../../installer/interactive-maintenance-transaction.mjs';
import {prepareInteractiveMaintenanceJournal} from '../../installer/interactive-maintenance-journal.mjs';
import {readDocumentWorkerInventory,readSystemdUnit,verifyOfflineDocumentWorkers,verifyOfflineSystemdUnits} from '../../services/resources/interactive-lease-recovery.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const suffix=process.argv[2],directory=process.argv[3],crashPoint=process.argv[4];
assert.match(suffix,/^[0-9a-f]{8}$/);assert.match(directory,/^\/root\/localai-maintenance-proof-[A-Za-z0-9]+$/);
assert.ok(['after-begin','after-first-mask','during-restore'].includes(crashPoint));
const units=['gateway','chat','embedding','supervisor'].map(role=>`localai-recovery-${suffix}-${role}.service`);
const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:20000,maxBuffer:8192});
const capture=unit=>{
 const fields=Object.fromEntries(systemctl('show',unit,'--property=LoadState','--property=ActiveState','--property=UnitFileState','--no-pager').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
 assert.equal(fields.LoadState,'loaded');assert.ok(['active','inactive'].includes(fields.ActiveState));assert.ok(['enabled','disabled'].includes(fields.UnitFileState));
 return {available:true,active:fields.ActiveState==='active',enabled:fields.UnitFileState==='enabled'};
};
let restored=0;
const control={capture,stop:unit=>systemctl('stop',unit),reload:()=>systemctl('daemon-reload'),restore:(unit,state)=>{systemctl(state.enabled?'enable':'disable',unit);systemctl(state.active?'start':'stop',unit);if(++restored===1)process.kill(process.pid,'SIGKILL');},verifyRestored:()=>{throw new Error('unexpected_child_verify');}};
const options={journal:join(directory,'maintenance.json'),unitDirectory:'/etc/systemd/system',units,control,recoverWorkers:()=>verifyOfflineDocumentWorkers(readDocumentWorkerInventory),verifyOffline:async()=>{await verifyOfflineSystemdUnits(readSystemdUnit,units);await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);return true;}};
if(crashPoint==='after-first-mask'){
 const serviceStates=Object.fromEntries(units.map(unit=>[unit,capture(unit)]));
 prepareInteractiveMaintenanceJournal({journal:options.journal,unitDirectory:options.unitDirectory,units,serviceStates});
 for(const unit of units)systemctl('stop',unit);
 const temporary=join(options.unitDirectory,`.${units[0]}.mask-${suffix}`);
 try{symlinkSync('/dev/null',temporary);renameSync(temporary,join(options.unitDirectory,units[0]));}
 finally{if(existsSync(temporary))unlinkSync(temporary);}
 const fd=openSync(options.unitDirectory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 process.kill(process.pid,'SIGKILL');
}
await beginInteractiveMaintenance(options);
if(crashPoint==='after-begin')process.kill(process.pid,'SIGKILL');
await finishInteractiveMaintenance(options);
throw new Error('expected_child_crash');
