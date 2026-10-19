import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWordDocument} from '../services/documents/word.mjs';
import {makeZip} from './helpers/zip.mjs';
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function doc(body,prefix='w'){
 const xml=`<${prefix}:document xmlns:${prefix}="${NS}" xmlns:x="urn:foreign"><${prefix}:body>${body}</${prefix}:body></${prefix}:document>`;
 const bytes=makeZip([{name:'[Content_Types].xml',bytes:'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},{name:'_rels/.rels',bytes:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},{name:'word/document.xml',bytes:xml}]);return {input:{name:'test.docx',bytes},xml};
}
test('Word extraction preserves literal multilingual runs and exact decoded XML references',async()=>{
 const {input,xml}=doc('<w:p><w:r><w:t>Local &amp; AI </w:t></w:r><w:r><w:t><![CDATA[مرحبا]]></w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>');
 const result=await parseWordDocument(input);assert.equal(result.text,'Local & AI مرحبا\nSecond\n');assert.equal(result.units.length,3);
 assert.equal(xml.slice(result.units[0].source.start,result.units[0].source.end),'Local &amp; AI ');assert.equal(xml.slice(result.units[1].source.start,result.units[1].source.end),'مرحبا');assert.equal(result.units[0].source.part,'word/document.xml');assert.equal(result.units[0].source.unit,'utf16');assert.equal(result.units[0].source.paragraph,1);assert.equal(result.units[2].source.paragraph,2);
});
test('Word extraction selects namespaces instead of prefixes and omits deleted instructions and embedded stories',async()=>{
 const {input}=doc('<z:p><z:r><z:t>Shown</z:t><z:instrText>SECRET FIELD</z:instrText></z:r><z:del><z:r><z:delText>DELETED</z:delText></z:r></z:del><x:t>FOREIGN</x:t><z:r><z:drawing><z:txbxContent><z:p><z:r><z:t>TEXTBOX</z:t></z:r></z:p></z:txbxContent></z:drawing></z:r></z:p>','z');
 const result=await parseWordDocument(input);assert.equal(result.text,'Shown\n');assert.ok(result.warnings.includes('word_nonbody_or_embedded_content_not_extracted'));assert.ok(result.warnings.includes('word_fields_not_recalculated'));assert.ok(result.warnings.includes('word_deleted_content_omitted'));
});
test('Word extraction enforces output bounds and cancellation without poisoning subsequent work',async()=>{
 const {input}=doc('<w:p><w:r><w:t>content</w:t></w:r></w:p>'),controller=new AbortController();controller.abort();await assert.rejects(parseWordDocument(input,{signal:controller.signal}),/cancelled/);
 await assert.rejects(parseWordDocument(input,{maxTextBytes:3}),/text_output_limit/);assert.equal((await parseWordDocument(input)).text,'content\n');
});

test('Word extraction keeps tabs breaks and table paragraph order with explicit element provenance',async()=>{
 const {input}=doc('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>مرحبا</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
 const result=await parseWordDocument(input);assert.equal(result.text,'A\tB\nC\nمرحبا\n');assert.equal(result.units[1].source.unit,'element');assert.equal(result.units[1].source.start,undefined);assert.equal(result.units.at(-1).source.paragraph,2);assert.ok(Object.isFrozen(result.units[0].source));
});
test('Word extraction omits directly hidden runs but honors explicitly false visibility flags',async()=>{
 const {input}=doc('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN</w:t></w:r><w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t>VISIBLE</w:t></w:r></w:p>');
 const result=await parseWordDocument(input);assert.equal(result.text,'VISIBLE\n');assert.ok(result.warnings.includes('word_direct_hidden_runs_omitted'));assert.ok(result.warnings.includes('word_styles_not_resolved'));
});
