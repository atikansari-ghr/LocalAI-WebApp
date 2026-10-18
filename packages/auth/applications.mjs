import { randomUUID } from 'node:crypto';
import { newToken, tokenDigest } from './crypto.mjs';
import { matchesNetwork } from './network.mjs';
import { AuthError } from './service.mjs';
const CAPABILITIES=new Set(['models','chat','embeddings','ocr','extract','ingest','rag','document:read','document:delete']);
const NEEDS_SCOPE=new Set(['rag','ingest','document:read','document:delete']);
function names(values,max=100){
 if(!Array.isArray(values)||values.length>max||values.some(v=>typeof v!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(v)))throw new TypeError('Invalid scope list');
 return [...new Set(values)];
}
export function createApplicationService({repo,auth,now=Date.now}){
 return {
  create(token,csrf,{name,capabilities,networks=[],scopes=[],expires=null}){
   const actor=auth.requireAdmin(token,csrf);
   if(typeof name!=='string'||!name.trim()||name.length>100)throw new TypeError('Invalid application name');
   capabilities=names(capabilities);
   if(!capabilities.length||capabilities.some(c=>!CAPABILITIES.has(c)))throw new TypeError('Unknown capability');
   scopes=names(scopes);matchesNetwork('127.0.0.1',networks);
   if(expires!==null&&(!Number.isSafeInteger(expires)||expires<=now()))throw new TypeError('Invalid key expiry');
   const id=randomUUID(),key=newToken();
   repo.createApplication({id,name:name.trim(),capabilities,networks,scopes,keyHash:tokenDigest(key),expires},actor.id,now());
   return {id,key};
  },
  rotate(token,csrf,id){const actor=auth.requireAdmin(token,csrf),key=newToken();repo.rotateApplication(id,tokenDigest(key),actor.id,now());return key;},
  revoke(token,csrf,id){const actor=auth.requireAdmin(token,csrf);repo.revokeApplication(id,actor.id,now());},
  authenticate(key,{capability,ip,scopes=[]}){
   try{
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key)||!CAPABILITIES.has(capability))throw new AuthError();
    const app=repo.applicationByKey(tokenDigest(key));
    if(!app||app.enabled!==1||(app.expires!==null&&app.expires<=now())||!JSON.parse(app.capabilities).includes(capability))throw new AuthError();
    const networks=JSON.parse(app.networks);
    if(!matchesNetwork(ip,networks.length?networks:['0.0.0.0/0','::/0']))throw new AuthError();
    scopes=names(scopes);
    const permitted=JSON.parse(app.scopes);
    if((NEEDS_SCOPE.has(capability)&&!scopes.length)||scopes.some(scope=>!permitted.includes(scope)))throw new AuthError();
    return {applicationId:app.id,namespace:app.id,scopes};
   }catch{throw new AuthError();}
  }
 };
}
