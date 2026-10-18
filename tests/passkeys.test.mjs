import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync,randomBytes,createHash,sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { openSecurityRepository } from '../packages/auth/repository.mjs';
import { createAuthService } from '../packages/auth/service.mjs';
import { createPasskeyService } from '../packages/auth/passkeys.mjs';
import { initializeVault,totp } from '../packages/auth/crypto.mjs';
const rpId='localai.test',origin='https://localai.test';
const digest=value=>createHash('sha256').update(value).digest();
function authenticator(){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
 const publicCose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 function client(type,challenge,site=origin){return Buffer.from(JSON.stringify({type,challenge,origin:site,crossOrigin:false}));}
 return {
  registration(challenge){
   const size=Buffer.alloc(2);size.writeUInt16BE(id.length);
   const data=Buffer.concat([digest(rpId),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),size,id,publicCose]);
   return {id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:client('webauthn.create',challenge).toString('base64url'),attestationObject:Buffer.from(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(data)]]))).toString('base64url'),transports:['internal']}};
  },
  authentication(challenge,counter=1,site=origin){
   const count=Buffer.alloc(4);count.writeUInt32BE(counter);
   const data=Buffer.concat([digest(rpId),Buffer.from([0x05]),count]),json=client('webauthn.get',challenge,site);
   return {id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',clientExtensionResults:{},response:{authenticatorData:data.toString('base64url'),clientDataJSON:json.toString('base64url'),signature:sign('sha256',Buffer.concat([data,digest(json)]),privateKey).toString('base64url')}};
  }
 };
}
test('WebAuthn verifies a real signed assertion and denies replay forged signatures wrong origins and expiry',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-passkeys-')),repo=openSecurityRepository(join(dir,'state.sqlite'));let now=1800000000000;
 t.after(()=>{repo.close();rmSync(dir,{recursive:true,force:true});});
 const auth=createAuthService({repo,vault:initializeVault(join(dir,'master.key'),{encryptedStateExists:repo.hasEncryptedState()}),now:()=>now});
 const pending=await auth.beginSetup({code:auth.issueSetupCode(),username:'admin',password:'correct horse battery staple',ip:'127.0.0.1'});
 const admin=auth.completeSetup({enrollmentToken:pending.enrollmentToken,code:totp(pending.totpSecret,now),ip:'127.0.0.1'});
 const passkeys=createPasskeyService({repo,auth,rpId,origin,now:()=>now}),device=authenticator();
 const registration=await passkeys.registrationOptions(admin.token,admin.csrf);
 assert.equal(registration.options.authenticatorSelection.residentKey,'required');
 assert.equal(registration.options.authenticatorSelection.requireResidentKey,true);
 await passkeys.register(admin.token,admin.csrf,registration.id,device.registration(registration.options.challenge));
 const login=await passkeys.authenticationOptions('127.0.0.1');
 const response=device.authentication(login.options.challenge);
 const session=await passkeys.authenticate(login.id,response,'127.0.0.1');
 assert.equal(auth.session(session.token).user.id,admin.user.id);
 await assert.rejects(passkeys.authenticate(login.id,response,'127.0.0.1'));
 const forged=await passkeys.authenticationOptions('127.0.0.1');
 const bad=device.authentication(forged.options.challenge,2);bad.response.signature=randomBytes(64).toString('base64url');
 await assert.rejects(passkeys.authenticate(forged.id,bad,'127.0.0.1'));
 const cross=await passkeys.authenticationOptions('127.0.0.1');
 await assert.rejects(passkeys.authenticate(cross.id,device.authentication(cross.options.challenge,2,'https://evil.test'),'127.0.0.1'));
 const bound=await passkeys.authenticationOptions('192.0.2.50','browser-a');
 await assert.rejects(passkeys.authenticate(bound.id,device.authentication(bound.options.challenge,2),'192.0.2.50','browser-b'));
 const own=await passkeys.authenticationOptions('192.0.2.51','browser-a');
 assert.equal((await passkeys.authenticate(own.id,device.authentication(own.options.challenge,2),'192.0.2.51','browser-a')).user.id,admin.user.id);
 const expired=await passkeys.authenticationOptions('192.0.2.1');now+=6*60000;
 await assert.rejects(passkeys.authenticate(expired.id,device.authentication(expired.options.challenge,2),'192.0.2.1'));
});
