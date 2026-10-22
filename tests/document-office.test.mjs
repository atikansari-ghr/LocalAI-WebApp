import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOfficePackage} from '../services/documents/office.mjs';
import {makeZip} from './helpers/zip.mjs';
const CT='http://schemas.openxmlformats.org/package/2006/content-types',REL='http://schemas.openxmlformats.org/package/2006/relationships',OFF='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
function fixture({type=MIME,target='word/document.xml',mode='',overrides='',extra=[],main='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>مرحبا Local AI</w:t></w:r></w:p></w:body></w:document>'}={}){
 return {name:'sample.docx',bytes:makeZip([{name:'[Content_Types].xml',bytes:`<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${type}"/>${overrides}</Types>`},{name:'_rels/.rels',bytes:`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFF}" Target="${target}" ${mode}/></Relationships>`},{name:'word/document.xml',bytes:main},...extra])};
}
test('Office package validates content types root relationship and exact member identities',async()=>{
 const result=await inspectOfficePackage(fixture());assert.equal(result.mainPart,'word/document.xml');assert.equal(result.document.format,'docx');assert.equal(result.validation,'office-package-policy-passed');assert.match(result.parts.find(p=>p.path==='word/document.xml').sha256,/^[a-f0-9]{64}$/);
});
test('Office package rejects family mismatches missing targets active or external parts and DTDs',async()=>{
 for(const input of [fixture({type:'application/xml'}),fixture({target:'missing.xml'}),fixture({target:'https://example.com/file',mode:'TargetMode="External"'}),fixture({extra:[{name:'word/vbaProject.bin',bytes:'macro'}]}),fixture({extra:[{name:'word/embeddings/object.xml',bytes:'<object/>'}]}),fixture({main:'<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>'}),fixture({main:'<document xmlns="wrong"/>'})])await assert.rejects(inspectOfficePackage(input));
});
test('Office package checks every relationship and XML part even if not selected as main',async()=>{
 for(const extra of [[{name:'word/_rels/document.xml.rels',bytes:`<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFF}" Target="https://example.com/" TargetMode="External"/></Relationships>`}],[{name:'word/unused.xml',bytes:'<broken>'}]])await assert.rejects(inspectOfficePackage(fixture({extra})));
});

test('Office package identifies spreadsheet and presentation families without claiming text extraction',async()=>{
 for(const [extension,path,type,root,ns]of [['xlsx','xl/workbook.xml','spreadsheetml.sheet','workbook','spreadsheetml'],['pptx','ppt/presentation.xml','presentationml.presentation','presentation','presentationml']]){
  const result=await inspectOfficePackage({name:'sample.'+extension,bytes:makeZip([{name:'[Content_Types].xml',bytes:`<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`},{name:'_rels/.rels',bytes:`<Relationships xmlns="${REL}"><Relationship Id="main" Type="${OFF}" Target="${path}"/></Relationships>`},{name:path,bytes:`<root:${root} xmlns:root="http://schemas.openxmlformats.org/${ns}/2006/main"/>`}])});
  assert.equal(result.mainPart,path);assert.equal(result.document.format,extension);assert.deepEqual(result.warnings,['office_schema_and_text_extraction_pending']);
 }
});
test('Office package rejects orphan or escaping relationships and duplicate content type declarations',async()=>{
 const relationship=target=>`<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFF}" Target="${target}"/></Relationships>`;
 for(const extra of [[{name:'word/_rels/missing.xml.rels',bytes:relationship('document.xml')}],[{name:'word/_rels/document.xml.rels',bytes:relationship('../../outside.xml')}],[{name:'word/_rels/document.xml.rels',bytes:relationship('%2e%2e/secret.xml')}]])await assert.rejects(inspectOfficePackage(fixture({extra})));
 const bytes=makeZip([{name:'[Content_Types].xml',bytes:`<Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="xml" ContentType="text/xml"/></Types>`}]);await assert.rejects(inspectOfficePackage({name:'sample.docx',bytes}),/content_types_invalid/);
});

test('Office package inspects XML by declared type and rejects disguised embedded packages',async()=>{
 for(const name of ['word/unused.XML','word/unused.txt']){
  await assert.rejects(inspectOfficePackage(fixture({overrides:`<Override PartName="/${name}" ContentType="application/xml"/>`,extra:[{name,bytes:'<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>'}]})),/doctype_forbidden/);
 }
 await assert.rejects(inspectOfficePackage(fixture({extra:[{name:'word/nested.docx',bytes:makeZip([{name:'inner.txt',bytes:'nested'}])}]})),/embedded_package_forbidden/);
 await assert.rejects(inspectOfficePackage(fixture({extra:[{name:'word/disguised.txt',bytes:makeZip([{name:'inner.txt',bytes:'nested'}])}]})),/embedded_package_forbidden/);
});

test('Office relationship policy cannot be bypassed through casing or declared media type',async()=>{
 for(const name of ['word/_rels/document.xml.RELS','word/hidden.txt'])await assert.rejects(inspectOfficePackage(fixture({overrides:`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,extra:[{name,bytes:`<Relationships xmlns="${REL}"><Relationship Id="r1" Type="${OFF}" TargetMode="External" Target="https://example.com/"/></Relationships>`}]})));
});

test('Office relationship media types are case insensitive for policy dispatch',async()=>{
 const name='word/hidden.txt';await assert.rejects(inspectOfficePackage(fixture({overrides:`<Override PartName="/${name}" ContentType="Application/Vnd.Openxmlformats-Package.Relationships+Xml"/>`,extra:[{name,bytes:`<Relationships xmlns="${REL}"><Relationship Id="r" Type="${OFF}" TargetMode="External" Target="https://example.com/"/></Relationships>`}]})));
});