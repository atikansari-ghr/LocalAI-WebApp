// Disposable Debian proof. It creates only randomized synthetic /etc units.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdtempSync,readFileSync,unlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {applyInteractiveUnitMasks,prepareInteractiveMaintenanceJournal,restoreInteractiveUnitFiles} from '../../installer/interactive-maintenance-journal.mjs';
import {readSystemdUnit,verifyOfflineSystemdUnits} from '../../services/resources/interactive-lease-recovery.mjs';

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
const source='[Unit]\nDescription=Disposable Local AI maintenance proof\n[Service]\nType=simple\nExecStart=/bin/sleep infinity\nRestart=no\nNoNewPrivileges=yes\nPrivateNetwork=yes\nProtectSystem=strict\n[Install]\nWantedBy=multi-user.target\n';
try{
 for(const path of paths){writeFileSync(path,source,{flag:'wx',mode:0o644});created++;}
 systemctl('daemon-reload');systemctl('start',units[0],units[1]);
 const states=Object.fromEntries(units.map(unit=>[unit,{available:true,active:Number(pid(unit))>0,enabled:false}]));
 assert.equal(states[units[0]].active,true);assert.equal(states[units[1]].active,true);
 prepareInteractiveMaintenanceJournal({journal,unitDirectory:'/etc/systemd/system',serviceStates:states,units});
 systemctl('stop',...units);
 applyInteractiveUnitMasks({journal,unitDirectory:'/etc/systemd/system',units});systemctl('daemon-reload');
 assert.equal(await verifyOfflineSystemdUnits(readSystemdUnit,units),true);
 restoreInteractiveUnitFiles({journal,unitDirectory:'/etc/systemd/system',units});systemctl('daemon-reload');
 for(const path of paths)assert.equal(readFileSync(path,'utf8'),source);
 assert.equal(pid('localai.service'),baseline.gateway);assert.equal(pid('localai-chat.service'),baseline.chat);assert.equal(pid('localai-embedding.service'),baseline.embedding);assert.equal(packageDigest(),baseline.packages);
 process.stdout.write(JSON.stringify({gate:'native-etc-unit-mask-restore',effectiveMasks:true,exactFilesRestored:true,realGatewayAndWorkersUnchanged:true,packageInventoryUnchanged:true,activated:false})+'\n');
}finally{
 for(const unit of units)try{systemctl('stop',unit);}catch{}
 if(existsSync(journal))restoreInteractiveUnitFiles({journal,unitDirectory:'/etc/systemd/system',units});
 for(const path of paths.slice(0,created))try{unlinkSync(path);}catch{}
 try{systemctl('daemon-reload');}catch{}
 rmSync(directory,{recursive:true,force:true});
}
