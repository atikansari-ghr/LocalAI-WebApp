import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventoryDocumentCohortTree} from '../services/documents/cohort-inventory.mjs';

test('Candidate inventory is path-order stable and detects changed installed bytes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'localai-inventory-'));
 try{
  mkdirSync(join(root,'pkg'));writeFileSync(join(root,'pkg','LICENSE'),'MIT');writeFileSync(join(root,'b.bin'),Buffer.from([0,1,2]));
  const first=await inventoryDocumentCohortTree(root);const repeated=await inventoryDocumentCohortTree(root);
  assert.deepEqual(first,repeated);assert.equal(first.files,2);assert.equal(first.bytes,6);assert.deepEqual(first.licensePaths,['pkg/LICENSE']);
  writeFileSync(join(root,'b.bin'),Buffer.from([0,1,3]));const changed=await inventoryDocumentCohortTree(root);
  assert.notEqual(changed.treeSha256,first.treeSha256);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Candidate inventory records symlinks without following external targets',async t=>{
 if(process.platform==='win32')return t.skip('POSIX symlink permissions');
 const root=mkdtempSync(join(tmpdir(),'localai-inventory-'));
 try{
  writeFileSync(join(root,'safe'),'x');symlinkSync('/etc/passwd',join(root,'external'));chmodSync(root,0o700);
  const inventory=await inventoryDocumentCohortTree(root);assert.equal(inventory.files,1);assert.equal(inventory.symlinks,1);assert.deepEqual(inventory.externalSymlinks,['external']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Candidate inventory identifies writable installed paths for remediation',async t=>{
 if(process.platform==='win32')return t.skip('POSIX mode bits');
 const root=mkdtempSync(join(tmpdir(),'localai-inventory-'));
 try{writeFileSync(join(root,'writable'),'x');chmodSync(join(root,'writable'),0o666);const result=await inventoryDocumentCohortTree(root);assert.deepEqual(result.unsafeModePaths,['writable']);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('Candidate inventory includes root permissions and resolves indirect external links',async t=>{
 if(process.platform==='win32')return t.skip('POSIX mode bits and symlinks');
 const root=mkdtempSync(join(tmpdir(),'localai-inventory-'));
 try{
  writeFileSync(join(root,'safe'),'x');symlinkSync('/etc/passwd',join(root,'outside'));symlinkSync('outside',join(root,'indirect'));
  chmodSync(root,0o777);const unsafe=await inventoryDocumentCohortTree(root);
  assert.ok(unsafe.unsafeModePaths.includes('.'));
  assert.deepEqual(unsafe.externalSymlinks,['indirect','outside']);
  chmodSync(root,0o700);const safe=await inventoryDocumentCohortTree(root);
  assert.notEqual(unsafe.treeSha256,safe.treeSha256);
 }finally{rmSync(root,{recursive:true,force:true});}
});
