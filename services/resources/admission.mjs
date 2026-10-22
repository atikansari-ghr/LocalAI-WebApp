export class AdmissionError extends Error{constructor(code){super(code);this.code=code;this.status=503;}}
const error=code=>new AdmissionError(code);
// A 512 MiB-capped document unit needs 512 MiB plus a 256 MiB host reserve.
const BACKGROUND_START_BYTES=768*1024**2, BACKGROUND_RUNNING_FLOOR_BYTES=256*1024**2;
// One aggregate slot. Background work must settle after abort only after native cleanup.
// A stalled worker never releases the slot merely because a timer has elapsed.
export function createResourceAdmission({resources,maxInteractiveQueue=8,monitorIntervalMs=1000}={}){
 if(typeof resources!=='function'||!Number.isSafeInteger(maxInteractiveQueue)||maxInteractiveQueue<1||maxInteractiveQueue>32||!Number.isSafeInteger(monitorIntervalMs)||monitorIntervalMs<10||monitorIntervalMs>10000)throw new TypeError('Invalid admission configuration');
 let active=null;const queue=[];
 function backgroundPolicy(minAvailableBytes){let value;try{value=resources();}catch{throw error('resource_measurement_unavailable');}if(!value||!Number.isSafeInteger(value.availableBytes)||value.availableBytes<0||!Number.isSafeInteger(value.swapUsedBytes)||value.swapUsedBytes<0||!Number.isFinite(value.memoryPressure)||value.memoryPressure<0||value.memoryPressure>100)throw error('resource_measurement_unavailable');if(value.hostSwapGrowthBytes!==undefined&&(!Number.isSafeInteger(value.hostSwapGrowthBytes)||value.hostSwapGrowthBytes<0))throw error('resource_measurement_unavailable');if(value.availableBytes<minAvailableBytes||value.swapUsedBytes>0||(value.hostSwapGrowthBytes??0)>0||value.memoryPressure>20)throw error('background_resource_pressure');}
 function abortTask(task,reason){task.abortReason??=reason;task.controller.abort(error(reason));}
 function pump(){if(active||!queue.length)return;const task=queue.shift();start(task);}
 function start(task){
  active=task;task.started=true;let timer;
  if(task.kind==='background'){timer=setInterval(()=>{try{backgroundPolicy(BACKGROUND_RUNNING_FLOOR_BYTES);}catch(failure){abortTask(task,failure.code);}},monitorIntervalMs);timer.unref();}
  void (async()=>{let value,failure,failed=false;try{if(task.controller.signal.aborted)throw error(task.abortReason);value=await task.work(task.controller.signal);}catch(caught){failed=true;failure=caught;}finally{clearInterval(timer);task.signal?.removeEventListener('abort',task.onAbort);active=null;pump();}if(task.controller.signal.aborted)task.reject(error(task.abortReason));else if(failed)task.reject(failure);else task.resolve(value);})();
 }
 function run(kind,work,{signal}={}){
  if(typeof work!=='function'||signal!==undefined&&!(signal instanceof AbortSignal))return Promise.reject(new TypeError('Invalid admission request'));if(signal?.aborted)return Promise.reject(error('admission_cancelled'));
  if(kind==='background'){if(active||queue.length)return Promise.reject(error('background_postponed'));try{backgroundPolicy(BACKGROUND_START_BYTES);}catch(failure){return Promise.reject(failure);}}
  else if(active&&queue.length>=maxInteractiveQueue)return Promise.reject(error('admission_queue_full'));
  return new Promise((resolve,reject)=>{
   const task={kind,work,signal,resolve,reject,controller:new AbortController(),started:false};task.onAbort=()=>{abortTask(task,'admission_cancelled');if(!task.started){const index=queue.indexOf(task);if(index>=0)queue.splice(index,1);signal.removeEventListener('abort',task.onAbort);reject(error('admission_cancelled'));}};signal?.addEventListener('abort',task.onAbort,{once:true});if(signal?.aborted){task.onAbort();return;}
   if(kind==='interactive'){queue.push(task);if(active?.kind==='background')abortTask(active,'background_preempted');pump();}else start(task);
  });
 }
 return Object.freeze({runInteractive:(work,options)=>run('interactive',work,options),runBackground:(work,options)=>run('background',work,options),snapshot:()=>Object.freeze({active:active?.kind??null,queuedInteractive:queue.length,backgroundAborting:active?.kind==='background'&&active.controller.signal.aborted})});
}
