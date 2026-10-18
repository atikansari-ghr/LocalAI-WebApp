import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import manifest from '../services/inference/starter-manifest.json' with {type:'json'};
import {validateStarterManifest,downloadAsset} from '../services/inference/assets.mjs';

export async function provisionStarter(input,{base='/opt/localai/ai',modelRoot='/var/lib/localai-models',fetchImpl=fetch,signal,onProgress}={}){
 const approved=validateStarterManifest(input),manifestSha256=createHash('sha256').update(JSON.stringify(approved)).digest('hex'),assets=[];
 for(const asset of approved.assets){
  const path=join(asset.kind==='runtime'?join(base,'archives'):modelRoot,asset.sha256,asset.filename);
  const result=await downloadAsset(asset,path,{fetchImpl,signal,onProgress});assets.push({id:asset.id,...result});
 }
 const candidate=join(base,'candidates',manifestSha256);await mkdir(candidate,{recursive:true,mode:0o750});
 const reportPath=join(candidate,'assets.json'),result={manifestSha256,qualification:'downloaded-unqualified',assets,reportPath};
 const temporary=join(candidate,'.assets-'+randomUUID()+'.json'),file=await open(temporary,'wx',0o600);
 try{await file.writeFile(JSON.stringify(result,null,2));await file.sync();await file.close();await rename(temporary,reportPath);}
 finally{try{await file.close();}catch{}try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 process.umask(0o077);
 try{
  if(process.platform!=='linux'||process.getuid()!==0||process.arch!=='x64')throw new Error('This starter requires root on Debian13 x64');
  if(process.argv.length!==3||!['--check','--download-starter'].includes(process.argv[2]))throw new Error('Use install-ai.sh --check or --download-starter');
  execFileSync(process.execPath,[fileURLToPath(new URL('./preflight.mjs',import.meta.url))],{stdio:'inherit'});
  validateStarterManifest(manifest);
  if(process.argv[2]==='--check')console.log('Starter source manifest and target preflight passed; runtime compatibility remains unqualified.');
  else{
   const progress=new Map();
   const result=await provisionStarter(manifest,{onProgress:({id,bytes,total})=>{if(bytes===total||bytes-(progress.get(id)??0)>=256*1024**2){progress.set(id,bytes);console.log(id+': '+Math.round(bytes/1024**2)+' / '+Math.round(total/1024**2)+' MiB');}}});
   console.log(JSON.stringify(result));console.log('Assets verified only. No worker was started; native runtime qualification is still required.');
  }
 }catch(error){console.error('AI provisioning blocked: '+error.message);process.exitCode=1;}
}
