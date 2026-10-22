import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {createLegacyParser} from '../../services/documents/legacy.mjs';
assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.notEqual(process.getuid(),0);for(const path of ['/var/lib/localai','/var/lib/localai-models','/opt/localai/ai','/etc/localai'])await assert.rejects(access(path,constants.R_OK|constants.X_OK));
const base='/opt/localai/documents/candidates/legacy-tools',parse=createLegacyParser({binDir:base+'/root/usr/bin',dataDir:base+'/root/usr/share',msgWorker:new URL('../../services/documents/workers/msg-worker.mjs',import.meta.url).pathname}),files=new URL('../fixtures/documents/',import.meta.url),load=async name=>({name,bytes:await readFile(new URL(name,files))}),before=(await readdir(tmpdir())).filter(n=>n.startsWith('localai-legacy-'));
const rtf=await parse(await load('multilingual.rtf'));assert.match(rtf.text,/LOCAL AI TEST 1234/);assert.match(rtf.text,/مرحبا بالعالم/);assert.equal(rtf.units[0].source.unit,'converted-html-utf16');
const xls=await parse(await load('legacy.xls'));assert.equal(xls.sheets.length,2);assert.equal(xls.sheets[0].cells[1].text,'مرحبا بالعالم');assert.equal(xls.sheets[1].cells[1].text,'مرحبا');
const msg=await parse(await load('synthetic.msg'));assert.equal(msg.subject,'Local AI synthetic message');assert.match(msg.text,/مرحبا بالعالم/);
for(const [name,text]of [['html-utf8.msg','HTML ONLY مرحبا'],['html-arabic.msg','مرحبا']])assert.equal((await parse(await load(name))).text.trim(),text);
await assert.rejects(parse(await load('html-unsupported.msg')),/msg_html_encoding_unsupported/);
for(const name of ['multilingual.rtf','legacy.xls','synthetic.msg']){await assert.rejects(parse(await load(name),{maxTextBytes:2}),/text_output_limit/);await assert.rejects(parse(await load(name),{signal:AbortSignal.abort()}),/cancelled/);}
await assert.rejects(parse({name:'broken.rtf',bytes:Buffer.from('{\\rtf1 broken')}),/invalid_rtf/);for(const name of ['legacy.xls','synthetic.msg']){const input=await load(name);await assert.rejects(parse({...input,bytes:input.bytes.subarray(0,200)}));}
assert.deepEqual((await readdir(tmpdir())).filter(n=>n.startsWith('localai-legacy-')),before);
const group=(await readFile('/proc/self/cgroup','utf8')).trim().split('::')[1],path='/sys/fs/cgroup'+group,memory={peak:Number(await readFile(path+'/memory.peak','utf8')),swapPeak:Number(await readFile(path+'/memory.swap.peak','utf8'))};assert.equal(memory.swapPeak,0);
console.log(JSON.stringify({gate:'private-legacy-candidate',rtf:{english:true,arabic:true},xls:{sheets:xls.sheets.length,arabic:true},msg:{unicodeBody:true,attachmentsExtracted:false},memory,activated:false,fullPhaseGate:'blocked'}));
