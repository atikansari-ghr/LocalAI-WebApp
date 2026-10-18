import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,lstatSync,readFileSync,writeFileSync,openSync,fsyncSync,closeSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {expectedQualificationIdentity,parseNativeTestSummary,combineNativeQualification,assertProtectedRecord} from '../services/inference/qualification.mjs';

const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
const run=(file,args)=>execFileSync(file,args,{cwd:sourceRoot,encoding:'utf8',timeout:30000}).trim();
function privateDirectory(path){mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)throw new Error('Qualification storage must be a private root-owned directory');}
function writeAtomic(path,value){
 try{assertProtectedRecord(lstatSync(path));}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=path+'.'+randomUUID(),fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 try{renameSync(temporary,path);const directory=openSync(join(path,'..'),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
 finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
export function qualifyPrivateRuntime(){
 if(process.platform!=='linux'||process.arch!=='x64'||process.getuid()!==0||process.env.TARGET_TEST_LXC!=='disposable')throw new Error('Explicit disposable Debian13 x64 root qualification required');
 if(run('git',['status','--porcelain']))throw new Error('Use a clean reviewed source revision');
 const revision=run('git',['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(revision))throw new Error('Invalid source revision');
 execFileSync(process.execPath,[join(sourceRoot,'installer/preflight.mjs')],{cwd:sourceRoot,stdio:'inherit',timeout:30000});
 const before=expectedQualificationIdentity(sourceRoot,revision),storage=join(sourceRoot,'.localai');privateDirectory(storage);
 const execute=(name,args,{native=false}={})=>{
  console.log('Running '+name+'; runtime remains inactive.');
  const result=spawnSync(process.execPath,args,{cwd:sourceRoot,env:{...process.env,...(native?{TARGET_TEST_LXC:'disposable'}:{})},encoding:'utf8',timeout:300000,maxBuffer:16*1024**2});
  const output=(result.stdout??'')+(result.stderr??''),log=join(storage,'qualification-'+name+'-'+randomUUID()+'.log');writeFileSync(log,output,{flag:'wx',mode:0o600});
  if(result.error||result.signal||result.status!==0)throw new Error(name+' failed; inspect protected log '+log);
  return output;
 };
 const suite=parseNativeTestSummary(execute('suite',['--test','--test-concurrency=1','--test-reporter=tap']));
 const started=Date.now();
 execute('workers',['tests/target/private-workers.mjs'],{native:true});
 execute('router',['tests/target/router.mjs'],{native:true});
 execute('loader',['tests/target/qualification.mjs'],{native:true});
 const reports={};
 for(const [name,file]of Object.entries({workers:'private-workers.json',router:'router.json'})){
  const path=join(storage,file),stat=lstatSync(path);assertProtectedRecord(stat);if(stat.mtimeMs<started||stat.size>65536)throw new Error('Stale/oversized native report');reports[name]=JSON.parse(readFileSync(path,'utf8'));
 }
 if(run('git',['status','--porcelain'])||run('git',['rev-parse','HEAD'])!==revision)throw new Error('Source changed during qualification');
 const after=expectedQualificationIdentity(sourceRoot,revision);if(JSON.stringify(after)!==JSON.stringify(before))throw new Error('Runtime source or target environment changed during qualification');
 const report=combineNativeQualification({identity:after,suite,...reports}),destination='/opt/localai/ai/qualified/'+revision;privateDirectory(destination);
 const reportPath=join(destination,'report.json');writeAtomic(reportPath,report);
 console.log(JSON.stringify({scope:report.scope,sourceCommit:revision,tests:suite.tests,reportPath,activated:false}));
 return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 process.umask(0o077);
 try{if(process.argv.length!==3||process.argv[2]!=='--qualify-private-preview')throw new Error('Use qualify-ai.mjs --qualify-private-preview');qualifyPrivateRuntime();}
 catch(error){console.error('Runtime qualification blocked: '+error.message);process.exitCode=1;}
}
