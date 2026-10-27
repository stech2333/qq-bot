import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

async function fixture(t) {
  let handler;
  const timers = [], server = { address: () => ({ port: 3106 }), listen(_p, _h, cb) { cb(); }, on() {} };
  const h = await bridgeHarness({ config: { consolePort: 3106, consoleToken: 'boundary-fixture', ownerQQ: '987654321',
    allow: { groups: ['123456'], private: [] }, bigfatfish: { expectedQQ: '123456789' },
    socialV2: { proactive: { enabled: true }, sticker: { enabled: false } } },
    files: { 'state/bigfatfish-settings.json': { coldStart: { dryRun: false, quietStart: 0, quietEnd: 0 }, interestPolicy: { enabled: false } } },
    globals: { http: { createServer(cb) { handler = cb; return server; } },
      setTimeout(fn, ms) { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; },
      clearTimeout(timer) { if (timer) timer.cleared = true; } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789'); h.startConsoleServer();
  const configure = async body => {
    const req = Readable.from([JSON.stringify(body)]);
    Object.assign(req, { url: '/api/socialV2/config', method: 'POST', headers: { host: '127.0.0.1:3106', 'x-console-token': 'boundary-fixture', 'content-type': 'application/json' } });
    let result; await handler(req, { writeHead() {}, end(body) { result = JSON.parse(body); } });
    assert.equal(result.ok, true, result.error);
  };
  return { h, configure, timers };
}

test('native proactive switch cancels scheduled checks and re-enabling immediately schedules them again', async t => {
  const { h, configure } = await fixture(t), key = 'group:123456', st = h.getSocialV2State(key);
  st.lastIncomingAt = Date.now() - 3600000;
  h.scheduleProactiveCheckV2(key); const timer = st.proactiveTimer; assert.ok(timer);
  await configure({ proactive: { enabled: false } });
  assert.equal(st.proactiveTimer, null); assert.equal(timer.cleared, true); assert.equal(st.bigfatfish.nextCheckAt, 0);
  // A callback already queued by the event loop must obey the new switch too.
  await h.sendWakePromptV2(key, 'proactiveCheck'); assert.equal(h.calls.prompts.length, 0);
  await configure({ proactive: { enabled: true } }); assert.ok(st.proactiveTimer);
  await configure({ enabled: false }); assert.equal(st.proactiveTimer, null);
});

test('real bridge prompt preserves an unread platform mention across a mixed batch', async t => {
  const { h } = await fixture(t), key = 'group:123456';
  const event = { self_id: '123456789', user_id: '111111', group_id: '123456', message_id: 'at-detail', sender: { nickname: '群友' }, message: [{ type: 'at', data: { qq: '123456789' } }, { type: 'text', data: { text: '请详细解释训练过程' } }] };
  await h.handleIncoming('group', '123456', event, h.cfg);
  await h.handleIncoming('group', '123456', { ...event, message_id: 'ambient', user_id: '222222', message: [{ type: 'text', data: { text: '我去吃饭了' } }] }, h.cfg);
  assert.match(h.buildWakePromptV2(key, 'addressed'), /当前模式 ASSISTANT/);
  h.acknowledgeMessagesV2(h.getSocialV2State(key), 1);
  assert.match(h.buildWakePromptV2(key, 'ambient'), /当前模式 CASUAL/);
});

for (const control of ['pause', 'disable']) {
  test('queued outgoing text observes ' + control + ' immediately before reaching QQ', async t => {
    const { h } = await fixture(t), key = 'group:123456';
    h.getSocialV2State(key);
    const pending = h.sendMessagesV2(key, ['尚未到达 QQ 的回复'], []);
    if (control === 'pause') h.socialV2.paused = true;
    else h.cfg.socialV2.enabled = false;
    await assert.rejects(pending, /暂停|关闭/);
    assert.equal(h.calls.sent.length, 0);
  });
}
