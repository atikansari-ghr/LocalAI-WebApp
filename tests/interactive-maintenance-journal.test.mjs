import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,symlinkSync,lstatSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';
import {prepareInteractiveMaintenanceJournal,readInteractiveMaintenanceJournal} from '../installer/interactive-maintenance-journal.mjs';

const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'localai-maintenance-'));chmodSync(root,0o700);
 const unitDirectory=join(root,'units'),journalDirectory=join(root,'journal');
 mkdirSync(unitDirectory,{mode:0o755});mkdirSync(journalDirectory,{mode:0o700});
 for(const name of RECOVERY_UNITS.slice(0,3))writeFileSync(join(unitDirectory,name),'[Service]\nExecStart=/bin/true\n',{mode:0o644});
 return {root,unitDirectory,journal:join(journalDirectory,'maintenance.json'),cleanup:()=>rmSync(root,{recursive:true,force:true})};
};

test('Maintenance journal captures fixed unit bytes, metadata and missing candidate before any mutation',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  const result=prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory});
  assert.equal(result.schemaVersion,1);assert.deepEqual(result.files.map(file=>file.unit),RECOVERY_UNITS);
  assert.equal(result.files[0].previous.data,Buffer.from('[Service]\nExecStart=/bin/true\n').toString('base64'));
  assert.equal(result.files[0].previous.mode,0o644);assert.equal(result.files[3].previous,null);
  assert.equal(lstatSync(f.journal).mode&0o777,0o600);
  assert.deepEqual(readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),result);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/interactive_maintenance_journal_exists/);
 }finally{f.cleanup();}
});

test('Maintenance journal rejects linked or writable unit files and unsafe journal parents',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  const path=join(f.unitDirectory,RECOVERY_UNITS[0]);rmSync(path);symlinkSync('/dev/null',path);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_unit/);
  rmSync(path);writeFileSync(path,'x',{mode:0o666});chmodSync(path,0o666);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_unit/);
  chmodSync(path,0o644);chmodSync(join(f.root,'journal'),0o755);
  assert.throws(()=>prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_journal_directory/);
 }finally{f.cleanup();}
});

test('Maintenance journal reader refuses tampered permissions and symlink replacement',{skip:process.platform==='win32'},()=>{
 const f=fixture();try{
  prepareInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory});chmodSync(f.journal,0o666);
  assert.throws(()=>readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_journal/);
  rmSync(f.journal);symlinkSync('/dev/null',f.journal);
  assert.throws(()=>readInteractiveMaintenanceJournal({journal:f.journal,unitDirectory:f.unitDirectory}),/unsafe_interactive_maintenance_journal/);
 }finally{f.cleanup();}
});
