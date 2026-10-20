import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStructuredEvidence,assessStructuredCandidates,runStructuredExtractionCandidate} from '../services/documents/structured-extract.mjs';

const schema={schemaVersion:1,schemaId:'invoice',revision:1,schema:{type:'object',additionalProperties:false,properties:{invoice:{type:'string',format:'identifier'},date:{type:'string',format:'date'},total:{type:'string',format:'amount'},note:{type:'string'}},required:['invoice','date','total']}};
const hash='a'.repeat(64);
const report={document:{sha256:hash},units:[{text:'Invoice INV-42; date 2024-02-29',source:{kind:'text-line',documentSha256:hash,line:1}}],pages:[{index:1,units:[{text:'Total 120.50',source:{kind:'pdf-native-word',documentSha256:hash,page:1}}],ocr:{units:[{text:'Total 125.50',source:{kind:'ocr-line',documentSha256:hash,page:1}}]}}]};

test('bounded evidence preserves parser and OCR source identities',()=>{
 const evidence=prepareStructuredEvidence(report);
 assert.equal(evidence.length,3);assert.equal(evidence[0].id,'u0001');assert.equal(evidence[2].source.kind,'ocr-line');
 assert.equal(evidence[0].source.documentSha256,hash);
 assert.ok(Object.isFrozen(evidence));assert.ok(Object.isFrozen(evidence[0].source));
 assert.equal(prepareStructuredEvidence({document:{sha256:hash},units:[{text:'A',source:{kind:'text-line',line:1}}]})[0].source.documentSha256,hash);
 assert.throws(()=>prepareStructuredEvidence({document:{sha256:hash},units:[{text:'x',source:{documentSha256:'b'.repeat(64)}}]}),/invalid_structured_evidence/);
 assert.throws(()=>prepareStructuredEvidence({document:{sha256:hash},text:'unattributed'}),/invalid_structured_evidence/);
});

test('candidates require literal evidence and retain missing and conflicting fields',()=>{
 const evidence=prepareStructuredEvidence(report);
 const output=assessStructuredCandidates(schema,evidence,JSON.stringify({fields:{invoice:[{value:'INV-42',evidenceIds:['u0001']}],total:[{value:'120.50',evidenceIds:['u0002']},{value:'125.50',evidenceIds:['u0003']}]}}));
 assert.equal(output.fields.invoice.status,'found');assert.equal(output.fields.invoice.value,'INV-42');
 assert.equal(output.fields.date.status,'missing');assert.equal(output.fields.total.status,'conflict');assert.equal(output.reviewRequired,true);
 assert.equal(output.fields.total.candidates[1].sources[0].kind,'ocr-line');
});

test('hostile or malformed model output cannot forge citations or silently normalize values',()=>{
 const evidence=prepareStructuredEvidence(report),run=value=>assessStructuredCandidates(schema,evidence,JSON.stringify(value));
 for(const value of [
  {fields:{invoice:[{value:'INV-99',evidenceIds:['u0001']}]}},
  {fields:{invoice:[{value:'INV-42',evidenceIds:['u9999']}]}},
  {fields:{invoice:[{value:'../INV-42',evidenceIds:['u0001']}]}},
  {fields:{date:[{value:'2023-02-29',evidenceIds:['u0001']}]}},
  {fields:{total:[{value:'120.50',evidenceIds:[]}]}},
  {fields:{total:[{value:'120',evidenceIds:['u0002']}]}},
  {fields:{invoice:[{value:'',evidenceIds:['u0001']}]}},
  {fields:{note:[{value:' ',evidenceIds:['u0001']}]}},
  {fields:{unknown:[{value:'x',evidenceIds:['u0001']}]}},
  {fields:{invoice:[{value:'INV-42',evidenceIds:['u0001'],source:{kind:'forged'}}]}},
 ])assert.throws(()=>run(value),/invalid_structured_candidate/);
 assert.throws(()=>assessStructuredCandidates(schema,evidence,'not JSON'),/invalid_structured_candidate/);
 assert.throws(()=>assessStructuredCandidates(schema,evidence,'x'.repeat(32769)),/invalid_structured_candidate/);
 assert.throws(()=>assessStructuredCandidates(schema,evidence,'{"fields":{"total":[{"value":"120.50","evidenceIds":["u0002"]}],"total":[{"value":"125.50","evidenceIds":["u0003"]}]}}'),/invalid_structured_candidate/);
 assert.throws(()=>assessStructuredCandidates(schema,evidence,String.raw`{"fields":{"invoice":[{"value":"INV-42","evidenceIds":["u0001"]}],"inv\u006fice":[{"value":"INV-42","evidenceIds":["u0001"]}]}}`),/invalid_structured_candidate/);
 assert.equal(assessStructuredCandidates(schema,evidence,'{ "fields" : { "invoice" : [{"value":"INV-42","evidenceIds":["u0001"]}] } }').fields.invoice.status,'found');
 assert.equal(assessStructuredCandidates(schema,evidence,String.raw`{"fields":{"invoice":[{"value":"\u0049NV-42","evidenceIds":["u0001"]}]}}`).fields.invoice.status,'found');
 const numericSchema={schemaVersion:1,schemaId:'count',revision:1,schema:{type:'object',additionalProperties:false,properties:{count:{type:'number'}},required:[]}};
 const numericEvidence=prepareStructuredEvidence({document:{sha256:hash},units:[{text:'Count 1',source:{kind:'text-line'}}]});
 assert.equal(assessStructuredCandidates(numericSchema,numericEvidence,'{"fields":{"count":[{"value":1.0,"evidenceIds":["u0001"]}]}}').fields.count.status,'found');
 assert.throws(()=>assessStructuredCandidates(schema,[...evidence],JSON.stringify({fields:{}})),/invalid_structured_candidate/);
});

test('candidate invokes qualified private inference only with bounded evidence and checks its result',async()=>{
 let seen;
 const inference={chat:async(request,options)=>{seen={request,options};return {choices:[{message:{content:JSON.stringify({fields:{invoice:[{value:'INV-42',evidenceIds:['u0001']}]}})}}]};}};
 const signal=new AbortController().signal;
 const result=await runStructuredExtractionCandidate({report,schema,inference,signal});
 assert.equal(result.fields.invoice.status,'found');assert.equal(result.fields.total.status,'missing');
 assert.equal(seen.request.temperature,0);assert.equal(seen.request.stream,false);assert.equal(seen.options.signal,signal);
 assert.ok(seen.request.messages[1].content.includes('INV-42'));
 await assert.rejects(runStructuredExtractionCandidate({report,schema,inference:{chat:async()=>({choices:[{message:{content:'{"fields":{},"fields":{}}'}}]})}}),/invalid_structured_candidate/);
});
