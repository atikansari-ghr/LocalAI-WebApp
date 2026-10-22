import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const [root,file]=process.argv.slice(2);if(process.argv.length!==4)throw new Error('invalid_worker_arguments');
const require=createRequire(root+'/package.json'),{createEngine}=require('@arcships/light-ocr');
const engine=await createEngine({execution:{provider:'cpu',sessionFallback:'error',precision:'fp32'},intraOpThreads:1,interOpThreads:1,recognitionBatchSize:1,queueCapacity:1,maxPendingInputBytes:10*1024**2,reducedLimits:{maxWidth:2000,maxHeight:2000,maxPixels:4000000,maxDetectionSide:960,maxDetectionCandidates:256,maxDetectionTiles:4,maxRecognitionBatchSize:1,maxRecognitionWidth:2048,maxTemporaryBytes:128*1024**2}});
try{
 for(const stage of ['detection','recognition'])if(!engine.info.execution.sessions[stage].actualProviderChain.every(provider=>/cpu/i.test(provider)))throw new Error('cpu_required');
 const result=await engine.recognizeEncoded(await readFile(file),{signal:AbortSignal.timeout(29000)});process.stdout.write(JSON.stringify({engine:'light-ocr',width:result.imageWidth,height:result.imageHeight,lines:result.lines.map(line=>({text:line.text,confidence:line.confidence,box:line.box}))}));
}finally{await engine.close();}
