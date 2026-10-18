import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { rootCertificates } from 'node:tls';
import { loadConfig } from '../packages/shared/config.mjs';

export function readInstallationConfig(path) {
  const env=parseEnv(readFileSync(path,'utf8'));
  // An incomplete file must not silently switch to a source-relative state directory.
  for(const key of ['LOCALAI_HOST','LOCALAI_PORT','LOCALAI_STATE_DIR'])if(!Object.hasOwn(env,key))throw new Error('Incomplete installer configuration');
  return loadConfig(env);
}
export function prepareConfiguration(path) {
  const temporary=join(dirname(path),'.gateway.env.'+randomUUID());
  const fd=openSync(temporary,'wx',0o640);
  try {
    writeFileSync(fd,'LOCALAI_HOST=127.0.0.1\nLOCALAI_PORT=1234\nLOCALAI_STATE_DIR=/var/lib/localai\n');
    fsyncSync(fd);
  } finally {closeSync(fd);}
  readInstallationConfig(temporary);
  return temporary;
}
export function publishConfiguration(temporary,path) {
  try {linkSync(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  finally {unlinkSync(temporary);}
  return readInstallationConfig(path);
}
export async function backupInstallation(config) {
  const source=join(config.stateDir,'platform.sqlite');
  if(!existsSync(source))return null;
  const directory=join(config.stateDir,'pre-install-backups');mkdirSync(directory,{recursive:true,mode:0o700});
  const destination=join(directory,Date.now()+'-'+randomUUID()+'.sqlite');
  const db=new DatabaseSync(source,{readOnly:true});
  let reserved=false;
  try {
    closeSync(openSync(destination,'wx',0o600));reserved=true;
    await backup(db,destination);
    const restored=new DatabaseSync(destination,{readOnly:true});
    try {if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Invalid backup');}
    finally {restored.close();}
    return destination;
  } catch(error){if(reserved)unlinkSync(destination);throw error;}
  finally {db.close();}
}
export async function probeGateway(config,expectedPid) {
  let deadline;
  try {
    if(!Number.isSafeInteger(expectedPid)||expectedPid<=0)return false;
    const tls=config.transport==='tls';
    const hostname=config.host==='0.0.0.0'?'127.0.0.1':config.host==='::'?'::1':config.host;
    const options={hostname,port:config.port,path:'/health/live',method:'GET',agent:false,timeout:2000};
    if(tls)Object.assign(options,{servername:new URL(config.origin).hostname,rejectUnauthorized:true,minVersion:'TLSv1.2',ca:[...rootCertificates,readFileSync(config.tlsCert)]});
    const controller=new AbortController();options.signal=controller.signal;
    deadline=setTimeout(()=>controller.abort(),2000);deadline.unref();
    return await new Promise((resolve,reject)=>{
      const request=(tls?requestHttps:requestHttp)(options,response=>{
        let bytes=0;const chunks=[];
        response.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384){request.destroy(new Error('Probe response too large'));return;}chunks.push(chunk);});
        response.on('error',reject);
        response.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve(response.statusCode===200&&body.status==='alive'&&body.pid===expectedPid);}catch{resolve(false);}});
      });
      request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('Probe timeout')));request.end();
    });
  }catch{return false;}
  finally{clearTimeout(deadline);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const [,,action,path,pid]=process.argv;
    if(action==='prepare')console.log(prepareConfiguration(path));
    else if(action==='publish')publishConfiguration(path,process.argv[4]);
    else {
      const config=readInstallationConfig(path);
      if(action==='backup')await backupInstallation(config);
      else if(action==='probe'){if(!await probeGateway(config,Number(pid)))process.exitCode=1;}
      else if(action!=='validate')throw new Error('Unknown lifecycle operation');
    }
  } catch {console.error('Installer lifecycle check failed; configuration/state preserved.');process.exitCode=1;}
}
