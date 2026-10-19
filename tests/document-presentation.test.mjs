import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePresentationDocument} from '../services/documents/presentation.mjs';
import {officeFixture,P,A,R} from './helpers/office.mjs';
const slide=text=>`<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const make=(ids='<p:sldId id="257" r:id="second"/><p:sldId id="256" r:id="first"/>')=>officeFixture('pptx','ppt/presentation.xml',`<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,[['ppt/slides/slide1.xml',slide('First &amp; one')],['ppt/slides/slide2.xml',slide('مرحبا')]], [['first','slide','slides/slide1.xml'],['second','slide','slides/slide2.xml']]);
test('Presentation follows slide-list relationships and preserves multilingual text citations',async()=>{
 const result=await parsePresentationDocument(make());assert.equal(result.slides[0].text,'مرحبا\n');assert.equal(result.slides[1].text,'First & one\n');assert.equal(result.slides[0].units[0].source.part,'ppt/slides/slide2.xml');assert.equal(result.slides[0].units[0].source.slide,1);assert.match(result.slides[1].units[0].source.partSha256,/^[0-9a-f]{64}$/);
});
test('Presentation rejects missing duplicate or incorrectly typed slide references',async()=>{
 for(const ids of ['<p:sldId id="257" r:id="absent"/>','<p:sldId id="257" r:id="first"/><p:sldId id="258" r:id="first"/>','<p:sldId id="257" r:id="first"/><p:sldId id="257" r:id="second"/>'])await assert.rejects(parsePresentationDocument(make(ids)));
});
test('Presentation enforces shared output and cancellation bounds',async()=>{
 await assert.rejects(parsePresentationDocument(make(),{maxTextBytes:2}),/text_output_limit/);await assert.rejects(parsePresentationDocument(make(),{signal:AbortSignal.abort()}),/cancelled/);assert.equal((await parsePresentationDocument(make())).slides.length,2);
});

test('Presentation counts slide separators in the shared output byte limit',async()=>{
 const input=make(),baseline=await parsePresentationDocument(input),bytes=Buffer.byteLength(baseline.text);await assert.rejects(parsePresentationDocument(input,{maxTextBytes:bytes-1}),/text_output_limit/);
});
