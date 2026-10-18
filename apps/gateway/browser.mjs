import { readFileSync } from 'node:fs';
import { newToken,equalSecret } from '../../packages/auth/crypto.mjs';
import { matchesNetwork,resolveClientIp } from '../../packages/auth/network.mjs';
import { AuthError } from '../../packages/auth/service.mjs';
const assets=new Map([
 ['/assets/app.js',['text/javascript; charset=utf-8',readFileSync(new URL('../web-admin/app.js',import.meta.url))]],
 ['/assets/styles.css',['text/css; charset=utf-8',readFileSync(new URL('../web-admin/styles.css',import.meta.url))]],
 ['/assets/mark.svg',['image/svg+xml',readFileSync(new URL('../web-admin/mark.svg',import.meta.url))]],
 ['/assets/wallpaper.svg',['image/svg+xml',readFileSync(new URL('../web-admin/wallpaper.svg',import.meta.url))]]
]);
const html=readFileSync(new URL('../web-admin/index.html',import.meta.url));
const documents=Object.fromEntries(['installation','configuration','security'].map(name=>[name,readFileSync(new URL('../../docs/'+name+'.md',import.meta.url),'utf8')]));
const SESSION='__Host-localai-session',PREAUTH='__Host-localai-preauth',ENROLL='__Host-localai-enrollment';
class HttpError extends Error{constructor(status){super('Request rejected');this.status=status;}}
function cookies(request){
 const result=Object.create(null);
 for(const part of (request.headers.cookie??'').split(';')){const [name,...value]=part.trim().split('=');if(Object.hasOwn(result,name))throw new HttpError(403);if(name)result[name]=value.join('=');}
 return result;
}
function setCookie(response,name,value,maxAge){const existing=response.getHeader('Set-Cookie')??[];response.setHeader('Set-Cookie',[...existing,name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge]);}
function readJson(request){
 return new Promise((resolve,reject)=>{
  let bytes=0,done=false;const chunks=[];
  const fail=status=>{if(!done){done=true;reject(new HttpError(status));}};
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type']??'')){request.resume();fail(415);return;}
  request.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>65536){chunks.length=0;fail(413);}else chunks.push(chunk);});
  request.on('error',()=>fail(400));
  request.on('end',()=>{if(done)return;done=true;try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();resolve(body);}catch{reject(new HttpError(400));}});
 });
}
function fields(body,allowed){if(Object.keys(body).some(k=>!allowed.includes(k)))throw new HttpError(400);return body;}
export function createBrowserHandler({config,repo,auth,apps,passkeys,vault}){
 const origin=new URL(config.origin);
 return (request,response)=>{
  const send=(status,body,type='application/json; charset=utf-8')=>{response.statusCode=status;response.setHeader('Content-Type',type);response.end(type.startsWith('application/json')?JSON.stringify(body):body);};
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  response.setHeader('Strict-Transport-Security','max-age=31536000');
  (async()=>{
   const remote=request.socket.remoteAddress;
   if(config.transport==='proxy'){
    if(!matchesNetwork(remote,config.trustedProxies)||request.headers['x-forwarded-proto']!=='https')throw new HttpError(403);
   }else if(config.transport!=='tls'||!request.socket.encrypted)throw new HttpError(403);
   if(request.headers.host?.toLowerCase()!==origin.host.toLowerCase())throw new HttpError(403);
   if(request.headers['sec-fetch-site']==='cross-site')throw new HttpError(403);
   const ip=resolveClientIp(remote,config.transport==='proxy'?request.headers['x-forwarded-for']:undefined,config.trustedProxies);
   const jar=cookies(request),sessionToken=jar[SESSION],preauth=jar[PREAUTH];
   const requireSession=()=>auth.session(sessionToken);
   const sessionCsrf=()=>{const session=requireSession();if(!equalSecret(session.csrf,request.headers['x-csrf-token']))throw new HttpError(403);return session;};
   const requirePreauth=()=>{if(!/^[A-Za-z0-9_-]{43}$/.test(preauth??'')||!equalSecret(vault.csrf('preauth:'+preauth),request.headers['x-csrf-token']))throw new HttpError(403);};
   const establish=value=>{
    if(sessionToken){try{auth.logout(sessionToken);}catch{}}
    setCookie(response,SESSION,value.token,Math.max(0,Math.floor((value.expires-Date.now())/1000)));
    setCookie(response,PREAUTH,'',0);setCookie(response,ENROLL,'',0);
    const {token,...safe}=value;return send(200,safe);
   };
   const path=new URL(request.url,config.origin).pathname;
   if(request.method==='GET'){
    if(assets.has(path)){const [type,body]=assets.get(path);return send(200,body,type);}
    if(path==='/auth/bootstrap'){
     const token=/^[A-Za-z0-9_-]{43}$/.test(preauth??'')?preauth:newToken();
     setCookie(response,PREAUTH,token,600);return send(200,{status:auth.status(),csrf:vault.csrf('preauth:'+token)});
    }
    if(path==='/auth/session')return send(200,requireSession());
    if(path==='/auth/passkeys'){const session=requireSession();return send(200,{passkeys:repo.passkeysForUser(session.user.id)});}
    if(path==='/admin/api/apps'){if(requireSession().user.role!=='admin')throw new HttpError(403);return send(200,{applications:repo.listApplications()});}
    if(path==='/docs/content'){
     requireSession();const name=new URL(request.url,config.origin).searchParams.get('guide');
     if(!Object.hasOwn(documents,name))throw new HttpError(404);return send(200,{content:documents[name]});
    }
    if(['/','/login','/setup','/workspace','/admin','/profile','/docs'].includes(path)){
     if(['/workspace','/admin','/profile','/docs'].includes(path)){
      let session;try{session=requireSession();}catch{response.setHeader('Location','/login');return send(303,{status:'sign_in_required'});}
      if(path==='/admin'&&session.user.role!=='admin')throw new HttpError(403);
     }
     return send(200,html,'text/html; charset=utf-8');
    }
    throw new HttpError(404);
   }
   if(request.method!=='POST')throw new HttpError(405);
   if(request.headers.origin!==config.origin)throw new HttpError(403);
   const publicPaths=['/auth/setup/begin','/auth/setup/complete','/auth/login','/auth/passkeys/login/options','/auth/passkeys/login/verify'];
   if(publicPaths.includes(path))requirePreauth();else sessionCsrf();
   const body=await readJson(request);
   if(path==='/auth/setup/begin'){
    fields(body,['code','username','password']);const result=await auth.beginSetup({...body,ip});
    setCookie(response,ENROLL,result.enrollmentToken,600);
    return send(200,{totpSecret:result.totpSecret,otpauthUri:result.otpauthUri});
   }
   if(path==='/auth/setup/complete'){fields(body,['code']);return establish(auth.completeSetup({enrollmentToken:jar[ENROLL],code:body.code,ip}));}
   if(path==='/auth/login'){fields(body,['username','password','code','recoveryCode']);return establish(await auth.login({...body,ip}));}
   if(path==='/auth/logout'){fields(body,[]);auth.logout(sessionToken);setCookie(response,SESSION,'',0);return send(200,{ok:true});}
   if(path==='/auth/step-up'){fields(body,['code']);auth.stepUp(sessionToken,request.headers['x-csrf-token'],body.code,ip);return send(200,{ok:true});}
   if(path==='/auth/passkeys/register/options'){fields(body,[]);return send(200,await passkeys.registrationOptions(sessionToken,request.headers['x-csrf-token']));}
   if(path==='/auth/passkeys/register/verify'){fields(body,['id','response']);return send(200,await passkeys.register(sessionToken,request.headers['x-csrf-token'],body.id,body.response));}
   if(path==='/auth/passkeys/login/options'){fields(body,[]);return send(200,await passkeys.authenticationOptions(ip,preauth));}
   if(path==='/auth/passkeys/login/verify'){fields(body,['id','response']);return establish(await passkeys.authenticate(body.id,body.response,ip,preauth));}
   if(path==='/auth/passkeys/remove'){fields(body,['id']);const user=auth.requireFreshSession(sessionToken,request.headers['x-csrf-token']);repo.removePasskey(user.id,body.id,Date.now());return send(200,{ok:true});}
   if(path==='/admin/api/apps/create'){fields(body,['name','capabilities','networks','scopes','expires']);return send(200,apps.create(sessionToken,request.headers['x-csrf-token'],body));}
   if(path==='/admin/api/apps/rotate'){fields(body,['id']);return send(200,{key:apps.rotate(sessionToken,request.headers['x-csrf-token'],body.id)});}
   if(path==='/admin/api/apps/revoke'){fields(body,['id']);apps.revoke(sessionToken,request.headers['x-csrf-token'],body.id);return send(200,{ok:true});}
   throw new HttpError(404);
  })().catch(error=>{
   if(response.headersSent){response.destroy();return;}
   const status=error instanceof AuthError?401:error instanceof HttpError?error.status:error instanceof TypeError?400:503;
   response.setHeader('Connection','close');
   send(status,{error:{code:status===401?'authentication_failed':status===503?'service_unavailable':'request_rejected'}});
  });
 };
}
