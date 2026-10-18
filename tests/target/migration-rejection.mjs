import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import { existsSync,readlinkSync,writeFileSync,mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable Debian test LXC required');
const source=process.cwd(),node='/opt/localai/node/bin/node';
const run=(file,args,cwd=source)=>execFileSync(file,args,{cwd,encoding:'utf8',timeout:180000}).trim();
mkdirSync(source+'/.localai',{recursive:true,mode:0o700});
const pid=()=>run('systemctl',['show','localai.service','--property=MainPID','--value']);
const history=()=>run(node,['--input-type=module','--eval',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/var/lib/localai/platform.sqlite',{readOnly:true});console.log(JSON.stringify(db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all()));db.close();"]);
const original={pid:pid(),current:readlinkSync('/opt/localai/current'),history:history()};
assert.ok(Number(original.pid)>0,'Existing service must be active');
const fault='/root/localai-migration-rejection-'+randomUUID();
assert.ok(fault.startsWith('/root/localai-migration-rejection-'));
run('git',['worktree','add','--detach',fault,'HEAD']);
try{
 writeFileSync(fault+'/migrations/003-unqualified.sql','ALTER TABLE settings ADD COLUMN synthetic_unqualified TEXT;\n');
 run('git',['add','migrations/003-unqualified.sql'],fault);
 run('git',['-c','user.name=atikansari','-c','user.email=atikansari@ansariz.biz','commit','-m','test: synthetic unqualified migration fixture'],fault);
 const failed=spawnSync('bash',['installer/install.sh'],{cwd:fault,encoding:'utf8',timeout:180000});
 writeFileSync(source+'/.localai/migration-rejection.log',failed.stdout+failed.stderr,{mode:0o600});
 assert.notEqual(failed.status,0,'Schema-changing update was accepted');
 assert.match(failed.stdout+failed.stderr,/schema migration recovery is not yet qualified/);
 assert.equal(pid(),original.pid,'Running service was restarted despite a rejected update');
 assert.equal(readlinkSync('/opt/localai/current'),original.current,'Rejected update changed active code');
 assert.equal(history(),original.history,'Rejected update changed persisted migration history');
 assert.equal(existsSync('/opt/localai/activation.json'),false,'Rejected update left an activation journal');
 const report={commit:run('git',['rev-parse','HEAD']),environment:'debian13-proxmox-lxc-4vcpu-6gb-100gb',check:'unqualified schema update rejected before activation; active PID, code and migration history preserved'};
 writeFileSync(source+'/.localai/migration-rejection.json',JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report));
}finally{run('git',['worktree','remove',fault]);}
