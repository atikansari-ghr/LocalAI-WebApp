import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evaluateOcrText} from '../services/documents/quality.mjs';
import {createOcrChain} from '../services/documents/ocr.mjs';
const bytes=Buffer.from([137,80,78,71,13,10,26,10,0]),sha256=createHash('sha256').update(bytes).digest('hex'),page={index:1,width:900,height:140,bytes,sha256,documentSha256:'a'.repeat(64)};
const output=text=>({lines:text?[{text,confidence:0.99,box:[{x:0,y:0},{x:800,y:0},{x:800,y:100},{x:0,y:100}]}]:[]});
test('OCR independent quality detects empty corrupt and wrong-script output without confidence claims',()=>{
 assert.equal(evaluateOcrText('مرحبا بالعالم',{language:'ar'}).acceptable,true);assert.equal(evaluateOcrText('LOCAL AI TEST 1234',{language:'en'}).acceptable,true);
 for(const text of ['', '????', '\ufffd\ufffd','LOCAL AI'])assert.equal(evaluateOcrText(text,{language:'ar'}).acceptable,false);
 assert.equal(evaluateOcrText('LOCAL Al TEST 1234',{language:'en'}).accuracyVerified,false);
});
test('OCR default chain falls back on empty and wrong-script output while retaining attempts and citations',async()=>{
 const called=[],adapters=Object.fromEntries(['light-ocr','tesseract','paddleocr'].map((id,i)=>[id,async()=>{called.push(id);return output(i===0?'':i===1?'wrong script':'مرحبا بالعالم');}]));
 const result=await createOcrChain({adapters})([page],{language:'ar'});assert.deepEqual(called,['light-ocr','tesseract','paddleocr']);assert.equal(result.pages[0].engine,'paddleocr');assert.equal(result.pages[0].attempts.length,3);assert.equal(result.pages[0].units[0].source.normalizedSha256,sha256);assert.equal(result.pages[0].manualReviewRequired,true);assert.equal(result.pages[0].conflict,true);
});
test('OCR configured order disabled engines and primary-only behavior never reorder themselves',async()=>{
 const called=[],adapters={'light-ocr':async()=>{called.push('light-ocr');return output('LOCAL AI');},tesseract:async()=>{called.push('tesseract');return output('مرحبا');}};
 const chain=createOcrChain({adapters,order:['tesseract','light-ocr'],disabled:['tesseract']});const result=await chain([page],{language:'en'});assert.deepEqual(called,['light-ocr']);assert.equal(result.pages[0].attempts[0].status,'disabled');
 called.length=0;const only=await createOcrChain({adapters,mode:'primary-only'})([page],{language:'ar'});assert.deepEqual(called,['light-ocr']);assert.equal(only.pages[0].status,'requires-review');
 assert.throws(()=>createOcrChain({adapters,order:['tesseract','tesseract']}),/invalid_ocr_configuration/);
});
test('OCR validates immutable page snapshots output polygons cancellation and aggregate budgets',async()=>{
 const adapter=async()=>output('LOCAL AI');const chain=createOcrChain({adapters:{'light-ocr':adapter}});
 await assert.rejects(chain([{...page,sha256:'b'.repeat(64)}]),/invalid_ocr_page/);await assert.rejects(chain([page],{signal:AbortSignal.abort()}),/ocr_cancelled/);
 const malformed=await createOcrChain({adapters:{'light-ocr':async()=>({lines:[{text:'LOCAL AI',box:[{x:-1,y:0}]}]})},mode:'primary-only'})([page]);assert.equal(malformed.pages[0].attempts[0].error,'invalid_ocr_result');
 await assert.rejects(chain([page],{maxTextBytes:2}),/text_output_limit/);await assert.rejects(chain([page,page]),/invalid_ocr_page/);
});

test('OCR reports an actionable language prerequisite instead of inventing a tertiary failure',async()=>{
 const error=Object.assign(new Error('ocr_language_hint_required'),{code:'ocr_language_hint_required'}),result=await createOcrChain({adapters:{paddleocr:async()=>{throw error;}},order:['paddleocr']})([page]);assert.equal(result.pages[0].attempts[0].status,'language-hint-required');assert.equal(result.pages[0].attempts[0].error,'ocr_language_hint_required');assert.equal(result.pages[0].status,'requires-review');
});

test('OCR preserves bounded timeout evidence and handles non-Error adapter failures safely',async()=>{
 for(const failure of [null,Object.assign(new Error(),{code:'document_tool_timeout'})]){const result=await createOcrChain({adapters:{'light-ocr':async()=>{throw failure;}},mode:'primary-only'})([page]);assert.equal(result.pages[0].attempts[0].error,failure===null?'ocr_engine_failed':'document_tool_timeout');}
});

test('OCR auto checks secondary script coverage and uses observed Arabic for tertiary model selection',async()=>{
 const calls=[],chain=createOcrChain({adapters:{'light-ocr':async()=>{calls.push('light');return output('NATIVE HEADER');},tesseract:async()=>{calls.push('tess');return output('NATIVE HEADER مرحبا بالعالم');},paddleocr:async(_page,options)=>{calls.push(options.language);return output('NATIVE HEADER مرحبا بالعالم');}}});const result=await chain([page]);assert.deepEqual(calls,['light','tess','ar']);assert.equal(result.pages[0].engine,'paddleocr');assert.equal(result.pages[0].conflict,true);assert.match(result.pages[0].text,/مرحبا/);
});

test('OCR automatic agreement ignores harmless whitespace and does not replace corroborated text',async()=>{
 const called=[],result=await createOcrChain({adapters:{'light-ocr':async()=>output('LOCAL AI'),tesseract:async()=>output('LOCAL\nAI'),paddleocr:async()=>{called.push('paddle');return output('WRONG BODY');}}})([page]);assert.deepEqual(called,[]);assert.equal(result.pages[0].conflict,false);
});
