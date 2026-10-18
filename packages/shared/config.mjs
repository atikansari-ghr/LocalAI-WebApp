import { resolve } from 'node:path';
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
    } else if (setting.type === 'loopback') {
      if (!['127.0.0.1', '::1'].includes(value)) throw new Error('Foundation gateway must bind loopback');
    } else {
      if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid state directory');
      value = resolve(value);
    }
    config[setting.key] = value;
  }
  return Object.freeze(config);
}
