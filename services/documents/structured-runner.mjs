import {runStructuredExtractionCandidate} from './structured-extract.mjs';

// Private one-claim-at-a-time stage. The injected generator must use the
// qualified inference client, whose interactive lease owns model admission.
export function createStructuredInferenceGenerator({inference}={}){
 if(typeof inference?.chat!=='function')throw new TypeError('invalid_structured_inference');
 return async ({report,schema,signal})=>{
  const assessed=await runStructuredExtractionCandidate({report,schema,inference,signal});
  const fields=Object.fromEntries(Object.entries(assessed.fields).filter(([,field])=>field.status!=='missing').map(([name,field])=>[name,field.candidates.map(({value,evidenceIds})=>({value,evidenceIds}))]));
  return JSON.stringify({fields});
 };
}

export function createStructuredJobRunner({store,receipt,generateCandidate,barrier}={}){
 if(!store||['claimOwned','complete'].some(name=>typeof store[name]!=='function')||!receipt||typeof receipt!=='object'||typeof generateCandidate!=='function'||typeof barrier?.isClear!=='function')throw new TypeError('invalid_structured_runner');
 const claimReceipt=Object.freeze({id:receipt.id,namespace:receipt.namespace,scope:receipt.scope,claimCapability:receipt.claimCapability});
 if(typeof claimReceipt.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(claimReceipt.id)||typeof claimReceipt.namespace!=='string'||!/^(?:app|user):[A-Za-z0-9_-]{1,128}$/.test(claimReceipt.namespace)||typeof claimReceipt.scope!=='string'||!/^[-a-zA-Z0-9_.:]{1,128}$/.test(claimReceipt.scope)||typeof claimReceipt.claimCapability!=='string'||!/^[a-f0-9]{64}$/.test(claimReceipt.claimCapability))throw new TypeError('invalid_structured_runner');
 let tail=Promise.resolve(),blocked=false;
 function step({signal}={}){
  if(signal!==undefined&&!(signal instanceof AbortSignal))return Promise.reject(new TypeError('invalid_structured_signal'));
  const result=tail.then(async()=>{
   if(blocked)throw new Error('structured_recovery_required');
   if(!barrier.isClear())throw new Error('interactive_recovery_required');
   signal?.throwIfAborted();
   try{
    const job=await store.claimOwned(claimReceipt);if(!job)return null;
    if(!barrier.isClear())throw new Error('interactive_recovery_required');
    signal?.throwIfAborted();
    const modelText=await generateCandidate({report:job.report,schema:job.schema,signal:signal??new AbortController().signal});
    if(!barrier.isClear())throw new Error('interactive_recovery_required');
    signal?.throwIfAborted();
    return await store.complete(job.id,job.token,modelText);
   }catch(error){blocked=true;throw error;}
  });
  tail=result.catch(()=>{});return result;
 }
 return Object.freeze({step});
}
