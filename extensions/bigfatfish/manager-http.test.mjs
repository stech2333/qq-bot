import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { managerHandler } from './manager-http.mjs';

function fixture() {
  const manager = { config: () => ({ consoleToken: 'fixture-management-token' }), status: async () => ({ ok: true, busy: false }), action: async body => ({ ok: true, action: body.action }) };
  const handle = managerHandler(manager);
  return { manager, async request({ url = '/api/manager/status', method = 'GET', headers = {}, raw = '' } = {}) {
    const req = Readable.from([Buffer.from(raw)]); req.setTimeout = () => {};
    Object.assign(req, { url, method, headers: { host: '127.0.0.1:3105', 'x-console-token': 'fixture-management-token', 'content-type': 'application/json', ...headers } });
    let result; const res = { writeHead(status) { this.status = status; }, end(text) { this.writableEnded = true; result = { status: this.status, ...JSON.parse(text) }; } };
    await handle(req, res); return result;
  } };
}
test('configuration and status errors are contained without returning secrets or crashing later requests', async () => {
  const { manager, request } = fixture(); const config = manager.config;
  manager.config = () => { throw Error('JSON parse: password=secret-fixture'); };
  let result = await request(); assert.equal(result.status, 503); assert.doesNotMatch(result.error, /secret-fixture/);
  manager.config = config; manager.status = async () => { throw Error('sensitive path'); };
  result = await request(); assert.equal(result.status, 503); assert.doesNotMatch(result.error, /sensitive/);
  manager.status = async () => ({ ok: true }); assert.equal((await request()).ok, true);
});
test('manager rejects hostile host, cross-site origin and all agent credentials', async () => {
  const { request } = fixture();
  for (const headers of [{ host: 'evil.example:3105' }, { origin: 'https://evil.example' }, { 'x-agent-call': '1' }, { 'x-agent-token': '' }]) assert.equal((await request({ headers })).status, 403);
  assert.equal((await request({ headers: { 'x-console-token': 'wrong' } })).status, 401);
});
test('manager bounds bytes and validates JSON before process actions', async () => {
  const { manager, request } = fixture(); let actions = 0; manager.action = async () => { actions++; return { ok: true }; };
  for (const raw of ['{bad', 'null', '[]', '"text"']) assert.equal((await request({ method: 'POST', url: '/api/manager/action', raw })).status, 400);
  assert.equal((await request({ method: 'POST', url: '/api/manager/action', raw: JSON.stringify({ note: '鲸'.repeat(1400) }) })).status, 413);
  assert.equal(actions, 0);
  assert.equal((await request({ method: 'POST', url: '/api/manager/action', raw: '{"action":"start","service":"all"}' })).ok, true); assert.equal(actions, 1);
});
test('operational errors remain useful while raw parse and spawn errors stay private', async () => {
  const { manager, request } = fixture();
  for (const message of ['已有启停操作进行中', '操作参数无效', '该服务由其他入口启动，请在原入口停止']) {
    manager.action = async () => { throw Error(message); };
    assert.equal((await request({ method: 'POST', url: '/api/manager/action', raw: '{}' })).error, message);
  }
  manager.action = async () => { throw Error('JSON password=do-not-echo'); };
  assert.doesNotMatch((await request({ method: 'POST', url: '/api/manager/action', raw: '{}' })).error, /do-not-echo/);
});
