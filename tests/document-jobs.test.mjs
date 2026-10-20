import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {initializeVault,openVault} from '../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../services/documents/jobs.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'localai-document-jobs-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:false});
 return {dir,path:join(dir,'jobs.sqlite'),vault};
}
const submission=(overrides={})=>({namespace:'app:one',scope:'private',kind:'extract',idempotencyKey:'example_key_12345',name:'x.txt',mime:'text/plain',bytes:Buffer.from('x'),expiresAt:5000,...overrides});
test('Document jobs persist encrypted input and completed results across reopen without crossing namespaces',t=>{
 const f=fixture(t);
  const store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
  const job=store.enqueue(submission({name:'Private notes.txt',bytes:Buffer.from('PRIVATE DOCUMENT BODY')}));
  assert.equal(job.status,'queued');assert.equal(store.get(job.id,'app:two','private'),null);assert.equal(store.get(job.id,'app:one','other'),null);
  const claim=store.claim();assert.equal(claim.id,job.id);assert.equal(claim.name,'Private notes.txt');assert.equal(claim.bytes.toString(),'PRIVATE DOCUMENT BODY');
  store.complete(job.id,claim.token,{text:'PRIVATE EXTRACTED TEXT'},{nativeCleanupConfirmed:true});store.close();
  const raw=Buffer.concat(readdirSync(f.dir).filter(name=>name.startsWith('jobs.sqlite')).map(name=>readFileSync(join(f.dir,name)))).toString('utf8');
  for(const secret of ['PRIVATE DOCUMENT BODY','Private notes.txt','PRIVATE EXTRACTED TEXT'])assert.equal(raw.includes(secret),false);
  const reopened=openDocumentJobStore(f.path,{vault:openVault(join(f.dir,'master.key')),now:()=>1001});
  assert.deepEqual(reopened.result(job.id,'app:one','private'),{text:'PRIVATE EXTRACTED TEXT'});assert.equal(reopened.result(job.id,'app:two','private'),null);assert.equal(reopened.result(job.id,'app:one','other'),null);reopened.close();
});
test('A restart does not reclaim an active job until native cleanup is explicitly confirmed',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
 const first=store.enqueue(submission({namespace:'user:one',name:'scan.pdf',mime:'application/pdf',bytes:Buffer.from('synthetic')})),claim=store.claim();
 store.close();const reopened=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1001});assert.equal(reopened.claim(),null);
 assert.throws(()=>reopened.recoverInterrupted({nativeCleanupConfirmed:false}),/native_cleanup_required/);
 assert.equal(reopened.recoverInterrupted({nativeCleanupConfirmed:true}),1);assert.equal(reopened.get(first.id,'user:one','private').status,'failed');
 assert.throws(()=>reopened.complete(first.id,claim.token,{text:'late'},{nativeCleanupConfirmed:true}),/job_claim_invalid/);reopened.close();
});
test('Document job claims, cancellation, expiry and result caps fail closed',t=>{
 const f=fixture(t);let now=1000;const store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>now});
 assert.throws(()=>store.enqueue(submission({namespace:'../other'})),/invalid_job/);
 const job=store.enqueue(submission());
 assert.equal(store.cancel(job.id,'app:two','private'),false);assert.equal(store.cancel(job.id,'app:one','other'),false);const claim=store.claim();
 assert.throws(()=>store.complete(job.id,'wrong',{text:'x'}),/job_claim_invalid/);
 assert.equal(store.cancel(job.id,'app:one','private'),true);
 assert.equal(store.get(job.id,'app:one','private').status,'cancelling');
 assert.throws(()=>store.complete(job.id,claim.token,{text:'late'},{nativeCleanupConfirmed:true}),/job_claim_invalid/);
 now=5001;assert.equal(store.purgeExpired(),0);assert.equal(store.get(job.id,'app:one','private').status,'cancelling');
 store.finishCancellation(job.id,claim.token,{nativeCleanupConfirmed:true});assert.equal(store.get(job.id,'app:one','private').status,'cancelled');
 assert.equal(store.purgeExpired(),1);assert.equal(store.get(job.id,'app:one','private'),null);store.close();
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
 const job=store.enqueue(submission({namespace:'user:one',name:'proof.txt',bytes:Buffer.from('synthetic private proof')}));store.close();
 const other=initializeVault(join(f.dir,'other.key'),{encryptedStateExists:false}),wrong=openDocumentJobStore(f.path,{vault:other,now:()=>1001});
 assert.throws(()=>wrong.claim());wrong.close();
 const reopened=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1001}),claim=reopened.claim();assert.equal(claim.id,job.id);
 assert.throws(()=>reopened.complete(job.id,claim.token,{text:'x'.repeat(4*1024**2)},{nativeCleanupConfirmed:true}),/job_result_too_large/);
 assert.equal(reopened.get(job.id,'user:one','private').status,'running');reopened.complete(job.id,claim.token,{text:'safe'},{nativeCleanupConfirmed:true});reopened.close();
});
test('Idempotency is bound to namespace, scope, operation and exact request bytes across restart',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000}),first=store.enqueue(submission());
 assert.equal(store.enqueue(submission()).id,first.id);
 assert.throws(()=>store.enqueue(submission({bytes:Buffer.from('different')})),/job_idempotency_conflict/);
 assert.throws(()=>store.enqueue(submission({name:'changed.txt'})),/job_idempotency_conflict/);
 const otherScope=store.enqueue(submission({scope:'shared'})),otherKind=store.enqueue(submission({kind:'ocr'})),otherApp=store.enqueue(submission({namespace:'app:two'}));
 for(const job of [otherScope,otherKind,otherApp])assert.notEqual(job.id,first.id);
 assert.equal(store.get(otherScope.id,'app:one','private'),null);store.close();
 const reopened=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1001});assert.equal(reopened.enqueue(submission()).id,first.id);reopened.close();
});
test('An expired idempotency key can be reused only after its prior job is inactive',t=>{
 const f=fixture(t);let now=1000;const store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>now}),old=store.enqueue(submission());
 now=5001;assert.notEqual(store.enqueue(submission({expiresAt:9000})).id,old.id);
 const claim=store.claim();now=9001;assert.throws(()=>store.enqueue(submission({expiresAt:13000})),/job_in_progress_cleanup/);
 store.cancel(claim.id,'app:one','private');store.finishCancellation(claim.id,claim.token,{nativeCleanupConfirmed:true});
 assert.notEqual(store.enqueue(submission({expiresAt:13000})).id,claim.id);store.close();
});
test('Database fingerprints do not permit offline guesses of document bytes or idempotency keys',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000}),input=submission({name:'private.txt',bytes:Buffer.from('family answer YES')});store.enqueue(input);store.close();
 const db=new DatabaseSync(f.path,{readOnly:true}),row=db.prepare('SELECT request_hash,idempotency_hash FROM document_jobs').get();db.close();
 const guessedYes=createHash('sha256').update(JSON.stringify({name:input.name,mime:input.mime,options:{ocr:'auto',language:'auto'}})).update(input.bytes).digest('hex');
 const guessedNo=createHash('sha256').update(JSON.stringify({name:input.name,mime:input.mime,options:{ocr:'auto',language:'auto'}})).update(Buffer.from('family answer NO')).digest('hex');
 assert.notEqual(row.request_hash,guessedYes);assert.notEqual(row.request_hash,guessedNo);
 assert.notEqual(row.idempotency_hash,createHash('sha256').update(input.idempotencyKey).digest('hex'));
});
test('A claim cannot finalize before native worker cleanup is confirmed',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
 const first=store.enqueue(submission()),claim=store.claim();
 assert.throws(()=>store.complete(first.id,claim.token,{text:'unsafe'}),/native_cleanup_required/);
 assert.equal(store.get(first.id,'app:one','private').status,'running');
 store.complete(first.id,claim.token,{text:'safe'},{nativeCleanupConfirmed:true});
 const second=store.enqueue(submission({idempotencyKey:'another_key_12345'})),cancelClaim=store.claim();
 store.cancel(second.id,'app:one','private');
 assert.throws(()=>store.finishCancellation(second.id,cancelClaim.token),/native_cleanup_required/);
 assert.equal(store.get(second.id,'app:one','private').status,'cancelling');
 store.finishCancellation(second.id,cancelClaim.token,{nativeCleanupConfirmed:true});
 assert.equal(store.get(second.id,'app:one','private').status,'cancelled');store.close();
});
test('A stopped worker failure persists only for its live claim',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000});
 const job=store.enqueue(submission()),claim=store.claim();
 assert.throws(()=>store.fail(job.id,claim.token,'document_worker_failed'),/native_cleanup_required/);
 assert.throws(()=>store.fail(job.id,'wrong','document_worker_failed',{nativeCleanupConfirmed:true}),/job_claim_invalid/);
 assert.throws(()=>store.fail(job.id,claim.token,'private details: secret',{nativeCleanupConfirmed:true}),/job_error_invalid/);
 assert.equal(store.get(job.id,'app:one','private').status,'running');
 store.fail(job.id,claim.token,'document_worker_failed',{nativeCleanupConfirmed:true});
 assert.deepEqual({status:store.get(job.id,'app:one','private').status,error:store.get(job.id,'app:one','private').errorCode},{status:'failed',error:'document_worker_failed'});
 assert.throws(()=>store.complete(job.id,claim.token,{text:'late'},{nativeCleanupConfirmed:true}),/job_claim_invalid/);
 store.close();const reopened=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1001});
 assert.equal(reopened.get(job.id,'app:one','private').errorCode,'document_worker_failed');reopened.close();
});
test('Cancellation cannot be overwritten by a late worker failure',t=>{
 const f=fixture(t),store=openDocumentJobStore(f.path,{vault:f.vault,now:()=>1000}),job=store.enqueue(submission()),claim=store.claim();
 store.cancel(job.id,'app:one','private');
 assert.throws(()=>store.fail(job.id,claim.token,'document_worker_failed',{nativeCleanupConfirmed:true}),/job_claim_invalid/);
 store.finishCancellation(job.id,claim.token,{nativeCleanupConfirmed:true});
 assert.equal(store.get(job.id,'app:one','private').status,'cancelled');store.close();
});
