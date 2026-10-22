import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpreadsheetDocument} from '../services/documents/spreadsheet.mjs';
import {officeFixture,S,R} from './helpers/office.mjs';
const make=(cells,shared='<si><t>مرحبا</t></si>')=>officeFixture('xlsx','xl/workbook.xml',`<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="s1"/></sheets></workbook>`,[['xl/worksheets/sheet1.xml',`<worksheet xmlns="${S}"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`],['xl/sharedStrings.xml',`<sst xmlns="${S}">${shared}</sst>`]],[['s1','worksheet','worksheets/sheet1.xml'],['strings','sharedStrings','sharedStrings.xml']]);
test('Spreadsheet extracts shared inline and cached values with cell and literal formula provenance',async()=>{
 const result=await parseSpreadsheetDocument(make('<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Local AI</t></is></c><c r="C1"><f>1+2</f><v>3</v></c>'));
 assert.deepEqual(result.cells.map(c=>c.text),['مرحبا','Local AI','3']);assert.equal(result.cells[0].source.cell,'A1');assert.equal(result.cells[0].source.sheet,'Data');assert.equal(result.cells[0].valueSources[0].source.part,'xl/sharedStrings.xml');assert.equal(result.cells[2].formula,'1+2');assert.equal(result.cells[2].cached,true);assert.ok(result.warnings.includes('spreadsheet_formulas_not_evaluated'));
});
test('Spreadsheet rejects duplicate or invalid coordinates and missing shared-string references',async()=>{
 for(const cells of ['<c r="A1"><v>1</v></c><c r="A1"><v>2</v></c>','<c r="XFE1"><v>1</v></c>','<c r="A2"><v>1</v></c>','<c r="A1" t="s"><v>42</v></c>'])await assert.rejects(parseSpreadsheetDocument(make(cells)));
});
test('Spreadsheet keeps formula-only values inert and enforces bounds and cancellation',async()=>{
 const input=make('<c r="A1"><f>HYPERLINK("https://example.com","x")</f></c>');const result=await parseSpreadsheetDocument(input);assert.match(result.cells[0].text,/^=HYPERLINK/);assert.equal(result.cells[0].cached,false);
 await assert.rejects(parseSpreadsheetDocument(input,{maxTextBytes:2}),/text_output_limit/);const signal=AbortSignal.abort();await assert.rejects(parseSpreadsheetDocument(input,{signal}),/cancelled/);
});
