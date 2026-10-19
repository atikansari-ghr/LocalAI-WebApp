// Synthetic MSG fixture assembled from MS-OXMSG Unicode property streams.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire(new URL('./fixtures/package.json',import.meta.url)),CFB=require('cfb'),file=CFB.utils.cfb_new({root:'Root Entry'});
const values=[[0x001a,'IPM.Note'],[0x0037,'Local AI synthetic message'],[0x1000,'LOCAL AI TEST 1234\r\nمرحبا بالعالم\r\n'],[0x0c1a,'Synthetic Sender']];
const header=Buffer.alloc(32),properties=[];
for(const [id,text]of values){const bytes=Buffer.from(text+'\0','utf16le'),entry=Buffer.alloc(16);entry.writeUInt32LE((id<<16)|0x001f);entry.writeUInt32LE(6,4);entry.writeUInt32LE(bytes.length,8);properties.push(entry);CFB.utils.cfb_add(file,'__substg1.0_'+id.toString(16).padStart(4,'0').toUpperCase()+'001F',bytes);}
CFB.utils.cfb_add(file,'__properties_version1.0',Buffer.concat([header,...properties]));CFB.utils.cfb_del(file,'\u0001Sh33tJ5');
writeFileSync(new URL('../tests/fixtures/documents/synthetic.msg',import.meta.url),CFB.write(file,{type:'buffer'}));
for(const [name,codepage,html]of [['html-utf8',65001,Buffer.from('<p>HTML ONLY مرحبا</p>')],['html-arabic',1256,Buffer.from([60,112,62,0xe3,0xd1,0xcd,0xc8,0xc7,60,47,112,62])],['html-unsupported',99999,Buffer.from('<p>Unsupported</p>')]]){
 const message=CFB.utils.cfb_new({root:'Root Entry'}),entry=Buffer.alloc(16);entry.writeUInt32LE(0x3fde0003);entry.writeUInt32LE(6,4);entry.writeUInt32LE(codepage,8);
 CFB.utils.cfb_add(message,'__substg1.0_001A001F',Buffer.from('IPM.Note\0','utf16le'));CFB.utils.cfb_add(message,'__substg1.0_10130102',html);CFB.utils.cfb_add(message,'__properties_version1.0',Buffer.concat([Buffer.alloc(32),entry]));CFB.utils.cfb_del(message,'\u0001Sh33tJ5');
 writeFileSync(new URL('../tests/fixtures/documents/'+name+'.msg',import.meta.url),CFB.write(message,{type:'buffer'}));
}
