import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpenDocument} from '../services/documents/opendocument.mjs';
import {makeZip} from './helpers/zip.mjs';
const O='urn:oasis:names:tc:opendocument:xmlns:office:1.0',T='urn:oasis:names:tc:opendocument:xmlns:text:1.0',TABLE='urn:oasis:names:tc:opendocument:xmlns:table:1.0',D='urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',M='urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
function fixture(format,body,{mimetype,mimeMethod=0,extra=[],manifest=''}={}){
 const media='application/vnd.oasis.opendocument.'+{odt:'text',ods:'spreadsheet',odp:'presentation'}[format],kind={odt:'text',ods:'spreadsheet',odp:'presentation'}[format];
 return {name:'sample.'+format,bytes:makeZip([{name:'mimetype',bytes:mimetype??media,method:mimeMethod},{name:'META-INF/manifest.xml',bytes:`<m:manifest xmlns:m="${M}"><m:file-entry m:full-path="/" m:media-type="${media}"/><m:file-entry m:full-path="content.xml" m:media-type="text/xml"/>${manifest}</m:manifest>`},{name:'content.xml',bytes:`<o:document-content xmlns:o="${O}" xmlns:t="${T}" xmlns:table="${TABLE}" xmlns:d="${D}" xmlns:xlink="http://www.w3.org/1999/xlink"><o:body><o:${kind}>${body}</o:${kind}></o:body></o:document-content>`},...extra])};
}
test('OpenDocument text preserves mixed inline multilingual source order and explicit spaces',async()=>{
 const result=await parseOpenDocument(fixture('odt','<t:p>Hello <t:span>مرحبا</t:span><t:s t:c="2"/>world<t:tab/>end<t:line-break/>next</t:p>'));assert.equal(result.text,'Hello مرحبا  world\tend\nnext\n');assert.match(result.units[0].source.partSha256,/^[0-9a-f]{64}$/);assert.equal(result.units[0].source.part,'content.xml');
});
test('OpenDocument sheets bound repeated cells and rows and keep formulas inert',async()=>{
 const body='<table:table table:name="Data"><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" o:value-type="string"><t:p>مرحبا</t:p></table:table-cell><table:table-cell table:formula="of:=1+2" o:value-type="float" o:value="3"/></table:table-row></table:table>';
 const result=await parseOpenDocument(fixture('ods',body));assert.equal(result.cells.length,6);assert.deepEqual(result.cells.map(c=>c.text),['مرحبا','مرحبا','3','مرحبا','مرحبا','3']);assert.equal(result.cells[2].formula,'of:=1+2');assert.equal(result.cells[5].source.row,2);assert.equal(result.cells[5].source.column,3);
 await assert.rejects(parseOpenDocument(fixture('ods',body.replace('repeated="2"','repeated="999999999"'))),/repeat_limit/);
});
test('OpenDocument slides retain page ordering and text frame source citations',async()=>{
 const result=await parseOpenDocument(fixture('odp','<d:page d:name="One"><d:frame><d:text-box><t:p>First</t:p></d:text-box></d:frame></d:page><d:page d:name="Two"><d:frame><d:text-box><t:p>ثاني</t:p></d:text-box></d:frame></d:page>'));assert.deepEqual(result.pages.map(p=>p.text),['First\n','ثاني\n']);assert.equal(result.pages[1].units[0].source.page,2);
});
test('OpenDocument rejects spoofing encryption scripts external links and undeclared parts',async()=>{
 for(const input of [fixture('odt','<t:p>x</t:p>',{mimetype:'wrong'}),fixture('odt','<t:a xlink:href="https://example.com/">x</t:a>'),fixture('odt','<t:p>x</t:p>',{manifest:'<m:encryption-data/>'}),fixture('odt','<t:p>x</t:p>',{extra:[{name:'unknown.xml',bytes:'<x/>'}]}),fixture('odt','<o:script/>')])await assert.rejects(parseOpenDocument(input));
 await assert.rejects(parseOpenDocument(fixture('odt','<t:p>long</t:p>'),{maxTextBytes:2}),/text_output_limit/);await assert.rejects(parseOpenDocument(fixture('odt','<t:p>x</t:p>'),{signal:AbortSignal.abort()}),/cancelled/);
});

test('OpenDocument exact MIME bytes and aggregate blank-row expansion cannot bypass limits',async()=>{
 const mime=Buffer.from('application/vnd.oasis.opendocument.text');mime[0]|=0x80;await assert.rejects(parseOpenDocument(fixture('odt','<t:p>x</t:p>',{mimetype:mime})),/package_invalid/);
 const table=name=>`<table:table table:name="${name}"><table:table-row table:number-rows-repeated="6000"/></table:table>`;await assert.rejects(parseOpenDocument(fixture('ods',table('One')+table('Two'))),/repeat_limit/);
});

test('OpenDocument MIME policy binds to the referenced first stored entry rather than an unreferenced prefix',async()=>{
 const mime='application/vnd.oasis.opendocument.text',prefixZip=makeZip([{name:'mimetype',bytes:mime}]),prefix=prefixZip.subarray(0,prefixZip.readUInt32LE(prefixZip.length-6)),input=fixture('odt','<t:p>accepted</t:p>',{mimeMethod:8}),bytes=Buffer.from(input.bytes),footer=bytes.length-22,central=bytes.readUInt32LE(footer+16);let cursor=central;
 for(let count=0;count<bytes.readUInt16LE(footer+10);count++){bytes.writeUInt32LE(bytes.readUInt32LE(cursor+42)+prefix.length,cursor+42);cursor+=46+bytes.readUInt16LE(cursor+28)+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32);}bytes.writeUInt32LE(central+prefix.length,footer+16);
 await assert.rejects(parseOpenDocument({name:input.name,bytes:Buffer.concat([prefix,bytes])}),/mimetype_invalid/);
});