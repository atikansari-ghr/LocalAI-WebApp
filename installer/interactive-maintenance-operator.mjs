import {lstatSync} from 'node:fs';
import {beginInteractiveMaintenance,finishInteractiveMaintenance} from './interactive-maintenance-transaction.mjs';
import {assertInteractiveMaintenanceBarrier} from '../services/resources/interactive-lease-barrier.mjs';

function journalExists(path){
 try{lstatSync(path);return true;}
 catch(error){if(error?.code==='ENOENT')return false;throw error;}
}

// The caller must hold the exclusive installer/runtime locks for this entire
// operation. The journal itself blocks document claims after marker removal.
export async function runInteractiveMaintenance(options){
 const {journal,barrier,verifyOffline}=options??{};
 if(!barrier||typeof barrier.isClear!=='function'||typeof barrier.recover!=='function'||typeof verifyOffline!=='function')throw new TypeError('invalid_interactive_maintenance_operator');
 assertInteractiveMaintenanceBarrier(barrier,journal);
 let restored=false;
 if(journalExists(journal)){
  await finishInteractiveMaintenance(options);
  restored=true;
 }
 if(barrier.isClear())return Object.freeze({restored,recovered:false});
 await beginInteractiveMaintenance(options);
 let recoveryError;
 try{await barrier.recover(verifyOffline);}
 catch(error){recoveryError=error;}
 try{await finishInteractiveMaintenance(options);}
 catch(error){
  if(recoveryError)throw new AggregateError([recoveryError,error],'Interactive recovery failed and maintenance journal retained');
  throw error;
 }
 if(recoveryError)throw recoveryError;
 return Object.freeze({restored:true,recovered:true});
}
