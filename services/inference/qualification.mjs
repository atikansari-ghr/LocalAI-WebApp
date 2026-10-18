import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,realpathSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {join,basename} from 'node:path';
import {createInferenceClient} from './client.mjs';
import {validateStarterManifest,validateFallbackModel} from './assets.mjs';
import starter from './starter-manifest.json' with {type:'json'};
import fallback from './fallback-manifest.json' with {type:'json'};

export const REQUIRED_NATIVE_CHECKS=Object.freeze(['english-chat','arabic-chat','english-arabic-embeddings','native-sse-stream','gateway-adapter-real-tokenizer-context-cancellation-and-reuse','idle-sleep-and-lazy-reload','native-worker-crash-restart-and-vault-isolation','real-fallback-with-primary-http-fault-circuit-cooldown-and-recovery','child-listeners-isolated-and-unrelated-user-denied','isolated-native-activation-rollback']);
function exactKeys(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new Error('Unexpected qualification fields');}
function validateSuite(suite){
 exactKeys(suite,['tests','passed','failed','skipped','cancelled']);
 if(Object.values(suite).some(n=>!Number.isSafeInteger(n)||n<0)||suite.tests<1||suite.passed!==suite.tests||suite.failed!==0||suite.skipped!==0||suite.cancelled!==0)throw new Error('Complete non-skipped native test evidence required');
}
export function validateQualification(value,expected){
 exactKeys(value,['schemaVersion','scope','sourceCommit','sourceFingerprint','starterManifest','fallbackManifest','environmentFingerprint','suite','checks']);
 if(value.schemaVersion!==1||value.scope!=='private-preview')throw new Error('Private preview qualification required');
 for(const key of ['sourceCommit','sourceFingerprint','starterManifest','fallbackManifest','environmentFingerprint']){
  if(typeof value[key]!=='string'||!new RegExp('^[a-f0-9]{'+(key==='sourceCommit'?40:64)+'}$').test(value[key])||value[key]!==expected[key])throw new Error('Qualification identity mismatch');
 }
 validateSuite(value.suite);
 if(!Array.isArray(value.checks)||value.checks.length!==REQUIRED_NATIVE_CHECKS.length||new Set(value.checks).size!==value.checks.length||REQUIRED_NATIVE_CHECKS.some(check=>!value.checks.includes(check)))throw new Error('Mandatory native evidence missing');
 const copy=structuredClone(value);Object.freeze(copy.suite);Object.freeze(copy.checks);return Object.freeze(copy);
}
export function parseNativeTestSummary(output){
 const result={};
 for(const [source,target]of Object.entries({tests:'tests',pass:'passed',fail:'failed',cancelled:'cancelled',skipped:'skipped'})){
  const matches=[...output.matchAll(new RegExp('^# '+source+' (\\d+)\\r?$','gm'))];if(matches.length!==1)throw new Error('Unambiguous native test summary required');result[target]=Number(matches[0][1]);
 }
 validateSuite(result);return Object.freeze(result);
}
export function combineNativeQualification({identity,suite,workers,router,activation}){
 if(workers?.qualification!=='workers-loaded-unqualified'||router?.qualification!=='router-tested-unqualified'||activation?.qualification!=='activation-fixture-tested'||workers.manifestSha256!==identity.starterManifest||router.starterManifest!==identity.starterManifest||router.fallbackManifest!==identity.fallbackManifest||!Array.isArray(workers.checks)||!Array.isArray(router.checks)||!Array.isArray(activation.checks)||!activation.checks.some(item=>item?.check==='isolated-native-activation-rollback'))throw new Error('Native report identity mismatch');
 const observed=new Set([...workers.checks,...router.checks,...activation.checks].map(item=>item?.check));
 const checks=REQUIRED_NATIVE_CHECKS.filter(check=>observed.has(check));
 return validateQualification({schemaVersion:1,scope:'private-preview',...identity,suite,checks},identity);
}
export function assertProtectedRecord(stat){
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.nlink!==1||(stat.mode&0o022)!==0)throw new Error('Qualification record must be a protected root-owned regular file');
}
export function computeRuntimeFingerprint(sourceRoot){
 const root=realpathSync(sourceRoot),files=[];
 const visit=(relative)=>{
  const path=join(root,relative),stat=lstatSync(path);
  if(stat.isSymbolicLink())throw new Error('Runtime source must not contain symbolic links');
  if(stat.isDirectory()){for(const name of readdirSync(path).sort())visit(relative+'/'+name);}
  else if(stat.isFile())files.push([relative,createHash('sha256').update(readFileSync(path)).digest('hex')]);
  else throw new Error('Runtime source must contain only regular files/directories');
 };
 for(const directory of ['apps','packages','services','migrations','installer'])visit(directory);
 visit('package.json');visit('package-lock.json');
 return createHash('sha256').update('localai-runtime-v1\n').update(JSON.stringify(files.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))).digest('hex');
}
const digest=value=>createHash('sha256').update(value).digest('hex');
export function computeEnvironmentFingerprint({read=path=>readFileSync(path,'utf8')}={}){
 const cpu=read('/proc/cpuinfo'),memory=read('/proc/meminfo');
 const machine=read('/etc/machine-id').trim();if(!/^[a-f0-9]{32}$/.test(machine))throw new Error('Native machine identity unavailable');
 const model=cpu.match(/^model name\s*:\s*(.+)$/m)?.[1],flags=cpu.match(/^flags\s*:\s*(.+)$/m)?.[1],total=memory.match(/^MemTotal:\s+(\d+)\s+kB$/m)?.[1];
 if(!model||!flags||!total)throw new Error('Native target identity unavailable');
 return digest(JSON.stringify({machine,os:read('/etc/os-release'),kernel:read('/proc/sys/kernel/osrelease').trim(),packages:digest(read('/var/lib/dpkg/status')),cpu:model,flags:flags.split(/\s+/).sort(),memoryKiB:total,node:process.version,arch:process.arch}));
}
export function expectedQualificationIdentity(sourceRoot,sourceCommit=basename(realpathSync(sourceRoot))){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw new Error('Immutable source revision required');
 return {sourceCommit,sourceFingerprint:computeRuntimeFingerprint(sourceRoot),starterManifest:digest(JSON.stringify(validateStarterManifest(starter))),fallbackManifest:digest(JSON.stringify({schemaVersion:1,assets:[validateFallbackModel(fallback)]})),environmentFingerprint:computeEnvironmentFingerprint()};
}
function readProtectedFile(path,{optional=false,credential=false}={}){
 let fd;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 try{
  const stat=fstatSync(fd);
  if(credential){if(!stat.isFile()||stat.nlink!==1||![0,process.getuid()].includes(stat.uid)||(stat.mode&0o077)!==0)throw new Error('Unsafe internal credential file');}
  else assertProtectedRecord(stat);
  if(stat.size<1||stat.size>(credential?128:65536))throw new Error('Invalid protected file size');
  return readFileSync(fd);
 }finally{closeSync(fd);}
}
export function loadQualifiedInference({sourceRoot,reportPath='/etc/localai/inference.json',credentialsDirectory=process.env.CREDENTIALS_DIRECTORY,onFallback,mode='balanced'}={}){
 const raw=readProtectedFile(reportPath,{optional:true});if(raw===null)return null;
 if(process.platform!=='linux')throw new Error('Qualified native runtime requires Linux');
 const record=JSON.parse(raw.toString('utf8'));exactKeys(record,['qualification','units','presetHash']);
 validateQualification(record.qualification,expectedQualificationIdentity(sourceRoot));
 exactKeys(record.units,['chat','embedding','slice']);
 const files={chat:'/etc/systemd/system/localai-chat.service',embedding:'/etc/systemd/system/localai-embedding.service',slice:'/etc/systemd/system/localai-ai.slice'};
 for(const [name,file]of Object.entries(files)){if(!/^[a-f0-9]{64}$/.test(record.units[name])||digest(readProtectedFile(file))!==record.units[name])throw new Error('Qualified worker configuration mismatch');}
 if(!/^[a-f0-9]{64}$/.test(record.presetHash)||digest(readProtectedFile('/etc/localai-runtime/models/'+record.qualification.sourceCommit+'/chat.ini'))!==record.presetHash)throw new Error('Qualified model preset mismatch');
 if(typeof credentialsDirectory!=='string'||!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(credentialsDirectory)||credentialsDirectory.split('/').some(part=>part==='.'||part==='..'))throw new Error('Native systemd credential directory required');
 const key=readProtectedFile(join(credentialsDirectory,'ai-backend-key'),{credential:true}).toString('utf8').replace(/\n$/,'');
 return createInferenceClient({key,mode,fallbackEnabled:true,onFallback});
}
