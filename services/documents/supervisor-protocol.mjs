const invalid=()=>new TypeError('invalid_document_supervisor_message');
const identity=value=>typeof value==='string'&&/^(?:app|user):[A-Za-z0-9_-]{1,128}$/.test(value);
const scope=value=>typeof value==='string'&&/^[-A-Za-z0-9_.:]{1,128}$/.test(value);
const jobId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function exact(value,keys,required){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw invalid();}
function owner(message){if(!identity(message.namespace)||!scope(message.scope))throw invalid();}

// Only the local, permission-restricted socket may call this dispatcher.
// Public HTTP authentication must derive namespace/scope before sending a frame.
export function dispatchDocumentMessage(message,{store,runner,structuredStore,now=Date.now}){
 if(!store||!runner||typeof now!=='function')throw invalid();
 if(message?.op==='submit-structured'){
  if(!structuredStore||typeof structuredStore.enqueue!=='function')throw invalid();
  exact(message,['op','namespace','scope','idempotencyKey','report','schema'],['namespace','scope','idempotencyKey','report','schema']);owner(message);
  if(typeof message.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(message.idempotencyKey)||!message.report||typeof message.report!=='object'||Array.isArray(message.report)||!message.schema||typeof message.schema!=='object'||Array.isArray(message.schema))throw invalid();
  let size;try{size=Buffer.byteLength(JSON.stringify({report:message.report,schema:message.schema}));}catch{throw invalid();}
  if(size>131072)throw invalid();
  return structuredStore.enqueue({namespace:message.namespace,scope:message.scope,idempotencyKey:message.idempotencyKey,report:message.report,schema:message.schema,expiresAt:now()+86400000});
 }
 if(message?.op==='structured-status'){
  if(!structuredStore||typeof structuredStore.get!=='function'||typeof structuredStore.result!=='function')throw invalid();
  exact(message,['op','id','namespace','scope'],['id','namespace','scope']);owner(message);if(!jobId(message.id))throw invalid();
  const job=structuredStore.get(message.id,message.namespace,message.scope);if(!job)return null;
  return {...job,...job.status==='complete'?{result:structuredStore.result(message.id,message.namespace,message.scope)}:{}};
 }
 if(message?.op==='claim-owned-structured'){
  if(!structuredStore||typeof structuredStore.claimOwned!=='function')throw invalid();
  exact(message,['op','id','namespace','scope','claimCapability'],['id','namespace','scope','claimCapability']);owner(message);
  if(!jobId(message.id)||typeof message.claimCapability!=='string'||!/^[a-f0-9]{64}$/.test(message.claimCapability))throw invalid();
  return structuredStore.claimOwned({id:message.id,namespace:message.namespace,scope:message.scope,claimCapability:message.claimCapability});
 }
 if(message?.op==='complete-structured'){
  if(!structuredStore||typeof structuredStore.complete!=='function')throw invalid();
  exact(message,['op','id','token','modelText'],['id','token','modelText']);
  if(!jobId(message.id)||typeof message.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(message.token)||typeof message.modelText!=='string'||Buffer.byteLength(message.modelText)>32768)throw invalid();
  return structuredStore.complete(message.id,message.token,message.modelText);
 }
 if(message?.op==='submit'){
  exact(message,['op','namespace','scope','kind','idempotencyKey','name','mime','content_base64','options'],['namespace','scope','kind','idempotencyKey','name','mime','content_base64']);owner(message);
  if(!['ocr','extract'].includes(message.kind)||typeof message.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(message.idempotencyKey)||typeof message.name!=='string'||message.name.length<1||message.name.length>255||/[\\/\x00-\x1f\x7f]/.test(message.name)||typeof message.mime!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(message.mime))throw invalid();
  if(typeof message.content_base64!=='string'||message.content_base64.length<4||message.content_base64.length>13981016||message.content_base64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(message.content_base64))throw invalid();
  const bytes=Buffer.from(message.content_base64,'base64');if(bytes.length<1||bytes.length>10*1024**2||bytes.toString('base64')!==message.content_base64)throw invalid();
  if(message.options!==undefined){exact(message.options,['ocr','language'],[]);if(message.options.ocr!==undefined&&!['auto','off','all'].includes(message.options.ocr)||message.options.language!==undefined&&!['auto','en','ar'].includes(message.options.language))throw invalid();}
  return store.enqueue({namespace:message.namespace,scope:message.scope,kind:message.kind,idempotencyKey:message.idempotencyKey,name:message.name,mime:message.mime,bytes,options:message.options??{},expiresAt:now()+86400000});
 }
 if(message?.op==='status'){
  exact(message,['op','id','namespace','scope'],['id','namespace','scope']);owner(message);if(!jobId(message.id))throw invalid();
  const job=store.get(message.id,message.namespace,message.scope);if(!job)return null;
  return {...job,...job.status==='complete'?{result:store.result(message.id,message.namespace,message.scope)}:{}};
 }
 if(message?.op==='cancel'){
  exact(message,['op','id','namespace','scope'],['id','namespace','scope']);owner(message);if(!jobId(message.id))throw invalid();
  const job=store.get(message.id,message.namespace,message.scope);if(!job)return null;
  return runner.cancel(message.id,message.namespace,message.scope)?{...job,status:job.status==='running'?'cancelling':'cancelled'}:job;
 }
 if(message?.op==='delete'){
  exact(message,['op','id','namespace','scope'],['id','namespace','scope']);owner(message);if(!jobId(message.id))throw invalid();
  if(!store.get(message.id,message.namespace,message.scope))return null;
  runner.cancel(message.id,message.namespace,message.scope);
  return store.requestDelete(message.id,message.namespace,message.scope);
 }
 throw invalid();
}
