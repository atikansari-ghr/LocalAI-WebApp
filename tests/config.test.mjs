import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../packages/shared/config.mjs';
test('default configuration binds only loopback and never stores state in source', () => {
  const c = loadConfig({});
  assert.equal(c.host, '127.0.0.1'); assert.equal(c.port, 1234);
  assert.ok(c.stateDir.endsWith('.localai')); assert.ok(Object.isFrozen(c));
});
test('configuration rejects unsafe binds, typos and malformed ports', () => {
  for (const env of [{LOCALAI_HOST:'0.0.0.0'}, {LOCALAI_PORT:'1234x'}, {LOCALAI_PORT:'0'}, {LOCALAI_PORT:'65536'}, {LOCALAI_POTR:'1234'}, {LOCALAI_STATE_DIR:''}]) {
    assert.throws(() => loadConfig(env));
  }
  assert.equal(loadConfig({LOCALAI_HOST:'::1',LOCALAI_PORT:'4321'}).port,4321);
});
