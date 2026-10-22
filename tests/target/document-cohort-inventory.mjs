// Read-only installed-byte inventory of the disposable Debian candidate trees.
import assert from 'node:assert/strict';
import {inventoryDocumentCohortTree} from '../../services/documents/cohort-inventory.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const roots=Object.freeze({
 light:'/opt/localai/ocr/candidates/light-ocr-0.5.8',
 tesseract:'/opt/localai/ocr/candidates/tesseract-5.5.0',
 paddle:'/opt/localai/ocr/candidates/paddleocr-3.7.0',
 poppler:'/opt/localai/documents/candidates/poppler-25.03.0',
 legacy:'/opt/localai/documents/candidates/legacy-tools'
});
for(const [component,path] of Object.entries(roots)){
 const inventory=await inventoryDocumentCohortTree(path);
 process.stdout.write(JSON.stringify({component,...inventory,
  unsafeModePaths:inventory.unsafeModePaths.slice(0,20),nonRootPaths:inventory.nonRootPaths.slice(0,20),
  licensePaths:inventory.licensePaths.slice(0,20),licensePathCount:inventory.licensePaths.length,
  externalSymlinks:inventory.externalSymlinks.slice(0,20),externalSymlinkCount:inventory.externalSymlinks.length})+'\n');
}
