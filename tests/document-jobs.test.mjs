import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeVault,openVault} from '../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../services/documents/jobs.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'localai-document-jobs-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false});
 return {dir,path:join(dir,'jobs.sqlite'),vault};
}
test('Document jobs persist encrypted input and completed results across reopen without crossing namespaces',t=>{
 const f=fixture(t);
  const store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
  const job=store.enqueue({namespace:'app:one',name:'Private notes.txt',mime:'text/plain',bytes:Buffer.from('PRIVATE DOCUMENT BODY'),expiresAt:5000});
  assert.equal(job.status,'queued');assert.equal(store.get(job.id,'app:two'),null);
  const claim=store.claim();assert.equal(claim.id,job.id);assert.equal(claim.name,'Private notes.txt');assert.equal(claim.bytes.toString(),'PRIVATE DOCUMENT BODY');
  store.complete(job.id,claim.token,{text:'PRIVATE EXTRACTED TEXT'});store.close();
  const raw=Buffer.concat(readdirSync(f.dir).filter(name=>name.startsWith('jobs.sqlite')).map(name=>readFileSync(join(f.dir,name)))).toString('utf8');
  for(const secret of ['PRIVATE DOCUMENT BODY','Private notes.txt','PRIVATE EXTRACTED TEXT'])assert.equal(raw.includes(secret),false);
  const reopened=openDocumentJobStore(f.path,{vault:openVault(join(f.dir,'master.key')),now:()=>1001});
  assert.deepEqual(reopened.result(job.id,'app:one'),{text:'PRIVATE EXTRACTED TEXT'});assert.equal(reopened.result(job.id,'app:two'),null);reopened.close();
});
test('A restart does not reclaim an active job until native cleanup is explicitly confirmed',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
 const first=store.enqueue({namespace:'user:one',name:'scan.pdf',mime:'application/pdf',bytes:Buffer.from('synthetic'),expiresAt:5000}),claim=store.claim();
 store.close();const reopened=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1001});assert.equal(reopened.claim(),null);
 assert.throws(()=>reopened.recoverInterrupted({nativeCleanupConfirmed:false}),/native_cleanup_required/);
 assert.equal(reopened.recoverInterrupted({nativeCleanupConfirmed:true}),1);assert.equal(reopened.get(first.id,'user:one').status,'failed');
 assert.throws(()=>reopened.complete(first.id,claim.token,{text:'late'}),/job_claim_invalid/);reopened.close();
});
test('Document job claims, cancellation, expiry and result caps fail closed',t=>{
 const f=fixture(t);let now=1000;const store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>now});
 assert.throws(()=>store.enqueue({namespace:'../other',name:'a',mime:'text/plain',bytes:Buffer.from('x'),expiresAt:5000}),/invalid_job/);
 const job=store.enqueue({namespace:'app:one',name:'x.txt',mime:'text/plain',bytes:Buffer.from('x'),expiresAt:5000});
 assert.equal(store.cancel(job.id,'app:two'),false);const claim=store.claim();
 assert.throws(()=>store.complete(job.id,'wrong',{text:'x'}),/job_claim_invalid/);
 assert.equal(store.cancel(job.id,'app:one'),true);
 assert.equal(store.get(job.id,'app:one').status,'cancelling');
 assert.throws(()=>store.complete(job.id,claim.token,{text:'late'}),/job_claim_invalid/);
 now=5001;assert.equal(store.purgeExpired(),0);assert.equal(store.get(job.id,'app:one').status,'cancelling');
 store.finishCancellation(job.id,claim.token);assert.equal(store.get(job.id,'app:one').status,'cancelled');
 assert.equal(store.purgeExpired(),1);assert.equal(store.get(job.id,'app:one'),null);store.close();
});
test('An existing unversioned database cannot be relabelled as a job store',t=>{
 const f=fixture(t),db=new DatabaseSync(f.path);db.exec('CREATE TABLE foreign_table (value TEXT)');db.close();if(process.platform!=='win32')chmodSync(f.path,0o600);
 assert.throws(()=>openDocumentJobStore(f.path,{vault:f.vault}),/job_schema_incompatible/);
});
test('A foreign version-one database stays byte-for-byte unchanged on a mistaken job-store path',t=>{
 const f=fixture(t),db=new DatabaseSync(f.path);db.exec('CREATE TABLE foreign_table (value TEXT); PRAGMA user_version=1;');db.close();if(process.platform!=='win32')chmodSync(f.path,0o600);
 const before=readFileSync(f.path);assert.throws(()=>openDocumentJobStore(f.path,{vault:f.vault}),/job_schema_incompatible/);
 assert.deepEqual(readFileSync(f.path),before);
 const check=new DatabaseSync(f.path,{readOnly:true});assert.equal(check.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='document_jobs'").get().count,0);check.close();
});
test('Wrong vault material and oversized results cannot silently replace persistent document evidence',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
 const job=store.enqueue({namespace:'user:one',name:'proof.txt',mime:'text/plain',bytes:Buffer.from('synthetic private proof'),expiresAt:5000});store.close();
 const other=initializeVault(join(f.dir,'other.key'),{encryptedStateExists:false}),wrong=openDocumentJobStore(f.path,{vault:other,now:()=>1001});
 assert.throws(()=>wrong.claim());wrong.close();
 const reopened=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1001}),claim=reopened.claim();assert.equal(claim.id,job.id);
 assert.throws(()=>reopened.complete(job.id,claim.token,{text:'x'.repeat(4*1024**2)}),/job_result_too_large/);
 assert.equal(reopened.get(job.id,'user:one').status,'running');reopened.complete(job.id,claim.token,{text:'safe'});reopened.close();
});
