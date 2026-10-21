import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeVault} from '../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../services/documents/structured-jobs.mjs';

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
 const claim=store.claim();assert.equal(claim.id,job.id);assert.deepEqual(claim.report,report);
 const result={schemaId:'invoice',revision:1,fields:{invoice:{status:'found',value:'INV-42',candidates:[{value:'INV-42',evidenceIds:['u0001'],sources:[{kind:'text',offset:0,documentSha256:'a'.repeat(64)}]}]}},reviewRequired:true};
 store.complete(job.id,claim.token,result);store.close();
 const raw=Buffer.concat(readdirSync(f.dir).filter(name=>name.startsWith('structured.sqlite')).map(name=>readFileSync(join(f.dir,name)))).toString('utf8');
 for(const secret of ['Private invoice INV-42','structured_key_12345','INV-42'])assert.equal(raw.includes(secret),false);
 const reopened=openStructuredJobStore(f.path,{vault:f.vault,now:()=>1001});
 assert.deepEqual(reopened.result(job.id,'app:one','private'),result);
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
