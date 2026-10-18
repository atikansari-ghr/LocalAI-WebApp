import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword, totp, verifyTotp, openVault, initializeVault } from '../packages/auth/crypto.mjs';
import { matchesNetwork, resolveClientIp } from '../packages/auth/network.mjs';
test('password hashes are salted and wrong or malformed hashes never authenticate',async()=>{
 const a=await hashPassword('correct horse battery staple'), b=await hashPassword('correct horse battery staple');
 assert.notEqual(a,b);assert.equal(await verifyPassword('correct horse battery staple',a),true);
 assert.equal(await verifyPassword('wrong password',a),false);
 assert.equal(await verifyPassword('anything','scrypt$999999999999$8$1$a$b'),false);
 await assert.rejects(hashPassword('short'));
});
test('password verification accepts the OWASP 32 MiB scrypt profile with three passes',async()=>{
 const salt=Buffer.alloc(16,7),key=scryptSync('synthetic strong password',salt,64,{N:32768,r:8,p:3,maxmem:64*1024**2});
 const encoded='scrypt$32768$8$3$'+salt.toString('base64url')+'$'+key.toString('base64url');
 assert.equal(await verifyPassword('synthetic strong password',encoded),true);
});
test('TOTP matches an RFC vector and rejects already-used counters and expired codes',()=>{
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 6238 SHA-1 test key
 assert.equal(totp(secret,59000),'287082');
 assert.equal(verifyTotp(secret,'287082',59000,-1),1);
 assert.equal(verifyTotp(secret,'287082',59000,1),null);
 assert.equal(verifyTotp(secret,'287082',180000,-1),null);
 assert.equal(verifyTotp(secret,'28708x',59000,-1),null);
});
test('vault survives reopening and binds encrypted secrets to their purpose',t=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-vault-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'master.key');const vault=initializeVault(path,{encryptedStateExists:false}), encrypted=vault.seal('synthetic secret','totp:user1');
 assert.equal(encrypted.includes('synthetic'),false);assert.equal(openVault(path).open(encrypted,'totp:user1'),'synthetic secret');
 assert.throws(()=>vault.open(encrypted,'totp:user2'));
 const parts=encrypted.split('.');parts[2]=Buffer.from('tampered').toString('base64url');
 assert.throws(()=>vault.open(parts.join('.'),'totp:user1'));
 assert.equal(readFileSync(path).length,32);
});
test('opening a vault with a missing master key requires recovery and never silently rekeys it',t=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-vault-lost-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'master.key');const vault=initializeVault(path,{encryptedStateExists:false}),encrypted=vault.seal('saved data','purpose');
 renameSync(path,path+'.recovery');assert.throws(()=>openVault(path));
 renameSync(path+'.recovery',path);assert.equal(openVault(path).open(encrypted,'purpose'),'saved data');
});
test('initialization requires an empty-state proof and never replaces an incomplete existing key',t=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-vault-init-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'master.key');assert.throws(()=>initializeVault(path,{encryptedStateExists:true}));assert.equal(existsSync(path),false);
 writeFileSync(path,Buffer.alloc(0),{mode:0o600});assert.throws(()=>initializeVault(path,{encryptedStateExists:false}));assert.equal(readFileSync(path).length,0);
});
test('network restrictions handle IPv4 IPv6 and mapped IPv4 without accepting malformed CIDRs',()=>{
 assert.equal(matchesNetwork('192.168.10.20',['192.168.10.0/24']),true);
 assert.equal(matchesNetwork('192.168.11.20',['192.168.10.0/24']),false);
 assert.equal(matchesNetwork('::ffff:192.168.10.20',['192.168.10.0/24']),true);
 assert.equal(matchesNetwork('2001:db8::20',['2001:db8::/32']),true);
 for(const network of ['0.0.0.0/abc','192.168.0.1/33','::/129','localhost'])assert.throws(()=>matchesNetwork('127.0.0.1',[network]));
});
test('only explicitly trusted proxy hops can supply the client address',()=>{
 assert.equal(resolveClientIp('192.168.10.5','1.2.3.4',['127.0.0.1']),'192.168.10.5');
 assert.equal(resolveClientIp('127.0.0.1','198.51.100.7, 10.0.0.1',['127.0.0.1','10.0.0.0/8']),'198.51.100.7');
 assert.equal(resolveClientIp('127.0.0.1','1.2.3.4, 198.51.100.7',['127.0.0.1']),'198.51.100.7');
 assert.throws(()=>resolveClientIp('127.0.0.1','malformed',['127.0.0.1']));
});
