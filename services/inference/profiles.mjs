import {readFileSync} from 'node:fs';

// Request budgets stay inside the native worker's independently enforced limits.
export function selectResourceProfile(mode,{availableBytes}){
 if(!['eco','balanced','performance'].includes(mode))throw new TypeError('Unknown operating profile');
 if(!Number.isSafeInteger(availableBytes)||availableBytes<0)throw new Error('resource_measurement_unavailable');
 if(availableBytes<512*1024**2)throw new Error('resource_pressure');
 const emergency=availableBytes<1024**3;
 return Object.freeze({requestedMode:mode,effectiveMode:emergency?'emergency':mode,emergency,concurrency:1,
  contextTokens:emergency?1024:mode==='eco'?2048:4096,
  maxOutputTokens:emergency?128:mode==='eco'?256:mode==='balanced'?512:1024});
}

export function readMemoryBudget({read=path=>readFileSync(path,'utf8')}={}){
 const available=read('/proc/meminfo').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
 const maximum=read('/sys/fs/cgroup/memory.max').trim(),current=read('/sys/fs/cgroup/memory.current').trim();
 if(!available||!/^\d+$/.test(current)||(maximum!=='max'&&!/^\d+$/.test(maximum)))throw new Error('resource_measurement_unavailable');
 const availableBytes=Number(available[1])*1024,used=Number(current),limit=maximum==='max'?Infinity:Number(maximum);
 if(!Number.isSafeInteger(availableBytes)||!Number.isSafeInteger(used)||(maximum!=='max'&&!Number.isSafeInteger(limit)))throw new Error('resource_measurement_unavailable');
 return Object.freeze({availableBytes:Math.max(0,Math.min(availableBytes,limit-used))});
}
