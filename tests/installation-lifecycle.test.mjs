import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createGateway } from '../apps/gateway/server.mjs';
import { openState } from '../packages/database/index.mjs';
import { loadConfig } from '../packages/shared/config.mjs';
import { readInstallationConfig, backupInstallation, probeGateway, prepareConfiguration, publishConfiguration } from '../installer/lifecycle.mjs';
import { applyActivation, restoreActivation, commitActivation } from '../installer/activation.mjs';

function fixture(t){const d=mkdtempSync(join(tmpdir(),'localai-install-'));t.after(()=>rmSync(d,{recursive:true,force:true}));return d;}
test('pre-install backup follows configured state and never applies migrations',async t=>{
 const dir=fixture(t),stateDir=join(dir,'custom');mkdirSync(stateDir);
 const state=openState(join(stateDir,'platform.sqlite'));state.setSetting('saved',{n:19});state.close();
 const configFile=join(dir,'gateway.env');writeFileSync(configFile,'LOCALAI_HOST=127.0.0.1\nLOCALAI_PORT=4321\nLOCALAI_STATE_DIR='+stateDir.replaceAll('\\','/')+'\n');
 const config=readInstallationConfig(configFile);const snapshot=await backupInstallation(config);
 assert.ok(snapshot.startsWith(join(stateDir,'pre-install-backups')));
 const restored=openState(snapshot);assert.deepEqual(restored.getSetting('saved'),{n:19});restored.close();
});
test('interruption before configuration publication leaves no partial final file and existing administrator settings survive',t=>{
 const dir=fixture(t),path=join(dir,'gateway.env');const staged=prepareConfiguration(path);
 assert.equal(existsSync(path),false);assert.ok(readFileSync(staged,'utf8').includes('LOCALAI_STATE_DIR=/var/lib/localai'));
 rmSync(staged);const retry=prepareConfiguration(path);publishConfiguration(retry,path);
 writeFileSync(path,'LOCALAI_HOST=127.0.0.1\nLOCALAI_PORT=4321\nLOCALAI_STATE_DIR=/var/lib/localai/custom\n');
 const again=prepareConfiguration(path);publishConfiguration(again,path);
 assert.equal(readInstallationConfig(path).port,4321);
 assert.throws(()=>readInstallationConfig(join(dir,'missing.env')));
 writeFileSync(path,'');assert.throws(()=>readInstallationConfig(path));
});
test('installer probes configured custom port and verifies actual gateway PID',async t=>{
 const server=createGateway({state:{health:()=>({ok:true})}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const config=loadConfig({LOCALAI_PORT:String(server.address().port)});
 assert.equal(await probeGateway(config,process.pid),true);
 assert.equal(await probeGateway(config,process.pid+1000000),false);
 const occupied=spawnSync(process.execPath,['apps/gateway/main.mjs'],{env:{...process.env,LOCALAI_HOST:'127.0.0.1',LOCALAI_PORT:String(config.port),LOCALAI_STATE_DIR:fixture(t)},encoding:'utf8',timeout:5000});
 assert.equal(occupied.status,1,'An occupied port must fail startup');
 assert.equal(await probeGateway(config,occupied.pid),false,'Another process must never satisfy the new service probe');
});
test('installer handles an IPv6 loopback endpoint',async t=>{
 const server=createGateway({state:{health:()=>({ok:true})}});server.listen(0,'::1');
 try {await once(server,'listening');}catch(error){if(['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){t.skip('Host has no IPv6 loopback');return;}throw error;}
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 assert.equal(await probeGateway(loadConfig({LOCALAI_HOST:'::1',LOCALAI_PORT:String(server.address().port)}),process.pid),true);
});
test('activation rollback restores application runtime and unit together after each partial activation', {skip:process.platform==='win32'?'POSIX activation is exercised on Linux CI':false},t=>{
 const dir=fixture(t),base=join(dir,'opt'),unit=join(dir,'localai.service'),journal=join(dir,'journal.json');
 const oldApp=join(base,'releases','old'),oldRuntime=join(base,'runtimes','old'),newApp=join(base,'releases','new'),newRuntime=join(base,'runtimes','new');
 for(const p of [oldApp,oldRuntime,newApp,newRuntime])mkdirSync(p,{recursive:true});
 const oldUnit=join(dir,'old.service'),newUnit=join(dir,'new.service');writeFileSync(oldUnit,'OLD UNIT');writeFileSync(newUnit,'NEW UNIT');
 applyActivation({base,unit,deployment:oldApp,runtime:oldRuntime,unitSource:oldUnit,journal});
 commitActivation(journal);
 // Real filesystem errors at each activation boundary must restore the whole previous bundle.
 for(const change of [{runtime:newRuntime+'\0'},{deployment:newApp+'\0'},{unitSource:join(dir,'missing')}]) {
   assert.throws(()=>applyActivation({base,unit,deployment:newApp,runtime:newRuntime,unitSource:newUnit,journal,...change}));
   assert.equal(readlinkSync(join(base,'current')),oldApp);assert.equal(readlinkSync(join(base,'node')),oldRuntime);assert.equal(readFileSync(unit,'utf8'),'OLD UNIT');
   assert.equal(existsSync(journal),false);
 }
 applyActivation({base,unit,deployment:newApp,runtime:newRuntime,unitSource:newUnit,journal});restoreActivation(journal);
 assert.equal(readlinkSync(join(base,'current')),oldApp);assert.equal(readlinkSync(join(base,'node')),oldRuntime);assert.equal(readFileSync(unit,'utf8'),'OLD UNIT');
});
