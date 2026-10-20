import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../packages/shared/config.mjs';
import { openSecurityRepository } from '../packages/auth/repository.mjs';
import { initializeVault,totp,tokenDigest } from '../packages/auth/crypto.mjs';
import { createAuthService } from '../packages/auth/service.mjs';
import { createApplicationService } from '../packages/auth/applications.mjs';
import { createPasskeyService } from '../packages/auth/passkeys.mjs';
import { createBrowserHandler } from '../apps/gateway/browser.mjs';
async function fixture(t,trusted='127.0.0.1',inference,documentClient){
 const dir=mkdtempSync(join(tmpdir(),'localai-browser-')),repo=openSecurityRepository(join(dir,'s.sqlite')),vault=initializeVault(join(dir,'master.key'),{encryptedStateExists:repo.hasEncryptedState()});
 const auth=createAuthService({repo,vault}),apps=createApplicationService({repo,auth}),passkeys=createPasskeyService({repo,auth,rpId:'localai.test',origin:'https://localai.test'});
 const config=loadConfig({LOCALAI_TRANSPORT:'proxy',LOCALAI_ORIGIN:'https://localai.test',LOCALAI_TRUSTED_PROXIES:trusted});
 const server=createServer(createBrowserHandler({config,repo,auth,apps,passkeys,vault,inference,documentClient}));server.listen(0,'127.0.0.1');await once(server,'listening');
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
 return {auth,repo,apps,request,jar,port:server.address().port,statePath:join(dir,'s.sqlite')};
}

test('unified AI routes enforce application capability IP policy and browser CSRF before inference',async t=>{
 let invoked=0;const inference={chat:async()=>{invoked++;return {choices:[{message:{content:'synthetic'}}]};},embeddings:async()=>{invoked++;return {data:[]};}};
 const f=await fixture(t,'127.0.0.1',inference);await f.request('/auth/bootstrap');
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});
 await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 const token=f.jar.get('__Host-localai-session'),csrf=f.auth.session(token).csrf;
 const app=f.apps.create(token,csrf,{name:'AI test',capabilities:['models','chat'],networks:['192.0.2.15/32']});
 const headers={authorization:'Bearer '+app.key,cookie:''},body={messages:[{role:'user',content:'hello'}]};
 assert.equal((await f.request('/v1/models',{headers})).response.status,200);
 assert.equal((await f.request('/v1/chat/completions',{method:'POST',headers,body})).response.status,200);
 assert.equal(invoked,1);
 for(const denied of [{...headers,'x-forwarded-for':'192.0.2.16'},{...headers,origin:'https://evil.test'},{...headers,cookie:'__Host-localai-session='+token}])assert.equal((await f.request('/v1/chat/completions',{method:'POST',headers:denied,body})).response.status,403);
 assert.equal((await f.request('/v1/embeddings',{method:'POST',headers,body:{input:'hello'}})).response.status,403);
 assert.equal((await f.request('/v1/chat/completions',{method:'POST',headers:{'x-csrf-token':'wrong'},body})).response.status,403);
 assert.equal(invoked,1);
 assert.equal((await f.request('/v1/chat/completions',{method:'POST',body})).response.status,200);
 f.apps.revoke(token,csrf,app.id);
 assert.equal((await f.request('/v1/models',{headers})).response.status,403);
 assert.equal((await f.request('/v1/models',{headers:{cookie:''}})).response.status,401);
});
test('draft document operations remain unavailable before their worker and release gates',async t=>{
 const f=await fixture(t,'127.0.0.1',{chat:async()=>({choices:[]}),embeddings:async()=>({data:[]})});
 for(const [method,path] of [['POST','/v1/ocr'],['POST','/v1/extract'],['GET','/v1/documents/00000000-0000-4000-8000-000000000000/status'],['DELETE','/v1/documents/00000000-0000-4000-8000-000000000000']]){
  assert.equal((await f.request(path,{method,body:method==='POST'?{}:undefined})).response.status,404);
 }
});
test('gated document HTTP candidate derives owner and scope before private submission',async t=>{
 const calls=[],jobId='123e4567-e89b-42d3-a456-426614174000',documentClient=async message=>{calls.push(message);if(message.op==='status')return message.scope==='absent'?null:{id:jobId,status:'complete',result:{text:'x'}};if(message.idempotencyKey==='conflictkey123456')throw Error('job_idempotency_conflict');return {id:jobId,status:'queued',expiresAt:Date.now()+60000};};
 const f=await fixture(t,'127.0.0.1',null,documentClient);await f.request('/auth/bootstrap');
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});
 await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 const token=f.jar.get('__Host-localai-session'),userId=f.auth.session(token).user.id,body={name:'x.txt',mime:'text/plain',content_base64:'eA==',scope:'private'};
 const headers={'idempotency-key':'abcdefghijklmnop'};
 assert.equal((await f.request('/v1/extract',{method:'POST',body,headers:{...headers,'x-csrf-token':'wrong'}})).response.status,403);
 assert.equal(calls.length,0);
 const submitted=await f.request('/v1/extract',{method:'POST',body,headers});assert.equal(submitted.response.status,202);
 assert.deepEqual([calls[0].op,calls[0].namespace,calls[0].scope],['submit','user:'+userId,'private']);
 assert.equal((await f.request('/v1/documents/'+jobId+'/status?scope=private')).value.result.text,'x');
 assert.equal((await f.request('/v1/documents/'+jobId+'/status?scope=absent')).response.status,404);
 assert.equal((await f.request('/v1/extract',{method:'POST',body,headers:{'idempotency-key':'conflictkey123456'}})).response.status,409);
 const app=f.apps.create(token,f.auth.session(token).csrf,{name:'Documents',capabilities:['extract','document:read'],scopes:['private'],networks:['192.0.2.15/32']});
 const bearer={authorization:'Bearer '+app.key,cookie:''};
 assert.equal((await f.request('/v1/extract',{method:'POST',body,headers:{...headers,...bearer}})).response.status,202);
 assert.equal(calls.at(-1).namespace,'app:'+app.id);
 assert.equal((await f.request('/v1/documents/'+jobId+'/status?scope=private',{headers:bearer})).response.status,200);
 assert.equal((await f.request('/v1/extract',{method:'POST',body:{...body,scope:'other'},headers:{...headers,...bearer}})).response.status,403);
 assert.equal((await f.request('/v1/documents/'+jobId+'/status?scope=other',{headers:bearer})).response.status,403);
 assert.equal((await f.request('/v1/extract',{method:'POST',body,headers:{...headers,...bearer,cookie:'__Host-localai-session='+token}})).response.status,403);
 const beforeInvalid=calls.length;
 assert.equal((await f.request('/v1/extract',{method:'POST',body:{...body,mime:'application/pdf'},headers})).response.status,400);
 assert.equal((await f.request('/v1/extract',{method:'POST',body:{...body,ocr:'arbitrary'},headers})).response.status,400);
 assert.equal((await f.request('/v1/extract',{method:'POST',body:{...body,mime:undefined},headers})).response.status,400);
 assert.equal((await f.request('/v1/documents/'+jobId+'/status?scope=private&scope=other')).response.status,400);
 assert.equal(calls.length,beforeInvalid);
 f.apps.revoke(token,f.auth.session(token).csrf,app.id);
 assert.equal((await f.request('/v1/documents/'+jobId+'/status?scope=private',{headers:bearer})).response.status,403);
});
test('gated document HTTP candidate bounds simultaneous incomplete uploads and releases slots',async t=>{
 const f=await fixture(t,'127.0.0.1',null,async()=>({id:'123e4567-e89b-42d3-a456-426614174000',status:'queued',expiresAt:Date.now()+60000}));await f.request('/auth/bootstrap');
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 const headers={host:'localai.test','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.15',origin:'https://localai.test',cookie:'__Host-localai-session='+f.jar.get('__Host-localai-session'),'x-csrf-token':f.auth.session(f.jar.get('__Host-localai-session')).csrf,'idempotency-key':'abcdefghijklmnop','content-type':'application/json','content-length':'1000'};
 const held=[];for(let i=0;i<2;i++){const request=httpRequest({host:'127.0.0.1',port:f.port,path:'/v1/extract',method:'POST',headers},()=>{});request.on('error',()=>{});request.write('{"name":"unfinished');held.push(request);}await new Promise(resolve=>setTimeout(resolve,30));
 try{
  const body={name:'x.txt',mime:'text/plain',content_base64:'eA==',scope:'private'};
  assert.equal((await f.request('/v1/extract',{method:'POST',body,headers:{'idempotency-key':'abcdefghijklmnop'}})).response.status,429);
  for(const request of held)request.destroy();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await f.request('/v1/extract',{method:'POST',body,headers:{'idempotency-key':'abcdefghijklmnop'}})).response.status,202);
 }finally{for(const request of held)request.destroy();}
});
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

test('recovery replacement rotates HTTP cookies and codes without returning session tokens',async t=>{
 const f=await fixture(t);await f.request('/auth/bootstrap');
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});
 const setup=await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 const original=f.jar.get('__Host-localai-session');
 const replacement=await f.request('/auth/totp/replace/begin',{method:'POST',body:{password:'correct horse battery staple',recoveryCode:setup.value.recoveryCodes[0]}});
 assert.equal(replacement.response.status,200);assert.equal(replacement.value.token,undefined);
 assert.notEqual(f.jar.get('__Host-localai-session'),original);
 assert.equal((await f.request('/auth/session',{headers:{cookie:'__Host-localai-session='+original}})).response.status,401);
 const result=await f.request('/auth/totp/replace/complete',{method:'POST',body:{id:replacement.value.id,code:totp(replacement.value.totpSecret)}});
 assert.equal(result.response.status,200);assert.equal(result.value.token,undefined);assert.equal(result.value.recoveryCodes.length,10);
 await f.request('/auth/logout',{method:'POST',body:{}});await f.request('/auth/bootstrap');
 assert.equal((await f.request('/auth/login',{method:'POST',body:{username:'admin',password:'correct horse battery staple',recoveryCode:setup.value.recoveryCodes[1]}})).response.status,401);
 assert.equal((await f.request('/auth/login',{method:'POST',body:{username:'admin',password:'correct horse battery staple',recoveryCode:result.value.recoveryCodes[0]}})).response.status,200);
});

test('role changes immediately remove administrator access from an existing session',async t=>{
 const f=await fixture(t);await f.request('/auth/bootstrap');
 const pending=await f.request('/auth/setup/begin',{method:'POST',body:{code:f.auth.issueSetupCode(),username:'admin',password:'correct horse battery staple'}});
 const setup=await f.request('/auth/setup/complete',{method:'POST',body:{code:totp(pending.value.totpSecret)}});
 // Fixture-only role change; production administration is a separate interface.
 const db=new DatabaseSync(f.statePath);try{db.prepare("UPDATE users SET role='user' WHERE id=?").run(setup.value.user.id);}finally{db.close();}
 assert.equal((await f.request('/auth/session')).value.user.role,'user');
 assert.equal((await f.request('/profile')).response.status,200);
 assert.equal((await f.request('/admin')).response.status,403);
 assert.equal((await f.request('/admin/api/apps')).response.status,403);
 assert.equal((await f.request('/admin/api/apps/create',{method:'POST',body:{name:'Denied',capabilities:['chat']}})).response.status,401);
});
