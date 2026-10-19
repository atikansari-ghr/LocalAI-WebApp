import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeLegacyCsv} from '../services/documents/legacy.mjs';
const document={sha256:'a'.repeat(64)};
test('Legacy XLS conversion preserves literal cells sheet ordinals and quoted separator bytes',()=>{
 const result=decodeLegacyCsv('"LOCAL AI","مرحبا"\n"42","=inert"\n\u001e"Second","inside\u001evalue"\n\u001e',document);assert.equal(result.sheets.length,2);assert.equal(result.sheets[0].cells[1].text,'مرحبا');assert.equal(result.sheets[0].cells[3].text,'=inert');assert.equal(result.sheets[1].cells[1].text,'inside\u001evalue');assert.equal(result.sheets[1].cells[0].source.sheet,2);assert.equal(result.sheets[0].cells[0].source.unit,'converted-csv-utf16');
});
test('Legacy XLS conversion rejects malformed streams and bounded output',()=>{
 assert.throws(()=>decodeLegacyCsv('"broken\u001e',document));assert.throws(()=>decodeLegacyCsv('"data"\n\u001e',document,{maxTextBytes:2}),/text_output_limit/);assert.throws(()=>decodeLegacyCsv('no terminating sheet marker',document));
});

test('RTF structural policy rejects truncated groups embedded objects and oversized binary payloads',async()=>{
 const {validateRtfStructure}=await import('../services/documents/legacy.mjs');assert.equal(validateRtfStructure(Buffer.from('{\\rtf1 literal \\{brace\\} \\bin3 {}}}')).valid,true);
 for(const text of ['{\\rtf1 broken','{\\rtf1 \\object data}','{\\rtf1 \\bin999999999 x}','{\\rtf1 } trailing'])assert.throws(()=>validateRtfStructure(Buffer.from(text)));
});
