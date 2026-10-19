import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodePopplerOutput} from '../services/documents/pdf.mjs';
const fixture=await readFile(new URL('./fixtures/documents/poppler-bbox.xml',import.meta.url),'utf8'),document={sha256:'a'.repeat(64)};
const input=(bbox=fixture)=>({info:'Pages: 3\nEncrypted: no\nJavaScript: no\n',bbox,images:'page num type width height\n--------------------------\n2 0 image 900 140 rgb 3 8 image no 4 0 129 129 3525B 0.9%\n3 1 image 900 140 rgb 3 8 image no 6 0 129 129 1808B 0.5%\n'});
test('PDF native output decoding retains page coordinates and distinguishes native scanned and mixed pages',()=>{
 const result=decodePopplerOutput(input(),document);assert.deepEqual(result.pages.map(p=>p.status),['native-text','requires-ocr','native-and-images-review']);assert.match(result.pages[0].text,/LOCAL AI NATIVE TEXT 1234/);assert.equal(result.pages[1].text,'');assert.equal(result.pages[0].units[0].source.page,1);assert.deepEqual(result.pages[0].units[0].source.box,[54,41.076,113.022,57.726]);assert.equal(result.pages[0].units[0].source.unit,'pdf-points-top-left');
});
test('PDF native output decoding rejects encryption scripts DTD substitution invalid coordinates and oversized output',()=>{
 for(const altered of [{...input(),info:'Pages: 3\nEncrypted: yes\n'},{...input(),info:'Pages: 3\nEncrypted: no\nJavaScript: yes\n'},input(fixture.replace('http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd','https://example.com/entity')),input(fixture.replace('xMin="54.000000" yMin="41.076000" xMax="113.022000"','xMin="99999" yMin="41.076000" xMax="113.022000"'))])assert.throws(()=>decodePopplerOutput(altered,document));
 assert.throws(()=>decodePopplerOutput(input(),document,{maxTextBytes:3}),/text_output_limit/);assert.throws(()=>decodePopplerOutput({...input(),info:'Pages: 1000000\nEncrypted: no\n'},document),/pdf_page_limit/);
});

test('PDF auto raster selection excludes native text pages while all preserves explicit full rendering',async()=>{
 const {selectPdfRasterPages}=await import('../services/documents/pdf.mjs'),pages=decodePopplerOutput(input(),document).pages;assert.deepEqual(selectPdfRasterPages(pages,'needed').map(p=>p.index),[2,3]);assert.deepEqual(selectPdfRasterPages(pages,true).map(p=>p.index),[1,2,3]);assert.deepEqual(selectPdfRasterPages(pages,false),[]);assert.throws(()=>selectPdfRasterPages(pages,'invalid'),/invalid_pdf_options/);
});
