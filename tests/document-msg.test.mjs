import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMsgDocument} from '../services/documents/msg.mjs';
const bytes=await readFile(new URL('./fixtures/documents/synthetic.msg',import.meta.url));
test('MSG binary HTML uses declared Unicode or Arabic codepages and rejects unknown encodings',async()=>{
 for(const [name,expected]of [['html-utf8','HTML ONLY مرحبا'],['html-arabic','مرحبا']]){const result=parseMsgDocument({name:'message.msg',bytes:await readFile(new URL('./fixtures/documents/'+name+'.msg',import.meta.url))});assert.equal(result.text.trim(),expected);assert.equal(result.units[0].source.representation,'html-to-text');}
 const unsupported=await readFile(new URL('./fixtures/documents/html-unsupported.msg',import.meta.url));assert.throws(()=>parseMsgDocument({name:'message.msg',bytes:unsupported}),/msg_html_encoding_unsupported/);
});
test('MSG extracts synthetic Unicode subject and body without inventing raw spans or executing content',()=>{
 const result=parseMsgDocument({name:'message.msg',bytes});assert.equal(result.subject,'Local AI synthetic message');assert.equal(result.text,'LOCAL AI TEST 1234\r\nمرحبا بالعالم\r\n');assert.equal(result.units[0].source.kind,'decoded-msg-body');assert.equal(result.units[0].source.start,undefined);assert.equal(result.attachments.length,0);
});
test('MSG rejects truncated OLE and output beyond explicit limits',()=>{
 assert.throws(()=>parseMsgDocument({name:'bad.msg',bytes:bytes.subarray(0,200)}),/invalid_msg/);assert.throws(()=>parseMsgDocument({name:'message.msg',bytes},{maxTextBytes:2}),/text_output_limit/);
});

test('MSG decoding is confined to the exact typed-array view, including pooled and truncated buffers',()=>{
 const container=Buffer.concat([Buffer.from('unrelated-prefix'),bytes,Buffer.from('unrelated-suffix')]),view=container.subarray(16,16+bytes.length);assert.equal(parseMsgDocument({name:'message.msg',bytes:view}).subject,'Local AI synthetic message');
 assert.throws(()=>parseMsgDocument({name:'bad.msg',bytes:bytes.subarray(0,512)}),/invalid_msg/);
});
