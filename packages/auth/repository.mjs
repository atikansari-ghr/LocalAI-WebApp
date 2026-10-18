import { DatabaseSync } from 'node:sqlite';
import { openState } from '../database/index.mjs';
import { equalSecret } from './crypto.mjs';
export function openSecurityRepository(path){
 openState(path).close();
 const db=new DatabaseSync(path,{timeout:5000,enableForeignKeyConstraints:true,allowExtension:false});
 db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}};
 const audit=(at,action,actor,target,outcome)=>db.prepare('INSERT INTO audit_events(at,action,actor,target,outcome) VALUES (?,?,?,?,?)').run(at,action,actor,target,outcome);
 const userById=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
 return {
  state:()=>db.prepare('SELECT * FROM security_state WHERE id=1').get(),
  userByName:username=>db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND status='active'").get(username),
  userById,
  hasEncryptedState:()=>db.prepare('SELECT EXISTS(SELECT 1 FROM users) AS found').get().found===1,
  clearRate:key=>db.prepare('DELETE FROM auth_rate WHERE key=?').run(key),
  audit:(...args)=>audit(...args),
  auditRecords:()=>db.prepare('SELECT at,action,actor,target,outcome FROM audit_events ORDER BY id').all(),
  hitRate(key,now,limit,window){return transaction(()=>{
   db.prepare('DELETE FROM auth_rate WHERE window_start < ?').run(now-24*60*60*1000);
   const row=db.prepare('SELECT * FROM auth_rate WHERE key=?').get(key);
   if(!row||now-row.window_start>=window){db.prepare('INSERT INTO auth_rate(key,window_start,attempts) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,attempts=1').run(key,now);return true;}
   db.prepare('UPDATE auth_rate SET attempts=min(attempts+1,1000000) WHERE key=?').run(key);
   return row.attempts<limit;
  });},
  issueSetup(hash,expires,now){return transaction(()=>{
   const state=db.prepare('SELECT * FROM security_state WHERE id=1').get();
   if(state.status==='ready')throw new Error('Already initialized');
   db.prepare('UPDATE security_state SET status=?,setup_hash=?,setup_expires=?,enrollment_hash=NULL,enrollment_expires=NULL,pending_user=NULL WHERE id=1').run('new',hash,expires);
   if(state.pending_user)db.prepare("DELETE FROM users WHERE id=? AND status='pending'").run(state.pending_user);
   audit(now,'setup_code_issued',null,null,'success');
  });},
  beginSetup({codeHash,now,user,enrollmentHash,enrollmentExpires}){return transaction(()=>{
   const state=db.prepare('SELECT * FROM security_state WHERE id=1').get();
   if(state.status!=='new'||state.setup_expires<=now||!equalSecret(state.setup_hash,codeHash))throw new Error('Invalid setup');
   db.prepare("INSERT INTO users(id,username,password_hash,totp_secret,role,status) VALUES (?,?,?,?,'admin','pending')").run(user.id,user.username,user.passwordHash,user.totpSecret);
   db.prepare("UPDATE security_state SET status='pending',setup_hash=NULL,setup_expires=NULL,enrollment_hash=?,enrollment_expires=?,pending_user=? WHERE id=1").run(enrollmentHash,enrollmentExpires,user.id);
   audit(now,'setup_claimed',user.id,user.id,'success');
  });},
  completeSetup({hash,now,verify,recoveryHashes,session}){return transaction(()=>{
   const state=db.prepare('SELECT * FROM security_state WHERE id=1').get();
   if(state.status!=='pending'||state.enrollment_expires<=now||!equalSecret(state.enrollment_hash,hash))throw new Error('Invalid enrollment');
   const user=userById(state.pending_user),counter=verify(user);
   if(counter===null)throw new Error('Invalid MFA');
   db.prepare("UPDATE users SET status='active',totp_counter=? WHERE id=?").run(counter,user.id);
   for(const recovery of recoveryHashes)db.prepare('INSERT INTO recovery_codes(hash,user_id) VALUES (?,?)').run(recovery,user.id);
   db.prepare("UPDATE security_state SET status='ready',enrollment_hash=NULL,enrollment_expires=NULL,pending_user=NULL WHERE id=1").run();
   db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run(session.hash,user.id,now,now,session.expires,now,'password_totp');
   audit(now,'setup_completed',user.id,user.id,'success');return userById(user.id);
  });},
  login({id,now,verify,recoveryHash,session,passwordHash}){return transaction(()=>{
   const user=userById(id);if(!user||user.status!=='active')throw new Error('Invalid account');
   if(!equalSecret(user.password_hash,passwordHash))throw new Error('Credentials changed');
   if(recoveryHash){
    const deleted=db.prepare('DELETE FROM recovery_codes WHERE hash=? AND user_id=?').run(recoveryHash,id);
    if(deleted.changes!==1)throw new Error('Invalid recovery code');
   } else {
    const counter=verify(user);if(counter===null)throw new Error('Invalid MFA');
    db.prepare('UPDATE users SET totp_counter=? WHERE id=?').run(counter,id);
   }
   db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run(session.hash,id,now,now,session.expires,now,recoveryHash?'recovery':'password_totp');
   audit(now,recoveryHash?'recovery_login':'login',id,id,'success');return user;
  });},
  session(hash,now,idle){return transaction(()=>{
   const row=db.prepare("SELECT s.*,u.username,u.role,u.status FROM sessions s JOIN users u ON s.user_id=u.id WHERE token_hash=?").get(hash);
   if(!row||row.status!=='active'||row.expires<=now||row.last_seen+idle<=now){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);return null;}
   db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now,hash);return row;
  });},
  logout(hash,now){return transaction(()=>{const row=db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(hash);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);if(row)audit(now,'logout',row.user_id,row.user_id,'success');});},
  stepUp(hash,now,verify){return transaction(()=>{
   const session=db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash);
   if(!session||session.expires<=now)throw new Error('Invalid session');
   const user=userById(session.user_id);if(!user||user.status!=='active')throw new Error('Invalid account');
   const counter=verify(user);if(counter===null)throw new Error('Invalid MFA');
   db.prepare('UPDATE users SET totp_counter=? WHERE id=?').run(counter,user.id);
   db.prepare('UPDATE sessions SET step_up=? WHERE token_hash=?').run(now,hash);
   audit(now,'step_up',user.id,user.id,'success');
  });},
  createApplication(app,actor,now){return transaction(()=>{
   db.prepare('INSERT INTO applications(id,name,capabilities,networks,scopes,key_hash,expires) VALUES (?,?,?,?,?,?,?)').run(app.id,app.name,JSON.stringify(app.capabilities),JSON.stringify(app.networks),JSON.stringify(app.scopes),app.keyHash,app.expires);
   audit(now,'application_created',actor,app.id,'success');
  });},
  applicationByKey:hash=>db.prepare('SELECT * FROM applications WHERE key_hash=?').get(hash),
  applicationById:id=>db.prepare('SELECT * FROM applications WHERE id=?').get(id),
  rotateApplication(id,keyHash,actor,now){return transaction(()=>{
   if(db.prepare('UPDATE applications SET key_hash=? WHERE id=?').run(keyHash,id).changes!==1)throw new Error('Unknown application');
   audit(now,'application_key_rotated',actor,id,'success');
  });},
  revokeApplication(id,actor,now){return transaction(()=>{
   if(db.prepare('UPDATE applications SET key_hash=NULL,enabled=0 WHERE id=?').run(id).changes!==1)throw new Error('Unknown application');
   audit(now,'application_revoked',actor,id,'success');
  });},
  saveChallenge(row,now){return transaction(()=>{
   db.prepare('DELETE FROM auth_challenges WHERE expires<=?').run(now);
   if(db.prepare('SELECT count(*) n FROM auth_challenges').get().n>=128)throw new Error('Challenge capacity reached');
   db.prepare('INSERT INTO auth_challenges(id,user_id,kind,challenge,expires,session_hash) VALUES (?,?,?,?,?,?)').run(row.id,row.userId,row.kind,row.challenge,row.expires,row.sessionHash);
  });},
  consumeChallenge(id,kind,now,sessionHash=null){return transaction(()=>{
   const row=db.prepare('SELECT * FROM auth_challenges WHERE id=?').get(id);
   if(!row)return null;
   db.prepare('DELETE FROM auth_challenges WHERE id=?').run(id);
   return row.kind===kind&&row.expires>now&&row.session_hash===sessionHash?row:null;
  });},
  passkeysForUser:id=>db.prepare('SELECT id,transports FROM passkeys WHERE user_id=?').all(id),
  passkey:id=>db.prepare('SELECT * FROM passkeys WHERE id=?').get(id),
  registerPasskey(userId,credential,sessionHash,now){return transaction(()=>{
   const session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND user_id=?').get(sessionHash,userId),user=userById(userId);
   if(!session||session.expires<=now||session.last_seen+30*60000<=now||session.step_up+5*60000<now||user?.status!=='active')throw new Error('Fresh session required');
   db.prepare('INSERT INTO passkeys(id,user_id,public_key,counter,transports) VALUES (?,?,?,?,?)').run(credential.id,userId,credential.publicKey,credential.counter,JSON.stringify(credential.transports??[]));
   audit(now,'passkey_registered',userId,userId,'success');
  });},
  passkeyLogin({credentialId,expectedCounter,counter,session,now}){return transaction(()=>{
   const credential=db.prepare('SELECT * FROM passkeys WHERE id=?').get(credentialId),user=credential?userById(credential.user_id):null;
   if(!credential||user?.status!=='active'||credential.counter!==expectedCounter)throw new Error('Credential changed');
   if(counter!==0&&counter<=expectedCounter)throw new Error('Invalid signature counter');
   db.prepare('UPDATE passkeys SET counter=? WHERE id=?').run(counter,credentialId);
   db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?)').run(session.hash,user.id,now,now,session.expires,now,'passkey');
   audit(now,'passkey_login',user.id,user.id,'success');return user;
  });},
  close:()=>db.close()
 };
}
