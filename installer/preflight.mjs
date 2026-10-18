import { readFileSync, existsSync, statfsSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { pathToFileURL } from 'node:url';

export function preflight(s) {
  const errors=[];
  if(s.os!=='debian'||s.version!=='13')errors.push('Debian 13 is required');
  if(!['x64','arm64'].includes(s.arch))errors.push('Unsupported CPU architecture');
  for(const [key,min] of [['cpus',4],['memoryBytes',5.5e9],['diskBytes',90e9],['freeBytes',10e9]]) {
    if(!Number.isFinite(s[key])||s[key]<min)errors.push('Insufficient or unknown '+key);
  }
  if(s.systemd!==true)errors.push('Running systemd is required');
  return {errors,warnings:[]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const release=Object.fromEntries(readFileSync('/etc/os-release','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')];}));
    const disk=statfsSync('/var/lib'),limit=process.constrainedMemory();
    const result=preflight({os:release.ID,version:release.VERSION_ID,arch:process.arch,cpus:availableParallelism(),memoryBytes:limit?Math.min(limit,totalmem()):totalmem(),diskBytes:disk.blocks*disk.bsize,freeBytes:disk.bavail*disk.bsize,systemd:existsSync('/run/systemd/system')});
    console.log(JSON.stringify(result));if(result.errors.length)process.exitCode=1;
  } catch {console.error('Unable to verify installation environment');process.exitCode=1;}
}
