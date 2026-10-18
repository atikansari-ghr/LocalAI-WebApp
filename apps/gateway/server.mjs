import { createServer } from 'node:http';

export function createGateway({ state }) {
  return createServer({ requestTimeout:10000, headersTimeout:10000, keepAliveTimeout:2000, maxHeaderSize:8192 }, (request, response) => {
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy','no-referrer');
    const send = (status, body) => { response.writeHead(status);response.end(JSON.stringify(body)); };
    if (!['/health/live','/health/ready'].includes(request.url)) return send(404,{error:{code:'not_found'}});
    if (request.method !== 'GET') { response.setHeader('Allow','GET');return send(405,{error:{code:'method_not_allowed'}}); }
    if (request.url === '/health/live') return send(200,{status:'alive',pid:process.pid});
    try {
      if (!state.health().ok) throw new Error('State unavailable');
      return send(503,{status:'not_ready',blockers:['setup_not_implemented','runtime_not_provisioned','release_not_qualified']});
    } catch {
      return send(503,{status:'not_ready',blockers:['state_unavailable']});
    }
  });
}
