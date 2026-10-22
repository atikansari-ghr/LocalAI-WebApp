import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTesseractTsv,createNativeOcrAdapters} from '../services/documents/ocr-adapters.mjs';
const header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n';
test('Tesseract adapter preserves word polygons and raw confidence without cross-engine ranking',()=>{
 const result=decodeTesseractTsv(header+'5\t1\t1\t1\t1\t1\t10\t20\t50\t30\t92.5\tمرحبا\n',{width:900,height:140});assert.equal(result.lines[0].text,'مرحبا');assert.equal(result.lines[0].confidence,0.925);assert.deepEqual(result.lines[0].box[2],{x:60,y:50});
 for(const row of ['5\t1\t1\t1\t1\t1\t-1\t20\t50\t30\t92\tx\n','5\t1\t1\t1\t1\t1\t10\t20\t5000\t30\t92\tx\n'])assert.throws(()=>decodeTesseractTsv(header+row,{width:900,height:140}),/invalid_tesseract_output/);
 assert.throws(()=>decodeTesseractTsv('wrong',{width:1,height:1}),/invalid_tesseract_output/);
});
test('Native OCR adapters reject caller executable overrides and require fixed absolute installations',()=>{
 assert.throws(()=>createNativeOcrAdapters({lightRoot:'relative'}),/invalid_ocr_adapter_configuration/);
});
