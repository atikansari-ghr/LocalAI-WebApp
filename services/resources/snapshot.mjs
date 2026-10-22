import {readFileSync} from 'node:fs';
import {AdmissionError} from './admission.mjs';
const ROOT='/sys/fs/cgroup',SLICE=ROOT+'/localai.slice/localai-ai.slice';
const unavailable=()=>{throw new AdmissionError('resource_measurement_unavailable');};
function integer(text){if(typeof text!=='string'||!/^\d+\s*$/.test(text))unavailable();const value=Number(text.trim());if(!Number.isSafeInteger(value)||value<0)unavailable();return value;}
function inactiveFile(text,current){if(typeof text!=='string')unavailable();const values=Object.fromEntries(text.trim().split(/\r?\n/).map(line=>line.split(' ')));if(!Object.hasOwn(values,'file')||!Object.hasOwn(values,'inactive_file'))unavailable();const file=integer(values.file),inactive=integer(values.inactive_file);if(inactive>file||file>current)unavailable();return inactive;}
function pressure(text){if(typeof text!=='string')unavailable();const values=['some','full'].map(kind=>{const matches=[...text.matchAll(new RegExp('^'+kind+' avg10=([0-9]+(?:\\.[0-9]+)?) avg60=[0-9]+(?:\\.[0-9]+)? avg300=[0-9]+(?:\\.[0-9]+)? total=[0-9]+$','gm'))];if(matches.length!==1)unavailable();const value=Number(matches[0][1]);if(!Number.isFinite(value)||value<0||value>100)unavailable();return value;});return Math.max(...values);}
// Fixed container and aggregate-worker paths. The gateway leaf's512MiB cap is not
// the budget for a sibling document worker. Existing cold host swap is distinct
// from worker swap or recent host swap growth; no swap is disabled or cleared.
export function createResourceReader({read=path=>readFileSync(path,'utf8'),now=()=>performance.now()}={}){
 if(typeof read!=='function'||typeof now!=='function')throw new TypeError('Invalid resource reader');let previousSwap,previousTime=-1,growthBytes=0,growthAt=-Infinity;
 return function snapshot(){try{
  const time=now();if(!Number.isFinite(time)||time<previousTime)unavailable();const meminfo=read('/proc/meminfo');
  const metric=key=>{const matches=[...meminfo.matchAll(new RegExp('^'+key+':\\s+(\\d+) kB$','gm'))];if(matches.length!==1)unavailable();const value=integer(matches[0][1])*1024;if(!Number.isSafeInteger(value))unavailable();return value;};
  const total=metric('MemTotal'),available=metric('MemAvailable'),current=integer(read(ROOT+'/memory.current')),maximum=read(ROOT+'/memory.max').trim(),sliceCurrent=integer(read(SLICE+'/memory.current')),sliceMaximum=read(SLICE+'/memory.max').trim(),hostSwap=integer(read(ROOT+'/memory.swap.current')),swapUsedBytes=integer(read(SLICE+'/memory.swap.current'));
  const rootLimit=maximum==='max'?total:Math.min(total,integer(maximum)),sliceLimit=sliceMaximum==='max'?rootLimit:integer(sliceMaximum);if(total<1||available>total)unavailable();
  const memoryPressure=Math.max(pressure(read(ROOT+'/memory.pressure')),pressure(read(SLICE+'/memory.pressure')));
  if(previousSwap!==undefined&&hostSwap>previousSwap){growthBytes=Math.max(growthBytes,hostSwap-previousSwap);growthAt=time;}if(time-growthAt>60000)growthBytes=0;previousSwap=hostSwap;previousTime=time;
  const containerAvailableBytes=Math.max(0,Math.min(available,rootLimit-current+inactiveFile(read(ROOT+'/memory.stat'),current))),workerSliceAvailableBytes=Math.max(0,sliceLimit-sliceCurrent+inactiveFile(read(SLICE+'/memory.stat'),sliceCurrent));return Object.freeze({availableBytes:Math.min(containerAvailableBytes,workerSliceAvailableBytes),containerAvailableBytes,workerSliceAvailableBytes,swapUsedBytes,existingHostSwapBytes:hostSwap,hostSwapGrowthBytes:growthBytes,memoryPressure});
 }catch{unavailable();}};
}
