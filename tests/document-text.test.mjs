import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTextDocument} from '../services/documents/text.mjs';
const input=(name,text)=>({name,bytes:Buffer.from(text)});
test('native text parsing preserves English Arabic literal content and precise decoded source offsets',()=>{
 const original='Hello\r\nمرحبا <script>literal</script>\n',result=parseTextDocument(input('document.md',original));
 assert.equal(result.text,original);assert.equal(result.parser,'localai-md-v1');assert.equal(result.units[1].text,'مرحبا <script>literal</script>');
 assert.equal(original.slice(result.units[1].source.start,result.units[1].source.end),result.units[1].text);assert.equal(result.units[1].source.line,2);assert.equal(result.units[1].source.unit,'utf16');
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.units[1].source));
});
test('JSON parsing validates bounded structure while retaining original duplicate-key evidence literally',()=>{
 const text='{"name":"first","name":"second","arabic":"مرحبا"}';assert.equal(parseTextDocument(input('data.json',text)).text,text);
 for(const text of ['{invalid}', '['.repeat(40)+'0'+']'.repeat(40),'['+Array(10001).fill('0').join(',')+']'])assert.throws(()=>parseTextDocument(input('data.json',text)));
 assert.throws(()=>parseTextDocument(input('duplicate.json','{"a":'+'['.repeat(40)+'0'+']'.repeat(40)+',"a":0}')),/json_structure_limit/);
 assert.equal(parseTextDocument(input('quoted.json','{"literal":"[[[\\\"not structure\\\"]]]"}')).parser,'localai-json-v1');
 assert.throws(()=>parseTextDocument(input('huge.txt','x'.repeat(65537))),/line_limit/);
 assert.throws(()=>parseTextDocument(input('many.txt','x\n'.repeat(10001))),/unit_limit/);
});
test('CSV parsing handles quoted commas multiline cells escaped quotes and literal formulas with cell provenance',()=>{
 const csv='name,note\r\n"مرحبا","a,b\nline ""two"""\r\nformula,=1+1',result=parseTextDocument(input('table.csv',csv));
 assert.equal(result.units[3].text,'a,b\nline "two"');assert.equal(result.units[3].source.row,2);assert.equal(result.units[3].source.column,2);
 assert.equal(csv.slice(result.units[3].source.start,result.units[3].source.end),'"a,b\nline ""two"""');assert.equal(result.units[5].text,'=1+1');
 for(const text of ['a,"unclosed','a,b"bad','"quoted"suffix,b',Array(257).fill('x').join(',')])assert.throws(()=>parseTextDocument(input('bad.csv',text)));
});
test('ICS parsing unfolds lines preserves provenance and never creates or resolves calendar content',()=>{
 const text='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:موعد\r\n تجريبي\r\nURL:https://example.invalid/private\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
 const result=parseTextDocument(input('calendar.ics',text));assert.equal(result.units[3].text,'SUMMARY:موعدتجريبي');assert.equal(result.units[3].source.line,4);assert.equal(result.units[3].source.endLine,5);
 assert.ok(result.text.includes('https://example.invalid/private'));assert.ok(result.warnings.includes('calendar_content_only_no_events_created'));
 for(const value of ['BEGIN:VCALENDAR\nEND:VCALENDAR','BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nEND:VCALENDAR','BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\nURL:outside'])assert.throws(()=>parseTextDocument(input('bad.ics',value)));
});
test('preliminary binary recognition cannot bypass an unavailable structural parser',()=>{
 assert.throws(()=>parseTextDocument(input('file.pdf','%PDF-1.7\nplaceholder')),/parser_unavailable/);
 for(const name of ['file.html','file.xml','file.eml'])assert.throws(()=>parseTextDocument(input(name,'<literal>data</literal>')),/parser_unavailable/);
});
