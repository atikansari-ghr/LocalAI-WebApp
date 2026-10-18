import { join } from 'node:path';
import { loadConfig } from '../../packages/shared/config.mjs';
import { openState } from '../../packages/database/index.mjs';
import { createGateway } from './server.mjs';

process.umask(0o077);
let state, server;
try {
  const config=loadConfig();
  state=openState(join(config.stateDir,'platform.sqlite'));
  server=createGateway({state});
  server.on('error',()=>{ console.error('Gateway failed to listen; check configuration and port availability.');state.close();process.exitCode=1; });
  server.listen(config.port,config.host,()=>console.log('Local AI foundation listening on loopback port '+config.port));
  let stopping=false;
  const stop=()=> {
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>{server.closeAllConnections();},5000);deadline.unref();
    server.close(()=>{clearTimeout(deadline);state.close();});
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
} catch {
  state?.close();
  console.error('Gateway startup failed; check runtime, configuration and state permissions.');
  process.exitCode=1;
}
