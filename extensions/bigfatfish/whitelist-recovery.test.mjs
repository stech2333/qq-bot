import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import * as roleCard from '../../integrations/qq-bridge/src/role-card.js';

const TOKEN = 'fixture-whitelist-token';
async function fixture(t) {
  let handler;
  const server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ config: { consolePort: 3106, consoleToken: TOKEN, allowAllWhenEmpty: false,
    ownerQQ: '111111', allow: { groups: [], private: [] }, bigfatfish: { expectedQQ: '123456789' },
    socialV2: { sticker: { enabled: false }, proactive: { enabled: false } }
  }, globals: { ...roleCard, http: { createServer(cb) { handler = cb; return server; } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789'); h.startConsoleServer();
  const allow = async (groups = [], peer = []) => {
    const req = Readable.from([JSON.stringify({ allow: { groups, private: peer } })]);
    Object.assign(req, { url: '/api/whitelist', method: 'POST', headers: { host: '127.0.0.1:3106', 'x-console-token': TOKEN, 'content-type': 'application/json' } });
    let result; const res = { writeHead() {}, end(body) { result = JSON.parse(body); } };
    await handler(req, res); assert.equal(result.ok, true, result.error);
  };
  return { h, allow };
}
async function waitForPrompt(h, key) {
  const end = Date.now() + 4000;
  while (!h.calls.prompts.length && Date.now() < end) await new Promise(r => setTimeout(r, 30));
  assert.equal(h.calls.prompts.length, 1, 'expected one model prompt for ' + key);
}

for (const kind of ['private', 'group']) {
  test('adding a ' + kind + ' whitelist entry takes effect without restart and permits an addressed reply', async t => {
    const { h, allow } = await fixture(t), id = kind === 'group' ? '123456' : '987654321', key = kind + ':' + id;
    const event = message_id => ({ message_id, user_id: '987654321', self_id: '123456789',
      message: [{ type: 'at', data: { qq: '123456789' } }, { type: 'text', data: { text: '你好，回答一下' } }], sender: { nickname: '测试群友' } });
    await h.handleIncoming(kind, Number(id), event('before'), h.cfg);
    assert.equal(h.calls.prompts.length, 0);
    await allow(kind === 'group' ? [id] : [], kind === 'private' ? [id] : []);
    await h.handleIncoming(kind, Number(id), event('after'), h.cfg);
    await waitForPrompt(h, key);
    assert.equal(h.getSocialV2State(key).unread.length, 1);
    await h.sendMessagesV2(key, ['你好，我在。'], []);
    assert.ok(h.calls.http.some(c => c.url.endsWith('/send_' + kind + '_msg')));
  });

  test('an interrupted first ' + kind + ' wake is recovered once without replaying an already answered message', async t => {
    const { h, allow } = await fixture(t), key = kind === 'group' ? 'group:123456' : 'private:987654321';
    await allow(['123456'], ['987654321']);
    h.appendSocialV2Message(key, '测试群友', '你好', '你好', false, false, [], 'pending');
    const st = h.getSocialV2State(key), msg = st.unread.at(-1); st.bootstrapSent = false; st.lastAiReplyAt = msg.time - 10;
    assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), [key]);
    assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
    await waitForPrompt(h, key);
    h.retireSession(key); st.lastAiReplyAt = msg.time + 1;
    assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
    st.lastAiReplyAt = 0; st.lastReadThroughSeq = msg.seq;
    assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
  });
}

test('recovery respects removed or denied entries, pause, offline state and ordinary group participation decisions', async t => {
  const { h, allow } = await fixture(t), key = 'group:123456';
  h.appendSocialV2Message(key, '测试群友', '普通聊天', '普通聊天', false, false, [], 'pending');
  assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
  await allow(['123456']);
  const st = h.getSocialV2State(key); clearTimeout(st.pendingWakeTimer); st.pendingWakeTimer = null; st.bootstrapSent = true;
  assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
  st.bootstrapSent = false; h.socialV2.paused = true;
  assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
  h.socialV2.paused = false; h.setReady(false);
  assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
  h.setReady(true); h.cfg.deny = { groups: ['123456'], private: [] };
  assert.deepEqual(Array.from(h.recoverOrphanedWakesV2()), []);
});
