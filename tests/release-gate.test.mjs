import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { assessRelease, REQUIRED_GATES } from '../scripts/release-gate.mjs';
const commit='a'.repeat(40), now=new Date('2026-10-18T12:00:00Z');
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'localai-gates-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'evidence.txt'),'synthetic evidence');
 const report={schemaVersion:1,commit,createdAt:now.toISOString(),gates:REQUIRED_GATES.map(category=>({category,status:'passed',commit,command:'synthetic test fixture only',environment:'debian13-proxmox-lxc-4vcpu-6gb-100gb',startedAt:'2026-10-18T11:59:00Z',finishedAt:now.toISOString(),artifacts:[{path:'evidence.txt',sha256:createHash('sha256').update('synthetic evidence').digest('hex')}]}))};
 return {dir,report,options:{commit,artifactRoot:dir,now}};
}
test('release fails closed when evidence, commit or required categories are absent',()=>{
 assert.ok(assessRelease(null,{commit,artifactRoot:'.',now}).length);
 assert.ok(assessRelease({schemaVersion:1,commit,createdAt:now.toISOString(),gates:[]},{commit,artifactRoot:'.',now}).length>=17);
});
test('complete synthetic evidence exercises validation only and corrupt artifacts block it',t=>{
 const {report,options,dir}=fixture(t);assert.deepEqual(assessRelease(report,options),[]);
 writeFileSync(join(dir,'evidence.txt'),'corrupted');
 assert.ok(assessRelease(report,options).some(x=>x.includes('artifact')));
});
test('failed skipped duplicate unknown stale and mismatched reports are rejected',t=>{
 const {report,options}=fixture(t);
 for(const mutate of [
   r=>r.gates[0].status='skipped',r=>r.gates[0].status='failed',
   r=>r.gates.push(r.gates[0]),r=>r.gates[0].category='invented',
   r=>r.commit='b'.repeat(40),r=>r.createdAt='2026-10-01T00:00:00Z',
   r=>r.gates[0].commit='b'.repeat(40),r=>r.gates[0].artifacts=[],
   r=>r.gates[0].artifacts[0].path='../outside',
   r=>r.gates[0].environment='windows',
   r=>r.gates[0].finishedAt='invalid'
 ]) {const copy=structuredClone(report);mutate(copy);assert.ok(assessRelease(copy,options).length);}
});
