import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { isIP } from 'node:net';
import { newToken,tokenDigest } from './crypto.mjs';
import { AuthError } from './service.mjs';

export function createPasskeyService({repo,auth,rpId,origin,now=Date.now}){
 const site=new URL(origin);
 if(site.origin!==origin||site.hostname!==rpId||isIP(rpId)||!(site.protocol==='https:'||(site.protocol==='http:'&&rpId==='localhost')))throw new TypeError('Passkeys require an exact HTTPS DNS origin or localhost');
 const save=(kind,challenge,userId=null,token=null)=>{
  const id=newToken();repo.saveChallenge({id,userId,kind,challenge,expires:now()+5*60000,sessionHash:token?tokenDigest(token):null},now());return id;
 };
 const bounded=response=>{if(!response||JSON.stringify(response).length>65536)throw new AuthError();};
 return {
  async registrationOptions(token,csrf){
   const user=auth.requireFreshSession(token,csrf);
   const options=await generateRegistrationOptions({rpName:'Local AI',rpID:rpId,userName:user.username,userID:new TextEncoder().encode(user.id),attestationType:'none',supportedAlgorithmIDs:[-7,-257,-8],excludeCredentials:repo.passkeysForUser(user.id).map(p=>({id:p.id,transports:JSON.parse(p.transports)})),authenticatorSelection:{residentKey:'required',userVerification:'required'}});
   return {id:save('registration',options.challenge,user.id,token),options};
  },
  async register(token,csrf,id,response){
   try{
    const user=auth.requireFreshSession(token,csrf),challenge=repo.consumeChallenge(id,'registration',now(),tokenDigest(token));bounded(response);
    if(!challenge||challenge.user_id!==user.id)throw new AuthError();
    // Only requested no-attestation credentials are accepted; no external metadata/CRL lookup.
    const object=isoCBOR.decodeFirst(Buffer.from(response.response.attestationObject,'base64url'));
    if(!(object instanceof Map)||object.get('fmt')!=='none')throw new AuthError();
    const result=await verifyRegistrationResponse({response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpId,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257,-8]});
    if(!result.verified||!result.registrationInfo.userVerified)throw new AuthError();
    auth.requireFreshSession(token,csrf);
    repo.registerPasskey(user.id,result.registrationInfo.credential,tokenDigest(token),now());
    return {id:result.registrationInfo.credential.id};
   }catch{throw new AuthError();}
  },
  async authenticationOptions(ip,binding=null){
   auth.guard('passkey_options',ip);
   const options=await generateAuthenticationOptions({rpID:rpId,userVerification:'required'});
   return {id:save('authentication',options.challenge,null,binding),options};
  },
  async authenticate(id,response,ip,binding=null){
   auth.guard('passkey_login',ip);
   try{
    const challenge=repo.consumeChallenge(id,'authentication',now(),binding?tokenDigest(binding):null);bounded(response);
    if(!challenge)throw new AuthError();
    const credential=repo.passkey(response.id);if(!credential)throw new AuthError();
    auth.guardAccount(credential.user_id);
    const result=await verifyAuthenticationResponse({response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpId,requireUserVerification:true,credential:{id:credential.id,publicKey:new Uint8Array(credential.public_key),counter:credential.counter,transports:JSON.parse(credential.transports)}});
    if(!result.verified||!result.authenticationInfo.userVerified)throw new AuthError();
    return auth.completePasskeyLogin(credential.id,credential.counter,result.authenticationInfo.newCounter);
   }catch{repo.audit(now(),'passkey_login',null,null,'denied');throw new AuthError();}
  }
 };
}
