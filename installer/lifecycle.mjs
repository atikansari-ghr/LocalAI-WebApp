import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
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
  try {
    if(!Number.isSafeInteger(expectedPid)||expectedPid<=0)return false;
    const host=config.host==='::1'?'[::1]':config.host;
    const response=await fetch('http://'+host+':'+config.port+'/health/live',{signal:AbortSignal.timeout(2000),redirect:'error'});
    const body=await response.json();
    return response.status===200&&body.status==='alive'&&body.pid===expectedPid;
  }catch{return false;}
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
