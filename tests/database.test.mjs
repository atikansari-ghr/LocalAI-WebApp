import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openState as openRealState } from '../packages/database/index.mjs';
const handles = new Set();
function openState(...args) {
  const state = openRealState(...args), close = state.close;
  state.close = () => { if (handles.delete(state)) close(); };
  handles.add(state); return state;
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(),'localai-'));
  t.after(() => { for (const state of handles) state.close(); rmSync(dir,{recursive:true,force:true}); });
  return dir;
}
test('WAL state survives close/reopen with structured values and integrity', t=>{
  const path=join(fixture(t),'state.sqlite'); let s=openState(path);
  s.setSetting('synthetic', {language:'ar',value:7}); assert.equal(s.health().journalMode,'wal'); s.close();
  s=openState(path); t.after(()=>s.close()); assert.deepEqual(s.getSetting('synthetic'),{language:'ar',value:7}); assert.equal(s.health().ok,true);
});
test('online backup includes committed WAL writes and refuses overwriting an existing file', async t=>{
  const dir=fixture(t); const s=openState(join(dir,'state.sqlite')); t.after(()=>s.close());
  s.setSetting('before',{n:1}); const backup=join(dir,'snapshot.sqlite'); await s.backup(backup);
  const restored=openState(backup); assert.deepEqual(restored.getSetting('before'),{n:1}); restored.close();
  await assert.rejects(s.backup(backup)); assert.deepEqual(s.getSetting('before'),{n:1});
});
test('migration error rolls back partial writes and leaves the existing schema usable',t=>{
  const dir=fixture(t), path=join(dir,'state.sqlite'), migrations=join(dir,'migrations'); mkdirSync(migrations);
  const original=readFileSync(new URL('../migrations/001-foundation.sql',import.meta.url),'utf8');
  writeFileSync(join(migrations,'001-foundation.sql'),original); let s=openState(path,{migrationsDir:migrations}); s.setSetting('safe',true);s.close();
  writeFileSync(join(migrations,'002-bad.sql'),'CREATE TABLE leaked (id INTEGER); INSERT INTO absent VALUES (1);');
  assert.throws(()=>openState(path,{migrationsDir:migrations}));
  const raw=new DatabaseSync(path);
  assert.equal(raw.prepare("SELECT count(*) n FROM sqlite_master WHERE name='leaked'").get().n,0);
  assert.equal(raw.prepare("SELECT value FROM settings WHERE key='safe'").get().value,'true');
  raw.close();
});
test('modified, missing, noncontiguous and newer migration histories fail closed',t=>{
  const dir=fixture(t), path=join(dir,'state.sqlite'), migrations=join(dir,'migrations'); mkdirSync(migrations);
  const sql=readFileSync(new URL('../migrations/001-foundation.sql',import.meta.url),'utf8'); writeFileSync(join(migrations,'001-foundation.sql'),sql);
  openState(path,{migrationsDir:migrations}).close(); writeFileSync(join(migrations,'001-foundation.sql'),sql+'\n-- drift');
  assert.throws(()=>openState(path,{migrationsDir:migrations}),/migration/i);
  writeFileSync(join(migrations,'001-foundation.sql'),sql);writeFileSync(join(migrations,'003-gap.sql'),'SELECT 1;');
  assert.throws(()=>openState(path,{migrationsDir:migrations}),/migration/i);
  rmSync(join(migrations,'003-gap.sql'));const raw=new DatabaseSync(path);raw.prepare('INSERT INTO schema_migrations(version,checksum) VALUES (?,?)').run(2,'newer');raw.close();
  assert.throws(()=>openState(path,{migrationsDir:migrations}),/migration/i);
});
test('invalid JSON settings cannot replace existing state',t=>{
 const s=openState(join(fixture(t),'s.sqlite'));t.after(()=>s.close());s.setSetting('x',1);
 assert.throws(()=>s.setSetting('x',undefined)); assert.equal(s.getSetting('x'),1);
});
