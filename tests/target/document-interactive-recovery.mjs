// Destructive only to four synthetic units and a private proof marker.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdtempSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createInteractiveLeaseBarrier} from '../../services/resources/interactive-lease-barrier.mjs';
import {parseStoppedMaskedUnit,readSystemdUnit,verifyOfflineSystemdUnits} from '../../services/resources/interactive-lease-recovery.mjs';
import {createDocumentSupervisorScheduler} from '../../services/documents/supervisor-scheduler.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:20000,maxBuffer:8192});
const pid=unit=>systemctl('show',unit,'--property=MainPID','--value').trim();
const packageDigest=()=>createHash('sha256').update(readFileSync('/var/lib/dpkg/status')).digest('hex');
const baseline={gateway:pid('localai.service'),chat:pid('localai-chat.service'),embedding:pid('localai-embedding.service'),packages:packageDigest()};
assert.ok(baseline.gateway!=='0'&&baseline.chat!=='0'&&baseline.embedding!=='0');
const suffix=randomBytes(4).toString('hex'),units=['gateway','chat','embedding','supervisor'].map(role=>`localai-recovery-${suffix}-${role}.service`);
// Vendor-location fixtures let a runtime mask take precedence. The deployed
// gateway unit is in /etc and needs a separate journaled maintenance workflow.
const files=units.map(unit=>join('/usr/lib/systemd/system',unit));
const etcUnit=`localai-recovery-${suffix}-etc.service`,etcFile=join('/etc/systemd/system',etcUnit);
const directory=mkdtempSync('/root/localai-recovery-proof-');chmodSync(directory,0o700);
const barrier=createInteractiveLeaseBarrier({path:join(directory,'interactive.lock')});
let created=0,etcCreated=false;
try{
 for(const path of files){writeFileSync(path,'[Unit]\nDescription=Local AI recovery disposable proof\n[Service]\nType=simple\nExecStart=/bin/sleep infinity\nRestart=no\nNoNewPrivileges=yes\nPrivateNetwork=yes\nProtectSystem=strict\n',{flag:'wx',mode:0o644});created++;}
 writeFileSync(etcFile,'[Unit]\nDescription=Local AI recovery precedence proof\n[Service]\nType=simple\nExecStart=/bin/sleep infinity\nRestart=no\n',{flag:'wx',mode:0o644});etcCreated=true;
 systemctl('daemon-reload');systemctl('start',units[0]);assert.ok(Number(pid(units[0]))>0);
 systemctl('mask','--runtime','--now',etcUnit);
 assert.throws(()=>parseStoppedMaskedUnit(readSystemdUnit(etcUnit)),/interactive_recovery_required/);
 barrier.begin();assert.equal(barrier.isClear(),false);
 await assert.rejects(barrier.recover(()=>verifyOfflineSystemdUnits(readSystemdUnit,units)),/interactive_recovery_required/);
 assert.equal(barrier.isClear(),false);
 await assert.rejects(barrier.recover(()=>verifyOfflineSystemdUnits(readSystemdUnit)),/interactive_recovery_required/);
 assert.equal(barrier.isClear(),false);
 systemctl('mask','--runtime','--now',...units);
 try{await barrier.recover(()=>verifyOfflineSystemdUnits(readSystemdUnit,units));}catch(error){process.stderr.write(JSON.stringify(units.map(unit=>({unit,state:readSystemdUnit(unit)})))+'\n');throw error;}assert.equal(barrier.isClear(),true);
 let claims=0;const scheduler=createDocumentSupervisorScheduler({runner:{prepare:async()=>{},step:async()=>{claims++;return null;}},admission:{runBackground:work=>work(new AbortController().signal)},barrier});
 await scheduler.prepare();await scheduler.step();assert.equal(claims,1);
 assert.equal(pid('localai.service'),baseline.gateway);assert.equal(pid('localai-chat.service'),baseline.chat);assert.equal(pid('localai-embedding.service'),baseline.embedding);assert.equal(packageDigest(),baseline.packages);
 process.stdout.write(JSON.stringify({gate:'native-interactive-lease-recovery',activeServiceRejected:true,liveUnitsRejected:true,etcUnitRuntimeMaskRejected:true,maskedStoppedRecovered:true,claimResumed:true,realGatewayAndWorkersUnchanged:true,packageInventoryUnchanged:true,activated:false})+'\n');
}finally{
 try{systemctl('unmask','--runtime',...units,etcUnit);}catch{}
 for(const unit of [...units,etcUnit])try{systemctl('stop',unit);}catch{}
 for(const path of files.slice(0,created))try{unlinkSync(path);}catch{}
 if(etcCreated)try{unlinkSync(etcFile);}catch{}
 try{systemctl('daemon-reload');}catch{}
 rmSync(directory,{recursive:true,force:true});
}
