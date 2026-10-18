import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openState } from '../packages/database/index.mjs';
import { verifyRollbackCompatibility } from '../installer/migration-gate.mjs';

test('schema-changing updates are rejected before touching state that the previous version must reopen',t=>{
 const root=mkdtempSync(join(tmpdir(),'localai-migration-gate-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const old=join(root,'old'),next=join(root,'next');mkdirSync(old);mkdirSync(next);
 const sql=readFileSync(new URL('../migrations/001-foundation.sql',import.meta.url),'utf8');
 for(const dir of [old,next])writeFileSync(join(dir,'001-foundation.sql'),sql);
 const config={stateDir:join(root,'state')};
 assert.equal(verifyRollbackCompatibility(config,old,next),true,'Fresh installation needs no database rollback');
 const state=openState(join(config.stateDir,'platform.sqlite'),{migrationsDir:old});state.setSetting('preserved',{synthetic:true});state.close();
 assert.equal(verifyRollbackCompatibility(config,old,next),true);
 writeFileSync(join(next,'002-future.sql'),'ALTER TABLE settings ADD COLUMN future TEXT;');
 assert.throws(()=>verifyRollbackCompatibility(config,old,next),/migration recovery/i);
 const reopened=openState(join(config.stateDir,'platform.sqlite'),{migrationsDir:old});
 assert.deepEqual(reopened.getSetting('preserved'),{synthetic:true});reopened.close();
 rmSync(join(next,'002-future.sql'));writeFileSync(join(next,'001-foundation.sql'),sql+'\n-- changed history');
 assert.throws(()=>verifyRollbackCompatibility(config,old,next));
});

test('a downgrade cannot pass merely because candidate and previous files agree',t=>{
 const root=mkdtempSync(join(tmpdir(),'localai-migration-downgrade-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const dir=join(root,'migrations');mkdirSync(dir);
 writeFileSync(join(dir,'001-foundation.sql'),readFileSync(new URL('../migrations/001-foundation.sql',import.meta.url),'utf8'));
 const config={stateDir:join(root,'state')};
 const state=openState(join(config.stateDir,'platform.sqlite'));state.close();
 assert.throws(()=>verifyRollbackCompatibility(config,dir,dir),/history/i);
});
