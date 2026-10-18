import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,lstatSync,mkdirSync,chmodSync,chownSync,realpathSync,readlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {activateNativeRuntime,recoverNativeRuntime,readNativeJournal} from './native-activation.mjs';
import {expectedQualificationIdentity,validateQualification} from '../services/inference/qualification.mjs';
import {renderChatRouterUnit,renderChatRouterPresets,renderWorkerUnit} from '../services/inference/native.mjs';
import {assertNativeUnitDefinitions,assertNativeEffectiveSettings} from '../services/inference/systemd.mjs';
import {provisionStarter,provisionFallback} from './install-ai.mjs';
import {createInferenceClient,requestPrivateWorker} from '../services/inference/client.mjs';
import {probeGateway,probeGatewayRuntime,readInstallationConfig} from './lifecycle.mjs';
import starter from '../services/inference/starter-manifest.json' with {type:'json'};
import fallback from '../services/inference/fallback-manifest.json' with {type:'json'};

const sourceRoot=fileURLToPath(new URL('..',import.meta.url)),journal='/opt/localai/ai/activation.json';
const run=(file,args)=>execFileSync(file,args,{cwd:sourceRoot,encoding:'utf8',timeout:120000}).trim();
const hash=content=>createHash('sha256').update(content).digest('hex');
function pathsFor(revision){if(!/^[a-f0-9]{40}$/.test(revision))throw new Error('Invalid activation revision');return {preset:'/etc/localai-runtime/models/'+revision+'/chat.ini',chat:'/etc/systemd/system/localai-chat.service',embedding:'/etc/systemd/system/localai-embedding.service',slice:'/etc/systemd/system/localai-ai.slice',dropin:'/etc/systemd/system/localai.service.d/inference.conf',record:'/etc/localai/inference.json'};}
function directory(path,gid){
 mkdirSync(path,{recursive:true,mode:0o750});const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error('Unsafe native configuration directory');chownSync(path,0,gid);chmodSync(path,0o750);
}
function platform(){if(process.platform!=='linux'||process.arch!=='x64'||process.getuid()!==0)throw new Error('Native activation requires Debian13 x64 root');}
function capture(name){
 const result=spawnSync('systemctl',['show',name,'--property=LoadState','--property=ActiveState','--property=UnitFileState'],{encoding:'utf8',timeout:15000});
 if(result.error)throw new Error('Service state unavailable');const values=Object.fromEntries((result.stdout??'').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 if(values.LoadState==='not-found')return {available:false,active:false,enabled:false};
 if(values.LoadState!=='loaded'||!['enabled','disabled'].includes(values.UnitFileState)||!['active','inactive','failed'].includes(values.ActiveState))throw new Error('Unexpected service state; inspect '+name);
 return {available:true,active:values.ActiveState==='active',enabled:values.UnitFileState==='enabled'};
}
const loaded=name=>{const value=run('systemctl',['show',name,'--property=LoadState','--value']);if(!['loaded','not-found'].includes(value))throw new Error('Unexpected service definition');return value==='loaded';};
const control={capture,stop:name=>{if(loaded(name))run('systemctl',['stop',name]);},setEnabled:(name,value)=>{if(loaded(name))run('systemctl',[value?'enable':'disable',name]);else if(value)throw new Error('Required service is missing');},restart:name=>{spawnSync('systemctl',['reset-failed',name],{stdio:'ignore',timeout:15000});run('systemctl',['restart',name]);},reload:()=>run('systemctl',['daemon-reload'])};
export async function recoverPrivateRuntime(){platform();if(!existsSync(journal)){console.log('No pending native activation.');return;}const revision=readNativeJournal(journal).revision;await recoverNativeRuntime({journal,allowedPaths:Object.values(pathsFor(revision)),control});console.log('Prior native configuration and service states recovered.');}
export async function activatePrivateRuntime(){
 platform();if(existsSync(journal))throw new Error('Pending activation requires --recover');
 if(existsSync('/etc/localai/inference.json'))throw new Error('Runtime updates require the later coordinated update/recovery workflow');
 if(run('git',['status','--porcelain']))throw new Error('Use a clean reviewed checkout');const revision=run('git',['rev-parse','HEAD']);
 const paths=pathsFor(revision),identity=expectedQualificationIdentity(sourceRoot,revision);
 const qualified=validateQualification(readNativeJournal('/opt/localai/ai/qualified/'+revision+'/report.json'),identity);
 if(realpathSync('/opt/localai/current')!=='/opt/localai/releases/'+revision)throw new Error('Deploy this exact tested app revision with the unchanged-schema installer before runtime activation');
 execFileSync(process.execPath,[join(sourceRoot,'installer/preflight.mjs')],{cwd:sourceRoot,stdio:'inherit',timeout:30000});
 const noDownload=async()=>{throw new Error('Qualified asset missing; provision and requalify before activation');};
 const primary=await provisionStarter(starter,{fetchImpl:noDownload}),small=await provisionFallback(fallback,{fetchImpl:noDownload});
 if(primary.manifestSha256!==identity.starterManifest||small.manifestSha256!==identity.fallbackManifest)throw new Error('Qualified assets changed');
 assertNativeUnitDefinitions();
 const runtimeGid=Number(run('getent',['group','localai-runtime']).split(':')[2]),gatewayGid=Number(run('id',['-g','localai']));
 if(!Number.isSafeInteger(runtimeGid)||!Number.isSafeInteger(gatewayGid))throw new Error('Qualified native accounts/groups missing');
 run('systemd-run',['--unit=localai-network-check-'+randomUUID(),'--wait','--collect','--property=PrivateNetwork=yes','/usr/bin/true']);
 for(const dir of ['/etc/localai-runtime','/etc/localai-runtime/models','/etc/localai-runtime/models/'+revision])directory(dir,runtimeGid);
 // Runtime binaries are public vendor code. The gateway needs read access to
 // fingerprint them; model and qualification directories retain private modes.
 for(const dir of ['/opt/localai/ai','/opt/localai/ai/runtimes'])directory(dir,runtimeGid);
 directory('/etc/systemd/system/localai.service.d',0);
 const runtime='/opt/localai/ai/runtimes/llama-b11669',credential='/run/credentials/placeholder/ai-backend-key';
 const preset=renderChatRouterPresets({primary:primary.assets.find(a=>a.id==='chat').path,fallback:small.assets[0].path});
 const chat=renderChatRouterUnit({runtime,preset:paths.preset,credential}),embedding=renderWorkerUnit('embedding',{runtime,model:primary.assets.find(a=>a.id==='embedding').path,credential}),slice=readFileSync(join(sourceRoot,'installer/localai-ai.slice'),'utf8');
 const dropin='[Unit]\nAfter=localai-chat.service localai-embedding.service\nWants=localai-chat.service localai-embedding.service\n\n[Service]\nSupplementaryGroups=localai-runtime\nLoadCredentialEncrypted=ai-backend-key:/etc/credstore.encrypted/localai-ai-key\n';
 const record={qualification:qualified,units:{chat:hash(chat),embedding:hash(embedding),slice:hash(slice)},presetHash:hash(preset)};
 const updates=[{path:paths.preset,content:preset,mode:0o640,gid:runtimeGid},{path:paths.chat,content:chat,mode:0o644},{path:paths.embedding,content:embedding,mode:0o644},{path:paths.slice,content:slice,mode:0o644},{path:paths.dropin,content:dropin,mode:0o644},{path:paths.record,content:JSON.stringify(record,null,2)+'\n',mode:0o640,gid:gatewayGid}];
 const key=run('systemd-creds',['decrypt','--name=ai-backend-key','/etc/credstore.encrypted/localai-ai-key','-']);if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw new Error('Qualified internal credential unavailable');
 await activateNativeRuntime({journal,revision,allowedPaths:Object.values(paths),updates,control,verify:async()=>{
  assertNativeUnitDefinitions();assertNativeEffectiveSettings(undefined,{chat,embedding});
  const client=createInferenceClient({key,fallbackEnabled:true,onFallback:()=>{}});let healthy=false;
  for(let i=0;i<60;i++){if(await client.health()){healthy=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}if(!healthy)throw new Error('Private worker readiness failed');
  for(const name of ['localai-chat.service','localai-embedding.service']){
   if(run('systemctl',['show',name,'--property=PrivateNetwork','--value'])!=='yes'||run('systemctl',['show',name,'--property=User','--value'])!=='localai-inference')throw new Error('Effective private worker isolation mismatch');
   const pid=run('systemctl',['show',name,'--property=MainPID','--value']);if(readlinkSync('/proc/'+pid+'/ns/net')===readlinkSync('/proc/1/ns/net'))throw new Error('Worker network namespace not isolated');
  }
  const completion=await client.chat({messages:[{role:'user',content:'Reply with ready.'}],max_tokens:8});if(!completion.choices?.[0]?.message?.content)throw new Error('Activated native chat failed');
  const embedded=await client.embeddings({input:'Synthetic activation check.'});if(embedded.data?.[0]?.embedding?.length!==1024)throw new Error('Activated embeddings failed');
  const response=await requestPrivateWorker('unix:/run/localai-chat/inference.sock','/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'localai-chat-fallback',messages:[{role:'user',content:'Reply ready.'}],max_tokens:8,chat_template_kwargs:{enable_thinking:false}}),signal:AbortSignal.timeout(120000)});const fallbackResult=await response.json();if(!response.ok||!fallbackResult.choices?.[0]?.message?.content)throw new Error('Activated local fallback failed');
  const config=readInstallationConfig('/etc/localai/gateway.env'),pid=Number(run('systemctl',['show','localai.service','--property=MainPID','--value']));if(!await probeGateway(config,pid)||!await probeGatewayRuntime(config))throw new Error('Gateway activation liveness/runtime readiness failed');
  if(run('systemctl',['show','localai-ai.slice','--property=MemorySwapCurrent','--value'])!=='0')throw new Error('Activated inference used swap');
 }});
 console.log(JSON.stringify({activated:true,scope:'private-preview',sourceCommit:revision,productionRelease:'blocked'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 process.umask(0o077);try{if(process.argv.length!==3)throw new Error('Use activate-ai.sh --activate-private-preview or --recover');if(process.argv[2]==='--recover')await recoverPrivateRuntime();else if(process.argv[2]==='--activate-private-preview')await activatePrivateRuntime();else throw new Error('Unknown activation operation');}
 catch(error){console.error('Private runtime activation blocked: '+error.message);process.exitCode=1;}
}
