import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInteractiveLeaseBarrier} from '../services/resources/interactive-lease-barrier.mjs';
import {createNativeMaintenanceControl,recoverNativeDocumentWorkers,requireInitialNativeServices,verifyNativeMaintenanceOffline} from './interactive-maintenance-native.mjs';
import {runInteractiveMaintenance} from './interactive-maintenance-operator.mjs';

const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
function assertProductionContext(){
 if(process.argv.length!==3||process.argv[2]!=='--recover'||process.platform!=='linux'||process.getuid?.()!==0)throw new Error('interactive_maintenance_root_command_required');
 const os=readFileSync('/etc/os-release','utf8');
 if(!/^ID=debian$/m.test(os)||!/^VERSION_ID="?13"?$/m.test(os))throw new Error('interactive_maintenance_debian13_required');
 if(realpathSync(sourceRoot)!==realpathSync('/opt/localai/current'))throw new Error('interactive_maintenance_installed_source_required');
 const systemd=lstatSync('/run/systemd/system');if(!systemd.isDirectory())throw new Error('interactive_maintenance_systemd_required');
 const state=lstatSync('/var/lib/localai-documents');if(!state.isDirectory()||state.isSymbolicLink()||state.uid!==0||(state.mode&0o077)!==0)throw new Error('unsafe_document_state_directory');
}

try{
 assertProductionContext();
 const stateDir='/var/lib/localai-documents',journal=join(stateDir,'maintenance.json');
 const control=createNativeMaintenanceControl();
 requireInitialNativeServices({journal,control});
 const barrier=createInteractiveLeaseBarrier({path:join(stateDir,'interactive.lock'),journalPath:journal});
 const result=await runInteractiveMaintenance({journal,unitDirectory:'/etc/systemd/system',control,barrier,recoverWorkers:recoverNativeDocumentWorkers,verifyOffline:()=>verifyNativeMaintenanceOffline()});
 process.stdout.write(JSON.stringify({gate:'interactive-maintenance',...result})+'\n');
}catch(error){
 process.stderr.write((error instanceof Error?error.message:'interactive_maintenance_failed')+'\n');
 process.exitCode=1;
}
