import {execFileSync} from 'node:child_process';

export const RECOVERY_UNITS=Object.freeze(['localai.service','localai-chat.service','localai-embedding.service','localai-documents.service']);
const blocked=()=>new Error('interactive_recovery_required');
const keys=['LoadState','UnitFileState','ActiveState','SubState','MainPID','ControlPID','ControlGroup','Job','NeedDaemonReload'];

export function parseStoppedMaskedUnit(text){
 if(typeof text!=='string'||text.length>4096)throw blocked();
 const fields=new Map();
 for(const line of (text.endsWith('\n')?text.slice(0,-1):text).split('\n')){
  const at=line.indexOf('=');if(at<1)throw blocked();
  const key=line.slice(0,at);if(!keys.includes(key)||fields.has(key))throw blocked();fields.set(key,line.slice(at+1));
 }
 if(fields.size!==keys.length||fields.get('LoadState')!=='masked'||!['masked','masked-runtime'].includes(fields.get('UnitFileState'))||fields.get('ActiveState')!=='inactive'||fields.get('SubState')!=='dead'||fields.get('MainPID')!=='0'||fields.get('ControlPID')!=='0'||fields.get('ControlGroup')!==''||fields.get('Job')!==''||fields.get('NeedDaemonReload')!=='no')throw blocked();
 return true;
}

export async function verifyOfflineSystemdUnits(readUnit,units=RECOVERY_UNITS){
 if(typeof readUnit!=='function'||!Array.isArray(units)||units.length<1||units.length>8||new Set(units).size!==units.length||units.some(unit=>typeof unit!=='string'||!/^localai-[a-z0-9-]+\.service$|^localai\.service$/.test(unit)))throw new TypeError('invalid_interactive_recovery_units');
 try{for(let pass=0;pass<2;pass++)for(const unit of units)parseStoppedMaskedUnit(await readUnit(unit));}
 catch{throw blocked();}
 return true;
}

export function readSystemdUnit(unit){
 return execFileSync('/usr/bin/systemctl',['show',unit,'--no-pager',...keys.map(key=>'--property='+key)],{encoding:'utf8',timeout:5000,maxBuffer:4096});
}

export function readDocumentWorkerInventory(){
 return execFileSync('/usr/bin/systemctl',['list-units','--all','--type=service','--output=json','--no-pager','localai-document-job-*.service'],{encoding:'utf8',timeout:5000,maxBuffer:65536});
}

export async function verifyOfflineDocumentWorkers(readInventory){
 if(typeof readInventory!=='function')throw new TypeError('invalid_interactive_recovery_inventory');
 try{for(let pass=0;pass<2;pass++){
  const text=await readInventory();if(typeof text!=='string'||text.length>65536)throw blocked();
  const units=JSON.parse(text);if(!Array.isArray(units)||units.length!==0)throw blocked();
 }}catch{throw blocked();}
 return true;
}
