import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEmailDocument} from '../services/documents/email.mjs';
const mail=value=>({name:'message.eml',bytes:Buffer.isBuffer(value)?value:Buffer.from(value)});
test('Email decodes literal headers and charset bodies with honest decoded-body provenance',async()=>{
 const input=mail(Buffer.concat([Buffer.from('Subject: =?UTF-8?B?2YXYsdit2KjYpw==?=\r\nContent-Type: text/plain; charset=iso-8859-1\r\n\r\ncaf'),Buffer.from([0xe9])]));const result=await parseEmailDocument(input);assert.equal(result.text,'café\n');assert.equal(result.subject,'مرحبا');assert.equal(result.units[0].source.kind,'decoded-email-body');assert.equal(result.units[0].source.start,undefined);assert.match(result.document.sha256,/^[a-f0-9]{64}$/);
});
test('Email extracts HTML as inert text and returns separate unvalidated attachment identities',async()=>{
 const input=mail('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello مرحبا</p><script>SECRET</script><img src="https://example.com/pixel">\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="../../bad.exe"\r\nContent-Transfer-Encoding: base64\r\n\r\nTVqQAAMAAAA=\r\n--x--\r\n');const result=await parseEmailDocument(input);assert.equal(result.text,'Hello مرحبا');assert.equal(result.attachments.length,1);assert.equal(result.attachments[0].name,'attachment-1.bin');assert.equal(result.attachments[0].structure,'requires-parser-validation');assert.ok(result.warnings.includes('email_attachment_name_replaced'));assert.equal(result.html,undefined);
});
test('Email enforces body header structure and nesting limits and cancellation',async()=>{
 await assert.rejects(parseEmailDocument(mail('not an email')),/invalid_email/);await assert.rejects(parseEmailDocument(mail('Subject: x\r\n\r\nlong body'),{maxTextBytes:2}),/text_output_limit/);await assert.rejects(parseEmailDocument(mail('Subject: x\r\n\r\nbody'),{signal:AbortSignal.abort()}),/cancelled/);
 const input=mail('Content-Type: multipart/encrypted; boundary=x\r\n\r\n--x--');await assert.rejects(parseEmailDocument(input),/encrypted_email_unsupported/);
 const headers=Array.from({length:2000},()=> 'X: x').join('\r\n');await assert.rejects(parseEmailDocument(mail(headers+'\r\n\r\nbody')),/invalid_email/);
});

test('Email marks both supported calendar MIME aliases as normalized parser content',async()=>{
 for(const mime of ['text/calendar','application/ics']){
  const result=await parseEmailDocument(mail(`Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nBody\r\n--x\r\nContent-Type: ${mime}; charset=iso-8859-1\r\nContent-Disposition: attachment; filename=event.ics\r\nContent-Transfer-Encoding: base64\r\n\r\nY2Fm6Q==\r\n--x--\r\n`));assert.equal(result.attachments[0].representation,'normalized-utf8-calendar');assert.equal(result.attachments[0].content.toString(),'café\n');
 }
});
