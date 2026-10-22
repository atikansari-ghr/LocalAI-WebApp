// Read-only vendor package inventory on the disposable Debian candidate.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,createReadStream,closeSync,fstatSync,lstatSync,openSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const root='/opt/localai/ocr/candidates/light-ocr-0.5.8/node_modules/@arcships/light-ocr-linux-x64-gnu';
const safePath=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
for(let directory=root;directory!=='/';directory=dirname(directory)){const state=lstatSync(directory);assert.ok(state.isDirectory()&&state.uid===0&&(state.mode&0o022)===0);}
function vendorJson(name){
 const path=join(root,name),before=lstatSync(path);assert.ok(before.isFile()&&before.uid===0&&(before.mode&0o022)===0&&before.size<2*1024**2);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const opened=fstatSync(fd);assert.ok(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size);return JSON.parse(readFileSync(fd,'utf8'));}
 finally{closeSync(fd);}
}
const manifest=vendorJson('artifact-hashes.json'),licenses=vendorJson('license-inventory.json'),sbom=vendorJson('sbom.spdx.json');
assert.ok(Array.isArray(manifest.files)&&manifest.files.length>=20&&manifest.files.length<=1000);
assert.ok(Array.isArray(licenses.files)&&licenses.files.length>=14&&licenses.files.length<=100);
const declared=new Map();
for(const item of manifest.files){
 assert.ok(item&&typeof item.path==='string'&&safePath.test(item.path)&&!declared.has(item.path));
 assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<100*1024**2);
 declared.set(item.path,item);
}
const names=[];
async function visit(directory,prefix=''){
 const state=lstatSync(directory);assert.ok(state.isDirectory()&&state.uid===0&&(state.mode&0o022)===0);
 for(const name of readdirSync(directory).sort()){
  const relative=prefix?prefix+'/'+name:name;assert.ok(safePath.test(relative));
  const full=join(directory,name),entry=lstatSync(full);
  if(entry.isDirectory()){await visit(full,relative);continue;}
  assert.ok(entry.isFile()&&entry.uid===0&&(entry.mode&0o022)===0,'unsafe package entry: '+relative);
  names.push(relative);
  if(relative==='artifact-hashes.json')continue;
  const expected=declared.get(relative);assert.ok(expected,'undeclared vendor file: '+relative);
  const fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW),digest=createHash('sha256');
  try{
   const opened=fstatSync(fd);assert.ok(opened.isFile()&&opened.ino===entry.ino&&opened.dev===entry.dev&&opened.size===expected.bytes);
   for await(const chunk of createReadStream(null,{fd,autoClose:false}))digest.update(chunk);
   assert.equal(digest.digest('hex'),expected.sha256,'vendor artifact mismatch: '+relative);
  }finally{closeSync(fd);}
 }
}
await visit(root);
assert.deepEqual(names.filter(name=>name!=='artifact-hashes.json').sort(),[...declared.keys()].sort());
const licenseFiles=new Set(),components=new Set();
for(const item of licenses.files){
 assert.ok(item&&typeof item.component==='string'&&/^[A-Za-z0-9_.-]+$/.test(item.component));
 assert.ok(typeof item.file==='string'&&item.file.startsWith('licenses/')&&safePath.test(item.file)&&!licenseFiles.has(item.file));
 assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.ok(declared.has(item.file),'undeclared license file');
 assert.equal(item.sha256,declared.get(item.file)?.sha256,'vendor license hash mismatch');
 licenseFiles.add(item.file);components.add(item.component);
}
assert.ok(Array.isArray(sbom.packages)&&sbom.packages.length>=components.size);
for(const item of sbom.packages)assert.ok(typeof item.name==='string'&&typeof item.licenseDeclared==='string'&&item.licenseDeclared!=='NOASSERTION');
process.stdout.write(JSON.stringify({gate:'light-ocr-vendor-native-inventory',files:names.length,declaredFiles:declared.size,licenseFiles:licenseFiles.size,licenseComponents:[...components].sort(),sbomPackages:sbom.packages.length,vendorManifestVerified:true,transitiveLicenseAuditComplete:false,activated:false})+'\n');
