import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { ApiPool, poolCredential, poolRoute, poolProfile, inspectApiAccess } from './api-pool.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
const secret = 'fixture-only-api-key-no-real-credential';
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-api-pool-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const credentials = new Map(), providers = {}, calls = [];
  let revision = 0, changes = 0;
  const options = { ready: () => true, fallback: () => ({ provider: 'deepseek-official', model: 'fixture-model' }), changed: () => changes++,
    probe: async () => 'API_POOL_OK', rpc: async (method, args) => {
      calls.push({ method, args }); let value;
      if (method === 'credentials.set') credentials.set(args.ref, args.value);
      else if (method === 'credentials.unset') credentials.delete(args.ref);
      else if (method === 'credentials.describe') value = Object.fromEntries(args.refs.map(ref => [ref, { configured: credentials.has(ref), writable: true }]));
      else if (method === 'settings.describe') value = { writable: true, namespaces: [{ ns: 'llm-pi-ai', revision, value: { providers } }] };
      else if (method === 'settings.mutate') {
        assert.equal(args.expectedRevision, revision); revision++;
        for (const op of args.ops) { assert.equal(op.path[0], 'providers'); if (op.op === 'set') providers[op.path[1]] = op.value; else delete providers[op.path[1]]; }
      } else throw new Error('unexpected ' + method);
      return { result: { ok: true, value } };
    }, ...overrides };
  const pool = new ApiPool(root, options);
  const add = (patch = {}) => pool.save({ revision: pool.state.revision, name: '测试接口', baseURL: 'https://example.com/v1', model: 'relay-model', apiKey: secret, ...patch });
  return { pool, add, root, options, credentials, providers, calls, changes: () => changes };
}
test('keys stay in the DSH credential store and are absent from API snapshots/files', async t => {
  const f = fixture(t); const saved = await f.add(); const entry = f.pool.entry(saved.id);
  assert.equal(f.credentials.get(poolCredential(entry)), secret);
  assert.equal(entry.keyStored, true);
  assert.ok(!JSON.stringify(saved).includes(secret)); assert.ok(!fs.readFileSync(f.pool.file, 'utf8').includes(secret));
  assert.equal(f.pool.selection(), null); assert.deepEqual(Object.keys(f.providers), []);
});
test('switch, replace an active model, restart and switch back preserve the selected route', async t => {
  const f = fixture(t); const a = await f.add(), b = await f.add({ name: '第二密钥', apiKey: secret + '2', model: 'other-model' });
  await f.pool.activate({ revision: f.pool.state.revision, id: a.id });
  assert.equal(f.pool.selection().provider, poolRoute(f.pool.entry(a.id)));
  await f.pool.save({ revision: f.pool.state.revision, id: a.id, model: 'new-model' });
  assert.equal(f.providers[poolRoute(f.pool.entry(a.id))].models[0].id, 'new-model');
  await f.pool.activate({ revision: f.pool.state.revision, id: b.id });
  const restored = new ApiPool(f.root, f.options); assert.equal(restored.selection().model, 'other-model');
  await f.pool.activate({ revision: f.pool.state.revision, id: null }); assert.equal(f.pool.selection(), null); assert.equal(f.changes(), 4);
});
test('editing a masked key retains it; rotation and deleting an unused entry affect only its own credential', async t => {
  const f = fixture(t); const a = await f.add(), b = await f.add();
  const ref = poolCredential(f.pool.entry(a.id)), other = poolCredential(f.pool.entry(b.id));
  await f.pool.save({ revision: f.pool.state.revision, id: a.id, apiKey: '', name: '重命名' }); assert.equal(f.credentials.get(ref), secret);
  await f.pool.save({ revision: f.pool.state.revision, id: a.id, apiKey: secret + 'new' }); assert.equal(f.credentials.get(ref), secret + 'new');
  await f.pool.remove({ revision: f.pool.state.revision, id: a.id }); assert.equal(f.credentials.has(ref), false); assert.equal(f.credentials.get(other), secret);
});
test('reject stale saves and serialize concurrent writes before changing credentials', async t => {
  const f = fixture(t); const revision = f.pool.state.revision;
  const results = await Promise.allSettled([f.add(), f.pool.save({ revision, name: 'stale', apiKey: 'fixture-other-key' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.credentials.size, 1);
  assert.equal(results[1].reason.status, 409);
});
test('active and testing entries cannot be deleted or disabled', async t => {
  const f = fixture(t); const a = await f.add(); await f.pool.activate({ revision: f.pool.state.revision, id: a.id });
  await assert.rejects(f.pool.remove({ revision: f.pool.state.revision, id: a.id }), /先切换/);
  await assert.rejects(f.pool.save({ revision: f.pool.state.revision, id: a.id, enabled: false }), /先切换/);
});
test('failed activation never changes the active selection or other provider routes', async t => {
  const f = fixture(t); const a = await f.add(); f.credentials.clear();
  f.providers['unrelated-provider'] = { untouched: true };
  await assert.rejects(f.pool.activate({ revision: f.pool.state.revision, id: a.id }), /API Key/);
  assert.equal(f.pool.selection(), null); assert.deepEqual(f.providers['unrelated-provider'], { untouched: true });
});
test('connection test pins the requested model, does not activate it and does not block switching', async t => {
  let finish; const f = fixture(t, { probe: async job => { assert.equal(job.modelSelection.model, 'relay-model'); return new Promise(resolve => { finish = resolve; }); } });
  const a = await f.add(); const pending = f.pool.test({ revision: f.pool.state.revision, id: a.id });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pool.entry(a.id).lastTest.status, 'running');
  await assert.rejects(f.pool.remove({ revision: f.pool.state.revision, id: a.id }), /测试/);
  await f.pool.activate({ revision: f.pool.state.revision, id: a.id });
  finish('API_POOL_OK'); const result = await pending; assert.equal(result.test.status, 'passed');
  assert.equal(f.pool.state.activeId, a.id);
});
test('raw upstream errors and response text never leak through failed tests', async t => {
  const f = fixture(t, { probe: async () => { throw new Error(secret); } }); const a = await f.add();
  const result = await f.pool.test({ revision: f.pool.state.revision, id: a.id });
  assert.equal(result.test.status, 'failed'); assert.ok(!JSON.stringify(result).includes(secret)); assert.equal(f.pool.selection(), null);
});
test('invalid endpoints, operation URLs, key formats and prototype ids cannot mutate credentials', async t => {
  const f = fixture(t);
  for (const baseURL of ['http://example.com/v1', 'https://example.com/v1?key=abc', 'https://user:pass@example.com/v1', 'https://example.com/v1/chat/completions']) await assert.rejects(f.add({ baseURL }));
  await assert.rejects(f.add({ apiKey: 'a b c d e f g' }));
  await assert.rejects(f.pool.save({ revision: 0, id: '__proto__' })); assert.equal(f.credentials.size, 0);
});
test('drafts can be saved but cannot be selected; disabled endpoints cannot be used', async t => {
  const f = fixture(t); const draft = await f.add({ baseURL: '', model: '', apiKey: '' });
  await assert.rejects(f.pool.activate({ revision: f.pool.state.revision, id: draft.id }), /填写/);
  const b = await f.add({ enabled: false }); await assert.rejects(f.pool.activate({ revision: f.pool.state.revision, id: b.id }), /启用/);
});
test('corrupt metadata is preserved and fails closed instead of silently selecting the official model', t => {
  const f = fixture(t); fs.mkdirSync(path.dirname(f.pool.file)); fs.writeFileSync(f.pool.file, '{broken');
  const restored = new ApiPool(f.root, f.options); assert.throws(() => restored.selection(), /损坏/); assert.equal(fs.readFileSync(f.pool.file, 'utf8'), '{broken');
});
test('pool profiles declare only verified modalities and explicitly supported reasoning', () => {
  const e = { id: 'a'.repeat(32), model: 'deepseek-flash', name: 'relay', baseURL: 'https://example.com/v1', protocol: 'openai-completions', contextWindow: 65536, maxTokens: 4096, deepseekCompat: true };
  const profile = poolProfile(e); assert.deepEqual(profile.models[0].input, ['text']); assert.equal(profile.models[0].reasoningEfforts, false);
  assert.equal(profile.compat.requiresReasoningContentOnAssistantMessages, true);
  assert.deepEqual(poolProfile({ ...e, vision: true, effort: 'high' }).models[0].reasoningEfforts, { off: null, high: 'high' });
});
test('pool HTTP management rejects agent access and never accepts unknown endpoints', async t => {
  const f = fixture(t); let result, status;
  const send = (v, s = 200) => { result = v; status = s; };
  await f.pool.handle({ method: 'GET', headers: { 'x-agent-token': 'token' } }, new URL('http://localhost/api/model-pool'), () => {}, send); assert.equal(status, 403);
  await f.pool.handle({ method: 'POST', headers: {} }, new URL('http://localhost/api/model-pool/unknown'), () => { throw new Error('must not read'); }, send); assert.equal(status, 404); assert.equal(result.ok, false);
});
test('native bridge enforces pool credentials and exposes the pool page under console authentication', async t => {
  let handler; const server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ globals: { http: { createServer(cb) { handler = cb; return server; } } } }); t.after(() => h.close()); h.startConsoleServer();
  const call = async headers => {
    const req = Readable.from([]); Object.assign(req, { method: 'GET', url: '/api/model-pool', headers: { host: '127.0.0.1:3106', 'x-console-token': 'fixture-console-token', ...headers } });
    let status, body; await handler(req, { writeHead(s) { status = s; }, end(text) { body = JSON.parse(text); } }); return { status, body };
  };
  const r = await call({}); assert.equal(r.status, 200); assert.equal(r.body.activeId, null);
  assert.equal((await call({ 'x-agent-token': 'anything' })).status, 403);
  assert.equal((await call({ 'x-console-token': 'wrong' })).status, 401);
});
test('native chat sessions reselect after each pool switch, and a failed custom selection never submits a prompt', async t => {
  const f = fixture(t), h = await bridgeHarness(); t.after(() => h.close());
  h.apiPool.options.rpc = f.options.rpc;
  const a = await h.apiPool.save({ revision: 0, name: 'A', baseURL: 'https://example.com/v1', model: 'model-a', apiKey: secret });
  const b = await h.apiPool.save({ revision: h.apiPool.state.revision, name: 'B', baseURL: 'https://example.org/v1', model: 'model-b', apiKey: secret });
  const selections = [];
  h.api.sessions.selectModel = async request => { selections.push(request); return { result: { ok: true, value: { selected: request } } }; };
  const sessionId = await h.ensureSession('private:123');
  await h.apiPool.activate({ revision: h.apiPool.state.revision, id: a.id }); assert.equal(await h.ensureSession('private:123'), sessionId);
  assert.equal(selections.at(-1).model, 'model-a'); assert.equal(selections.at(-1).reasoningEffort, undefined);
  await h.apiPool.activate({ revision: h.apiPool.state.revision, id: b.id }); await h.ensureSession('private:123'); assert.equal(selections.at(-1).model, 'model-b');
  await h.apiPool.activate({ revision: h.apiPool.state.revision, id: a.id });
  h.api.sessions.selectModel = async () => ({ result: { ok: false, error: { code: 'UNKNOWN_MODEL', message: 'model rejected' } } });
  await assert.rejects(h.ensureSession('private:123'), /已停止本次请求/); assert.equal(h.calls.prompts.length, 0);
});
test('native internal pool tests pin the tested endpoint and preserve the active endpoint', async t => {
  const f = fixture(t), h = await bridgeHarness(); t.after(() => h.close()); h.apiPool.options.rpc = f.options.rpc;
  h.apiPool.options.inspectAccess = async () => null;
  const a = await h.apiPool.save({ revision: 0, name: 'A', baseURL: 'https://example.com/v1', model: 'test-model', apiKey: secret });
  h.api.sessions.selectModel = async request => { assert.equal(request.model, 'test-model'); return { result: { ok: true, value: { selected: request } } }; };
  h.api.sessions.prompt = async request => { h.completeSlangTurn(request.sessionId, 'API_POOL_OK'); return { result: { ok: true, value: {} } }; };
  const r = await h.apiPool.test({ revision: h.apiPool.state.revision, id: a.id });
  assert.equal(r.test.status, 'passed'); assert.equal(h.apiPool.state.activeId, null); assert.equal(h.calls.sent.length, 0); assert.equal(h.calls.archived.length, 1);
});
test('internal probes restore their DSH global-default side effect without overwriting an unrelated selection', async t => {
  const f = fixture(t); const a = await f.add(); const entry = f.pool.entry(a.id);
  const original = f.options.rpc; let current = { provider: poolRoute(entry), model: entry.model }, restored;
  f.pool.options.rpc = async (method, args) => {
    if (method === 'settings.describe') { const r = await original(method, args); r.result.value.namespaces.push({ ns: 'agent-default-model', revision: 7, value: current }); return r; }
    if (method === 'settings.mutate' && args.ns === 'agent-default-model') { restored = args; return { result: { ok: true, value: {} } }; }
    return original(method, args);
  };
  await f.pool.restoreTestDefault(entry); assert.equal(restored.ops[0].value, 'deepseek-official');
  restored = undefined; current = { provider: 'another-user-selection', model: 'other' };
  await f.pool.restoreTestDefault(entry); assert.equal(restored, undefined);
});
test('model or key edits invalidate old connection results and invalid token limits are rejected', async t => {
  const f = fixture(t); const a = await f.add();
  await f.pool.test({ revision: f.pool.state.revision, id: a.id }); assert.equal(f.pool.entry(a.id).lastTest.status, 'passed');
  await f.pool.save({ revision: f.pool.state.revision, id: a.id, model: 'changed-model' }); assert.equal(f.pool.entry(a.id).lastTest, null);
  await f.pool.test({ revision: f.pool.state.revision, id: a.id });
  await f.pool.save({ revision: f.pool.state.revision, id: a.id, apiKey: secret + 'rotated' }); assert.equal(f.pool.entry(a.id).lastTest, null);
  await assert.rejects(f.add({ contextWindow: 4096, maxTokens: 8192 }), /不能大于/);
});

test('access inspection recognizes explicit campus network policy without sending credentials or following redirects', async () => {
  let args;
  const issue = await inspectApiAccess({ baseURL: 'https://example.com/v1' }, async (...input) => { args = input; return new Response('<html><body><img src="data:image/png;base64,' + 'a'.repeat(320000) + '">当前系统仅限校内访问，校外请登录门户或VPN。</body></html>', { status: 483, headers: { 'content-type': 'text/html' } }); });
  assert.equal(issue.code, 'CAMPUS_NETWORK_REQUIRED'); assert.match(issue.message, /校园 VPN.*483/);
  assert.equal(args[0], 'https://example.com/v1/models'); assert.equal(args[1].headers, undefined); assert.equal(args[1].redirect, 'manual'); assert.ok(!JSON.stringify(args).includes(secret));
});

test('ordinary unauthenticated, missing-model-list and transient network failures never block a model test', async () => {
  for (const [status, type, body] of [[401, 'application/json', '{"error":"key needed"}'], [403, 'text/html', 'Access denied'], [404, 'text/plain', 'not found'], [302, 'text/html', 'login']]) {
    assert.equal(await inspectApiAccess({ baseURL: 'https://example.com/v1' }, async () => new Response(body, { status, headers: { 'content-type': type } })), null);
  }
  assert.equal(await inspectApiAccess({ baseURL: 'https://example.com/v1' }, async () => { throw Error('offline'); }), null);
  assert.equal(await inspectApiAccess({ baseURL: 'https://example.com/v1' }, async () => new Response('x'.repeat(600000) + '仅限校内访问', { status: 483, headers: { 'content-type': 'text/html' } })), null);
});

test('confirmed campus restriction is recorded clearly and does not invoke a paid model or switch the active route', async t => {
  let calls = 0;
  const f = fixture(t, { inspectAccess: async () => ({ code: 'CAMPUS_NETWORK_REQUIRED', message: '接口仅限校内访问，请连接校园 VPN（HTTP 483）' }), probe: async () => { calls++; return 'API_POOL_OK'; } });
  const a = await f.add(), r = await f.pool.test({ revision: f.pool.state.revision, id: a.id });
  assert.equal(calls, 0); assert.equal(r.activeId, null); assert.equal(r.test.status, 'failed'); assert.equal(r.test.code, 'CAMPUS_NETWORK_REQUIRED'); assert.match(r.test.message, /VPN/);
  assert.equal(f.credentials.get(poolCredential(f.pool.entry(a.id))), secret);
});
