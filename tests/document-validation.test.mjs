import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDocument} from '../services/documents/validation.mjs';

const text=(name='note.txt',content='Hello مرحبا',mime='text/plain')=>({name,mime,bytes:Buffer.from(content)});
test('document inspection binds UTF8 bytes and reports preliminary structure status honestly',()=>{
 const input=text(),copy=Buffer.from(input.bytes),result=inspectDocument(input);
 assert.equal(result.format,'txt');assert.equal(result.size,copy.length);assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(result));assert.deepEqual(input.bytes,copy);
 const pdf=inspectDocument({name:'sample.pdf',mime:'application/pdf',bytes:Buffer.from('%PDF-1.7\nplaceholder')});
 assert.equal(pdf.structure,'requires-parser-validation');
 const zip=inspectDocument({name:'sample.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:Buffer.from([0x50,0x4b,3,4,1])});
 assert.equal(zip.structure,'requires-container-validation');
});
test('document inspection rejects unsafe names spoofed types binary text and invalid limits',()=>{
 for(const name of ['../note.txt','C:\\note.txt','note.txt:stream','bad\u0000.txt','bad\u202e.txt','a'.repeat(256)+'.txt'])assert.throws(()=>inspectDocument(text(name)));
 for(const input of [text('note.exe'),text('note.__proto__'),text('txt'),text('note.txt','hello','application/pdf'),text('note.pdf','ordinary text','application/pdf'),text('note.txt','%PDF-1.7'),text('note.txt','a\u0000b'),{...text(),bytes:Buffer.from([0xff,0xfe,0xff])},{...text(),bytes:[]},text('note.txt','')])assert.throws(()=>inspectDocument(input));
 assert.throws(()=>inspectDocument(text(),{maxFileBytes:3}),/too_large/);
 assert.throws(()=>inspectDocument(text(),{maxFileBytes:Infinity}));assert.throws(()=>inspectDocument(text(),{ignoreMagic:true}));
 assert.throws(()=>inspectDocument({...text(),path:'/etc/passwd'}));
 assert.throws(()=>inspectDocument({...text(),bytes:new Uint8Array(new SharedArrayBuffer(10))}));
});
test('document inspection normalizes safe names and MIME parameters without trusting them',()=>{
 const result=inspectDocument(text('Cafe\u0301.TXT','valid','Text/Plain; charset=UTF-8'));
 assert.equal(result.name,'Café.TXT');assert.equal(result.mediaType,'text/plain');
 assert.equal(inspectDocument(text('مستند.md','# عنوان','text/markdown')).format,'md');
});
