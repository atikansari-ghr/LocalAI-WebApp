import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocumentCohortProcessor,loadDocumentCohortProcessor} from '../services/documents/cohort.mjs';

const cohort={version:1,popplerRoot:'/opt/localai/documents/poppler',legacyRoot:'/opt/localai/documents/legacy',lightRoot:'/opt/localai/ocr/light',tesseractRoot:'/opt/localai/ocr/tesseract',paddleRoot:'/opt/localai/ocr/paddle',paddlePython:'/opt/localai/ocr/paddle/venv/bin/python'};
test('A fixed installed cohort composes a worker that still preserves native text',async()=>{
 const processDocument=createDocumentCohortProcessor(cohort);
 const result=await processDocument({name:'proof.txt',bytes:Buffer.from('مرحبا installed cohort')});
 assert.equal(result.text,'مرحبا installed cohort');
});
test('A malformed or caller-directed cohort fails closed',()=>{
 for(const value of [{...cohort,popplerRoot:'/tmp/foreign'}, {...cohort,extra:'accept'}, {...cohort,version:2}, {...cohort,paddlePython:'relative/python'}])assert.throws(()=>createDocumentCohortProcessor(value),/invalid_document_cohort/);
});
test('A missing cohort leaves rich native tools unavailable',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'localai-cohort-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const processDocument=loadDocumentCohortProcessor(join(dir,'absent.json'));
 await assert.rejects(processDocument({name:'proof.pdf',bytes:Buffer.from('%PDF-1.7\n')}),/pdf_worker_unavailable/);
 writeFileSync(join(dir,'invalid.json'),'{"version":2}');
 assert.throws(()=>loadDocumentCohortProcessor(join(dir,'invalid.json')));
});
