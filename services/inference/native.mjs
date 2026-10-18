// Fixed private worker profiles. Public callers cannot override native flags.
export function buildWorkerArguments(profile,paths){
 if(!['chat','embedding'].includes(profile))throw new Error('Unsupported worker profile');
 if(!paths||Object.keys(paths).sort().join(',')!=='credential,model')throw new Error('Only model and credential paths are accepted');
 for(const name of ['model','credential']){
  const value=paths[name];
  if(typeof value!=='string'||!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw new Error('Unsafe worker path');
 }
 const embedding=profile==='embedding';
 return ['--model',paths.model,'--host','127.0.0.1','--port',embedding?'8082':'8081',
  '--api-key-file',paths.credential,'--n-gpu-layers','0','--threads',embedding?'1':'3',
  '--threads-batch',embedding?'1':'3','--parallel','1','--ctx-size',embedding?'2048':'4096',
  '--batch-size','256','--ubatch-size','256','--fit','off','--cache-ram','0',
  '--no-cache-idle-slots','--no-context-shift','--offline','--no-webui','--log-disable',
  ...(embedding?['--embedding','--pooling','last','--embd-normalize','2']:[])];
}

export function renderWorkerUnit(profile,{runtime,...paths}){
 if(typeof runtime!=='string'||!/^\/opt\/localai\/ai\/runtimes\/[A-Za-z0-9_-]+$/.test(runtime))throw new Error('Unsafe runtime path');
 const args=buildWorkerArguments(profile,paths);
 args[args.indexOf('--api-key-file')+1]='%d/ai-backend-key';
 return `[Unit]
Description=Local AI private ${profile} CPU worker (qualification required)
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=localai-inference
Group=localai-inference
Slice=localai-ai.slice
WorkingDirectory=${runtime}
LoadCredentialEncrypted=ai-backend-key:/etc/credstore.encrypted/localai-ai-key
ExecStart=${runtime}/llama-server ${args.join(' ')}
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
UMask=0077
ProtectSystem=strict
ProtectHome=true
InaccessiblePaths=/var/lib/localai /etc/localai
PrivateTmp=true
PrivateDevices=true
NoNewPrivileges=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
IPAddressDeny=any
IPAddressAllow=localhost
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
