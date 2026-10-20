import {recoverDocumentUnits} from './unit-recovery.mjs';
import {runNativeDocumentUnit} from './native-runner.mjs';

// Serializes recovery and document launches inside one supervisor process.
// The eventual systemd supervisor service must also be single-instance.
export function createDocumentStartupGate({recover=recoverDocumentUnits,launch=runNativeDocumentUnit,onStopped}={}){
 if(typeof recover!=='function'||typeof launch!=='function'||typeof onStopped!=='function')throw new TypeError('invalid_document_startup_gate');
 let tail=Promise.resolve(),ready=false;
 const serialize=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 async function ensureRecovered(){if(ready)return;await recover({onStopped});ready=true;}
 return Object.freeze({
  start(){return serialize(ensureRecovered);},
  run(options){return serialize(async()=>{
   await ensureRecovered();
   try{const result=await launch(options);if(result?.cleanupConfirmed!==true)throw new Error('native_cleanup_unconfirmed');return result;}
   catch(error){ready=false;throw error;}
  });}
 });
}
