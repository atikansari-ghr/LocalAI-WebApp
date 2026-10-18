import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readInstallationConfig } from '../installer/lifecycle.mjs';
import { openSecurityRepository } from '../packages/auth/repository.mjs';
import { initializeVault,openVault } from '../packages/auth/crypto.mjs';
import { createAuthService } from '../packages/auth/service.mjs';

export function issueSetupCode(stateDir){
 const repo=openSecurityRepository(join(stateDir,'platform.sqlite'));
 try{
  const key=join(stateDir,'master.key');
  const vault=existsSync(key)?openVault(key):initializeVault(key,{encryptedStateExists:repo.hasEncryptedState()});
  return createAuthService({repo,vault}).issueSetupCode();
 }finally{repo.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 process.umask(0o077);
 try{
  if(process.getuid?.()===0)throw new Error('Run as the localai service account to preserve state ownership.');
  if(process.argv.length!==4||process.argv[2]!=='--config')throw new Error('Usage: setup-code.mjs --config /etc/localai/gateway.env');
  const config=readInstallationConfig(process.argv[3]);
  if(config.transport==='loopback')throw new Error('Configure verified HTTPS transport before browser setup.');
  console.log(issueSetupCode(config.stateDir));
  console.error('Use this private one-time code at '+config.origin+'/setup within 30 minutes.');
 }catch(error){console.error(error.message==='Run as the localai service account to preserve state ownership.'?error.message:'Setup code unavailable; check arguments, transport, state permissions and whether setup is already in progress or complete.');process.exitCode=1;}
}
