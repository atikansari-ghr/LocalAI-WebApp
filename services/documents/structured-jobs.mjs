import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {chmodSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {validateDocumentSchema} from './schema.mjs';
import {prepareStructuredEvidence,assessStructuredCandidates} from './structured-extract.mjs';

const APPLICATION_ID=0x4c414953; // LAIS, separate from document jobs and account state.
const TABLE_SQL=`CREATE TABLE structured_jobs (
 id TEXT PRIMARY KEY, namespace TEXT NOT NULL, scope TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','complete','failed')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 key_envelope TEXT NOT NULL, input_nonce BLOB NOT NULL, input_body BLOB NOT NULL, input_tag BLOB NOT NULL,
 claim_hash TEXT, result_nonce BLOB, result_body BLOB, result_tag BLOB, error_code TEXT
) STRICT`;
const QUEUE_SQL='CREATE INDEX structured_jobs_queue ON structured_jobs(status,created_at)';
const IDEMPOTENCY_SQL='CREATE UNIQUE INDEX structured_jobs_idempotency ON structured_jobs(namespace,scope,idempotency_hash)';
const invalid=code=>new Error(code);
const validNamespace=value=>typeof value==='string'&&/^(?:app|user):[A-Za-z0-9_-]{1,128}$/.test(value);
const validScope=value=>typeof value==='string'&&/^[-a-zA-Z0-9_.:]{1,128}$/.test(value);
const visible=row=>row?Object.freeze({id:row.id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at,errorCode:row.error_code}):null;
function encrypt(key,id,kind,data){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(id+':'+kind));return {nonce,body:Buffer.concat([cipher.update(data),cipher.final()]),tag:cipher.getAuthTag()};}
function decrypt(key,id,kind,nonce,body,tag){const cipher=createDecipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(id+':'+kind));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(body),cipher.final()]);}

// Private candidate queue. Inference and interactive admission remain in the caller.
export function openStructuredJobStore(path,{vault,now=Date.now}={}){
 if(typeof path!=='string'||!path||!vault||['seal','open','digest'].some(name=>typeof vault[name]!=='function')||typeof now!=='function')throw new TypeError('invalid_structured_store');
 const absolute=resolve(path),parent=lstatSync(dirname(absolute));
 if(!parent.isDirectory()||process.platform!=='win32'&&(parent.mode&0o077)!==0)throw invalid('unsafe_structured_directory');
 let exists=false;try{const state=lstatSync(absolute);if(!state.isFile()||process.platform!=='win32'&&(state.mode&0o077)!==0)throw invalid('unsafe_structured_database');exists=true;}catch(error){if(error?.code!=='ENOENT')throw error;}
 function verifyIdentity(db){
  if(db.prepare('PRAGMA application_id').get().application_id!==APPLICATION_ID||db.prepare('PRAGMA user_version').get().user_version!==1)throw invalid('structured_schema_incompatible');
  const objects=db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','view','trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const expected=[['structured_jobs',TABLE_SQL],['structured_jobs_idempotency',IDEMPOTENCY_SQL],['structured_jobs_queue',QUEUE_SQL]];
  if(objects.length!==expected.length||objects.some((row,index)=>row.name!==expected[index][0]||row.sql!==expected[index][1]))throw invalid('structured_schema_incompatible');
 }
 if(exists){const check=new DatabaseSync(absolute,{readOnly:true,allowExtension:false});try{verifyIdentity(check);}finally{check.close();}}
 const db=new DatabaseSync(absolute,{timeout:5000,enableForeignKeyConstraints:true,allowExtension:false});
 try{
  if(process.platform!=='win32')chmodSync(absolute,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
  if(!exists){db.exec('BEGIN IMMEDIATE');try{db.exec(TABLE_SQL+';'+QUEUE_SQL+';'+IDEMPOTENCY_SQL+';PRAGMA application_id='+APPLICATION_ID+';PRAGMA user_version=1;');db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
  verifyIdentity(db);
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw invalid('structured_store_corrupt');
 }catch(error){db.close();throw error;}
 const keyFor=row=>Buffer.from(vault.open(row.key_envelope,'structured-job-key:'+row.id),'base64url');
 const select=db.prepare('SELECT * FROM structured_jobs WHERE id=? AND namespace=? AND scope=?');
 const capabilityFor=(id,namespace,scope)=>vault.digest(JSON.stringify([id,namespace,scope]),'structured-claim-capability-v1');
 const receipt=row=>Object.freeze({...visible(row),claimCapability:capabilityFor(row.id,row.namespace,row.scope)});
 function transaction(work){db.exec('BEGIN IMMEDIATE');try{const value=work();db.exec('COMMIT');return value;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
 function take(row,at){
  if(!row)return null;
  const input=JSON.parse(decrypt(keyFor(row),row.id,'input',row.input_nonce,row.input_body,row.input_tag).toString('utf8'));
  const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
  const changed=db.prepare("UPDATE structured_jobs SET status='running',claim_hash=?,updated_at=? WHERE id=? AND status='queued' AND expires_at>?").run(hash,at,row.id,at).changes;
  if(changed!==1)throw invalid('structured_claim_conflict');
  return Object.freeze({id:row.id,namespace:row.namespace,scope:row.scope,report:input.report,schema:input.schema,token});
 }
 return Object.freeze({
  enqueue({namespace,scope,idempotencyKey,report,schema:input,expiresAt}={}){
   const at=now();if(!validNamespace(namespace)||!validScope(scope)||typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)||!Number.isSafeInteger(at)||!Number.isSafeInteger(expiresAt)||expiresAt<=at||expiresAt>at+7*86400000)throw new TypeError('invalid_structured_job');
   const schema=validateDocumentSchema(input),evidence=prepareStructuredEvidence(report);
   const digest=evidence[0].source.documentSha256;
   if(evidence.some(unit=>unit.source.documentSha256!==digest))throw invalid('invalid_structured_evidence');
   const normalizedReport={document:{sha256:digest},units:evidence.map(unit=>({text:unit.text,source:unit.source}))};
   prepareStructuredEvidence(normalizedReport);
   const payload=Buffer.from(JSON.stringify({report:normalizedReport,schema}));if(payload.length>131072)throw invalid('structured_input_too_large');
   const requestHash=vault.digest(payload.toString('base64url'),'structured-request-v1');
   const idempotencyHash=vault.digest(JSON.stringify([namespace,scope,idempotencyKey]),'structured-idempotency-v1');
   return transaction(()=>{
    const prior=db.prepare('SELECT * FROM structured_jobs WHERE namespace=? AND scope=? AND idempotency_hash=?').get(namespace,scope,idempotencyHash);
    if(prior){
     if(prior.expires_at<=at){if(prior.status==='running')throw invalid('structured_in_progress_cleanup');db.prepare('DELETE FROM structured_jobs WHERE id=?').run(prior.id);}
     else{if(prior.request_hash!==requestHash)throw invalid('structured_idempotency_conflict');return visible(prior);}
    }
    const id=randomUUID(),key=randomBytes(32),sealed=encrypt(key,id,'input',payload),envelope=vault.seal(key.toString('base64url'),'structured-job-key:'+id);
    db.prepare('INSERT INTO structured_jobs(id,namespace,scope,idempotency_hash,request_hash,status,created_at,updated_at,expires_at,key_envelope,input_nonce,input_body,input_tag) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,namespace,scope,idempotencyHash,requestHash,'queued',at,at,expiresAt,envelope,sealed.nonce,sealed.body,sealed.tag);
    return receipt(select.get(id,namespace,scope));
   });
  },
  get(id,namespace,scope){if(!validNamespace(namespace)||!validScope(scope))return null;const row=select.get(id,namespace,scope);return row?.expires_at>now()?visible(row):null;},
  // Root-owned startup/scheduler use only. Never expose this enumeration on
  // the group-accessible supervisor socket or a public HTTP response.
  pendingReceipts({limit=32}={}){
   if(!Number.isSafeInteger(limit)||limit<1||limit>128)throw new TypeError('invalid_structured_receipt_limit');
   return Object.freeze(db.prepare("SELECT id,namespace,scope FROM structured_jobs WHERE status='queued' AND expires_at>? ORDER BY created_at,id LIMIT ?").all(now(),limit).map(row=>Object.freeze({id:row.id,namespace:row.namespace,scope:row.scope,claimCapability:capabilityFor(row.id,row.namespace,row.scope)})));
  },
  claimOwned({id,namespace,scope,claimCapability}={}){
   if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||!validNamespace(namespace)||!validScope(scope)||typeof claimCapability!=='string'||!/^[a-f0-9]{64}$/.test(claimCapability))return null;
   if(!timingSafeEqual(Buffer.from(claimCapability,'hex'),Buffer.from(capabilityFor(id,namespace,scope),'hex')))return null;
   return transaction(()=>{const at=now();return take(db.prepare("SELECT * FROM structured_jobs WHERE id=? AND namespace=? AND scope=? AND status='queued' AND expires_at>?").get(id,namespace,scope,at),at);});
  },
  complete(id,token,modelText){
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid('structured_claim_invalid');
   return transaction(()=>{
    const hash=createHash('sha256').update(token).digest('hex'),row=db.prepare("SELECT * FROM structured_jobs WHERE id=? AND status='running' AND claim_hash=?").get(id,hash);if(!row)throw invalid('structured_claim_invalid');
    if(row.expires_at<=now())throw invalid('structured_job_expired');
    const input=JSON.parse(decrypt(keyFor(row),id,'input',row.input_nonce,row.input_body,row.input_tag).toString('utf8'));
    let result;try{result=assessStructuredCandidates(input.schema,prepareStructuredEvidence(input.report),modelText);}catch{throw invalid('structured_result_invalid');}
    const encoded=Buffer.from(JSON.stringify(result));if(encoded.length>131072)throw invalid('structured_result_invalid');
    const sealed=encrypt(keyFor(row),id,'result',encoded);
    db.prepare("UPDATE structured_jobs SET status='complete',claim_hash=NULL,result_nonce=?,result_body=?,result_tag=?,updated_at=? WHERE id=? AND status='running' AND claim_hash=?").run(sealed.nonce,sealed.body,sealed.tag,now(),id,hash);
    return visible(select.get(id,row.namespace,row.scope));
   });
  },
  result(id,namespace,scope){if(!validNamespace(namespace)||!validScope(scope))return null;const row=select.get(id,namespace,scope);if(!row||row.status!=='complete'||row.expires_at<=now())return null;return JSON.parse(decrypt(keyFor(row),id,'result',row.result_nonce,row.result_body,row.result_tag).toString('utf8'));},
  recoverInterrupted({interactiveRecoveryConfirmed}={}){if(interactiveRecoveryConfirmed!==true)throw invalid('interactive_recovery_required');return db.prepare("UPDATE structured_jobs SET status='failed',claim_hash=NULL,error_code='structured_interrupted',updated_at=? WHERE status='running'").run(now()).changes;},
  purgeExpired(){return db.prepare("DELETE FROM structured_jobs WHERE expires_at<=? AND status!='running'").run(now()).changes;},
  close(){db.close();}
 });
}
