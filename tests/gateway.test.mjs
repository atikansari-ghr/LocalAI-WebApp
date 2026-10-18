import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../apps/gateway/server.mjs';
import { openState } from '../packages/database/index.mjs';

async function fixture(t,services={}) {
  const dir = mkdtempSync(join(tmpdir(),'localai-http-'));
  const state = openState(join(dir,'state.sqlite'));
  const server = createGateway({ state,...services }); server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));state.close();rmSync(dir,{recursive:true,force:true});});
  return {state,base:'http://127.0.0.1:'+server.address().port};
}
test('liveness reflects process health while readiness blocks incomplete platform',async t=>{
  const {base}=await fixture(t);const live=await fetch(base+'/health/live');
  assert.equal(live.status,200);assert.deepEqual(await live.json(),{status:'alive',pid:process.pid});
  const ready=await fetch(base+'/health/ready');assert.equal(ready.status,503);
  assert.equal((await ready.json()).status,'not_ready');assert.equal(ready.headers.get('cache-control'),'no-store');
});
test('foundation never serves application APIs, settings, files or guessed admin routes',async t=>{
  const {base}=await fixture(t);
  for(const path of ['/v1/models','/admin','/workspace','/../package.json','/health/live?secret=synthetic']) {
    const r=await fetch(base+path); assert.equal(r.status,404);
    assert.ok(!(await r.text()).includes('synthetic'));
  }
  assert.equal((await fetch(base+'/health/live',{method:'POST',body:'sensitive'})).status,405);
});
test('storage failure marks readiness unavailable and hides internal exception details',async t=>{
  const {base,state}=await fixture(t); const close=state.close; state.close=()=>{};close();
  const r=await fetch(base+'/health/ready'); assert.equal(r.status,503);
  assert.deepEqual((await r.json()).blockers,['state_unavailable']);
});
test('qualified runtime health removes only the runtime blocker while production release stays blocked',async t=>{
 let healthy=true;const {base}=await fixture(t,{auth:{status:()=> 'ready'},inference:{health:async()=>healthy}});
 const loaded=await (await fetch(base+'/health/ready')).json();assert.deepEqual(loaded.blockers,['release_not_qualified']);
 healthy=false;const stopped=await (await fetch(base+'/health/ready')).json();assert.deepEqual(stopped.blockers,['runtime_unavailable','release_not_qualified']);
});
