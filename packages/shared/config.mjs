import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { matchesNetwork } from '../auth/network.mjs';
import registry from './settings.json' with { type: 'json' };

export function loadConfig(env = process.env) {
  const known = new Set(registry.map(s => s.env));
  for (const key of Object.keys(env)) {
    if (key.startsWith('LOCALAI_') && !known.has(key)) throw new Error('Unknown configuration key: ' + key);
  }
  const config = {};
  for (const setting of registry) {
    let value = env[setting.env] ?? setting.default;
    if (setting.type === 'port') {
      if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) throw new Error('Invalid gateway port');
      value = Number(value);
    } else if (setting.type === 'address') {
      if (!isIP(value)) throw new Error('Listen address must be an IP');
    } else if(setting.type==='transport') {
      if(!['loopback','proxy','tls'].includes(value))throw new Error('Unknown transport');
    } else if(setting.type==='origin') {
      if(value!==''){const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value||isIP(url.hostname))throw new Error('Canonical HTTPS DNS origin required');}
    } else if(setting.type==='networks') {
      if(typeof value!=='string')throw new Error('Invalid proxy list');
      value=value?value.split(',').map(v=>v.trim()):[];
      if(value.some(v=>v.endsWith('/0')))throw new Error('Unrestricted proxies are forbidden');
      matchesNetwork('127.0.0.1',value);value=Object.freeze(value);
    } else if(setting.type==='optionalPath') {
      if(typeof value!=='string'||value.includes('\0'))throw new Error('Invalid TLS path');
      value=value?resolve(value):'';
    } else {
      if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid state directory');
      value = resolve(value);
    }
    config[setting.key] = value;
  }
  if(config.transport==='loopback'){
    if(!['127.0.0.1','::1'].includes(config.host)||config.origin)throw new Error('Loopback foundation cannot expose browser access');
  }else{
    if(!config.origin)throw new Error('Secure browser origin required');
    if(config.transport==='proxy'&&!config.trustedProxies.length)throw new Error('Explicit trusted proxy required');
    if(config.transport==='tls'&&(!config.tlsCert||!config.tlsKey))throw new Error('TLS certificate and key required');
  }
  return Object.freeze(config);
}
