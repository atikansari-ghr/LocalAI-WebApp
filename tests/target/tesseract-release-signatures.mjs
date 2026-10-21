// Validate cached Debian Release signatures with an isolated, hash-pinned verifier.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
await import('./tesseract-deb-provenance.mjs');
const archive='/root/localai-phase4-validation/gpgv-static/gpgv-static_2.4.7-21+deb13u1+b5_amd64.deb';
const expected='cf12335ce3a8c6994a2008cd04cdf4d8e1e84a6d2e1aa9c78e3a6d4c235c2911';
for(let parent=dirname(archive);parent!=='/';parent=dirname(parent)){const state=lstatSync(parent);assert.ok(state.isDirectory()&&state.uid===0&&(state.mode&0o022)===0);}
const state=lstatSync(archive);assert.ok(state.isFile()&&state.uid===0&&(state.mode&0o022)===0&&state.size<2*1024**2);
const fd=openSync(archive,constants.O_RDONLY|constants.O_NOFOLLOW);
try{const opened=fstatSync(fd);assert.equal(opened.ino,state.ino);assert.equal(opened.dev,state.dev);assert.equal(createHash('sha256').update(readFileSync(fd)).digest('hex'),expected);}finally{closeSync(fd);}
const metadata=execFileSync('/usr/bin/dpkg-deb',['-f',archive,'Package','Version','Architecture'],{encoding:'utf8',maxBuffer:4096}).trim().split('\n').map(line=>line.slice(line.indexOf(': ')+2));
assert.deepEqual(metadata,['gpgv-static','2.4.7-21+deb13u1+b5','amd64']);
const index=execFileSync('/usr/bin/apt-cache',['show','gpgv-static=2.4.7-21+deb13u1+b5'],{encoding:'utf8',maxBuffer:8192});
assert.match(index,new RegExp('^SHA256: '+expected+'$','m'));
const packages=readFileSync('/var/lib/apt/lists/deb.debian.org_debian_dists_trixie_main_binary-amd64_Packages','utf8');
assert.ok(packages.split('\n\n').some(stanza=>{const fields=Object.fromEntries(stanza.split('\n').filter(line=>/^(Package|Version|Architecture|SHA256): /.test(line)).map(line=>{const at=line.indexOf(': ');return [line.slice(0,at),line.slice(at+2)];}));return fields.Package==='gpgv-static'&&fields.Version==='2.4.7-21+deb13u1+b5'&&fields.Architecture==='amd64'&&fields.SHA256===expected;}));
const keyring='/usr/share/keyrings/debian-archive-keyring.pgp',keyState=lstatSync(keyring);
assert.ok(keyState.isFile()&&keyState.uid===0&&(keyState.mode&0o022)===0);
const scratch='/root',parent=lstatSync(scratch);assert.ok(parent.isDirectory()&&parent.uid===0&&(parent.mode&0o077)===0);
const temporary=mkdtempSync(join(scratch,'localai-gpgv-'));
try{
 execFileSync('/usr/bin/dpkg-deb',['-x',archive,temporary],{timeout:30000,maxBuffer:8192});
 const verifier=join(temporary,'usr/bin/gpgv-static');
 for(const stem of ['deb.debian.org_debian_dists_trixie','deb.debian.org_debian_dists_trixie-updates','security.debian.org_dists_trixie-security']){
  const release='/var/lib/apt/lists/'+stem+'_InRelease';
  execFileSync(verifier,['--keyring',keyring,release],{timeout:15000,maxBuffer:8192});
 }
 process.stdout.write(JSON.stringify({gate:'tesseract-debian-release-signatures',verifierArchiveSha256:expected,verifiedReleases:3,locallyInstalledDebianKeyring:true,noSystemInstall:true,activated:false})+'\n');
}finally{assert.ok(temporary.startsWith(scratch+'/localai-gpgv-'));rmSync(temporary,{recursive:true,force:true});}
