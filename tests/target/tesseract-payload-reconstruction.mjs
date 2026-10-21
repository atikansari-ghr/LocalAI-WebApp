// Reconstruct the isolated OCR candidate from its verified Debian archives.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstatSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
await import('./tesseract-deb-provenance.mjs');
const base='/opt/localai/ocr/candidates/tesseract-5.5.0';
const archiveDirectory=join(base,'debs'),installed=join(base,'root');
const archiveNames=readdirSync(archiveDirectory).filter(name=>name.endsWith('.deb')).sort();
assert.equal(archiveNames.length,47);
const scratch='/root',parent=lstatSync(scratch);
assert.ok(parent.isDirectory()&&parent.uid===0&&(parent.mode&0o077)===0);
const reconstructed=mkdtempSync(join(scratch,'localai-tesseract-payload-'));
let comparedEntries=0;
function compareMetadata(left,right){
 const names=readdirSync(left).sort();assert.deepEqual(names,readdirSync(right).sort());
 for(const name of names){
  const leftPath=join(left,name),rightPath=join(right,name),a=lstatSync(leftPath),b=lstatSync(rightPath);
  assert.equal(a.mode,b.mode,'mode/type mismatch: '+leftPath);
  assert.equal(a.uid,b.uid,'owner mismatch: '+leftPath);assert.equal(a.gid,b.gid,'group mismatch: '+leftPath);
  comparedEntries++;if(a.isDirectory())compareMetadata(leftPath,rightPath);
 }
}
try{
 for(const name of archiveNames)execFileSync('/usr/bin/dpkg-deb',['-x',join(archiveDirectory,name),reconstructed],{timeout:30000,maxBuffer:8192});
 const result=execFileSync('/usr/bin/diff',['-qr','--no-dereference',installed,reconstructed],{encoding:'utf8',timeout:30000,maxBuffer:8192});
 assert.equal(result,'');
 compareMetadata(installed,reconstructed);
 process.stdout.write(JSON.stringify({gate:'tesseract-payload-reconstruction',archives:archiveNames.length,comparedEntries,byteAndSymlinkTreeMatched:true,ownershipAndModesMatched:true,licensesAuditedHere:false,activated:false})+'\n');
}finally{
 assert.ok(reconstructed.startsWith(scratch+'/localai-tesseract-payload-'));
 rmSync(reconstructed,{recursive:true,force:true});
}
