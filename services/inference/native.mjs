// Fixed private worker profiles. Public callers cannot override native flags.
export function buildWorkerArguments(profile,paths,options={}){
 if(!options||Object.keys(options).some(key=>key!=='idleSeconds'))throw new Error('Unknown native worker option');
 const idleSeconds=options.idleSeconds??900;
 if(!Number.isSafeInteger(idleSeconds)||idleSeconds<5||idleSeconds>86400)throw new Error('Invalid idle interval');
 if(!['chat','embedding'].includes(profile))throw new Error('Unsupported worker profile');
 if(!paths||Object.keys(paths).sort().join(',')!=='credential,model')throw new Error('Only model and credential paths are accepted');
 for(const name of ['model','credential']){
  const value=paths[name];
  if(typeof value!=='string'||!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw new Error('Unsafe worker path');
 }
 const embedding=profile==='embedding';
 return ['--model',paths.model,'--host',embedding?'/run/localai-embedding/inference.sock':'/run/localai-chat/inference.sock',
  '--api-key-file',paths.credential,'--n-gpu-layers','0','--threads',embedding?'1':'3',
  '--threads-batch',embedding?'1':'3','--parallel','1','--ctx-size',embedding?'2048':'4096',
  '--batch-size','256','--ubatch-size','256','--fit','off','--cache-ram','0',
  '--no-cache-idle-slots','--no-context-shift','--offline','--no-webui','--log-disable','--sleep-idle-seconds',String(idleSeconds),
  ...(embedding?['--embedding','--pooling','last','--embd-normalize','2']:[])];
}

export function renderWorkerUnit(profile,{runtime,...paths},options={}){
 const args=buildWorkerArguments(profile,paths,options);
 return renderUnit(profile,runtime,args);
}
export function buildChatRouterArguments({preset,credential},options={}){
 const args=buildWorkerArguments('chat',{model:preset,credential},options);
 args.splice(0,2);return [...args,'--models-preset',preset,'--models-max','1'];
}
export function renderChatRouterPresets({primary,fallback}){
 for(const model of [primary,fallback])buildWorkerArguments('chat',{model,credential:'/run/credentials/ai-backend-key'});
 return `version = 1\n\n[localai-chat]\nmodel = ${primary}\nload-on-startup = false\n\n[localai-chat-fallback]\nmodel = ${fallback}\nload-on-startup = false\n`;
}
export function renderChatRouterUnit({runtime,...paths},options={}){
 return renderUnit('chat',runtime,buildChatRouterArguments(paths,options));
}
function renderUnit(profile,runtime,args){
 if(typeof runtime!=='string'||!/^\/opt\/localai\/ai\/runtimes\/[A-Za-z0-9_-]+$/.test(runtime))throw new Error('Unsafe runtime path');
 args[args.indexOf('--api-key-file')+1]='%d/ai-backend-key';
 return `[Unit]
Description=Local AI private ${profile} CPU worker (qualification required)
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=localai-inference
Group=localai-runtime
SupplementaryGroups=localai-inference
RuntimeDirectory=localai-${profile}
RuntimeDirectoryMode=0750
Slice=localai-ai.slice
WorkingDirectory=${runtime}
LoadCredentialEncrypted=ai-backend-key:/etc/credstore.encrypted/localai-ai-key
ExecStart=${runtime}/llama-server ${args.join(' ')}
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
UMask=0007
ProtectSystem=strict
ProtectHome=true
InaccessiblePaths=/var/lib/localai /etc/localai
PrivateTmp=true
PrivateDevices=true
PrivateNetwork=true
NoNewPrivileges=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
TasksMax=64
MemoryMax=${profile==='chat'?'4G':'1G'}
MemorySwapMax=0
CPUQuota=${profile==='chat'?'300%':'100%'}
StandardOutput=null
StandardError=null

[Install]
WantedBy=multi-user.target
`;
}
