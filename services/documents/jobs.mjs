import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {lstatSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

const MAX_INPUT=10*1024**2,MAX_RESULT=4*1024**2;
const APPLICATION_ID=0x4c41494a; // LAIJ, distinct from the enrolled account database.
const TABLE_SQL=`CREATE TABLE document_jobs (
   id TEXT PRIMARY KEY, namespace TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL,
   idempotency_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('queued','running','cancelling','complete','failed','cancelled')),
   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
   key_envelope TEXT NOT NULL, input_nonce BLOB NOT NULL, input_body BLOB NOT NULL, input_tag BLOB NOT NULL,
   claim_hash TEXT, result_nonce BLOB, result_body BLOB, result_tag BLOB, error_code TEXT
  ) STRICT`;
const INDEX_SQL='CREATE INDEX document_jobs_queue ON document_jobs(status,created_at)';
const IDEMPOTENCY_SQL='CREATE UNIQUE INDEX document_jobs_idempotency ON document_jobs(namespace,scope,kind,idempotency_hash)';
const invalid=code=>new Error(code);
function encrypt(key,id,kind,data){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(id+':'+kind));return {nonce,body:Buffer.concat([cipher.update(data),cipher.final()]),tag:cipher.getAuthTag()};}
function decrypt(key,id,kind,nonce,body,tag){const cipher=createDecipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(id+':'+kind));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(body),cipher.final()]);}
function validNamespace(value){return typeof value==='string'&&/^(?:app|user):[A-Za-z0-9_-]{1,128}$/.test(value);}
function validScope(value){return typeof value==='string'&&/^[-a-zA-Z0-9_.:]{1,128}$/.test(value);}
function visible(row){return row?Object.freeze({id:row.id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,expiresAt:row.expires_at,errorCode:row.error_code}):null;}

// Private candidate store. Its schema and encrypted payloads are separate from enrolled account state.
export function openDocumentJobStore(path,{vault,now=Date.now}={}){
 if(typeof path!=='string'||!path||!vault||typeof vault.seal!=='function'||typeof vault.open!=='function'||typeof vault.digest!=='function'||typeof now!=='function')throw new TypeError('Invalid job store configuration');
 const absolute=resolve(path),parent=lstatSync(dirname(absolute));
 if(!parent.isDirectory()||(process.platform!=='win32'&&(parent.mode&0o077)!==0))throw invalid('unsafe_job_directory');
 let exists=false;try{const existing=lstatSync(absolute);if(!existing.isFile()||(process.platform!=='win32'&&(existing.mode&0o077)!==0))throw invalid('unsafe_job_database');exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 function verifyIdentity(connection){
  if(connection.prepare('PRAGMA application_id').get().application_id!==APPLICATION_ID||connection.prepare('PRAGMA user_version').get().user_version!==1)throw invalid('job_schema_incompatible');
  const objects=connection.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','view','trigger','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if(objects.length!==3||objects[0].name!=='document_jobs'||objects[0].sql!==TABLE_SQL||objects[1].name!=='document_jobs_idempotency'||objects[1].sql!==IDEMPOTENCY_SQL||objects[2].name!=='document_jobs_queue'||objects[2].sql!==INDEX_SQL)throw invalid('job_schema_incompatible');
 }
 if(exists){const inspect=new DatabaseSync(absolute,{readOnly:true,allowExtension:false});try{verifyIdentity(inspect);}finally{inspect.close();}}
 const db=new DatabaseSync(absolute,{timeout:5000,enableForeignKeyConstraints:true,allowExtension:false});
 try{
  if(process.platform!=='win32')chmodSync(absolute,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
  if(!exists){db.exec('BEGIN IMMEDIATE');try{db.exec(TABLE_SQL+';'+INDEX_SQL+';'+IDEMPOTENCY_SQL+';PRAGMA application_id='+APPLICATION_ID+';PRAGMA user_version=1;');db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
  verifyIdentity(db);
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw invalid('job_store_corrupt');
 }catch(error){db.close();throw error;}
 const keyFor=row=>Buffer.from(vault.open(row.key_envelope,'document-job-key:'+row.id),'base64url');
 const select=db.prepare('SELECT * FROM document_jobs WHERE id=? AND namespace=? AND scope=?');
 function transaction(work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
 return Object.freeze({
  enqueue({namespace,scope,kind,idempotencyKey,name,mime,bytes,expiresAt,options={}}){
   const at=now();if(!validNamespace(namespace)||!validScope(scope)||!['ocr','extract'].includes(kind)||typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)||typeof name!=='string'||name.length<1||name.length>255||/[\\/\x00-\x1f\x7f]/.test(name)||typeof mime!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)||!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_INPUT||!Number.isSafeInteger(at)||!Number.isSafeInteger(expiresAt)||expiresAt<=at||expiresAt>at+7*86400000||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['ocr','language'].includes(key))||!['auto','off','all'].includes(options.ocr??'auto')||!['auto','en','ar'].includes(options.language??'auto'))throw new TypeError('invalid_job');
   const normalizedOptions={ocr:options.ocr??'auto',language:options.language??'auto'},bytesHash=createHash('sha256').update(bytes).digest('hex');
   const requestHash=vault.digest(JSON.stringify([name,mime,normalizedOptions,bytesHash]),'document-request-v1');
   const idempotencyHash=vault.digest(JSON.stringify([namespace,scope,kind,idempotencyKey]),'document-idempotency-v1');
   return transaction(()=>{
    const prior=db.prepare('SELECT * FROM document_jobs WHERE namespace=? AND scope=? AND kind=? AND idempotency_hash=?').get(namespace,scope,kind,idempotencyHash);
    if(prior){
     if(prior.expires_at<=at){if(['running','cancelling'].includes(prior.status))throw invalid('job_in_progress_cleanup');db.prepare('DELETE FROM document_jobs WHERE id=?').run(prior.id);}
     else{if(prior.request_hash!==requestHash)throw invalid('job_idempotency_conflict');return visible(prior);}
    }
    const id=randomUUID(),key=randomBytes(32),payload=Buffer.from(JSON.stringify({name,mime,options:normalizedOptions,bytes:bytes.toString('base64')})),sealed=encrypt(key,id,'input',payload),envelope=vault.seal(key.toString('base64url'),'document-job-key:'+id);
    db.prepare('INSERT INTO document_jobs(id,namespace,scope,kind,idempotency_hash,request_hash,status,created_at,updated_at,expires_at,key_envelope,input_nonce,input_body,input_tag) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,namespace,scope,kind,idempotencyHash,requestHash,'queued',at,at,expiresAt,envelope,sealed.nonce,sealed.body,sealed.tag);
    return visible(select.get(id,namespace,scope));
   });
  },
  get(id,namespace,scope){if(!validNamespace(namespace)||!validScope(scope))return null;return visible(select.get(id,namespace,scope));},
  claim(){return transaction(()=>{
   const row=db.prepare("SELECT * FROM document_jobs WHERE status='queued' AND expires_at>? ORDER BY created_at,id LIMIT 1").get(now());if(!row)return null;
   const payload=JSON.parse(decrypt(keyFor(row),row.id,'input',row.input_nonce,row.input_body,row.input_tag).toString('utf8'));
   const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex'),at=now();
   db.prepare("UPDATE document_jobs SET status='running',claim_hash=?,updated_at=? WHERE id=? AND status='queued'").run(hash,at,row.id);
   return Object.freeze({id:row.id,namespace:row.namespace,scope:row.scope,kind:row.kind,name:payload.name,mime:payload.mime,options:payload.options,bytes:Buffer.from(payload.bytes,'base64'),token});
  });},
  complete(id,token,result,{nativeCleanupConfirmed}={}){
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid('job_claim_invalid');
   if(nativeCleanupConfirmed!==true)throw invalid('native_cleanup_required');
   const encoded=Buffer.from(JSON.stringify(result??null));if(encoded.length>MAX_RESULT)throw invalid('job_result_too_large');
   return transaction(()=>{const hash=createHash('sha256').update(token).digest('hex'),row=db.prepare("SELECT * FROM document_jobs WHERE id=? AND status='running' AND claim_hash=?").get(id,hash);if(!row)throw invalid('job_claim_invalid');
    const sealed=encrypt(keyFor(row),id,'result',encoded),change=db.prepare("UPDATE document_jobs SET status='complete',claim_hash=NULL,result_nonce=?,result_body=?,result_tag=?,updated_at=? WHERE id=? AND status='running' AND claim_hash=?").run(sealed.nonce,sealed.body,sealed.tag,now(),id,hash);if(change.changes!==1)throw invalid('job_claim_invalid');return visible(select.get(id,row.namespace,row.scope));});
  },
  result(id,namespace,scope){if(!validNamespace(namespace)||!validScope(scope))return null;const row=select.get(id,namespace,scope);if(!row||row.status!=='complete')return null;return JSON.parse(decrypt(keyFor(row),id,'result',row.result_nonce,row.result_body,row.result_tag).toString('utf8'));},
  cancel(id,namespace,scope){if(!validNamespace(namespace)||!validScope(scope))return false;return db.prepare("UPDATE document_jobs SET status=CASE status WHEN 'running' THEN 'cancelling' ELSE 'cancelled' END,updated_at=? WHERE id=? AND namespace=? AND scope=? AND status IN ('queued','running')").run(now(),id,namespace,scope).changes===1;},
  finishCancellation(id,token,{nativeCleanupConfirmed}={}){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid('job_claim_invalid');if(nativeCleanupConfirmed!==true)throw invalid('native_cleanup_required');const hash=createHash('sha256').update(token).digest('hex');if(db.prepare("UPDATE document_jobs SET status='cancelled',claim_hash=NULL,updated_at=? WHERE id=? AND claim_hash=? AND status='cancelling'").run(now(),id,hash).changes!==1)throw invalid('job_claim_invalid');},
  recoverInterrupted({nativeCleanupConfirmed}={}){if(nativeCleanupConfirmed!==true)throw invalid('native_cleanup_required');return db.prepare("UPDATE document_jobs SET status=CASE status WHEN 'cancelling' THEN 'cancelled' ELSE 'failed' END,claim_hash=NULL,error_code=CASE status WHEN 'running' THEN 'interrupted_after_restart' ELSE NULL END,updated_at=? WHERE status IN ('running','cancelling')").run(now()).changes;},
  purgeExpired(){return db.prepare("DELETE FROM document_jobs WHERE expires_at<=? AND status NOT IN ('running','cancelling')").run(now()).changes;},
  close(){db.close();}
 });
}
