import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {assertInheritedMaintenanceLocks} from '../../installer/interactive-maintenance-locks.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const file=fileURLToPath(import.meta.url);
if(process.argv[2]==='child'){
 assertInheritedMaintenanceLocks({installPath:process.argv[3],runtimePath:process.argv[4]});
 for(const path of [process.argv[3],process.argv[4]]){
  const contender=spawnSync('/usr/bin/flock',['-n',path,'/usr/bin/true'],{encoding:'utf8'});
  assert.notEqual(contender.status,0);
 }
 process.stdout.write('held\n');
}else{
 const dir=mkdtempSync(join(tmpdir(),'localai-lock-proof-'));
 const installPath=join(dir,'install.lock'),runtimePath=join(dir,'runtime.lock');
 try{
  const bypass=spawnSync(process.execPath,[file,'child',installPath,runtimePath],{encoding:'utf8'});
  assert.notEqual(bypass.status,0);
  const held=spawnSync('/bin/bash',['-c','exec 9>"$1"; flock -n 9; exec 8>"$2"; flock -n 8; exec "$3" "$4" child "$1" "$2"','_',installPath,runtimePath,process.execPath,file],{encoding:'utf8'});
  assert.equal(held.status,0,held.stderr);assert.match(held.stdout,/held/);
  process.stdout.write(JSON.stringify({gate:'maintenance-lock-ownership',directBypassRejected:true,inheritedLocksVerified:true})+'\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
}
