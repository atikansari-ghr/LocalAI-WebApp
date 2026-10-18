import {execFileSync} from 'node:child_process';

export const inspectNativeUnit=(name,key)=>execFileSync('systemctl',['show',name,'--property='+key,'--value'],{encoding:'utf8',timeout:15000}).trim();
export function assertNativeUnitDefinitions(inspect=inspectNativeUnit){
 for(const name of ['localai-chat.service','localai-embedding.service','localai-ai.slice']){
  if(inspect(name,'FragmentPath')!=='/etc/systemd/system/'+name)throw new Error('Unexpected native unit fragment: '+name);
  if(inspect(name,'DropInPaths')!=='')throw new Error('Unexpected native unit override: '+name);
 }
}
export function assertNativeEffectiveSettings(inspect=inspectNativeUnit,units={}){
 const verify=(name,values)=>{for(const [key,value]of Object.entries(values))if(inspect(name,key)!==value)throw new Error('Effective native configuration mismatch: '+name+' '+key);};
 for(const profile of ['chat','embedding']){
  const name='localai-'+profile+'.service';
  verify(name,{MemorySwapMax:'0',MemoryMax:profile==='chat'?'4294967296':'1073741824',CPUQuotaPerSecUSec:profile==='chat'?'3s':'1s',TasksMax:'64',User:'localai-inference',Group:'localai-runtime',SupplementaryGroups:'localai-inference',PrivateNetwork:'yes',PrivateDevices:'yes',NoNewPrivileges:'yes',ProtectSystem:'strict',ProtectHome:'yes',RuntimeDirectory:'localai-'+profile,RuntimeDirectoryMode:'0750',UMask:'0007',Slice:'localai-ai.slice',WorkingDirectory:'/opt/localai/ai/runtimes/llama-b11669'});
  const expected=units[profile]?.match(/^ExecStart=(.+)$/m)?.[1]?.replace('%d','/run/credentials/'+name);
  const actual=inspect(name,'ExecStart').split(' ; argv[]=')[1]?.split(' ; ignore_errors=')[0];
  if(!expected||actual!==expected)throw new Error('Effective native execution mismatch: '+name);
 }
 verify('localai-ai.slice',{MemorySwapMax:'0',MemoryMax:'5368709120',MemoryHigh:'4718592000',CPUQuotaPerSecUSec:'3s',TasksMax:'128'});
}
