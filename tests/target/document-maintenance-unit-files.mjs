// Disposable Debian proof. It creates only randomized synthetic /etc units.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdtempSync,readFileSync,readlinkSync,unlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beginInteractiveMaintenance,finishInteractiveMaintenance} from '../../installer/interactive-maintenance-transaction.mjs';
import {createNativeMaintenanceControl,recoverNativeDocumentWorkers} from '../../installer/interactive-maintenance-native.mjs';
import {createInteractiveLeaseBarrier} from '../../services/resources/interactive-lease-barrier.mjs';
import {readDocumentWorkerInventory,readSystemdUnit,verifyOfflineDocumentWorkers,verifyOfflineSystemdUnits} from '../../services/resources/interactive-lease-recovery.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:20000,maxBuffer:8192});
const pid=unit=>systemctl('show',unit,'--property=MainPID','--value').trim();
const packageDigest=()=>createHash('sha256').update(readFileSync('/var/lib/dpkg/status')).digest('hex');
const baseline={gateway:pid('localai.service'),chat:pid('localai-chat.service'),embedding:pid('localai-embedding.service'),packages:packageDigest()};
assert.ok(baseline.gateway!=='0'&&baseline.chat!=='0'&&baseline.embedding!=='0');
const suffix=randomBytes(4).toString('hex');
const units=['gateway','chat','embedding','supervisor'].map(role=>`localai-recovery-${suffix}-${role}.service`);
const workerUnit=`localai-document-job-${suffix}.service`;
const paths=units.map(unit=>join('/etc/systemd/system',unit));
const directory=mkdtempSync('/root/localai-maintenance-proof-');chmodSync(directory,0o700);
const journal=join(directory,'maintenance.json');let created=0,workerMayRun=false;
const barrier=createInteractiveLeaseBarrier({path:join(directory,'interactive.lock'),journalPath:journal});let markerToken;
const source='[Unit]\nDescription=Disposable Local AI maintenance proof\n[Service]\nType=simple\nExecStart=/bin/sleep infinity\nRestart=no\nRuntimeMaxSec=30\nNoNewPrivileges=yes\nPrivateNetwork=yes\nProtectSystem=strict\n[Install]\nWantedBy=multi-user.target\n';
const control=createNativeMaintenanceControl({units}),capture=control.capture;
const options={journal,unitDirectory:'/etc/systemd/system',units,control,recoverWorkers:recoverNativeDocumentWorkers,verifyOffline:async()=>{await verifyOfflineSystemdUnits(readSystemdUnit,units);await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);return true;}};
try{
 for(const path of paths){writeFileSync(path,source,{flag:'wx',mode:0o644});created++;}
 systemctl('daemon-reload');systemctl('enable',units[0],units[1]);systemctl('start',units[0],units[1]);
 assert.equal(capture(units[0]).active,true);assert.equal(capture(units[0]).enabled,true);
 markerToken=barrier.begin();
 workerMayRun=true;
 execFileSync('/usr/bin/systemd-run',['--unit='+workerUnit,'--collect','--property=PrivateNetwork=yes','--property=MemoryMax=64M','--property=MemorySwapMax=0','--property=RuntimeMaxSec=30','/bin/sleep','infinity'],{encoding:'utf8',timeout:20000});
 assert.ok(Number(pid(workerUnit))>0);
 await beginInteractiveMaintenance(options);
 assert.equal(JSON.parse(readDocumentWorkerInventory()).some(row=>row.unit===workerUnit),false);
 workerMayRun=false;
 assert.equal(existsSync(journal),true);assert.equal(barrier.isClear(),false);
 await finishInteractiveMaintenance(options);
 assert.equal(existsSync(journal),false);assert.equal(barrier.isClear(),false);
 for(const crashPoint of ['after-begin','after-first-mask','during-restore']){
  try{execFileSync(process.execPath,[fileURLToPath(new URL('./document-maintenance-crash-child.mjs',import.meta.url)),suffix,directory,crashPoint],{encoding:'utf8',timeout:20000});assert.fail('child did not stop abruptly');}
  catch(error){assert.equal(error.signal,'SIGKILL');}
  assert.equal(existsSync(journal),true);assert.equal(barrier.isClear(),false);
  if(crashPoint==='after-begin')assert.equal(await verifyOfflineSystemdUnits(readSystemdUnit,units),true);
  if(crashPoint==='after-first-mask'){
   assert.equal(lstatSync(paths[0]).isSymbolicLink(),true);
   assert.equal(readlinkSync(paths[0]),'/dev/null');
   for(const path of paths.slice(1))assert.equal(readFileSync(path,'utf8'),source);
  }
  await finishInteractiveMaintenance(options);
  assert.equal(existsSync(journal),false);assert.equal(barrier.isClear(),false);
 }
 await beginInteractiveMaintenance(options);
 await barrier.recover(async()=>{await verifyOfflineSystemdUnits(readSystemdUnit,units);await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);return true;});
 assert.equal(existsSync(join(directory,'interactive.lock')),false);
 assert.equal(barrier.isClear(),false);
 await finishInteractiveMaintenance(options);
 assert.equal(barrier.isClear(),true);
 for(const path of paths)assert.equal(readFileSync(path,'utf8'),source);
 assert.equal(pid('localai.service'),baseline.gateway);assert.equal(pid('localai-chat.service'),baseline.chat);assert.equal(pid('localai-embedding.service'),baseline.embedding);assert.equal(packageDigest(),baseline.packages);
 process.stdout.write(JSON.stringify({gate:'native-etc-maintenance-transaction',effectiveMasks:true,transientWorkerStopped:true,priorServiceStatesRestored:true,crashJournalRecovered:true,partialMaskCrashRecovered:true,restoreCrashRecovered:true,exactFilesRestored:true,journalBlocksUntilRestore:true,realGatewayAndWorkersUnchanged:true,packageInventoryUnchanged:true,activated:false})+'\n');
}finally{
 let restoreFailure;
 if(existsSync(journal))try{await finishInteractiveMaintenance(options);}catch(error){restoreFailure=error;process.stderr.write(`Disposable maintenance journal retained at ${journal}: ${error.message}\n`);}
 if(workerMayRun)try{systemctl('stop',workerUnit);}catch{}
 for(const unit of units)try{systemctl('stop',unit);}catch{}
 if(restoreFailure)throw restoreFailure;
 for(const unit of units)try{systemctl('disable',unit);}catch{}
 for(const path of paths.slice(0,created))try{unlinkSync(path);}catch{}
 try{systemctl('daemon-reload');}catch{}
 if(markerToken&& !barrier.isClear())barrier.finish(markerToken);
 rmSync(directory,{recursive:true,force:true});
}
