import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {parseMarkupDocument} from '../services/documents/markup.mjs';
const input=(name,text)=>({name,bytes:Buffer.from(text)});
test('HTML extraction decodes entities retains inline words and omits active content',()=>{
 const html='<h1>عنوان &amp; title</h1><p>Hel<b>lo</b> world</p><script>secret script</script><style>secret style</style><template>secret template</template>';
 const result=parseMarkupDocument(input('page.html',html));assert.ok(result.text.includes('عنوان & title'));assert.ok(result.text.includes('Hello world'));assert.ok(!result.text.includes('secret'));
 assert.ok(result.warnings.includes('active_embedded_content_omitted'));assert.ok(Object.isFrozen(result.units[0].source));
 for(const unit of result.units){assert.ok(unit.source.start>=0&&unit.source.end<=html.length&&unit.source.end>unit.source.start);assert.equal(unit.source.unit,'utf16');}
 const amp=result.units.find(unit=>unit.text==='&');assert.equal(html.slice(amp.source.start,amp.source.end),'&amp;');
});
test('XML extraction validates namespaces and preserves source spans paths CDATA and entities',()=>{
 const xml='<?xml version="1.0"?><r xmlns:x="urn:local"><x:name>مرحبا &amp; العالم</x:name><x:name><![CDATA[<literal>]]></x:name><item>one&#32;two</item></r>';
 const result=parseMarkupDocument(input('data.xml',xml));assert.ok(result.text.includes('مرحبا & العالم'));assert.ok(result.text.includes('<literal>'));assert.ok(result.text.includes('one two'));
 assert.equal(result.units[0].source.path,'/r[1]/x:name[1]');assert.equal(result.units[1].source.path,'/r[1]/x:name[2]');
 assert.equal(xml.slice(result.units[0].source.start,result.units[0].source.end),'مرحبا &amp; العالم');assert.equal(xml.slice(result.units[1].source.start,result.units[1].source.end),'<literal>');
 for(const value of ['<r><a></r>','<r>&unknown;</r>','<r/><second/>','<r>','<x:r/>'])assert.throws(()=>parseMarkupDocument(input('bad.xml',value)),/invalid_xml/);
});
test('markup parsers enforce depth node attribute and output boundaries',()=>{
 for(const name of ['deep.xml','deep.html'])assert.throws(()=>parseMarkupDocument(input(name,'<div>'.repeat(40)+'text'+'</div>'.repeat(40))),/structure_limit/);
 assert.throws(()=>parseMarkupDocument(input('attributes.xml','<r '+Array.from({length:257},(_,i)=>'a'+i+'="v"').join(' ')+'/>')),/structure_limit/);
 assert.throws(()=>parseMarkupDocument(input('many.html','<div>x</div>'.repeat(10001))),/structure_limit|unit_limit/);
});
test('neither markup parser dereferences document URLs or external entities',async t=>{
 let requests=0;const server=createServer((req,res)=>{requests++;res.end('forbidden external data');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/private';
 const html=parseMarkupDocument(input('page.html','<img src="'+url+'"><a href="'+url+'">visible</a><iframe src="'+url+'">hidden</iframe>'));assert.equal(html.text,'visible');assert.ok(html.warnings.includes('embedded_media_not_extracted'));
 assert.throws(()=>parseMarkupDocument(input('entity.xml','<!DOCTYPE r [<!ENTITY remote SYSTEM "'+url+'">]><r>&remote;</r>')),/xml_doctype_forbidden/);
 assert.throws(()=>parseMarkupDocument(input('entity.xml','<!DOCTYPE r [<!ENTITY local SYSTEM "file:///etc/passwd">]><r>&local;</r>')),/xml_doctype_forbidden/);
 const xml=parseMarkupDocument(input('include.xml','<r xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="'+url+'"/></r>'));assert.equal(xml.text,'');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,0);
});
