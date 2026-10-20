// Read-only apt-index/hash check of isolated Tesseract candidate archives.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {constants,createReadStream,closeSync,fstatSync,lstatSync,openSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const directory='/opt/localai/ocr/candidates/tesseract-5.5.0/debs';
for(let parent=directory;parent!=='/';parent=dirname(parent)){const state=lstatSync(parent);assert.ok(state.isDirectory()&&state.uid===0&&(state.mode&0o022)===0);}
const names=readdirSync(directory).filter(name=>name.endsWith('.deb')).sort();assert.ok(names.length>=40&&names.length<=100);
const checked=[];
for(const name of names){
 assert.match(name,/^[A-Za-z0-9_.+%~-]+\.deb$/);
 const path=join(directory,name),before=lstatSync(path);assert.ok(before.isFile()&&before.uid===0&&(before.mode&0o022)===0&&before.size>0&&before.size<100*1024**2);
 const metadata=execFileSync('/usr/bin/dpkg-deb',['-f',path,'Package','Version','Architecture'],{encoding:'utf8',maxBuffer:4096}).trim().split('\n');
 assert.equal(metadata.length,3);const [nameField,version,architecture]=metadata.map(line=>line.slice(line.indexOf(': ')+2));
 assert.match(nameField,/^[a-z0-9][a-z0-9+.-]{0,127}$/);assert.match(version,/^[A-Za-z0-9:~+.-]{1,128}$/);assert.ok(['amd64','all'].includes(architecture));
 const record=execFileSync('/usr/bin/apt-cache',['show',nameField+'='+version],{encoding:'utf8',maxBuffer:65536});
 const candidates=record.trim().split(/\n\s*\n/).map(stanza=>Object.fromEntries(stanza.split('\n').filter(line=>/^(Package|Version|Architecture|SHA256|Filename): /.test(line)).map(line=>{const at=line.indexOf(': ');return [line.slice(0,at),line.slice(at+2)];}))).filter(fields=>fields.Package===nameField&&fields.Version===version&&fields.Architecture===architecture&&/^[a-f0-9]{64}$/.test(fields.SHA256)&&fields.Filename?.startsWith('pool/')&&fields.Filename.endsWith('.deb'));
 assert.ok(candidates.length>0,'no exact apt index record: '+name);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
 try{const opened=fstatSync(fd);assert.ok(opened.isFile()&&opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size);
  for await(const chunk of createReadStream(null,{fd,autoClose:false}))hash.update(chunk);
  assert.equal(fstatSync(fd).size,before.size);const digest=hash.digest('hex');assert.ok(candidates.some(fields=>fields.SHA256===digest),'apt index hash mismatch: '+name);
 }finally{closeSync(fd);}
 checked.push({package:nameField,version,architecture});
}
assert.ok(checked.some(item=>item.package==='tesseract-ocr'&&item.version.startsWith('5.5.0')));
assert.ok(checked.some(item=>item.package==='tesseract-ocr-eng')&&checked.some(item=>item.package==='tesseract-ocr-ara'));
process.stdout.write(JSON.stringify({gate:'tesseract-debian-archives',archives:checked.length,ocrVersion:checked.find(item=>item.package==='tesseract-ocr').version,englishData:checked.find(item=>item.package==='tesseract-ocr-eng').version,arabicData:checked.find(item=>item.package==='tesseract-ocr-ara').version,aptIndexHashesVerified:true,indexSignatureRevalidatedHere:false,installedPayloadAndLicensesAudited:false,activated:false})+'\n');
