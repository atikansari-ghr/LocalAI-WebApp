import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeVault} from '../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../services/documents/structured-jobs.mjs';
import {prepareStructuredEvidence,assessStructuredCandidates} from '../services/documents/structured-extract.mjs';

const schema={schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'}},required:['invoice']}};
const report={document:{sha256:'a'.repeat(64)},units:[{text:'Private invoice INV-42',source:{kind:'text',offset:0}}]};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'localai-structured-jobs-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'structured.sqlite'),vault:initializeVault(join(dir,'master.key'),{encryptedStateExists:false})};}
const request=(overrides={})=>({namespace:'app:one',scope:'private',idempotencyKey:'structured_key_12345',report,schema,expiresAt:5000,...overrides});

test('structured requests and cited results remain encrypted, owner-scoped and idempotent across reopen',t=>{
 const f=fixture(t),store=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1000});
 const job=store.enqueue(request());assert.equal(job.status,'queued');
 assert.equal(store.enqueue(request()).id,job.id);
 assert.throws(()=>store.enqueue(request({report:{...report,units:[{...report.units[0],text:'Different secret INV-43'}]}})),/structured_idempotency_conflict/);
 assert.equal(store.get(job.id,'app:two','private'),null);
 const claim=store.claim();assert.equal(claim.id,job.id);assert.equal(claim.report.document.sha256,report.document.sha256);assert.equal(claim.report.units[0].text,report.units[0].text);assert.equal(claim.report.units[0].source.documentSha256,report.document.sha256);
 const candidate=JSON.stringify({fields:{invoice:[{value:'INV-42',evidenceIds:['u0001']}]}});
 const result=assessStructuredCandidates(schema,prepareStructuredEvidence(report),candidate);
 store.complete(job.id,claim.token,candidate);store.close();
 const raw=Buffer.concat(readdirSync(f.dir).filter(name=>name.startsWith('structured.sqlite')).map(name=>readFileSync(join(f.dir,name)))).toString('utf8');
 for(const secret of ['Private invoice INV-42','structured_key_12345','INV-42'])assert.equal(raw.includes(secret),false);
 const reopened=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1001});
 assert.deepEqual(reopened.result(job.id,'app:one','private'),JSON.parse(JSON.stringify(result)));
 assert.equal(reopened.result(job.id,'app:two','private'),null);
 assert.equal(reopened.result(job.id,'app:one','other'),null);
 assert.equal(reopened.enqueue(request()).id,job.id);reopened.close();
});

test('interrupted structured inference stays claimed until recovery is confirmed and then records failure',t=>{
 const f=fixture(t),store=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1000}),job=store.enqueue(request()),claim=store.claim();store.close();
 const reopened=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1001});
 assert.equal(reopened.claim(),null);
 assert.throws(()=>reopened.recoverInterrupted(),/interactive_recovery_required/);
 assert.equal(reopened.get(job.id,'app:one','private').status,'running');
 assert.equal(reopened.recoverInterrupted({interactiveRecoveryConfirmed:true}),1);
 assert.deepEqual({status:reopened.get(job.id,'app:one','private').status,errorCode:reopened.get(job.id,'app:one','private').errorCode},{status:'failed',errorCode:'structured_interrupted'});
 assert.throws(()=>reopened.complete(job.id,claim.token,{reviewRequired:true}),/structured_claim_invalid/);reopened.close();
});

test('structured queue rejects invalid evidence and foreign database before mutation',t=>{
 const f=fixture(t),db=new DatabaseSync(f.path);db.exec('CREATE TABLE foreign_table (x TEXT)');db.close();if(process.platform!=='win32')chmodSync(f.path,0o600);
 const before=readFileSync(f.path);
 assert.throws(()=>openStructuredJobStore(f.path,{vault:f.vault}),/structured_schema_incompatible/);
 assert.deepEqual(readFileSync(f.path),before);
 const other=fixture(t),store=openStructuredJobStore(other.path,{vault:other.vault,now:()=>1000});
 assert.throws(()=>store.enqueue(request({report:{document:{sha256:'b'.repeat(64)},units:[{text:'x',source:{documentSha256:'a'.repeat(64)}}]}})),/invalid_structured_evidence/);
 assert.throws(()=>store.enqueue(request({schema:{...schema,schema:{...schema.schema,additionalProperties:true}}})),/invalid_document_schema/);
 assert.equal(store.claim(),null);store.close();
});

test('expired structured content becomes unreadable and can be purged after claims settle',t=>{
 const f=fixture(t);let current=1000;const store=openStructuredJobStore(f.path,{vault:f.vault,now:()=>current});
 const complete=store.enqueue(request({expiresAt:2000})),claim=store.claim();
 store.complete(complete.id,claim.token,'{"fields":{}}');
 const running=store.enqueue(request({idempotencyKey:'running_key_12345',expiresAt:2000}));store.claim();
 current=2001;
 assert.equal(store.get(complete.id,'app:one','private'),null);
 assert.equal(store.result(complete.id,'app:one','private'),null);
 assert.equal(store.purgeExpired(),1);
 assert.equal(store.get(running.id,'app:one','private'),null);
 assert.equal(store.recoverInterrupted({interactiveRecoveryConfirmed:true}),1);
 assert.equal(store.purgeExpired(),1);store.close();
});

test('completion rejects invented citations and values even from a valid claim',t=>{
 const f=fixture(t),store=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1000}),job=store.enqueue(request()),claim=store.claim();
 assert.throws(()=>store.complete(job.id,claim.token,{schemaId:'invoice',revision:1,reviewRequired:true,fields:{invoice:{status:'found',value:'FABRICATED',candidates:[{value:'FABRICATED',evidenceIds:['u0001'],sources:[{documentSha256:'a'.repeat(64)}]}]}}}),/structured_result_invalid/);
 assert.equal(store.get(job.id,'app:one','private').status,'running');store.close();
});

test('serialization cannot replace evidence after validation',t=>{
 const f=fixture(t),store=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1000});
 const deceptive={...report,toJSON(){return {document:{sha256:'b'.repeat(64)},units:[{text:'Forged INV-99',source:{documentSha256:'a'.repeat(64)}}]};}};
 store.enqueue(request({report:deceptive}));const claim=store.claim();
 assert.equal(claim.report.document.sha256,'a'.repeat(64));
 assert.equal(claim.report.units[0].text,'Private invoice INV-42');
 assert.equal(JSON.stringify(claim.report).includes('Forged INV-99'),false);store.close();
});
