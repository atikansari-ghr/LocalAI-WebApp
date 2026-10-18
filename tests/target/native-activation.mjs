// Real systemd recovery, using only disposable fixture services/state.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync,rmSync,chownSync,chmodSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {activateNativeRuntime} from '../../installer/native-activation.mjs';
import {openState} from '../../packages/database/index.mjs';

if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable Debian root fixture required');
const run=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:30000}).trim(),suffix=randomUUID();
const base='/var/lib/localai-activation-validation-'+suffix,prefix='localai-activation-validation-'+suffix;
const mapping={'localai-chat.service':prefix+'-chat.service','localai-embedding.service':prefix+'-embedding.service','localai.service':prefix+'-gateway.service'};
const units=Object.fromEntries(Object.entries(mapping).map(([logical,actual])=>[logical,'/etc/systemd/system/'+actual]));
const gatewayPid=run('systemctl',['show','localai.service','-p','MainPID','--value']);assert.ok(Number(gatewayPid)>0);
const gid=Number(run('id',['-g','localai'])),uid=Number(run('id',['-u','localai'])),proof=base+'/synthetic-proof.json',journal=base+'/activation.json',statePath=base+'/state';
const control={
 capture:logical=>{const actual=mapping[logical],active=spawnSync('systemctl',['is-active','--quiet',actual]).status===0,enabled=spawnSync('systemctl',['is-enabled','--quiet',actual]).status===0;return {available:true,active,enabled};},
 stop:logical=>run('systemctl',['stop',mapping[logical]]),setEnabled:(logical,value)=>run('systemctl',[value?'enable':'disable',mapping[logical]]),restart:logical=>{spawnSync('systemctl',['reset-failed',mapping[logical]],{stdio:'ignore',timeout:15000});run('systemctl',['restart',mapping[logical]]);},reload:()=>run('systemctl',['daemon-reload'])
};
let prepared=false;
try{
 mkdirSync(base,{mode:0o750});chmodSync(base,0o750);chownSync(base,0,gid);mkdirSync(statePath,{mode:0o700});chownSync(statePath,uid,gid);
 const code=`import {writeFileSync} from 'node:fs';import {openState} from 'file:///opt/localai/current/packages/database/index.mjs';import {createGateway} from 'file:///opt/localai/current/apps/gateway/server.mjs';const state=openState(${JSON.stringify(statePath+'/fixture.sqlite')});const server=createGateway({state});server.listen(0,'127.0.0.1',()=>writeFileSync(${JSON.stringify(statePath+'/port')},String(server.address().port)));process.on('SIGTERM',()=>server.close(()=>{state.close();process.exit(0);}));`;
 writeFileSync(base+'/gateway.mjs',code,{mode:0o640});chmodSync(base+'/gateway.mjs',0o640);chownSync(base+'/gateway.mjs',0,gid);
 const original={};
 for(const [logical,file]of Object.entries(units)){
  original[file]='[Unit]\nDescription=Disposable Local AI activation recovery fixture\n[Service]\nType=simple\nUser='+(logical==='localai.service'?'localai':'localai-inference')+'\nExecStart='+(logical==='localai.service'?'/opt/localai/node/bin/node '+base+'/gateway.mjs':'/usr/bin/sleep infinity')+'\nRestart=no\nMemoryMax=128M\n[Install]\nWantedBy=multi-user.target\n';
  writeFileSync(file,original[file],{flag:'wx',mode:0o644});
 }
 prepared=true;control.reload();control.restart('localai.service');
 const wait=async()=>{for(let i=0;i<30;i++){try{const port=Number(readFileSync(statePath+'/port','utf8')),response=await fetch('http://127.0.0.1:'+port+'/health/live',{signal:AbortSignal.timeout(1000)});const result=await response.json(),pid=Number(run('systemctl',['show',mapping['localai.service'],'-p','MainPID','--value']));if(response.ok&&result.pid===pid&&pid>0)return true;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}return false;};
 assert.ok(await wait());const database=openState(statePath+'/fixture.sqlite');database.setSetting('synthetic-recovery',{value:42});database.close();chownSync(statePath+'/fixture.sqlite',uid,gid);
 const initial=Object.fromEntries(Object.keys(mapping).map(name=>[name,control.capture(name)]));
 const updates=Object.entries(units).map(([logical,path])=>({path,content:logical==='localai.service'?original[path].replace('/opt/localai/node/bin/node '+base+'/gateway.mjs','/nonexistent/localai-fixture-command'):original[path]+'\n# new fixture version\n',mode:0o644}));updates.push({path:proof,content:'synthetic-only; never deployed evidence',mode:0o600});
 await assert.rejects(activateNativeRuntime({journal,allowedPaths:[...Object.values(units),proof],updates,control,verify:async()=>{if(!await wait())throw new Error('Expected fixture liveness failure');throw new Error('Fixture must not qualify');}}));
 assert.ok(await wait(),'Fixture gateway did not recover');for(const [file,content]of Object.entries(original))assert.equal(readFileSync(file,'utf8'),content);
 assert.equal(existsSync(proof),false);assert.equal(existsSync(journal),false);for(const name of Object.keys(mapping))assert.deepEqual(control.capture(name),initial[name]);
 const restored=openState(statePath+'/fixture.sqlite');assert.deepEqual(restored.getSetting('synthetic-recovery'),{value:42});restored.close();
 assert.equal(run('systemctl',['show','localai.service','-p','MainPID','--value']),gatewayPid);
 const report={qualification:'activation-fixture-tested',checks:[{check:'isolated-native-activation-rollback'}],realGatewayPidPreserved:true,syntheticStateRestored:true,realAccountModified:false};mkdirSync('.localai',{recursive:true,mode:0o700});writeFileSync('.localai/native-activation.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}finally{
 if(prepared){for(const actual of Object.values(mapping)){spawnSync('systemctl',['stop',actual]);spawnSync('systemctl',['disable',actual]);}for(const file of Object.values(units))try{unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}run('systemctl',['daemon-reload']);}
 assert.ok(base.startsWith('/var/lib/localai-activation-validation-'));rmSync(base,{recursive:true,force:true});
}
