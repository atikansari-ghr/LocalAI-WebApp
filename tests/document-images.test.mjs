import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeImageReport} from '../services/documents/images.mjs';
const frame={page:1,originalWidth:900,originalHeight:140,orientation:1,width:900,height:140,bytes:100,sha256:'a'.repeat(64)};
test('Image report binds normalized pages to original image identity and transformation metadata',()=>{
 const result=decodeImageReport({version:'13.0.0',format:'PNG',frames:[frame]},{format:'png',sha256:'b'.repeat(64)});assert.equal(result.pages[0].source.documentSha256,'b'.repeat(64));assert.equal(result.pages[0].source.unit,'normalized-image-pixels');assert.deepEqual(result.pages[0].source.originalSize,[900,140]);
});
test('Image report rejects forged formats dimensions counts and output budgets',()=>{
 for(const altered of [{...frame,width:100000},{...frame,originalWidth:100000},{...frame,orientation:9},{...frame,page:2},{...frame,sha256:'bad'},{...frame,bytes:30000000}])assert.throws(()=>decodeImageReport({version:'13.0.0',format:'PNG',frames:[altered]},{format:'png',sha256:'b'.repeat(64)}));assert.throws(()=>decodeImageReport({version:'13.0.0',format:'JPEG',frames:[frame]},{format:'png',sha256:'b'.repeat(64)}));
});
