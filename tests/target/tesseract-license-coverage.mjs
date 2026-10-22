// This release gate intentionally fails while a candidate notice is unresolved.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
await import('./tesseract-deb-provenance.mjs');
const base='/opt/localai/ocr/candidates/tesseract-5.5.0',root=join(base,'root');
const archives=readdirSync(join(base,'debs')).filter(name=>name.endsWith('.deb')).sort();
const notices=[],unresolved=[];
for(const name of archives){
 const metadata=execFileSync('/usr/bin/dpkg-deb',['-f',join(base,'debs',name),'Package'],{encoding:'utf8',maxBuffer:1024}).trim();
 const packageName=metadata;
 assert.match(packageName,/^[a-z0-9][a-z0-9+.-]{0,127}$/);
 const expected=join(root,'usr/share/doc',packageName,'copyright');
 try{
  const resolved=realpathSync(expected);assert.ok(resolved.startsWith(root+'/'),'notice escapes candidate root: '+packageName);
  const state=lstatSync(resolved);assert.ok(state.isFile()&&state.uid===0&&(state.mode&0o022)===0&&state.size>0&&state.size<1024*1024);
  notices.push({package:packageName,sha256:createHash('sha256').update(readFileSync(resolved)).digest('hex')});
 }catch(error){if(error?.code==='ENOENT')unresolved.push(packageName);else throw error;}
}
process.stdout.write(JSON.stringify({gate:'tesseract-license-notice-coverage',archives:archives.length,resolved:notices.length,unresolved,transitiveLicenseAuditComplete:false,activated:false})+'\n');
assert.equal(unresolved.length,0,'missing candidate copyright notices');
