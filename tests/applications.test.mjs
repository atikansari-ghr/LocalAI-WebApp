import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openSecurityRepository } from '../packages/auth/repository.mjs';
import { initializeVault,totp } from '../packages/auth/crypto.mjs';
import { createAuthService } from '../packages/auth/service.mjs';
import { createApplicationService } from '../packages/auth/applications.mjs';
test('applications require step-up admin, isolate scope/capability/IP and revoke old keys immediately',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-app-')),repo=openSecurityRepository(join(dir,'state.sqlite'));let now=1800000000000;
 t.after(()=>{repo.close();rmSync(dir,{recursive:true,force:true});});
 const auth=createAuthService({repo,vault:initializeVault(join(dir,'master.key'),{encryptedStateExists:repo.hasEncryptedState()}),now:()=>now});
 const pending=await auth.beginSetup({code:auth.issueSetupCode(),username:'admin',password:'correct horse battery staple',ip:'127.0.0.1'});
 const admin=auth.completeSetup({enrollmentToken:pending.enrollmentToken,code:totp(pending.totpSecret,now),ip:'127.0.0.1'});
 const apps=createApplicationService({repo,auth,now:()=>now});
 assert.throws(()=>apps.create(admin.token,'wrong',{name:'Denied',capabilities:['chat']}));
 const a=apps.create(admin.token,admin.csrf,{name:'PDMS example',capabilities:['rag'],networks:['192.168.10.0/24'],scopes:['person-a']});
 const b=apps.create(admin.token,admin.csrf,{name:'Calendar example',capabilities:['chat'],expires:now+1000});
 assert.notEqual(a.key,b.key);assert.notEqual(a.id,b.id);
 const granted=apps.authenticate(a.key,{ip:'192.168.10.20',capability:'rag',scopes:['person-a']});
 assert.equal(granted.applicationId,a.id);assert.equal(granted.namespace,a.id);
 for(const options of [
 {ip:'192.168.11.20',capability:'rag',scopes:['person-a']},
 {ip:'192.168.10.20',capability:'chat',scopes:[]},
 {ip:'192.168.10.20',capability:'rag',scopes:['person-b']},
 {ip:'192.168.10.20',capability:'rag',scopes:[]}
 ])assert.throws(()=>apps.authenticate(a.key,options));
 const rotated=apps.rotate(admin.token,admin.csrf,a.id);
 assert.throws(()=>apps.authenticate(a.key,{ip:'192.168.10.20',capability:'rag',scopes:['person-a']}));
 assert.equal(apps.authenticate(rotated,{ip:'192.168.10.20',capability:'rag',scopes:['person-a']}).applicationId,a.id);
 apps.revoke(admin.token,admin.csrf,a.id);
 assert.throws(()=>apps.authenticate(rotated,{ip:'192.168.10.20',capability:'rag',scopes:['person-a']}));
 now+=2000;assert.throws(()=>apps.authenticate(b.key,{ip:'127.0.0.1',capability:'chat'}));
 now+=5*60000;assert.throws(()=>apps.rotate(admin.token,admin.csrf,b.id));
});
