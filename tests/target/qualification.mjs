// Isolated loader fixtures only. Never writes the deployed activation record.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {REQUIRED_NATIVE_CHECKS,expectedQualificationIdentity,loadQualifiedInference} from '../../services/inference/qualification.mjs';

if(process.platform!=='linux'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable Linux root fixture required');
const temporary=mkdtempSync('/tmp/localai-qualification-'),revision=randomBytes(20).toString('hex'),source=join(temporary,revision),credentials=join(temporary,'credentials');
const presetDirectory='/etc/localai-runtime/models/'+revision,preset=join(presetDirectory,'chat.ini'),digest=value=>createHash('sha256').update(value).digest('hex');
const reportPath=join(temporary,'fixture-only.json');let createdPreset=false;
try{
 mkdirSync(source);mkdirSync(credentials,{mode:0o700});
 for(const path of ['apps','packages','services','migrations','installer','package.json','package-lock.json'])cpSync(join(process.cwd(),path),join(source,path),{recursive:true});
 mkdirSync(presetDirectory,{recursive:true,mode:0o750});writeFileSync(preset,'; isolated loader fixture; not an active model preset\n',{flag:'wx',mode:0o600});createdPreset=true;
 const identity=expectedQualificationIdentity(source,revision),units={};
 for(const [name,file]of Object.entries({chat:'localai-chat.service',embedding:'localai-embedding.service',slice:'localai-ai.slice'}))units[name]=digest(readFileSync('/etc/systemd/system/'+file));
 const report={qualification:{schemaVersion:1,scope:'private-preview',...identity,suite:{tests:1,passed:1,failed:0,skipped:0,cancelled:0},checks:[...REQUIRED_NATIVE_CHECKS]},units,presetHash:digest(readFileSync(preset))};
 const save=()=>writeFileSync(reportPath,JSON.stringify(report),{mode:0o600});
 writeFileSync(join(credentials,'ai-backend-key'),'a'.repeat(43)+'\n',{mode:0o600});save();
 const options={sourceRoot:source,reportPath,credentialsDirectory:credentials,onFallback:()=>{}};
 assert.equal(typeof loadQualifiedInference(options).chat,'function');
 chmodSync(reportPath,0o660);assert.throws(()=>loadQualifiedInference(options));chmodSync(reportPath,0o600);
 chmodSync(join(credentials,'ai-backend-key'),0o640);assert.throws(()=>loadQualifiedInference(options));chmodSync(join(credentials,'ai-backend-key'),0o600);
 report.qualification.suite={tests:1,passed:0,failed:0,skipped:1,cancelled:0};save();assert.throws(()=>loadQualifiedInference(options));report.qualification.suite={tests:1,passed:1,failed:0,skipped:0,cancelled:0};save();
 writeFileSync(join(source,'services/inference/fallback-manifest.json'),'{}');assert.throws(()=>loadQualifiedInference(options));
 console.log(JSON.stringify({check:'isolated-qualification-loader',sourceTamperingRejected:true,unsafeRecordRejected:true,unsafeCredentialRejected:true,skipsRejected:true,realActivationPublished:false}));
}finally{
 assert.ok(resolve(temporary).startsWith('/tmp/localai-qualification-'));rmSync(temporary,{recursive:true,force:true});
 if(createdPreset){assert.equal(dirname(resolve(presetDirectory)),'/etc/localai-runtime/models');assert.equal(basename(presetDirectory),revision);rmSync(presetDirectory,{recursive:true,force:true});}
}
