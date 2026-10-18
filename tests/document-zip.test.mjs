import test from 'node:test';
import assert from 'node:assert/strict';
import {readZipDocument} from '../services/documents/containers.mjs';
import {makeZip} from './helpers/zip.mjs';
import {crc32} from 'node:zlib';
const input=bytes=>({name:'documents.zip',mime:'application/zip',bytes});
test('bounded ZIP reader verifies stored deflated descriptor and Unicode entries without filesystem extraction',async()=>{
 const bytes=makeZip([{name:'folder/'},{name:'folder/مستند.txt',bytes:'مرحبا بالعالم'},{name:'compressed.md',bytes:'# Local document\n',method:8},{name:'descriptor.txt',bytes:'descriptor',method:8,flags:0x808}]),copy=Buffer.from(bytes);
 const result=await readZipDocument(input(bytes));assert.deepEqual(bytes,copy);assert.equal(result.entries.length,4);assert.equal(result.entries[1].content.toString(),'مرحبا بالعالم');assert.match(result.entries[1].sha256,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(result.entries));assert.equal(result.validation,'zip-structure-and-crc-passed');
 const nested=await readZipDocument(input(makeZip([{name:'nested.zip',bytes:makeZip([{name:'inner.txt',bytes:'inner'}])}])));assert.equal(nested.entries[0].archive.entries[0].content.toString(),'inner');
 const unicode=Buffer.from('مستند.txt'),extra=Buffer.alloc(9+unicode.length);extra.writeUInt16LE(0x7075);extra.writeUInt16LE(5+unicode.length,2);extra[4]=1;extra.writeUInt32LE(crc32(Buffer.from('legacy.txt')),5);unicode.copy(extra,9);
 assert.equal((await readZipDocument(input(makeZip([{name:'legacy.txt',bytes:'text',flags:0,extra}])))).entries[0].path,'مستند.txt');
 const invalid=Buffer.from(extra);invalid[9]=0xff;await assert.rejects(readZipDocument(input(makeZip([{name:'legacy.txt',bytes:'text',flags:0,extra:invalid}]))),/invalid_name/);
});
test('ZIP reader rejects traversal aliases collisions links executables and encrypted or unsupported entries',async()=>{
 for(const name of ['../secret.txt','/absolute.txt','C:/secret.txt','dir\\secret.txt','dir/../secret.txt','dir//note.txt','dir/./note.txt','bad\u0000.txt','name.txt:stream','CON.txt'])await assert.rejects(readZipDocument(input(makeZip([{name,bytes:'x'}]))));
 for(const items of [[{name:'a.txt',bytes:'one'},{name:'A.txt',bytes:'two'}],[{name:'café.txt'},{name:'cafe\u0301.txt'}],[{name:'folder.txt'},{name:'folder.txt/child.txt'}],[{name:'folder.txt/child.txt'},{name:'folder.txt'}]])await assert.rejects(readZipDocument(input(makeZip(items))));
 for(const item of [{name:'link.txt',mode:0o120777},{name:'fifo.txt',mode:0o10644},{name:'script.txt',mode:0o100755},{name:'script.exe',bytes:'MZ'},{name:'renamed.txt',bytes:Buffer.from([127,69,76,70,0,0])},{name:'secret.txt',bytes:'encrypted',flags:0x801},{name:'strange.txt',method:99}])await assert.rejects(readZipDocument(input(makeZip([item]))));
});
test('ZIP reader rejects corruption forged sizes overlapping records and expansion limits',async()=>{
 for(const bytes of [Buffer.from('PK\x03\x04broken'),makeZip([{name:'crc.txt',bytes:'content',crc:123}]),makeZip([{name:'header.txt',bytes:'content',localCrc:456}]),makeZip([{name:'size.txt',bytes:'more than one',size:1,method:8}]),makeZip([{name:'a.txt',bytes:'one'},{name:'b.txt',bytes:'two',offset:0}])])await assert.rejects(readZipDocument(input(bytes)));
 await assert.rejects(readZipDocument(input(makeZip([{name:'bomb.txt',bytes:'x'.repeat(100000),method:8}]))),/compression_ratio/);
 await assert.rejects(readZipDocument(input(makeZip([{name:'a.txt',bytes:'12345'},{name:'b.txt',bytes:'12345'}])),{limits:{maxExpandedBytes:8}}),/expanded_limit/);
 await assert.rejects(readZipDocument(input(makeZip([{name:'a.txt'},{name:'b.txt'}])),{limits:{maxEntries:1}}),/entry_limit/);
 let nested=makeZip([{name:'inner.txt',bytes:'value'}]);for(let depth=0;depth<3;depth++)nested=makeZip([{name:'nested.zip',bytes:nested}]);await assert.rejects(readZipDocument(input(nested)),/depth_limit/);
});
test('ZIP cancellation rejects promptly releases work and does not poison a subsequent read',async()=>{
 const bytes=makeZip([{name:'safe.txt',bytes:'safe',method:8}]),controller=new AbortController();
 const pending=readZipDocument(input(bytes),{signal:controller.signal});queueMicrotask(()=>controller.abort());await assert.rejects(pending,/archive_cancelled/);
 assert.equal((await readZipDocument(input(bytes))).entries[0].content.toString(),'safe');
 for(const limits of [{maxEntries:0},{maxExpandedBytes:Infinity},{maxArchiveDepth:3},{timeoutMs:0},{ignoreCrc:true}])await assert.rejects(readZipDocument(input(bytes),{limits}));
});
