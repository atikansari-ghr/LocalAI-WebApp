import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSecurityRepository } from '../packages/auth/repository.mjs';
import { createAuthService } from '../packages/auth/service.mjs';
import { openVault, totp } from '../packages/auth/crypto.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'localai-auth-')),repo=openSecurityRepository(join(dir,'state.sqlite')),vault=openVault(join(dir,'master.key'));
 let time=1800000000000;const auth=createAuthService({repo,vault,now:()=>time});
 t.after(()=>{repo.close();rmSync(dir,{recursive:true,force:true});});
 return {auth,repo,advance:ms=>time+=ms,now:()=>time};
}
async function setup(f){
 const code=f.auth.issueSetupCode();
 const pending=await f.auth.beginSetup({code,username:'admin',password:'correct horse battery staple',ip:'127.0.0.1'});
 const result=f.auth.completeSetup({enrollmentToken:pending.enrollmentToken,code:totp(pending.totpSecret,f.now()),ip:'127.0.0.1'});
 return {...result,totpSecret:pending.totpSecret};
}
test('bootstrap has no default account and requires single-use expiring code and MFA',async t=>{
 const f=fixture(t);assert.equal(f.auth.status(),'new');
 await assert.rejects(f.auth.beginSetup({code:'wrong',username:'admin',password:'correct horse battery staple',ip:'127.0.0.1'}));
 const admin=await setup(f);assert.equal(f.auth.status(),'ready');assert.equal(admin.recoveryCodes.length,10);
 assert.equal(f.auth.session(admin.token).user.role,'admin');
 assert.throws(()=>f.auth.issueSetupCode());assert.throws(()=>f.auth.completeSetup({enrollmentToken:'wrong',code:'000000',ip:'127.0.0.1'}));
 const f2=fixture(t),expired=f2.auth.issueSetupCode();f2.advance(31*60000);
 await assert.rejects(f2.auth.beginSetup({code:expired,username:'admin',password:'correct horse battery staple',ip:'127.0.0.1'}));
});
test('concurrent first-run claims create exactly one pending administrator',async t=>{
 const f=fixture(t),code=f.auth.issueSetupCode();
 const results=await Promise.allSettled(['admin1','admin2'].map(username=>f.auth.beginSetup({code,username,password:'correct horse battery staple',ip:'127.0.0.1'})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.auth.status(),'pending');
});
test('password-only login is denied and TOTP cannot be replayed across sessions',async t=>{
 const f=fixture(t),admin=await setup(f);
 await assert.rejects(f.auth.login({username:'admin',password:'correct horse battery staple',code:'',ip:'127.0.0.1'}));
 await assert.rejects(f.auth.login({username:'admin',password:'correct horse battery staple',code:totp(admin.totpSecret,f.now()),ip:'127.0.0.1'}));
 f.advance(30000);
 const session=await f.auth.login({username:'admin',password:'correct horse battery staple',code:totp(admin.totpSecret,f.now()),ip:'127.0.0.1'});
 assert.equal(f.auth.session(session.token).user.username,'admin');
 await assert.rejects(f.auth.login({username:'admin',password:'correct horse battery staple',code:totp(admin.totpSecret,f.now()),ip:'127.0.0.1'}));
});
test('recovery codes are single-use, sessions enforce CSRF revocation idle and absolute expiry',async t=>{
 const f=fixture(t),admin=await setup(f);f.advance(30000);
 const recovered=await f.auth.login({username:'admin',password:'correct horse battery staple',recoveryCode:admin.recoveryCodes[0],ip:'127.0.0.1'});
 assert.equal(f.auth.session(recovered.token).user.role,'admin');
 await assert.rejects(f.auth.login({username:'admin',password:'correct horse battery staple',recoveryCode:admin.recoveryCodes[0],ip:'127.0.0.1'}));
 assert.throws(()=>f.auth.requireAdmin(recovered.token,'wrong'));
 assert.equal(f.auth.requireAdmin(recovered.token,recovered.csrf).role,'admin');
 f.auth.logout(recovered.token);assert.throws(()=>f.auth.session(recovered.token));
 f.advance(31*60000);assert.throws(()=>f.auth.session(admin.token));
});
test('login rate limits persist in SQLite and audit records never contain passwords MFA or recovery secrets',async t=>{
 const f=fixture(t),admin=await setup(f);
 for(let i=0;i<6;i++)await assert.rejects(f.auth.login({username:'admin',password:'incorrect password',code:'000000',ip:'192.0.2.1'}));
 const log=JSON.stringify(f.repo.auditRecords());
 assert.equal(log.includes('incorrect password'),false);assert.equal(log.includes(admin.totpSecret),false);
 for(const recovery of admin.recoveryCodes)assert.equal(log.includes(recovery),false);
 assert.ok(f.repo.auditRecords().length>0);
});
