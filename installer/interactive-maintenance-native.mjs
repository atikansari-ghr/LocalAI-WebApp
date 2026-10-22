import {execFileSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {assertInteractiveMaintenanceUnits} from './interactive-maintenance-journal.mjs';
import {RECOVERY_UNITS,readDocumentWorkerInventory,readSystemdUnit,verifyOfflineDocumentWorkers,verifyOfflineSystemdUnits} from '../services/resources/interactive-lease-recovery.mjs';
import {recoverDocumentUnits} from '../services/documents/unit-recovery.mjs';

const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:20000,maxBuffer:8192});

export function requireInitialNativeServices({journal,control}){
 if(typeof journal!=='string'||typeof control?.capture!=='function')throw new TypeError('invalid_interactive_maintenance_preflight');
 try{lstatSync(journal);return true;}
 catch(error){if(error?.code!=='ENOENT')throw error;}
 for(const unit of RECOVERY_UNITS)if(!control.capture(unit).available)throw new Error('interactive_maintenance_phase4_service_required');
 return false;
}

export function parseNativeMaintenanceState(text){
 if(typeof text!=='string'||text.length>4096)throw new Error('interactive_maintenance_state_unavailable');
 const rows=text.trim().split('\n'),fields=new Map();
 for(const row of rows){const at=row.indexOf('=');if(at<1||fields.has(row.slice(0,at)))throw new Error('interactive_maintenance_state_unavailable');fields.set(row.slice(0,at),row.slice(at+1));}
 if(fields.size!==3||!['loaded','not-found'].includes(fields.get('LoadState')))throw new Error('interactive_maintenance_state_unavailable');
 if(fields.get('LoadState')==='not-found'){
  if(fields.get('ActiveState')!=='inactive')throw new Error('interactive_maintenance_state_unavailable');
  return {available:false,active:false,enabled:false};
 }
 if(!['active','inactive'].includes(fields.get('ActiveState'))||!['enabled','disabled'].includes(fields.get('UnitFileState')))throw new Error('interactive_maintenance_state_unavailable');
 return {available:true,active:fields.get('ActiveState')==='active',enabled:fields.get('UnitFileState')==='enabled'};
}

export function createNativeMaintenanceControl({units}={}){
 const names=assertInteractiveMaintenanceUnits(units),allowed=new Set(names);
 const check=unit=>{if(!allowed.has(unit))throw new TypeError('invalid_interactive_maintenance_units');};
 function capture(unit){
  check(unit);
  const text=systemctl('show',unit,'--property=LoadState','--property=ActiveState','--property=UnitFileState','--no-pager');
  return parseNativeMaintenanceState(text);
 }
 return Object.freeze({
  capture,
  stop(unit){check(unit);if(capture(unit).available)systemctl('stop',unit);},
  reload(){systemctl('daemon-reload');},
  restore(unit,state){
   check(unit);
   if(!state?.available)return;
   systemctl(state.enabled?'enable':'disable',unit);
   if(state.active){systemctl('reset-failed',unit);systemctl('start',unit);}
   else systemctl('stop',unit);
  },
  verifyRestored(states){for(const unit of names){const actual=capture(unit),prior=states?.[unit];if(!prior||actual.available!==prior.available||actual.active!==prior.active||actual.enabled!==prior.enabled)throw new Error('interactive_maintenance_restore_unconfirmed');}},
 });
}

export async function verifyNativeMaintenanceOffline(units=RECOVERY_UNITS){
 await verifyOfflineSystemdUnits(readSystemdUnit,assertInteractiveMaintenanceUnits(units));
 await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);
 return true;
}

export async function recoverNativeDocumentWorkers(){
 await recoverDocumentUnits();
 await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);
}
