import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditLegacy, checkReadiness, formatReport, localEndpoint, probeJson } from './readiness.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-readiness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, data = '') => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data)); };
  const cfg = { consolePort: 3106, consoleToken: 'private-console-token-never-output',
    bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321',
    allowAllWhenEmpty: false, allow: { groups: ['123456'], private: ['987654321'] },
    dsh: { baseUrl: 'http://127.0.0.1:3086', authToken: 'private-dsh-token' },
    snowluma: { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000', accessToken: 'private-gateway-token' },
    socialV2: { enabled: true, tools: { listStickers: true, getStickerImage: true, sendSticker: true, collectSticker: true, stickerNote: true },
      sticker: { enabled: true, collect: { enabled: true } }, voice: { ffmpegPath: 'bin/ffmpeg.exe' } } };
  const legacy = { version: 1, bound: {}, tables: Object.fromEntries(['archives', 'facts', 'peers', 'policies', 'session_roots', 'summaries'].map(name => [name, []])) };
  legacy.tables.summaries.push({ key: 'old-peer', data: { version: 1, record: { peerKey: 'old-peer', summary: 'private-memory-content' } } });
  legacy.tables.facts.push({ key: 'fact-1', data: { version: 1, record: { peerKey: 'old-peer', text: 'private-fact-content' } } });
  for (const file of ['src/bridge.js', 'src/mcp-snowluma-safe.js', 'public/console.html', 'roles/大肥鱼.md', 'bin/ffmpeg.exe',
    'node_modules/@snowluma/sdk/package.json', 'node_modules/@modelcontextprotocol/sdk/package.json', 'node_modules/zod/package.json']) put('integrations/qq-bridge/' + file);
  for (const file of ['node_modules/@deepseek-ai/dsh/lib/bin.js', 'scripts/bridge-manager.mjs', 'scripts/open-bridge-manager.ps1', 'scripts/start-qq.ps1', 'extensions/bigfatfish/services.mjs', 'extensions/bigfatfish/manager.html', '一键启动.vbs',
    'data-bridge/profiles/web/cordis.yml', 'data-bridge/profiles/web/cordis.patch.yml', 'data-bridge/profiles/web/package.json']) put(file);
  put('integrations/qq-bridge/UPSTREAM-SNAPSHOT.json', { commit: 'a'.repeat(40) });
  put('integrations/qq-bridge/config.json', cfg);
  put('integrations/qq-bridge/state/mode.json', { mode: 'reserved2' });
  put('integrations/qq-bridge/state/legacy-import.json', legacy);
  for (const [name, entries] of Object.entries(legacy.tables)) {
    fs.mkdirSync(path.join(root, 'data-bridge/legacy-memory', name), { recursive: true });
    for (const entry of entries) put(`data-bridge/legacy-memory/${name}/${entry.key}.json`, entry.data);
  }
  return { root, cfg, legacy, put, saveConfig: () => put('integrations/qq-bridge/config.json', cfg), saveLegacy: () => put('integrations/qq-bridge/state/legacy-import.json', legacy) };
}
const check = (report, id) => report.checks.find(item => item.id === id);

test('an empty legacy store needs no historical source after retirement', async t => {
  const { root, legacy, saveLegacy } = fixture(t);
  for (const name of Object.keys(legacy.tables)) legacy.tables[name] = [];
  saveLegacy();
  fs.rmSync(path.join(root, 'data-bridge/legacy-memory'), { recursive: true });
  const report = await checkReadiness(root, { env: {} });
  assert.equal(report.summary.fail, 0);
  assert.equal(report.migration.sessions, 0);
  assert.equal(check(report, 'memory.source').status, 'pass');
  assert.equal(check(report, 'memory.bindings').status, 'pass');
});

test('offline inspection is read-only and keeps unbound identities unresolved', async t => {
  const { root } = fixture(t);
  const file = path.join(root, 'integrations/qq-bridge/state/legacy-import.json');
  const before = fs.readFileSync(file);
  const report = await checkReadiness(root, { env: {} });
  assert.equal(report.summary.fail, 0);
  assert.equal(report.migration.sessions, 1);
  assert.equal(report.migration.facts, 1);
  assert.equal(report.migration.sourceDrift, 0);
  assert.equal(check(report, 'memory.bindings').status, 'pending');
  assert.equal(check(report, 'voice.installed').status, 'pending');
  assert.equal(check(report, 'services.online').status, 'skipped');
  assert.equal(report.qqAcceptanceComplete, false);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('reports exclude credentials, memory bodies, session identifiers and absolute paths', async t => {
  const { root } = fixture(t);
  const report = await checkReadiness(root, { env: {} });
  const output = JSON.stringify(report) + formatReport(report);
  for (const secret of ['private-console-token', 'private-dsh-token', 'private-gateway-token', 'private-memory-content', 'private-fact-content', 'old-peer', root]) assert.equal(output.includes(secret), false);
});

test('invalid JSON fails without returning parser input or secrets', async t => {
  const { root, put } = fixture(t);
  put('integrations/qq-bridge/config.json', '{"secret":"private-broken-content",');
  const report = await checkReadiness(root, { env: {} });
  assert.equal(check(report, 'config.json').status, 'fail');
  assert.equal(JSON.stringify(report).includes('private-broken-content'), false);
});

test('missing dependencies and conflicting ports are reported as failures', async t => {
  const { root, cfg, saveConfig } = fixture(t);
  fs.unlinkSync(path.join(root, 'integrations/qq-bridge/node_modules/@snowluma/sdk/package.json'));
  cfg.consolePort = 3105; saveConfig();
  const report = await checkReadiness(root, { env: {} });
  assert.equal(check(report, 'bridge.dependencies').status, 'fail');
  assert.equal(check(report, 'ports.distinct').status, 'fail');
});

test('snapshot comparison catches additions, changes and deletions without exposing text', t => {
  const { root, put } = fixture(t);
  put('data-bridge/legacy-memory/facts/new.json', { record: { peerKey: 'new-peer', text: 'private-new' } });
  put('data-bridge/legacy-memory/summaries/old-peer.json', { record: { peerKey: 'old-peer', summary: 'private-changed' } });
  fs.unlinkSync(path.join(root, 'data-bridge/legacy-memory/facts/fact-1.json'));
  const report = auditLegacy(root);
  assert.equal(report.sourceDrift, 3);
  assert.equal(JSON.stringify(report).includes('private-'), false);
});

test('comparison ignores JSON property order but detects malformed source records', t => {
  const { root, put } = fixture(t);
  put('data-bridge/legacy-memory/facts/fact-1.json', { record: { text: 'private-fact-content', peerKey: 'old-peer' }, version: 1 });
  assert.equal(auditLegacy(root).sourceDrift, 0);
  put('data-bridge/legacy-memory/facts/fact-1.json', '{broken');
  assert.equal(auditLegacy(root).sourceErrors, 1);
});

test('invalid snapshots and duplicate snapshot keys cannot pass audit', t => {
  const { root, legacy, saveLegacy } = fixture(t);
  legacy.tables.facts.push(legacy.tables.facts[0]); saveLegacy();
  assert.equal(auditLegacy(root).valid, false);
  legacy.tables.facts = {}; saveLegacy();
  assert.equal(auditLegacy(root).valid, false);
});

test('bound sessions must have a persisted target state; unknown and invalid identities fail', t => {
  const { root, legacy, put, saveLegacy } = fixture(t);
  legacy.bound['old-peer'] = 'group:123456'; saveLegacy();
  assert.equal(auditLegacy(root).bindingErrors, 1);
  put('integrations/qq-bridge/state/social-v2.json', { conversations: { 'group:123456': { bigfatfish: { facts: [], summary: 'value' } } } });
  assert.equal(auditLegacy(root).bindingErrors, 0);
  legacy.bound['unknown-peer'] = 'group:123456'; saveLegacy();
  assert.equal(auditLegacy(root).bindingErrors, 1);
  legacy.bound['old-peer'] = '../bad'; saveLegacy();
  assert.equal(auditLegacy(root).bindingErrors, 2);
});

test('relative independent voice directory resolves from bridge root', async t => {
  const { root, cfg, put, saveConfig } = fixture(t);
  cfg.bigfatfish.voiceToolDir = '../voice-tool'; saveConfig();
  put('integrations/voice-tool/voice-gui.mjs');
  assert.equal(check(await checkReadiness(root, { env: {} }), 'voice.installed').status, 'pending');
  put('integrations/voice-tool/voice-cli.mjs');
  assert.equal(check(await checkReadiness(root, { env: {} }), 'voice.installed').status, 'pass');
});

test('local probe rejects remote hosts, userinfo, query credentials and wrong protocols', async () => {
  for (const value of ['https://example.com', 'http://127.0.0.1.example.com', 'http://user:secret@localhost', 'http://127.0.0.1/?token=secret', 'file:///secret', 'http://0.0.0.0:3105']) assert.equal(localEndpoint(value), null);
  for (const value of ['http://127.0.0.1:3105', 'http://localhost:3105', 'http://[::1]:3105']) assert.ok(localEndpoint(value));
  let calls = 0;
  assert.equal((await probeJson('http://example.com', 'secret', { fetchImpl: () => calls++ })).kind, 'blocked');
  assert.equal(calls, 0);
});

test('probe never follows redirects or includes raw errors and oversized bodies', async () => {
  let options;
  const redirect = await probeJson('http://127.0.0.1:3105/status', 'secret', { fetchImpl: async (_url, init) => { options = init; return new Response('', { status: 302, headers: { location: 'https://example.com/?secret' } }); } });
  assert.equal(options.redirect, 'manual'); assert.equal(redirect.status, 302);
  const error = await probeJson('http://127.0.0.1:3105/status', 'secret', { fetchImpl: async () => { throw new Error('secret/path'); } });
  assert.deepEqual(error, { kind: 'unavailable' });
  const large = await probeJson('http://127.0.0.1:3105/status', 'secret', { fetchImpl: async () => new Response(' '.repeat(1024 * 1024 + 1)) });
  assert.equal(large.kind, 'invalid');
});

test('open state endpoint fails auth check and does not receive a token', async t => {
  const { root } = fixture(t); const calls = [];
  const report = await checkReadiness(root, { online: true, env: {}, probe: async (url, token) => { calls.push({ url, token }); return { kind: 'ok', data: { ok: true, leaked: 'private-secret' } }; } });
  assert.equal(check(report, 'manager.authBoundary').status, 'fail');
  assert.equal(check(report, 'bridge.authBoundary').status, 'fail');
  assert.ok(calls.every(call => call.token === undefined));
  assert.equal(JSON.stringify(report).includes('private-secret'), false);
});

test('online checks distinguish listening services from a verified logged-in QQ', async t => {
  const { root } = fixture(t);
  const probe = async (url, token) => {
    if (!token) return { kind: 'http', status: 401 };
    if (url.pathname === '/api/manager/status') return { kind: 'ok', data: { ok: true, services: { dsh: { running: true }, bridge: { running: true } } } };
    if (url.pathname === '/api/status') return { kind: 'ok', data: { dshReady: true, activity: 'private-message' } };
    return { kind: 'ok', data: { ok: true, settings: {}, sessions: [], gatewayQQ: '', consoleToken: 'private-secret' } };
  };
  const report = await checkReadiness(root, { online: true, probe, env: {} });
  assert.equal(check(report, 'dsh.listening').status, 'pass');
  assert.equal(check(report, 'qq.login').status, 'pending');
  assert.equal(check(report, 'dsh.connected').status, 'pass');
  assert.equal(report.qqAcceptanceComplete, false);
  assert.equal(JSON.stringify(report).includes('private-'), false);
});

test('a different logged-in QQ fails even when service status is healthy', async t => {
  const { root } = fixture(t);
  const report = await checkReadiness(root, { online: true, env: {}, probe: async (_url, token) => token
    ? { kind: 'ok', data: { ok: true, settings: {}, sessions: [], gatewayQQ: '999999999' } }
    : { kind: 'http', status: 403 } });
  assert.equal(check(report, 'qq.login').status, 'fail');
});

test('live proactive mode is a warning and stopped services stay pending', async t => {
  const { root, put } = fixture(t);
  put('integrations/qq-bridge/state/bigfatfish-settings.json', { coldStart: { dryRun: false } });
  const report = await checkReadiness(root, { online: true, env: {}, probe: async () => ({ kind: 'unavailable' }) });
  assert.equal(check(report, 'behavior.dryRun').status, 'warn');
  assert.equal(check(report, 'manager.authBoundary').status, 'pending');
  assert.equal(report.summary.fail, 0);
});
