import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openSecurityRepository} from '../packages/auth/repository.mjs';
import {initializeVault,totp,tokenDigest} from '../packages/auth/crypto.mjs';
import {createAuthService} from '../packages/auth/service.mjs';
import {DatabaseSync} from 'node:sqlite';
const password='correct horse battery staple';
async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'localai-totp-rotation-')),repo=openSecurityRepository(join(dir,'state.sqlite'));let now=1800000000000;
 t.after(()=>{repo.close();rmSync(dir,{recursive:true,force:true});});
 const vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:repo.hasEncryptedState()}),auth=createAuthService({repo,vault,now:()=>now});
 const setup=await auth.beginSetup({code:auth.issueSetupCode(),username:'admin',password,ip:'127.0.0.1'});
 const admin=auth.completeSetup({enrollmentToken:setup.enrollmentToken,code:totp(setup.totpSecret,now),ip:'127.0.0.1'});
 return {repo,vault,auth,admin,statePath:join(dir,'state.sqlite'),secret:setup.totpSecret,now:()=>now,advance:ms=>{now+=ms;}};
}
test('recovery sign-in can replace a lost authenticator and revoke old sessions and recovery codes',async t=>{
 const f=await fixture(t);
 const recovered=await f.auth.login({username:'admin',password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'});
 const pending=await f.auth.beginTotpRotation(recovered.token,recovered.csrf,{password,recoveryCode:f.admin.recoveryCodes[1],ip:'127.0.0.1'});
 assert.notEqual(pending.token,recovered.token);assert.throws(()=>f.auth.session(recovered.token));
 const result=f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,totp(pending.totpSecret,f.now()),'127.0.0.1');
 assert.equal(result.recoveryCodes.length,10);assert.notEqual(result.token,pending.token);
 assert.throws(()=>f.auth.session(f.admin.token));assert.throws(()=>f.auth.session(pending.token));
 assert.equal(f.auth.session(result.token).user.id,f.admin.user.id);
 await assert.rejects(f.auth.login({username:'admin',password,recoveryCode:f.admin.recoveryCodes[2],ip:'127.0.0.1'}));
 f.advance(30000);
 await assert.rejects(f.auth.login({username:'admin',password,code:totp(f.secret,f.now()),ip:'127.0.0.1'}));
 assert.equal((await f.auth.login({username:'admin',password,code:totp(pending.totpSecret,f.now()),ip:'127.0.0.1'})).user.id,f.admin.user.id);
 assert.throws(()=>f.auth.completeTotpRotation(result.token,result.csrf,pending.id,totp(pending.totpSecret,f.now()),'127.0.0.1'));
 assert.ok(!JSON.stringify(f.repo.auditRecords()).includes(pending.totpSecret));
});
test('replacement requires explicit credential proof and invalid new MFA does not replace the old authenticator',async t=>{
 const f=await fixture(t);
 const onlyCode=new DatabaseSync(f.statePath);try{onlyCode.prepare('DELETE FROM recovery_codes WHERE hash<>?').run(tokenDigest('recovery:'+f.admin.recoveryCodes[0]));}finally{onlyCode.close();}
 await assert.rejects(f.auth.beginTotpRotation(f.admin.token,'wrong',{password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'}));
 await assert.rejects(f.auth.beginTotpRotation(f.admin.token,f.admin.csrf,{password:'incorrect password',recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'}));
 const pending=await f.auth.beginTotpRotation(f.admin.token,f.admin.csrf,{password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'});
 assert.throws(()=>f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,'not-code','127.0.0.1'));
 assert.equal(f.vault.open(f.repo.userById(f.admin.user.id).totp_secret,'totp:'+f.admin.user.id),f.secret);
 assert.equal(f.auth.session(pending.token).user.id,f.admin.user.id);
 assert.equal(f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,totp(pending.totpSecret,f.now()),'127.0.0.1').recoveryCodes.length,10,'A typo must be retryable even after the final old recovery code was used');
});
test('replacement challenges reject other sessions and expiry without changing the authenticator',async t=>{
 const f=await fixture(t);
 const pending=await f.auth.beginTotpRotation(f.admin.token,f.admin.csrf,{password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'});
 const other=await f.auth.login({username:'admin',password,recoveryCode:f.admin.recoveryCodes[1],ip:'127.0.0.1'});
 assert.throws(()=>f.auth.completeTotpRotation(other.token,other.csrf,pending.id,totp(pending.totpSecret,f.now()),'127.0.0.1'));
 const retry=await f.auth.beginTotpRotation(other.token,other.csrf,{password,recoveryCode:f.admin.recoveryCodes[2],ip:'127.0.0.1'});
 f.advance(6*60000);
 assert.throws(()=>f.auth.completeTotpRotation(retry.token,retry.csrf,retry.id,totp(retry.totpSecret,f.now()),'127.0.0.1'));
 assert.equal(f.vault.open(f.repo.userById(f.admin.user.id).totp_secret,'totp:'+f.admin.user.id),f.secret);
});

test('a database failure rolls back authenticator session and recovery-code replacement together',async t=>{
 const f=await fixture(t);
 const pending=await f.auth.beginTotpRotation(f.admin.token,f.admin.csrf,{password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'});
 const db=new DatabaseSync(f.statePath);
 try{db.exec("CREATE TRIGGER block_recovery BEFORE INSERT ON recovery_codes BEGIN SELECT RAISE(ABORT,'synthetic disk-write failure'); END;");}finally{db.close();}
 assert.throws(()=>f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,totp(pending.totpSecret,f.now()),'127.0.0.1'));
 assert.equal(f.vault.open(f.repo.userById(f.admin.user.id).totp_secret,'totp:'+f.admin.user.id),f.secret);
 assert.equal(f.auth.session(pending.token).user.id,f.admin.user.id);
 assert.equal((await f.auth.login({username:'admin',password,recoveryCode:f.admin.recoveryCodes[1],ip:'127.0.0.1'})).user.id,f.admin.user.id);
 const repaired=new DatabaseSync(f.statePath);try{repaired.exec('DROP TRIGGER block_recovery');}finally{repaired.close();}
 assert.equal(f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,totp(pending.totpSecret,f.now()),'127.0.0.1').recoveryCodes.length,10,'Database recovery must allow retrying the same verified challenge');
});

test('revoking the original session while password verification runs prevents replacement setup',async t=>{
 const f=await fixture(t);
 const pending=f.auth.beginTotpRotation(f.admin.token,f.admin.csrf,{password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'});
 f.auth.logout(f.admin.token);
 await assert.rejects(pending);
 assert.equal(f.vault.open(f.repo.userById(f.admin.user.id).totp_secret,'totp:'+f.admin.user.id),f.secret);
});

test('new-authenticator guessing cannot bypass the persistent account budget by rotating IPs',async t=>{
 const f=await fixture(t);
 const pending=await f.auth.beginTotpRotation(f.admin.token,f.admin.csrf,{password,recoveryCode:f.admin.recoveryCodes[0],ip:'127.0.0.1'});
 for(let i=0;i<5;i++)assert.throws(()=>f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,'not-code','192.0.2.'+(i+1)));
 assert.throws(()=>f.auth.completeTotpRotation(pending.token,pending.csrf,pending.id,totp(pending.totpSecret,f.now()),'198.51.100.1'));
 assert.equal(f.vault.open(f.repo.userById(f.admin.user.id).totp_secret,'totp:'+f.admin.user.id),f.secret);
});
