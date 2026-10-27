import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const KEY = 'group:123456';
async function fixture(t, { failAfter = Infinity } = {}) {
  let handler, sends = 0;
  const server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ config: { consolePort: 3106, consoleToken: 'duplicate-fixture', ownerQQ: '987654321',
    allow: { groups: ['123456'], private: [] }, bigfatfish: { expectedQQ: '123456789' },
    socialV2: { proactive: { enabled: false }, sticker: { enabled: false } } },
    globals: { http: { createServer(cb) { handler = cb; return server; } },
      setTimeout(fn, ms) { return { fn, ms, unref() {} }; }, clearTimeout() {},
      fetch: async () => { const success = ++sends <= failAfter; return { ok: success, status: success ? 200 : 500,
        json: async () => ({ status: success ? 'ok' : 'failed', retcode: success ? 0 : 100, wording: success ? '' : 'fixture gateway failure', data: { message_id: sends } }) }; } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789'); h.startConsoleServer();
  const st = h.getSocialV2State(KEY);
  const append = (id, text = '肥鱼，解释这个问题') => h.appendSocialV2Message(KEY, '群友', text, text, false, false, id, [], '111111');
  const read = async (agent = true) => {
    const req = Readable.from([]); Object.assign(req, { url: '/api/socialV2/unread?key=' + encodeURIComponent(KEY), method: 'GET',
      headers: { host: '127.0.0.1:3106', 'x-console-token': 'duplicate-fixture', ...(agent ? { 'x-agent-token': st.agentToken } : {}) } });
    let result; await handler(req, { writeHead() {}, end(body) { result = JSON.parse(body); } }); assert.equal(result.ok, true, result.error); return result;
  };
  return { h, st, append, read };
}

test('successful answer acknowledges only messages displayed before send, preserving arrivals during delivery', async t => {
  const { h, st, append, read } = await fixture(t); append('old'); await read();
  const pending = h.sendMessagesV2(KEY, ['旧问题的答复'], []); append('new', '新的问题'); await pending;
  assert.equal(st.lastReadThroughSeq, 1); assert.deepEqual(Array.from(st.unread, m => m.messageId), ['new']);
});

test('failed sends and console-only browsing never acknowledge unseen or unanswered input', async t => {
  const failing = await fixture(t, { failAfter: 0 }); failing.append('failed'); await failing.read();
  await assert.rejects(failing.h.sendMessagesV2(KEY, ['未送达的答复'], []), /failure/);
  assert.equal(failing.st.unread.length, 1); assert.equal(failing.st.lastReadThroughSeq, 0);
  const browsing = await fixture(t); browsing.append('not-seen-by-agent'); await browsing.read(false);
  await browsing.h.sendMessagesV2(KEY, ['普通发言'], []); assert.equal(browsing.st.unread.length, 1);
});

test('partial burst success checkpoints its original visibility without clearing later input', async t => {
  const { h, st, append, read } = await fixture(t, { failAfter: 1 }); append('old'); await read();
  const pending = h.sendMessagesV2(KEY, ['已经送达', '尚未送达'], []); append('new');
  await assert.rejects(pending, error => error.sent.length === 1);
  assert.equal(st.lastReadThroughSeq, 1); assert.deepEqual(Array.from(st.unread, m => m.messageId), ['new']);
});

test('an explicitly quoted answer does not acknowledge other displayed questions', async t => {
  const { h, st, append, read } = await fixture(t); append('101'); append('102'); await read();
  await h.sendMessagesV2(KEY, ['只回答第二个问题'], [], '102');
  assert.deepEqual(Array.from(st.unread, m => m.messageId), ['101']); assert.equal(st.lastReadThroughSeq, 0);
});

test('newer unread input cannot resurrect an already handled addressed wake', async t => {
  const { h, st, append } = await fixture(t); append('old'); append('new'); h.acknowledgeMessagesV2(st, 1);
  st.pendingWakeReasons = [{ reason: 'addressed', seq: 1 }];
  assert.equal(h.replayPendingWakeReasonsV2(KEY).action, 'skipped'); assert.equal(st.pendingWakeTimer, null);
});

test('stale queued wakes are drained so a genuinely pending new question is not stranded', async t => {
  const { h, st, append } = await fixture(t); append('old'); append('new'); h.acknowledgeMessagesV2(st, 1);
  st.pendingWakeReasons = [{ reason: 'addressed', seq: 1 }, { reason: 'question', seq: 1 }, { reason: 'interest', seq: 2 }];
  const result = h.replayPendingWakeReasonsV2(KEY);
  assert.equal(result.action, 'replayed'); assert.equal(result.reason, 'interest'); assert.equal(st.pendingWakeReasons.length, 0);
});

test('reply checks with no unread input do not repeat a stale mandatory-answer instruction', async t => {
  const { h, st, append } = await fixture(t); append('old');
  h.evaluateWakeTriggerV2(KEY, st, { user_id: '111111', message_id: 'old' }, 'group', '肥鱼，你好', '肥鱼，你好', false);
  h.acknowledgeMessagesV2(st, 1);
  const prompt = h.buildWakePromptV2(KEY, 'replyCheck');
  assert.doesNotMatch(prompt, /必须先回应这条真人消息/); assert.match(prompt, /已回应.*不重复/);
});
