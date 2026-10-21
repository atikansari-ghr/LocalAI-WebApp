import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readlinkSync,writeFileSync,chmodSync,symlinkSync,lstatSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';
import {applyInteractiveUnitMasks,prepareInteractiveMaintenanceJournal,readInteractiveMaintenanceJournal,restoreInteractiveUnitFiles} from '../installer/interactive-maintenance-journal.mjs';

const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'localai-maintenance-'));chmodSync(root,0o700);
 const unitDirectory=join(root,'units'),journalDirectory=join(root,'journal');
 mkdirSync(unitDirectory,{mode:0o755});mkdirSync(journalDirectory,{mode:0o700});
 for(const name of RECOVERY_UNITS.slice(0,3))writeFileSync(join(unitDirectory,name),'[Service]\nExecStart=/bin/true\n',{mode:0o644});
 const serviceStates=Object.fromEntries(RECOVERY_UNITS.map((unit,index)=>[unit,{available:index<3,active:index<2,enabled:index<3}]));
 return {root,unitDirectory,journal:join(journalDirectory,'maintenance.json'),serviceStates,cleanup:()=>rmSync(root,{recursive:true,force:true})};
};

test('Maintenance journal captures fixed unit bytes, metadata and missing candidate before any mutation',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  const result=prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates});
  assert.equal(result.schemaVersion,2);assert.deepEqual(result.files.map(file=>file.unit),RECOVERY_UNITS);
  assert.deepEqual(result.services,f.serviceStates);
  assert.equal(result.files[0].previous.data,Buffer.from('[Service]\nExecStart=/bin/true\n').toString('base64'));
  assert.equal(result.files[0].previous.mode,0o644);assert.equal(result.files[3].previous,null);
  assert.equal(lstatSync(f.journal).mode&0o777,0o600);
  assert.deepEqual(readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),result);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates}),/interactive_maintenance_journal_exists/);
 }finally{f.cleanup();}
});

test('Maintenance journal rejects linked or writable unit files and unsafe journal parents',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  const path=join(f.unitDirectory,RECOVERY_UNITS[0]);rmSync(path);symlinkSync('/dev/null',path);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates}),/unsafe_interactive_maintenance_unit/);
  rmSync(path);writeFileSync(path,'x',{mode:0o666});chmodSync(path,0o666);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates}),/unsafe_interactive_maintenance_unit/);
  chmodSync(path,0o644);chmodSync(join(f.root,'journal'),0o755);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates}),/unsafe_interactive_maintenance_journal_directory/);
  chmodSync(join(f.root,'journal'),0o700);writeFileSync(path,Buffer.alloc(1024**2+1));
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates}),/unsafe_interactive_maintenance_unit/);
 }finally{f.cleanup();}
});

test('Maintenance journal reader refuses tampered permissions and symlink replacement',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates});chmodSync(f.journal,0o666);
  assert.throws(()=>readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_journal/);
  rmSync(f.journal);symlinkSync('/dev/null',f.journal);
  assert.throws(()=>readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_journal/);
 }finally{f.cleanup();}
});

test('Maintenance journal refuses inconsistent or incomplete service-state snapshots',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  for(const serviceStates of [undefined,{}, {...f.serviceStates,[RECOVERY_UNITS[3]]:{available:false,active:true,enabled:false}}, {...f.serviceStates,[RECOVERY_UNITS[0]]:{available:true,active:'yes',enabled:true}}, {...f.serviceStates,other:{available:true,active:false,enabled:false}}]){
   assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates}),/unsafe_interactive_maintenance_service_state/);
  }
 }finally{f.cleanup();}
});

test('Maintenance journal reader rejects a changed service-state record',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates});
  const record=JSON.parse(readFileSync(f.journal,'utf8'));record.services[RECOVERY_UNITS[0]].active='yes';
  writeFileSync(f.journal,JSON.stringify(record));
  assert.throws(()=>readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_journal/);
 }finally{f.cleanup();}
});

test('Journaled unit masks replace only captured files and restore exact bytes and modes',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates});
  applyInteractiveUnitMasks({journal:f.journal,unitDirectory:f.unitDirectory});
  for(const unit of RECOVERY_UNITS){const path=join(f.unitDirectory,unit);assert.equal(lstatSync(path).isSymbolicLink(),true);assert.equal(readlinkSync(path),'/dev/null');}
  restoreInteractiveUnitFiles({journal:f.journal,unitDirectory:f.unitDirectory});
  for(const unit of RECOVERY_UNITS.slice(0,3)){const path=join(f.unitDirectory,unit);assert.equal(readFileSync(path,'utf8'),'[Service]\nExecStart=/bin/true\n');assert.equal(lstatSync(path).mode&0o777,0o644);}
  assert.throws(()=>lstatSync(join(f.unitDirectory,RECOVERY_UNITS[3])),{code:'ENOENT'});
  assert.equal(lstatSync(f.journal).isFile(),true);
  restoreInteractiveUnitFiles({journal:f.journal,unitDirectory:f.unitDirectory});
 }finally{f.cleanup();}
});

test('Unit masking refuses changed source bytes before replacing any unit',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates});
  writeFileSync(join(f.unitDirectory,RECOVERY_UNITS[1]),'changed');
  assert.throws(()=>applyInteractiveUnitMasks({journal:f.journal,unitDirectory:f.unitDirectory}),/interactive_maintenance_unit_changed/);
  assert.equal(lstatSync(join(f.unitDirectory,RECOVERY_UNITS[0])).isFile(),true);
 }finally{f.cleanup();}
});

test('Restore refuses an unexpected mask target and retains the journal',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,serviceStates:f.serviceStates});
  applyInteractiveUnitMasks({journal:f.journal,unitDirectory:f.unitDirectory});
  const path=join(f.unitDirectory,RECOVERY_UNITS[1]);rmSync(path);symlinkSync('/bin/true',path);
  assert.throws(()=>restoreInteractiveUnitFiles({journal:f.journal,unitDirectory:f.unitDirectory}),/interactive_maintenance_unit_changed/);
  assert.equal(readlinkSync(join(f.unitDirectory,RECOVERY_UNITS[0])),'/dev/null');
  assert.equal(lstatSync(f.journal).isFile(),true);
 }finally{f.cleanup();}
});

test('Maintenance journal refuses caller-directed unit names outside the disposable target',()=>{
 const f=fixture();try{
  const units=['gateway','chat','embedding','supervisor'].map(role=>`localai-recovery-12345678-${role}.service`);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory,units,serviceStates:f.serviceStates}),/invalid_interactive_maintenance_units/);
 }finally{f.cleanup();}
});
