// Installed into an isolated candidate directory and run as a DynamicUser.
// Synthetic fixtures only; this cannot publish gateway qualification.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';

if(process.platform!=='linux'||process.arch!=='x64'||process.getuid()===0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Disposable Linux x64 unprivileged sandbox required');
const root='/opt/localai/ocr/candidates/light-ocr-0.5.8',require=createRequire(root+'/package.json');
const {createEngine,modelProfile}=require('@arcships/light-ocr');
const dictionary=JSON.parse(readFileSync(join(dirname(require.resolve('@arcships/light-ocr-model-ppocrv6-small/bundle/manifest.json')),'rec/dictionary.json'),'utf8'));
const arabicCharacters=JSON.stringify(dictionary).match(/[\u0600-\u06ff]/gu)?.length??0;
const expectedHashes={english:'8a936d1ec24cc4c888cd3841498ee8f2790081cdab78d9210ca282e8916885cd',arabic:'b65d42a93ee4b50c2dadfe9f970a62ad583145a9e63914fdf5d3b5cb7fae735e'};
const engine=await createEngine({execution:{provider:'cpu',sessionFallback:'error',precision:'fp32'},intraOpThreads:1,interOpThreads:1,recognitionBatchSize:1,queueCapacity:1,maxPendingInputBytes:1024**2,
 reducedLimits:{maxWidth:2048,maxHeight:2048,maxPixels:4*1024**2,maxDetectionSide:960,maxDetectionCandidates:256,maxDetectionTiles:4,maxRecognitionBatchSize:1,maxRecognitionWidth:2048,maxTemporaryBytes:128*1024**2}});
try{
 for(const stage of ['detection','recognition'])assert.ok(engine.info.execution.sessions[stage].actualProviderChain.every(provider=>/cpu/i.test(provider)),'CPU-only provider required');
 const results=[];
 for(const language of ['english','arabic']){
  const bytes=readFileSync(root+'/fixtures/'+language+'.png');assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedHashes[language]);
  const started=performance.now(),result=await engine.recognizeEncoded(bytes,{includeDiagnostics:true,signal:AbortSignal.timeout(60000)}),text=result.lines.map(line=>line.text).join('\n');
  assert.equal(result.imageWidth,900);assert.equal(result.imageHeight,140);
  for(const line of result.lines){assert.ok(Number.isFinite(line.confidence)&&line.confidence>=0&&line.confidence<=1);assert.equal(line.box.length,4);for(const point of line.box)assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));}
  if(language==='english'){assert.match(text,/LOCAL/i);assert.match(text,/TEST/i);assert.match(text,/1234/);}
  results.push({language,elapsedMs:Math.round(performance.now()-started),syntheticText:text,lineCount:result.lines.length,containsArabic:/[\u0600-\u06ff]/u.test(text)});
 }
 console.log(JSON.stringify({scope:'isolated-ocr-candidate',engine:'light-ocr',version:'0.5.8',runtime:'0.1.8',model:'ppocrv6-small0.3.4',modelBundleId:engine.info.modelBundleId,declaredLanguageCount:modelProfile.languages,arabicDictionaryCharacters:arabicCharacters,actuallyTested:['en','ar'],acceptedLanguages:['en'],arabicFallbackRequired:true,cpuOnly:true,results,activated:false,fullOcrGate:'blocked'}));
}finally{await engine.close();}
