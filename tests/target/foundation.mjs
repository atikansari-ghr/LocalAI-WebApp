import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readlinkSync, readdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Run explicitly as root with TARGET_TEST_LXC=disposable on a dedicated test LXC only');
const source=process.cwd(),node='/opt/localai/node/bin/node';
const command=(file,args)=>execFileSync(file,args,{cwd:source,encoding:'utf8',timeout:180000});
command('mkdir',['-p',source+'/.localai']);
const report={commit:command('git',['rev-parse','HEAD']).trim(),environment:'debian13-proxmox-lxc-4vcpu-6gb-100gb',checks:[]};
function setting(mode){
 return command('runuser',['-u','localai','--',node,'--input-type=module','--eval',`import {openState} from '/opt/localai/current/packages/database/index.mjs';const s=openState('/var/lib/localai/platform.sqlite');${mode==='set'?"s.setSetting('target.validation',{synthetic:true,value:42});":"console.log(JSON.stringify(s.getSetting('target.validation')));"}s.close();`]);
}
// Bring the disposable host to this tested revision before checking rerun and rollback.
command('bash',['installer/install.sh']);
const original={config:readFileSync('/etc/localai/gateway.env','utf8'),unit:readFileSync('/etc/systemd/system/localai.service','utf8'),current:readlinkSync('/opt/localai/current'),runtime:readlinkSync('/opt/localai/node')};
setting('set');
const installed=spawnSync('bash',['installer/install.sh'],{cwd:source,encoding:'utf8',timeout:180000});
writeFileSync(source+'/.localai/rerun.log',installed.stdout+installed.stderr);
assert.equal(installed.status,0,'Rerun failed; see .localai/rerun.log');
assert.equal(setting('get').trim(),'{"synthetic":true,"value":42}');
assert.equal(readFileSync('/etc/localai/gateway.env','utf8'),original.config);
assert.ok(readdirSync('/var/lib/localai/pre-install-backups').some(p=>p.endsWith('.sqlite')));
report.checks.push('rerun/configuration/state/online-backup passed');
const oldPid=command('systemctl',['show','localai.service','-p','MainPID','--value']).trim();
command('systemctl',['kill','--signal=SIGKILL','--kill-whom=main','localai.service']);
let recovered=false;
for(let i=0;i<30;i++){
 await delay(500);
 const pid=command('systemctl',['show','localai.service','-p','MainPID','--value']).trim();
 if(pid!==oldPid&&Number(pid)>0){try{const r=await fetch('http://127.0.0.1:1234/health/live');if(r.ok&&(await r.json()).pid===Number(pid)){recovered=true;break;}}catch{}}
}
assert.ok(recovered,'systemd did not recover the killed gateway');
assert.equal(setting('get').trim(),'{"synthetic":true,"value":42}');
report.checks.push('systemd forced-crash restart and state persistence passed');
const fault='/root/localai-fault-'+randomUUID();
command('git',['worktree','add','--detach',fault,'HEAD']);
const unitFile=fault+'/installer/localai.service';
writeFileSync(unitFile,readFileSync(unitFile,'utf8').replace(/^ExecStart=.*$/m,'ExecStart=/bin/false'));
execFileSync('git',['-c','user.name=atikansari','-c','user.email=atikansari@ansariz.biz','commit','-am','test: synthetic failed activation fixture'],{cwd:fault,encoding:'utf8'});
const failed=spawnSync('bash',['installer/install.sh'],{cwd:fault,encoding:'utf8',timeout:180000});
writeFileSync(source+'/.localai/failure-activation.log',failed.stdout+failed.stderr);
assert.notEqual(failed.status,0,'Broken unit was accepted');
assert.equal(readlinkSync('/opt/localai/current'),original.current,'Application not restored');
assert.equal(readlinkSync('/opt/localai/node'),original.runtime,'Runtime not restored');
assert.equal(readFileSync('/etc/systemd/system/localai.service','utf8'),original.unit,'Unit not restored');
assert.equal(existsSync('/opt/localai/activation.json'),false,'Activation journal not cleared');
assert.equal(command('systemctl',['is-active','localai.service']).trim(),'active','Restored service is not running');
assert.equal(setting('get').trim(),'{"synthetic":true,"value":42}');
report.checks.push('failed activation restores code/runtime/unit and service');
writeFileSync(source+'/.localai/target-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
