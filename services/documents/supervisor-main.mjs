import {existsSync,lstatSync,readdirSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {initializeVault,openVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from './jobs.mjs';
import {createDocumentJobRunner} from './job-runner.mjs';
import {assertSafeDocumentWorkerPath} from './native-runner.mjs';
import {createDocumentSupervisorSocket} from './supervisor-socket.mjs';
import {createDocumentSupervisorScheduler} from './supervisor-scheduler.mjs';
import {createResourceAdmission} from '../resources/admission.mjs';
import {createResourceReader} from '../resources/snapshot.mjs';
import {createInteractiveLeaseServer} from '../resources/interactive-lease.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('native_supervisor_required');
const proof=process.env.TARGET_TEST_LXC==='disposable';
if(!proof&&(process.env.LOCALAI_DOCUMENT_PROOF_STATE_DIR||process.env.LOCALAI_DOCUMENT_PROOF_WORKER||process.env.LOCALAI_DOCUMENT_PROOF_SOCKET))throw new Error('invalid_document_supervisor_configuration');
const stateDir=proof?process.env.LOCALAI_DOCUMENT_PROOF_STATE_DIR:'/var/lib/localai-documents';
const workerPath=proof?process.env.LOCALAI_DOCUMENT_PROOF_WORKER:'/opt/localai/current/services/documents/workers/document-worker.mjs';
const socketPath=proof?process.env.LOCALAI_DOCUMENT_PROOF_SOCKET:'/run/localai-documents/document.sock';
if(typeof stateDir!=='string'||!isAbsolute(stateDir)||typeof workerPath!=='string'||!isAbsolute(workerPath)||!workerPath.startsWith('/opt/localai/')||typeof socketPath!=='string'||!isAbsolute(socketPath))throw new Error('invalid_document_supervisor_configuration');
assertSafeDocumentWorkerPath(workerPath);
const state=lstatSync(stateDir);if(!state.isDirectory()||state.uid!==0||(state.mode&0o077)!==0)throw new Error('unsafe_document_state_directory');
const keyPath=join(stateDir,'master.key'),dbPath=join(stateDir,'jobs.sqlite');
const keyExists=existsSync(keyPath),dbExists=existsSync(dbPath);
if(keyExists&&!dbExists)throw new Error('document_state_recovery_required');
const vault=keyExists?openVault(keyPath):readdirSync(stateDir).length===0?initializeVault(keyPath,{encryptedStateExists:false}):null;
if(!vault)throw new Error('document_state_recovery_required');
const store=openDocumentJobStore(dbPath,{vault}),runner=createDocumentJobRunner({store,workerPath});
const admission=createResourceAdmission({resources:createResourceReader()});
const scheduler=createDocumentSupervisorScheduler({runner,admission});
let stopping=false,wake,stopPromise;
await scheduler.prepare();
const socket=await createDocumentSupervisorSocket({socketPath,store,runner,isStopping:()=>stopping});
const lease=await createInteractiveLeaseServer({socketPath:join(dirname(socketPath),'interactive.sock'),admission});
const requestStop=()=>{if(stopping)return;stopping=true;socket.close();void lease.close().catch(()=>{});wake?.();stopPromise=runner.stop();void stopPromise.catch(()=>{});};
process.on('SIGTERM',requestStop);process.on('SIGINT',requestStop);
const pause=ms=>new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},ms);wake=()=>{clearTimeout(timer);wake=null;resolve();};if(stopping)wake();});
try{
 while(!stopping){
  try{const result=await scheduler.step();if(result)continue;}
  catch(error){const code=typeof error?.message==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(error.message)?error.message:'document_worker_failed';if(!['background_resource_pressure','background_postponed','resource_measurement_unavailable'].includes(code))process.stderr.write(code+'\n');}
  if(!stopping)await pause(500);
 }
 await (stopPromise??runner.stop());
}finally{process.off('SIGTERM',requestStop);process.off('SIGINT',requestStop);if(!stopping){socket.close();await lease.close();}store.close();}
