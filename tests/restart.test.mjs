import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openState } from '../packages/database/index.mjs';
test('committed WAL state survives a real abrupt gateway termination and restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'localai-restart-'));
  const path=join(dir,'platform.sqlite');
  const children=[];
  t.after(async()=>{for(const p of children)if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');await once(p,'exit');}rmSync(dir,{recursive:true,force:true});});
  const s=openState(path);s.setSetting('synthetic-recovery',{value:42});s.close();
  async function start(){
    const p=spawn(process.execPath,['apps/gateway/main.mjs'],{env:{...process.env,LOCALAI_STATE_DIR:dir,LOCALAI_PORT:'19234'},stdio:['ignore','pipe','pipe']});children.push(p);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Gateway start timeout')),8000);
      p.stdout.on('data',()=>{clearTimeout(timeout);resolve();});
      p.once('exit',code=>{clearTimeout(timeout);reject(new Error('Early gateway exit: '+code));});
    });return p;
  }
  const first=await start();first.kill('SIGKILL');await once(first,'exit');
  const second=await start();
  const r=await fetch('http://127.0.0.1:19234/health/live');assert.equal(r.status,200);
  const restored=openState(path);assert.deepEqual(restored.getSetting('synthetic-recovery'),{value:42});restored.close();
  second.kill('SIGKILL');await once(second,'exit');
});
