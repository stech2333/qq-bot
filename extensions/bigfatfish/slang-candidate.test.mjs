import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const KEY = 'group:123456', WORD = '月亮馒头';
async function fixture(t) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_port, _host, ready) { ready(); }, on() {} };
  const h = await bridgeHarness({ config: { allow: { groups: ['123456', '123457'], private: [] }, consolePort: 3106,
    slang: { enabled: true, autoResearch: false, extractMinMessages: 1 }, bigfatfish: { expectedQQ: '123456789' } },
    globals: { http: { createServer(cb) { handler = cb; return server; } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789'); h.startConsoleServer();
  const call = async (url, body) => {
    const req = Readable.from([JSON.stringify(body)]); Object.assign(req, { url, method: 'POST', headers: {
      host: '127.0.0.1:3106', 'x-console-token': 'fixture-console-token', 'content-type': 'application/json' } });
    let data; await handler(req, { writeHead() {}, end(text) { data = JSON.parse(text); } }); return data;
  };
  const feed = i => h.appendSocialV2Message(KEY, '群友', `${WORD}第${i}种用法`, `${WORD}第${i}种用法`, false, false, String(i), [], '111111');
  const entries = () => { const file = path.join(h.temp, 'state/slang.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : []; };
  return { h, call, feed, entries };
}

test('native AI submissions cannot create candidates until real message threshold, repeated calls do not count', async t => {
  const { h, call, feed, entries } = await fixture(t);
  feed(1); feed(2);
  for (let i = 0; i < 2; i++) {
    const result = await call('/api/socialV2/slang/submit', { key: KEY, content: WORD, context: 'AI声称出现100次' });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.status, 'pending'); assert.equal(result.messages, 2); assert.equal(result.required, 3);
  }
  assert.equal(entries().length, 0);
  assert.equal((await call('/api/socialV2/slang/submit', { key: KEY, content: WORD })).ok, false, 'existing submission rate limit still applies');
  feed(3); const other = await call('/api/socialV2/slang/submit', { key: 'group:123457', content: WORD });
  assert.equal(other.status, 'pending'); assert.equal(other.messages, 0, 'A group evidence cannot admit B group slang');
  for (let i = 1; i <= 3; i++) h.appendSocialV2Message('group:123457', '群友', WORD + i, WORD + i, false, false, String(i), [], '222222');
  const result = await call('/api/socialV2/slang/submit', { key: 'group:123457', content: WORD });
  assert.equal(result.entry?.status, 'candidate', JSON.stringify(result)); assert.equal(entries()[0].scope, 'group:123457'); assert.equal(entries().length, 1);
});

test('native extraction enforces the same threshold before creating a candidate', async t => {
  const { h, feed, entries } = await fixture(t); h.setReady(true);
  h.api.sessions.prompt = async ({ sessionId }) => {
    setImmediate(() => h.completeSlangTurn(sessionId, JSON.stringify([{ content: WORD, source_id: '1' }])));
    return { result: { ok: true, value: {} } };
  };
  const extract = async () => {
    h.slangWindows.set(KEY, [{ sender: '群友', text: WORD, time: Date.now() }]);
    await h.runSlangExtraction(KEY);
  };
  feed(1); feed(2); await extract(); assert.equal(entries().length, 0);
  feed(3); await extract(); assert.equal(entries()[0].content, WORD); assert.equal(entries()[0].status, 'candidate');
});

test('management API changes the entry threshold without changing formal confirmation rules', async t => {
  const { call, feed, entries } = await fixture(t);
  assert.equal((await call('/api/bigfatfish/settings', { slangPolicy: { candidateMinMessages: 4 } })).ok, true);
  feed(1); feed(2); feed(3);
  const pending = await call('/api/socialV2/slang/submit', { key: KEY, content: WORD });
  assert.equal(pending.status, 'pending'); assert.equal(pending.required, 4);
  feed(4); await call('/api/socialV2/slang/submit', { key: KEY, content: WORD });
  assert.equal(entries()[0].status, 'candidate');
});
