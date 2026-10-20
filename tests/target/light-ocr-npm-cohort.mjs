// Read-only comparison of the installed candidate against exact npm archives.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {constants,createReadStream,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const parent='/root/localai-phase4-validation/.localai',candidate='/opt/localai/ocr/candidates/light-ocr-0.5.8/node_modules/@arcships';
const lock=(await import('../../services/documents/package-lock.json',{with:{type:'json'}})).default;
const cohort=[
 ['light-ocr','0.5.8'],['light-ocr-runtime','0.1.8'],
 ['light-ocr-model-ppocrv6-small','0.3.4'],['light-ocr-linux-x64-gnu','0.5.8']
];
function safeAncestors(path){for(let directory=path;directory!=='/';directory=dirname(directory)){const state=lstatSync(directory);assert.ok(state.isDirectory()&&state.uid===0&&(state.mode&0o022)===0,'unsafe audit directory: '+directory);}}
async function hashFile(path,algorithm){
 const before=lstatSync(path);assert.ok(before.isFile());
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),digest=createHash(algorithm);
 try{const opened=fstatSync(fd);assert.ok(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size);
  for await(const chunk of createReadStream(null,{fd,autoClose:false}))digest.update(chunk);
  assert.equal(fstatSync(fd).size,before.size);return digest.digest(algorithm==='sha512'?'base64':'hex');
 }finally{closeSync(fd);}
}
async function files(root){
 const result=new Map();
 async function visit(directory,prefix=''){
  const stat=lstatSync(directory);assert.ok(stat.isDirectory()&&stat.uid===0&&(stat.mode&0o022)===0);
  for(const name of readdirSync(directory).sort()){
   const relative=prefix?prefix+'/'+name:name,full=join(directory,name),entry=lstatSync(full);
   if(entry.isDirectory())await visit(full,relative);
   else{assert.ok(entry.isFile(),'unexpected package link/entry: '+relative);result.set(relative,[entry.size,await hashFile(full,'sha256')]);}
  }
 }
 await visit(root);return result;
}
const results=[];
safeAncestors(parent);safeAncestors(candidate);
for(const [name,version] of cohort){
 const metadata=lock.packages['node_modules/@arcships/'+name],archive=join(parent,name+'-'+version+'.tgz');
 assert.equal(metadata.version,version);assert.equal(metadata.resolved,`https://registry.npmjs.org/@arcships/${name}/-/${name}-${version}.tgz`);
 const archiveState=lstatSync(archive);assert.ok(archiveState.isFile()&&archiveState.uid===0&&(archiveState.mode&0o022)===0&&archiveState.size>0&&archiveState.size<=100*1024**2);
 const archiveFd=openSync(archive,constants.O_RDONLY|constants.O_NOFOLLOW);let archiveBytes;
 try{const opened=fstatSync(archiveFd);assert.ok(opened.isFile()&&opened.dev===archiveState.dev&&opened.ino===archiveState.ino&&opened.size===archiveState.size);archiveBytes=readFileSync(archiveFd);assert.equal(fstatSync(archiveFd).size,archiveState.size);}finally{closeSync(archiveFd);}
 assert.equal('sha512-'+createHash('sha512').update(archiveBytes).digest('base64'),metadata.integrity,'npm lock integrity mismatch: '+name);
 const listing=execFileSync('/usr/bin/tar',['-tzf','-'],{input:archiveBytes,encoding:'utf8',maxBuffer:2*1024**2}).trim().split('\n');
 assert.ok(listing.length>0&&listing.length<1000);
 for(const path of listing)assert.ok(/^package\/(?:[A-Za-z0-9@_.+ -]+\/)*[A-Za-z0-9@_.+ -]+\/?$/.test(path)&&!path.split('/').includes('..'),'unsafe archive path: '+path);
 const typed=execFileSync('/usr/bin/tar',['-tvzf','-'],{input:archiveBytes,encoding:'utf8',maxBuffer:2*1024**2}).trim().split('\n');
 assert.equal(typed.length,listing.length);
 let unpacked=0;
 for(const row of typed){
  assert.ok(['-','d'].includes(row[0]),'archive contains a link or special entry');
  const size=Number(row.trim().split(/\s+/)[2]);assert.ok(Number.isSafeInteger(size)&&size>=0&&size<=128*1024**2);
  unpacked+=size;assert.ok(unpacked<=256*1024**2,'archive exceeds audit extraction budget');
 }
 const tmp=mkdtempSync(join(parent,'npm-verify-'));
 try{
  execFileSync('/usr/bin/tar',['-xzf','-','-C',tmp,'--no-same-owner','--no-same-permissions'],{input:archiveBytes,timeout:120000,maxBuffer:1024});
  const extracted=await files(join(tmp,'package')),installed=await files(join(candidate,name));
  assert.deepEqual([...installed.entries()].sort(),[...extracted.entries()].sort(),'installed package differs from pinned archive: '+name);
  results.push({name,version,files:installed.size,archiveSha512Verified:true,installedBytesMatch:true});
 }finally{assert.ok(tmp.startsWith(parent+'/npm-verify-'));rmSync(tmp,{recursive:true,force:true});}
}
process.stdout.write(JSON.stringify({gate:'light-ocr-npm-cohort',results,transitiveLicenseAuditComplete:false,activated:false})+'\n');
