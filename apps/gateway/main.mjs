import { join } from 'node:path';
import { loadConfig } from '../../packages/shared/config.mjs';
import { openState } from '../../packages/database/index.mjs';
import { createGateway } from './server.mjs';
import { existsSync } from 'node:fs';
import { openSecurityRepository } from '../../packages/auth/repository.mjs';
import { openVault,initializeVault } from '../../packages/auth/crypto.mjs';
import { createAuthService } from '../../packages/auth/service.mjs';
import { createApplicationService } from '../../packages/auth/applications.mjs';
import { createPasskeyService } from '../../packages/auth/passkeys.mjs';
import { loadQualifiedInference } from '../../services/inference/qualification.mjs';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
let state, server,repo;
try {
  const config=loadConfig();
  state=openState(join(config.stateDir,'platform.sqlite'));
  let services={};
  if(config.transport!=='loopback'){
    repo=openSecurityRepository(join(config.stateDir,'platform.sqlite'));
    const keyPath=join(config.stateDir,'master.key'),vault=existsSync(keyPath)?openVault(keyPath):initializeVault(keyPath,{encryptedStateExists:repo.hasEncryptedState()});
    const auth=createAuthService({repo,vault}),apps=createApplicationService({repo,auth}),passkeys=createPasskeyService({repo,auth,origin:config.origin,rpId:new URL(config.origin).hostname});
    const inference=loadQualifiedInference({sourceRoot:fileURLToPath(new URL('../..',import.meta.url)),onFallback:event=>repo.audit(Date.now(),'inference_fallback',null,event.to,event.reason)});
    services={repo,vault,auth,apps,passkeys,inference};
  }
  const closeState=()=>{repo?.close();state.close();};
  server=createGateway({state,config,...services});
  server.on('error',()=>{ console.error('Gateway failed to listen; check configuration and port availability.');closeState();process.exitCode=1; });
  server.listen(config.port,config.host,()=>console.log('Local AI listening on configured port '+config.port));
  let stopping=false;
  const stop=()=> {
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>{server.closeAllConnections();},5000);deadline.unref();
    server.close(()=>{clearTimeout(deadline);closeState();});
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
} catch {
  state?.close();
  repo?.close();
  console.error('Gateway startup failed; check runtime, configuration and state permissions.');
  process.exitCode=1;
}
