import {createDocumentStartupGate} from './startup-gate.mjs';

// Private candidate: claim only after startup recovery and keep each claim
// inside the same serialized launch/finalization sequence.
export function createDocumentJobRunner({store,workerPath,recover,launch,timeoutMs=120000}={}){
 if(!store||['recoverInterrupted','claim','get','complete','fail','finishCancellation'].some(method=>typeof store[method]!=='function')||typeof workerPath!=='string'||!workerPath||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new TypeError('invalid_document_job_runner');
 const gate=createDocumentStartupGate({recover,launch,onStopped:()=>store.recoverInterrupted({nativeCleanupConfirmed:true})});
 let tail=Promise.resolve();
 function step(){const result=tail.then(async()=>{
  await gate.start();
  const job=store.claim();if(!job)return null;
  const request={kind:job.kind,name:job.name,mime:job.mime,content_base64:job.bytes.toString('base64'),options:job.options};
  try{
   const proof=await gate.run({workerPath,request,timeoutMs});
   const current=store.get(job.id,job.namespace,job.scope);
   if(current?.status==='cancelling'){store.finishCancellation(job.id,job.token,{nativeCleanupConfirmed:true});return store.get(job.id,job.namespace,job.scope);}
   return store.complete(job.id,job.token,proof.result,{nativeCleanupConfirmed:true});
  }catch(error){
   try{if(error?.cleanupConfirmed===true){const current=store.get(job.id,job.namespace,job.scope);if(current?.status==='cancelling')store.finishCancellation(job.id,job.token,{nativeCleanupConfirmed:true});else if(current?.status==='running'){const code=/^document_[a-z0-9_]{1,55}$/.test(error.message)?error.message:'document_worker_failed';store.fail(job.id,job.token,code,{nativeCleanupConfirmed:true});}}}
   finally{await gate.requireRecovery();}
   throw error;
  }
 });tail=result.catch(()=>{});return result;}
 return Object.freeze({step});
}
