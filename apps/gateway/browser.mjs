import { readFileSync } from 'node:fs';
import { newToken,equalSecret } from '../../packages/auth/crypto.mjs';
import { matchesNetwork,resolveClientIp } from '../../packages/auth/network.mjs';
import { AuthError } from '../../packages/auth/service.mjs';
import { InferenceError } from '../../services/inference/client.mjs';
import {inspectDocument,DocumentError} from '../../services/documents/validation.mjs';
const assets=new Map([
 ['/assets/passkey-name.js',['text/javascript; charset=utf-8',readFileSync(new URL('../../packages/auth/passkey-name.mjs',import.meta.url))]],
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
function readJson(request,maxBytes=65536,deadlineMs=0){
 return new Promise((resolve,reject)=>{
  let bytes=0,done=false;const chunks=[];
  const timer=deadlineMs?setTimeout(()=>{chunks.length=0;fail(408);request.resume();},deadlineMs):null;timer?.unref();
  const fail=status=>{if(!done){done=true;clearTimeout(timer);reject(new HttpError(status));}};
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type']??'')){request.resume();fail(415);return;}
  request.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>maxBytes){chunks.length=0;fail(413);}else chunks.push(chunk);});
  request.on('error',()=>fail(400));
  request.on('aborted',()=>fail(400));
  request.on('end',()=>{if(done)return;done=true;clearTimeout(timer);try{const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();resolve(body);}catch{reject(new HttpError(400));}});
 });
}
function fields(body,allowed){if(Object.keys(body).some(k=>!allowed.includes(k)))throw new HttpError(400);return body;}
export function createBrowserHandler({config,repo,auth,apps,passkeys,vault,inference,documentClient}){
 const origin=new URL(config.origin);
 let pendingDocumentUploads=0;
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
   const documentStatus=/^\/v1\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/status$/.exec(path);
   if(documentClient&&(path==='/v1/ocr'||path==='/v1/extract'||documentStatus)){
    const submit=!documentStatus,capability=submit?path.slice(4):'document:read';
    if(request.method!==(submit?'POST':'GET'))throw new HttpError(405);
    if(request.headers.origin!==undefined&&request.headers.origin!==config.origin)throw new HttpError(403);
    const bearer=request.headers.authorization!==undefined;
    if(bearer&&(request.headers.cookie||!/^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers.authorization)))throw new HttpError(403);
    let namespace,scope,appKey;
    if(bearer){appKey=request.headers.authorization.slice(7);if(submit)try{namespace='app:'+apps.authenticate(appKey,{capability,ip}).applicationId;}catch{throw new HttpError(403);}}
    else{const session=requireSession();namespace='user:'+session.user.id;if(submit){if(request.headers.origin!==config.origin)throw new HttpError(403);sessionCsrf();}}
    let command;
    if(submit){
     if(pendingDocumentUploads>=2)throw new HttpError(429);
     pendingDocumentUploads++;let released=false;const release=()=>{if(released)return;released=true;pendingDocumentUploads--;response.off('finish',release);response.off('close',release);};response.once('finish',release);response.once('close',release);
     const body=fields(await readJson(request,14*1024*1024,15000),['name','mime','content_base64','scope','ocr','language']);scope=body.scope;
     if(typeof scope!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(scope)||typeof body.mime!=='string'||body.ocr!==undefined&&!['auto','off','all'].includes(body.ocr)||body.language!==undefined&&!['auto','en','ar'].includes(body.language)||typeof request.headers['idempotency-key']!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(request.headers['idempotency-key'])||typeof body.content_base64!=='string'||body.content_base64.length<4||body.content_base64.length>13981016||body.content_base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.content_base64))throw new HttpError(400);
     const bytes=Buffer.from(body.content_base64,'base64');if(bytes.toString('base64')!==body.content_base64)throw new HttpError(400);
     try{inspectDocument({name:body.name,mime:body.mime,bytes});}catch(error){if(error instanceof DocumentError)throw new HttpError(error.code==='document_too_large'?413:400);throw error;}
     if(bearer)try{namespace='app:'+apps.authenticate(appKey,{capability,ip,scopes:[scope]}).applicationId;}catch{throw new HttpError(403);}
     command={op:'submit',namespace,scope,kind:capability,name:body.name,mime:body.mime,content_base64:body.content_base64,idempotencyKey:request.headers['idempotency-key'],options:{ocr:body.ocr??'auto',language:body.language??'auto'}};
    }else{
     const url=new URL(request.url,config.origin);scope=url.searchParams.get('scope');if(url.searchParams.size!==1||typeof scope!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(scope))throw new HttpError(400);
     if(bearer)try{namespace='app:'+apps.authenticate(appKey,{capability,ip,scopes:[scope]}).applicationId;}catch{throw new HttpError(403);}
     command={op:'status',id:documentStatus[1],namespace,scope};
    }
    const controller=new AbortController(),cancel=()=>controller.abort();response.once('close',cancel);request.once('aborted',cancel);
    try{const result=await documentClient(command,{signal:controller.signal});if(!result)throw new HttpError(404);return submit?send(202,{id:result.id,status:result.status,status_url:'/v1/documents/'+result.id+'/status?scope='+encodeURIComponent(scope),expires_at:result.expiresAt}):send(200,result);}
    catch(error){if(error instanceof HttpError)throw error;if(error?.message==='job_idempotency_conflict')throw new HttpError(409);if(error?.message==='document_too_large')throw new HttpError(413);if(error?.message==='invalid_document_supervisor_message')throw new HttpError(400);throw error;}
    finally{controller.abort();response.off('close',cancel);request.off('aborted',cancel);}
   }
   if(path.startsWith('/v1/')){
    const routes={'/v1/models':{method:'GET',capability:'models'},'/v1/chat/completions':{method:'POST',capability:'chat'},'/v1/embeddings':{method:'POST',capability:'embeddings'}};
    const route=routes[path];if(!route)throw new HttpError(404);
    if(request.method!==route.method)throw new HttpError(405);
    if(request.headers.origin!==undefined&&request.headers.origin!==config.origin)throw new HttpError(403);
    if(request.headers.authorization!==undefined){
     if(sessionToken||!/^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers.authorization))throw new HttpError(403);
     try{apps.authenticate(request.headers.authorization.slice(7),{capability:route.capability,ip});}catch{throw new HttpError(403);}
    }else{
     requireSession();
     if(route.method==='POST'){if(request.headers.origin!==config.origin)throw new HttpError(403);sessionCsrf();}
    }
    if(!inference)throw new HttpError(503);
    if(path==='/v1/models')return send(200,{object:'list',data:[{id:'localai-chat',object:'model',owned_by:'localai'},{id:'localai-embedding',object:'model',owned_by:'localai'}]});
    const body=await readJson(request),controller=new AbortController(),cancel=()=>controller.abort();
    response.once('close',cancel);request.once('aborted',cancel);
    try{
     if(path==='/v1/embeddings')return send(200,await inference.embeddings(body,{signal:controller.signal}));
     const result=await inference.chat(body,{signal:controller.signal,onChunk:async chunk=>{
      if(controller.signal.aborted)throw controller.signal.reason;
      if(!response.headersSent){response.statusCode=200;response.setHeader('Content-Type','text/event-stream; charset=utf-8');response.setHeader('X-Accel-Buffering','no');}
      if(!response.write(chunk))await new Promise((resolve,reject)=>{
       const done=()=>{cleanup();resolve();},closed=()=>{cleanup();reject(new Error('Client disconnected'));};
       const cleanup=()=>{response.off('drain',done);response.off('close',closed);};
       response.once('drain',done);response.once('close',closed);
      });
     }});
     if(body.stream){response.end();return;}return send(200,result);
    }finally{controller.abort();response.off('close',cancel);request.off('aborted',cancel);}
   }
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
   if(path==='/auth/totp/replace/begin'){fields(body,['password','code','recoveryCode']);return establish(await auth.beginTotpRotation(sessionToken,request.headers['x-csrf-token'],{...body,ip}));}
   if(path==='/auth/totp/replace/complete'){fields(body,['id','code']);return establish(auth.completeTotpRotation(sessionToken,request.headers['x-csrf-token'],body.id,body.code,ip));}
   if(path==='/auth/passkeys/register/options'){fields(body,[]);return send(200,await passkeys.registrationOptions(sessionToken,request.headers['x-csrf-token']));}
   if(path==='/auth/passkeys/register/verify'){fields(body,['id','response','name']);return send(200,await passkeys.register(sessionToken,request.headers['x-csrf-token'],body.id,body.response,body.name));}
   if(path==='/auth/passkeys/rename'){fields(body,['id','name']);return send(200,passkeys.rename(sessionToken,request.headers['x-csrf-token'],body.id,body.name));}
   if(path==='/auth/passkeys/login/options'){fields(body,[]);return send(200,await passkeys.authenticationOptions(ip,preauth));}
   if(path==='/auth/passkeys/login/verify'){fields(body,['id','response']);return establish(await passkeys.authenticate(body.id,body.response,ip,preauth));}
   if(path==='/auth/passkeys/remove'){fields(body,['id']);const user=auth.requireFreshSession(sessionToken,request.headers['x-csrf-token']);repo.removePasskey(user.id,body.id,Date.now());return send(200,{ok:true});}
   if(path==='/admin/api/apps/create'){fields(body,['name','capabilities','networks','scopes','expires']);return send(200,apps.create(sessionToken,request.headers['x-csrf-token'],body));}
   if(path==='/admin/api/apps/rotate'){fields(body,['id']);return send(200,{key:apps.rotate(sessionToken,request.headers['x-csrf-token'],body.id)});}
   if(path==='/admin/api/apps/revoke'){fields(body,['id']);apps.revoke(sessionToken,request.headers['x-csrf-token'],body.id);return send(200,{ok:true});}
   throw new HttpError(404);
  })().catch(error=>{
   if(response.destroyed)return;
   if(response.headersSent){response.destroy();return;}
   const status=error instanceof AuthError?401:error instanceof HttpError||error instanceof InferenceError?error.status:error instanceof TypeError?400:503;
   response.setHeader('Connection','close');
   send(status,{error:{code:error instanceof InferenceError?error.code:status===401?'authentication_failed':status===503?'service_unavailable':'request_rejected'}});
  });
 };
}
