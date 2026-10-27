import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverSnowLumaConnection } from '../../integrations/qq-bridge/src/snowluma-conn.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-gateway-'));
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(home, 'config'));
  for (const [uin, port, token] of [['111111', 3000, 'other-token'], ['222222', 3010, 'target-token']]) {
    fs.writeFileSync(path.join(home, 'config', `onebot_${uin}.json`), JSON.stringify({ networks: {
      httpServers: [{ accessToken: token, host: '127.0.0.1', port }], wsServers: [{ accessToken: token + '-ws', host: '127.0.0.1', port: port + 1 }]
    } }));
  }
  const fetch = globalThis.fetch; t.after(() => globalThis.fetch = fetch);
  return { home, cfg: { bigfatfish: { expectedQQ: '222222' }, snowluma: { httpUrl: 'http://127.0.0.1:3000', accessToken: 'other-token' } } };
}
const response = user_id => ({ ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { user_id } }) });
test('gateway discovery rejects a working explicit endpoint for another account and selects target HTTP and WS together', async t => {
  const { home, cfg } = fixture(t), calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, token: init.headers.authorization }); return response(url.includes(':3010') ? 222222 : 111111); };
  const r = await discoverSnowLumaConnection({ cfg, homeDirs: [home] });
  assert.equal(r.ok, true); assert.equal(r.self.user_id, 222222); assert.equal(r.baseUrl, 'http://127.0.0.1:3010');
  assert.equal(r.wsUrl, 'ws://127.0.0.1:3011'); assert.equal(r.wsToken, 'target-token-ws');
  assert.equal(r.tried[0].ok, false); assert.equal(calls.filter(c => c.token === 'Bearer other-token').length, 1);
  assert.equal(cfg.snowluma.httpUrl, 'http://127.0.0.1:3000', 'discovery itself never rewrites configuration');
});
test('target token pointing to a conflicting backend never authenticates the wrong identity', async t => {
  const { home, cfg } = fixture(t); globalThis.fetch = async () => response(111111);
  const r = await discoverSnowLumaConnection({ cfg, homeDirs: [home] });
  assert.equal(r.ok, false); assert.match(r.error, /目标 QQ/); assert.ok(r.tried.every(row => !row.ok));
  assert.equal(r.token, undefined); assert.equal(r.self, undefined);
});
test('missing target account does not fall through to other per-account credentials', async t => {
  const { home, cfg } = fixture(t); cfg.bigfatfish.expectedQQ = '333333'; delete cfg.snowluma.accessToken;
  let calls = 0; globalThis.fetch = async () => { calls++; return response(111111); };
  const r = await discoverSnowLumaConnection({ cfg, homeDirs: [home] }); assert.equal(r.ok, false); assert.equal(calls, 1);
});
test('unscoped upstream installations preserve successful account discovery', async t => {
  const { home } = fixture(t); globalThis.fetch = async () => response(111111);
  const r = await discoverSnowLumaConnection({ cfg: {}, homeDirs: [home] }); assert.equal(r.ok, true); assert.equal(r.self.user_id, 111111);
});
