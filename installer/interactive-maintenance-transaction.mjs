import {applyInteractiveUnitMasks,completeInteractiveMaintenanceJournal,prepareInteractiveMaintenanceJournal,readInteractiveMaintenanceJournal,restoreInteractiveUnitFiles} from './interactive-maintenance-journal.mjs';
import {RECOVERY_UNITS} from '../services/resources/interactive-lease-recovery.mjs';
import {lstatSync} from 'node:fs';

function validControl(control){
 if(!control||['capture','stop','reload','restore','verifyRestored'].some(method=>typeof control[method]!=='function'))throw new TypeError('invalid_interactive_maintenance_control');
}
export async function finishInteractiveMaintenance({journal,unitDirectory,units,control}){
 validControl(control);
 const record=readInteractiveMaintenanceJournal({journal,unitDirectory,units});
 restoreInteractiveUnitFiles({journal,unitDirectory,units});
 await control.reload();
 for(const file of record.files)await control.restore(file.unit,record.services[file.unit]);
 await control.verifyRestored(record.services);
 completeInteractiveMaintenanceJournal({journal,unitDirectory,units});
 return Object.freeze({restored:true});
}
export async function beginInteractiveMaintenance({journal,unitDirectory,units,control,recoverWorkers,verifyOffline}){
 validControl(control);
 if(typeof recoverWorkers!=='function'||typeof verifyOffline!=='function')throw new TypeError('invalid_interactive_maintenance_proof');
 let interrupted=false;
 try{lstatSync(journal);interrupted=true;}catch(error){if(error?.code!=='ENOENT')throw error;}
 if(interrupted)await finishInteractiveMaintenance({journal,unitDirectory,units,control});
 const names=units??RECOVERY_UNITS,serviceStates={};
 for(const unit of names)serviceStates[unit]=await control.capture(unit);
 const record=prepareInteractiveMaintenanceJournal({journal,unitDirectory,units,serviceStates});
 try{
  for(const file of record.files)await control.stop(file.unit);
  applyInteractiveUnitMasks({journal,unitDirectory,units});
  await control.reload();
  await recoverWorkers();
  if(await verifyOffline()!==true)throw new Error('interactive_recovery_required');
  return Object.freeze({offlineReady:true});
 }catch(error){
  try{await finishInteractiveMaintenance({journal,unitDirectory,units,control});}
  catch(recovery){throw new AggregateError([error,recovery],'Offline maintenance failed and restoration is incomplete; protected journal retained');}
  throw error;
 }
}
