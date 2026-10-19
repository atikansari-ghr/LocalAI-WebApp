import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDocumentProcessor} from '../services/documents/parsers.mjs';
import {inspectDocument} from '../services/documents/validation.mjs';
const png=readFileSync(new URL('./fixtures/documents/english.png',import.meta.url)),sha=createHash('sha256').update(png).digest('hex');
test('Document processor dispatches literal formats and rejects caller runtime paths and limits',async()=>{
 const parse=createDocumentProcessor();const result=await parse({name:'example.txt',bytes:Buffer.from('مرحبا LOCAL AI')});assert.equal(result.text,'مرحبا LOCAL AI');assert.equal(result.document.format,'txt');
 await assert.rejects(parse({name:'example.txt',bytes:Buffer.from('hello')},{worker:'/tmp/evil'}),/invalid_document_options/);await assert.rejects(parse({name:'example.txt',bytes:Buffer.from('hello')},{maxTextBytes:2}),/document_too_large|text_output_limit/);
});
test('Document processor keeps mixed PDF native and OCR evidence distinct with exact page bindings',async()=>{
 const calls=[],pdf=async input=>({document:inspectDocument(input),parser:'test-pdf',warnings:[],pages:[{index:1,width:100,height:100,status:'native-text',text:'Native only',units:[]},{index:2,width:100,height:100,status:'native-and-images-review',text:'Native header',units:[]}],rasters:[1,2].map(page=>({page,bytes:png,sha256:sha}))}),ocr=async pages=>{calls.push(...pages.map(p=>p.index));return {pages:pages.map(p=>({index:p.index,text:'Scanned body',units:[{text:'Scanned body',source:{page:p.index}}],manualReviewRequired:true})),warnings:[]};};
 const result=await createDocumentProcessor({pdf,ocr})({name:'example.pdf',bytes:Buffer.from('%PDF-1.7\n')},{ocr:'auto',language:'en'});assert.deepEqual(calls,[2]);assert.equal(result.pages[0].text,'Native only');assert.equal(result.pages[1].nativeText,'Native header');assert.equal(result.pages[1].ocr.text,'Scanned body');assert.equal(result.pages[1].ocr.units[0].source.page,2);assert.equal(result.pages[1].ocr.page,2);assert.equal(result.pages[1].manualReviewRequired,true);assert.equal(result.rasters,undefined);
});
test('Image processor does not expose normalized bytes and requires configured OCR only when requested',async()=>{
 const image=async input=>({document:inspectDocument(input),parser:'test-image',warnings:[],pages:[{index:1,width:900,height:140,sha256:sha,bytes:png,source:{documentSha256:inspectDocument(input).sha256}}]});const parse=createDocumentProcessor({image});const result=await parse({name:'example.png',bytes:png},{ocr:'off'});assert.equal(result.pages[0].bytes,undefined);assert.equal(result.pages[0].status,'requires-ocr');await assert.rejects(parse({name:'example.png',bytes:png},{ocr:'auto'}),/ocr_worker_unavailable/);
});
