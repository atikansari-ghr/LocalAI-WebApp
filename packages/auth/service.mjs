import { randomUUID } from 'node:crypto';
import { newToken, newTotpSecret, tokenDigest, equalSecret, hashPassword, verifyPassword, verifyTotp } from './crypto.mjs';
import { normalizeIp } from './network.mjs';
const SESSION_TTL=8*60*60*1000,IDLE_TTL=30*60*1000,STEP_UP_TTL=5*60*1000;
export class AuthError extends Error {constructor(){super('Authentication failed');this.name='AuthError';}}
let dummyHash;
export function createAuthService({repo,vault,now=Date.now}){
 const rate=(kind,ip)=>{
  try{ip=normalizeIp(ip);}catch{throw new AuthError();}
  if(!repo.hitRate(tokenDigest(kind+':'+ip),now(),5,15*60000)){repo.audit(now(),'rate_limited',null,null,'denied');throw new AuthError();}
 };
 const accountKey=id=>tokenDigest('account:'+id);
 const guardAccount=id=>{if(!repo.hitRate(accountKey(id),now(),5,15*60000)){repo.audit(now(),'account_locked',id,id,'denied');throw new AuthError();}};
 const prepareSession=()=>{
  const token=newToken();return {token,hash:tokenDigest(token),expires:now()+SESSION_TTL,csrf:vault.csrf(token)};
 };
 const sessionResult=(session,user)=>({token:session.token,csrf:session.csrf,expires:session.expires,user:{id:user.id,username:user.username,role:user.role}});
 const verifyCode=(user,code)=>verifyTotp(vault.open(user.totp_secret,'totp:'+user.id),code,now(),user.totp_counter);
 const service={
  guard:rate,
  guardAccount,
  status:()=>repo.state().status,
  issueSetupCode(){
   const code=newToken();repo.issueSetup(tokenDigest(code),now()+30*60000,now());return code;
  },
  async beginSetup({code,username,password,ip}){
   rate('setup',ip);
   if(typeof code!=='string'||code.length>256||typeof username!=='string'||!/^[-a-zA-Z0-9_.]{3,64}$/.test(username))throw new AuthError();
   const state=repo.state();if(state.status!=='new'||state.setup_expires<=now()||!equalSecret(state.setup_hash,tokenDigest(code)))throw new AuthError();
   const id=randomUUID(),secret=newTotpSecret(),enrollmentToken=newToken();
   const passwordHash=await hashPassword(password);
   try{repo.beginSetup({codeHash:tokenDigest(code),now:now(),user:{id,username:username.toLowerCase(),passwordHash,totpSecret:vault.seal(secret,'totp:'+id)},enrollmentHash:tokenDigest(enrollmentToken),enrollmentExpires:now()+10*60000});}
   catch{throw new AuthError();}
   return {enrollmentToken,totpSecret:secret,otpauthUri:'otpauth://totp/Local%20AI:'+encodeURIComponent(username)+'?secret='+secret+'&issuer=Local%20AI&algorithm=SHA1&digits=6&period=30'};
  },
  completeSetup({enrollmentToken,code,ip}){
   rate('enrollment',ip);
   if(typeof enrollmentToken!=='string'||enrollmentToken.length>256)throw new AuthError();
   const state=repo.state();if(state.status!=='pending'||state.enrollment_expires<=now()||!equalSecret(state.enrollment_hash,tokenDigest(enrollmentToken)))throw new AuthError();
   guardAccount(state.pending_user);
   const recoveryCodes=Array.from({length:10},newToken),session=prepareSession();
   try{
    const user=repo.completeSetup({hash:tokenDigest(enrollmentToken),now:now(),verify:user=>verifyCode(user,code),recoveryHashes:recoveryCodes.map(c=>tokenDigest('recovery:'+c)),session});
    repo.clearRate(accountKey(user.id));
    return {...sessionResult(session,user),recoveryCodes};
   }catch{throw new AuthError();}
  },
  async login({username,password,code,recoveryCode,ip}){
   rate('login',ip);
   if(typeof username!=='string'||username.length>64||typeof password!=='string')throw new AuthError();
   const user=repo.userByName(username.toLowerCase());
   guardAccount(user?.id??tokenDigest(username.toLowerCase()));
   dummyHash??=hashPassword(newToken());
   const valid=await verifyPassword(password,user?.password_hash??await dummyHash);
   if(!valid||!user){repo.audit(now(),'login',null,null,'denied');throw new AuthError();}
   const session=prepareSession();
   try{
    if(recoveryCode!==undefined&&(typeof recoveryCode!=='string'||recoveryCode.length>256))throw new AuthError();
    const account=repo.login({id:user.id,now:now(),passwordHash:user.password_hash,verify:u=>verifyCode(u,code),recoveryHash:recoveryCode?tokenDigest('recovery:'+recoveryCode):null,session});
    repo.clearRate(accountKey(account.id));
    return sessionResult(session,account);
   }catch{repo.audit(now(),'login',user.id,user.id,'denied');throw new AuthError();}
  },
  session(token){
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AuthError();
   const session=repo.session(tokenDigest(token),now(),IDLE_TTL);if(!session)throw new AuthError();
   return {user:{id:session.user_id,username:session.username,role:session.role},csrf:vault.csrf(token),stepUp:session.step_up,expires:session.expires};
  },
  requireFreshSession(token,csrf){
   const session=service.session(token);
   if(!equalSecret(session.csrf,csrf)||now()-session.stepUp>STEP_UP_TTL)throw new AuthError();
   return session.user;
  },
  requireAdmin(token,csrf){const user=service.requireFreshSession(token,csrf);if(user.role!=='admin')throw new AuthError();return user;},
  completePasskeyLogin(credentialId,expectedCounter,counter){
   const session=prepareSession();
   try {const user=repo.passkeyLogin({credentialId,expectedCounter,counter,session,now:now()});repo.clearRate(accountKey(user.id));return sessionResult(session,user);}
   catch{throw new AuthError();}
  },
  stepUp(token,csrf,code,ip){
   rate('stepup',ip);const session=service.session(token);
   if(!equalSecret(session.csrf,csrf))throw new AuthError();
   guardAccount(session.user.id);
   try{repo.stepUp(tokenDigest(token),now(),user=>verifyCode(user,code));}catch{throw new AuthError();}
   repo.clearRate(accountKey(session.user.id));
   return session.user;
  },
  logout(token){service.session(token);repo.logout(tokenDigest(token),now());}
 };
 return service;
}
