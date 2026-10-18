import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { loadConfig } from '../packages/shared/config.mjs';
import { openSecurityRepository } from '../packages/auth/repository.mjs';
import { initializeVault,totp,tokenDigest } from '../packages/auth/crypto.mjs';
import { createAuthService } from '../packages/auth/service.mjs';
import { createApplicationService } from '../packages/auth/applications.mjs';
import { createPasskeyService } from '../packages/auth/passkeys.mjs';
import { createBrowserHandler } from '../apps/gateway/browser.mjs';
async function fixture(t,trusted='127.0.0.1'){
 const dir=mkdtempSync(join(tmpdir(),'localai-browser-')),repo=openSecurityRepository(join(dir,'s.sqlite')),vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:repo.hasEncryptedState()});
 const auth=createAuthService({repo,vault}),apps=createApplicationService({repo,auth}),passkeys=createPasskeyService({repo,auth,rpId:'localai.test',origin:'https://localai.test'});
 const config=loadConfig({LOCALAI_TRANSPORT:'proxy',LOCALAI_ORIGIN:'https://localai.test',LOCALAI_TRUSTED_PROXIES:trusted});
 const server=createServer(createBrowserHandler({config,repo,auth,apps,passkeys,vault}));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));repo.close();rmSync(dir,{recursive:true,force:true});});
 const jar=new Map();let csrf='';
 async function request(path,{method='GET',body,headers={}}={}){
  const payload=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body);
  const response=await new Promise((resolve,reject)=>{
   const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method,headers:{host:'localai.test','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.15',origin:'https://localai.test',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'content-type':'application/json','x-csrf-token':csrf,...(payload===undefined?{}:{'content-length':Buffer.byteLength(payload)}),...headers}},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const result=new Headers();for(const [key,value]of Object.entries(res.headers))for(const v of Array.isArray(value)?value:[value])if(v!==undefined)result.append(key,v);resolve({status:res.statusCode,headers:result,text:async()=>Buffer.concat(chunks).toString()});});
   });req.on('error',reject);req.end(payload);
  });
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  let value;const text=await response.text();try{value=JSON.parse(text);}catch{value=text;}
  if(value.csrf)csrf=value.csrf;
  return {response,value};
 }
 return {auth,repo,request,jar};
}
test('browser setup requires proxy TLS origin and CSRF and issues secure session cookies',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/auth/bootstrap',{headers:{'x-forwarded-proto':'http'}})).response.status,403);
 const boot=await f.request('/auth/bootstrap');assert.equal(boot.response.status,200);
 assert.ok(boot.response.headers.getSetCookie().some(c=>c.includes('Secure')&&c.includes('HttpOnly')&&c.includes('SameSite=Strict')));
 assert.equal((await f.request('/auth/setup/begin',{method:'POST',body:{},headers:{origin:'https://evil.test'}})).response.status,403);
 assert.equal((await f.request('/auth/setup/begin',{method:'POST',body:{},headers:{'x-csrf-token':'wrong'}})).response.status,403);
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});
 assert.equal(pending.response.status,200);assert.equal(pending.value.enrollmentToken,undefined);
 const complete=await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 assert.equal(complete.response.status,200);assert.equal(complete.value.token,undefined);assert.equal(complete.value.recoveryCodes.length,10);
 assert.ok(f.jar.get('__Host-localai-session'));
 assert.equal((await f.request('/auth/session')).value.user.role,'admin');
 assert.equal((await f.request('/admin')).response.status,200);
 assert.equal((await f.request('/auth/logout',{method:'POST',body:{},headers:{'x-csrf-token':'wrong'}})).response.status,403);
 assert.equal((await f.request('/auth/session')).response.status,200);
 assert.equal((await f.request('/auth/logout',{method:'POST',body:{}})).response.status,200);
 assert.equal((await f.request('/auth/session')).response.status,401);
 assert.equal((await f.request('/admin')).response.status,303);
});
test('HTTP boundary rejects malformed large bodies spoofed hosts unknown fields and state-file paths',async t=>{
 const f=await fixture(t);await f.request('/auth/bootstrap');
 assert.equal((await f.request('/assets/passkey-name.js')).response.status,200);
 assert.equal((await f.request('/auth/bootstrap',{headers:{host:'evil.test'}})).response.status,403);
 assert.equal((await f.request('/auth/setup/begin',{method:'POST',body:'{'})).response.status,400);
 assert.equal((await f.request('/auth/setup/begin',{method:'POST',body:'x'.repeat(70000)})).response.status,413);
 assert.equal((await f.request('/auth/setup/begin',{method:'POST',body:{ip:'127.0.0.1'}})).response.status,400);
 assert.equal((await f.request('/assets/../../package.json')).response.status,404);
 assert.equal((await f.request('/admin/api/apps')).response.status,401);
 assert.equal((await f.request('/auth/bootstrap',{headers:{cookie:'__Host-localai-session=a; __Host-localai-session=b'}})).response.status,403);
 assert.equal((await f.request('/auth/bootstrap',{headers:{cookie:'__proto__=ignored'}})).response.status,200);
});
test('an untrusted socket peer cannot claim HTTPS or a trusted forwarded address',async t=>{
 const f=await fixture(t,'192.0.2.245/32');
 assert.equal((await f.request('/auth/bootstrap',{headers:{'x-forwarded-for':'192.0.2.245'}})).response.status,403);
 assert.equal((await f.request('/login')).response.status,403);
});

test('device names can be saved for an existing passkey with ownership CSRF and length enforcement',async t=>{
 const f=await fixture(t);await f.request('/auth/bootstrap');
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});
 const complete=await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 // A metadata-only fixture; the separate authenticator test verifies signed registration.
 const id='synthetic-passkey';f.repo.registerPasskey(complete.value.user.id,{id,publicKey:Buffer.from([1]),counter:0},tokenDigest(f.jar.get('__Host-localai-session')),Date.now());
 assert.equal((await f.request('/auth/passkeys')).value.passkeys[0].name,'');
 assert.equal((await f.request('/auth/passkeys/rename',{method:'POST',body:{id,name:'My laptop'},headers:{'x-csrf-token':'wrong'}})).response.status,403);
 assert.equal((await f.request('/auth/passkeys/rename',{method:'POST',body:{id,name:'x'.repeat(81)}})).response.status,400);
 assert.equal((await f.request('/auth/passkeys/rename',{method:'POST',body:{id:'another-credential',name:'Denied'}})).response.status,401);
 assert.equal((await f.request('/auth/passkeys/rename',{method:'POST',body:{id,name:'حاسوب العمل'}})).response.status,200);
 assert.equal((await f.request('/auth/passkeys')).value.passkeys[0].name,'حاسوب العمل');
 assert.ok(!JSON.stringify(f.repo.auditRecords()).includes('حاسوب العمل'));
 assert.equal((await f.request('/auth/passkeys/remove',{method:'POST',body:{id}})).response.status,200);
 assert.deepEqual((await f.request('/auth/passkeys')).value.passkeys,[]);
});
