import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createBrowserHandler } from './browser.mjs';
import { matchesNetwork, normalizeIp } from '../../packages/auth/network.mjs';

export function createGateway({ state,config,...services }) {
  const browser=config&&config.transport!=='loopback'?createBrowserHandler({config,...services}):null;
  const options={requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:2000,maxHeaderSize:8192};
  const factory=config?.transport==='tls'?createTlsServer:createServer;
  if(config?.transport==='tls')Object.assign(options,{cert:readFileSync(config.tlsCert),key:readFileSync(config.tlsKey),minVersion:'TLSv1.2'});
  return factory(options, async (request, response) => {
    if(!['/health/live','/health/ready'].includes(request.url)&&browser)return browser(request,response);
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy','no-referrer');
    const send = (status, body) => { response.writeHead(status);response.end(JSON.stringify(body)); };
    if (!['/health/live','/health/ready'].includes(request.url)) return send(404,{error:{code:'not_found'}});
    if(config&&config.transport!=='loopback'){
      const remote=normalizeIp(request.socket.remoteAddress);
      if(!matchesNetwork(remote,['127.0.0.0/8','::1'])&&remote!==normalizeIp(config.host)&&!matchesNetwork(remote,config.trustedProxies))return send(403,{error:{code:'source_denied'}});
    }
    if (request.method !== 'GET') { response.setHeader('Allow','GET');return send(405,{error:{code:'method_not_allowed'}}); }
    if (request.url === '/health/live') return send(200,{status:'alive',pid:process.pid});
    try {
      if (!state.health().ok) throw new Error('State unavailable');
      const runtimeBlockers=services.inference?(await services.inference.health()?[]:['runtime_unavailable']):['runtime_not_provisioned'];
      return send(503,{status:'not_ready',blockers:[...(services.auth?.status()==='ready'?[]:[browser?'setup_required':'setup_not_implemented']),...runtimeBlockers,'release_not_qualified']});
    } catch {
      return send(503,{status:'not_ready',blockers:['state_unavailable']});
    }
  });
}
