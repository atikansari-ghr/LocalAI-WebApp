// Disposable Debian proof. It creates only randomized synthetic /etc units.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdtempSync,readFileSync,unlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beginInteractiveMaintenance,finishInteractiveMaintenance} from '../../installer/interactive-maintenance-transaction.mjs';
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
const paths=units.map(unit=>join('/etc/systemd/system',unit));
const directory=mkdtempSync('/root/localai-maintenance-proof-');chmodSync(directory,0o700);
const journal=join(directory,'maintenance.json');let created=0;
const barrier=createInteractiveLeaseBarrier({path:join(directory,'interactive.lock'),journalPath:journal});let markerToken;
const source='[Unit]\nDescription=Disposable Local AI maintenance proof\n[Service]\nType=simple\nExecStart=/bin/sleep infinity\nRestart=no\nRuntimeMaxSec=30\nNoNewPrivileges=yes\nPrivateNetwork=yes\nProtectSystem=strict\n[Install]\nWantedBy=multi-user.target\n';
const capture=unit=>{
 const fields=Object.fromEntries(systemctl('show',unit,'--property=LoadState','--property=ActiveState','--property=UnitFileState','--no-pager').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
 assert.equal(fields.LoadState,'loaded');assert.ok(['active','inactive'].includes(fields.ActiveState));assert.ok(['enabled','disabled'].includes(fields.UnitFileState));
 return {available:true,active:fields.ActiveState==='active',enabled:fields.UnitFileState==='enabled'};
};
const control={capture,stop:unit=>systemctl('stop',unit),reload:()=>systemctl('daemon-reload'),restore:(unit,state)=>{systemctl(state.enabled?'enable':'disable',unit);systemctl(state.active?'start':'stop',unit);},verifyRestored:states=>{for(const unit of units)assert.deepEqual(capture(unit),states[unit]);}};
const options={journal,unitDirectory:'/etc/systemd/system',units,control,recoverWorkers:()=>verifyOfflineDocumentWorkers(readDocumentWorkerInventory),verifyOffline:async()=>{await verifyOfflineSystemdUnits(readSystemdUnit,units);await verifyOfflineDocumentWorkers(readDocumentWorkerInventory);return true;}};
try{
 for(const path of paths){writeFileSync(path,source,{flag:'wx',mode:0o644});created++;}
 systemctl('daemon-reload');systemctl('enable',units[0],units[1]);systemctl('start',units[0],units[1]);
 assert.equal(capture(units[0]).active,true);assert.equal(capture(units[0]).enabled,true);
 markerToken=barrier.begin();
 await beginInteractiveMaintenance(options);
 assert.equal(existsSync(journal),true);assert.equal(barrier.isClear(),false);
 await finishInteractiveMaintenance(options);
 assert.equal(existsSync(journal),false);assert.equal(barrier.isClear(),false);
 for(const crashPoint of ['after-begin','during-restore']){
  try{execFileSync(process.execPath,[fileURLToPath(new URL('./document-maintenance-crash-child.mjs',import.meta.url)),suffix,directory,crashPoint],{encoding:'utf8',timeout:20000});assert.fail('child did not stop abruptly');}
  catch(error){assert.equal(error.signal,'SIGKILL');}
  assert.equal(existsSync(journal),true);assert.equal(barrier.isClear(),false);
  if(crashPoint==='after-begin')assert.equal(await verifyOfflineSystemdUnits(readSystemdUnit,units),true);
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
 process.stdout.write(JSON.stringify({gate:'native-etc-maintenance-transaction',effectiveMasks:true,priorServiceStatesRestored:true,crashJournalRecovered:true,restoreCrashRecovered:true,exactFilesRestored:true,journalBlocksUntilRestore:true,realGatewayAndWorkersUnchanged:true,packageInventoryUnchanged:true,activated:false})+'\n');
}finally{
 if(existsSync(journal))await finishInteractiveMaintenance(options);
 for(const unit of units)try{systemctl('stop',unit);}catch{}
 for(const unit of units)try{systemctl('disable',unit);}catch{}
 for(const path of paths.slice(0,created))try{unlinkSync(path);}catch{}
 try{systemctl('daemon-reload');}catch{}
 if(markerToken&& !barrier.isClear())barrier.finish(markerToken);
 rmSync(directory,{recursive:true,force:true});
}
