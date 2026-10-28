import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const PRIVATE = 'private:987654321', GROUP = 'group:123456';
const ended = { reason: { kind: 'completed' }, text: 'fixture draft that must never be forwarded automatically' };
async function fixture(t) {
  const h = await bridgeHarness({ config: { ownerQQ: '987654321', bigfatfish: { expectedQQ: '123456789' },
    allow: { groups: ['123456'], private: ['987654321'] } },
    files: { 'state/bigfatfish-settings.json': { participation: { requireDirected: true } } } });
  t.after(() => h.close()); h.setSelfIdentity('肥鱼', '123456789');
  return h;
}
function incoming(h, key = PRIVATE, directed = true, id = '101') {
  h.appendSocialV2Message(key, '真人', '肥鱼在吗', '肥鱼在吗', false, false, id, [], '987654321');
  const st = h.getSocialV2State(key), m = st.unread.at(-1);
  m.addressedToBot = directed; m.recipientPolicy = 'directed'; st.lastWakeReason = key === PRIVATE ? 'private' : 'addressed';
  return st;
}
async function settle() { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 10)); }

test('every wake, including first private and named wakes, states the QQ tool-only sending protocol', async t => {
  const h = await fixture(t); incoming(h);
  for (const reason of ['private', 'addressed', 'bootstrap', 'replyDeliveryRecovery']) {
    const prompt = h.buildWakePromptV2(PRIVATE, reason);
    assert.match(prompt, /普通文本输出不会自动发送到 QQ/);
    assert.match(prompt, /qq_send_message 或 qq_send_burst/);
  }
  assert.match(h.buildWakePromptV2(PRIVATE, 'replyDeliveryRecovery'), /发送遗漏纠正/);
});

test('a live completed draft with pending private input queues guarded correction, bounded per unread watermark', async t => {
  const h = await fixture(t); incoming(h);
  for (let i = 0; i < 3; i++) {
    assert.equal(h.queueReplyDeliveryRecoveryV2(PRIVATE, { live: true, ended }), true);
    await settle();
  }
  assert.equal(h.calls.prompts.length, 2, 'no unlimited correction loop');
  const content = JSON.stringify(h.calls.prompts[0].content);
  assert.match(content, /发送遗漏纠正/); assert.match(content, /本次消息快照/);
  assert.ok(!content.includes(ended.text), 'raw generated output is not reused as trusted instructions');
  assert.equal(h.calls.sent.length, 0); assert.equal(h.calls.http.filter(c => /\/send_/.test(c.url)).length, 0);
  incoming(h, PRIVATE, true, '102');
  assert.equal(h.queueReplyDeliveryRecoveryV2(PRIVATE, { live: true, ended }), true); await settle();
  assert.equal(h.calls.prompts.length, 3, 'a new human message has its own bounded recovery');
});

test('send attempts, replayed events, error turns and empty text do not trigger a blind retry', async t => {
  const h = await fixture(t); incoming(h);
  for (const input of [{ live: false, ended }, { live: true, attempted: true, ended },
    { live: true, ended: { ...ended, reason: { kind: 'error' } } }, { live: true, ended: { ...ended, text: '' } }]) {
    assert.equal(h.queueReplyDeliveryRecoveryV2(PRIVATE, input), false);
  }
  await settle(); assert.equal(h.calls.prompts.length, 0);
});

test('successful guarded sending consumes the pending reply and prevents another correction', async t => {
  const h = await fixture(t); incoming(h);
  assert.equal(h.queueReplyDeliveryRecoveryV2(PRIVATE, { live: true, ended }), true); await settle();
  assert.equal(h.calls.prompts.length, 1);
  await h.sendMessagesV2(PRIVATE, ['隔离夹具回复'], [], null);
  assert.equal(h.calls.http.filter(c => /\/send_private_msg$/.test(c.url)).length, 1);
  assert.equal(h.queueReplyDeliveryRecoveryV2(PRIVATE, { live: true, ended }), false);
  await settle(); assert.equal(h.calls.prompts.length, 1);
});

test('only still-pending confirmed recipients qualify; read, answered, old and proactive input is skipped', async t => {
  const h = await fixture(t); const st = incoming(h, GROUP, false);
  assert.equal(h.queueReplyDeliveryRecoveryV2(GROUP, { live: true, ended }), false);
  st.unread[0].addressedToBot = true; assert.ok(h.pendingReplyDeliveryV2(GROUP));
  st.lastReadThroughSeq = st.lastUnreadSeq; assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  st.lastReadThroughSeq = 0; st.lastAiReplyAt = Date.now() + 1; assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  st.lastAiReplyAt = 0; st.unread[0].time = Date.now() - 16 * 60000; assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  st.unread[0].time = Date.now(); st.lastWakeReason = 'contextInitiative'; assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  st.lastWakeReason = 'addressed'; h.socialV2.paused = true; assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  h.socialV2.paused = false; h.cfg.socialV2.tools.sendGroup = false; assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  h.cfg.socialV2.tools.sendGroup = true; h.setSelfIdentity('未核验', '222222'); assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
  h.setSelfIdentity('肥鱼', '123456789'); h.cfg.deny.groups.push('123456'); assert.equal(h.pendingReplyDeliveryV2(GROUP), null);
});

test('queued correction rechecks the token and unread state after asynchronous session setup', async t => {
  const h = await fixture(t); const st = incoming(h);
  let release, started; const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; }); const create = h.api.sessions.create;
  h.api.sessions.create = async params => { started(); await gate; return create(params); };
  assert.equal(h.queueReplyDeliveryRecoveryV2(PRIVATE, { live: true, ended }), true);
  await ready; st.lastReadThroughSeq = st.lastUnreadSeq; release(); await settle();
  assert.equal(h.calls.prompts.length, 0, 'already handled input must not consume another model request');
  const source = fs.readFileSync(new URL('../../integrations/qq-bridge/src/bridge.js', import.meta.url), 'utf8');
  assert.match(source, /live: replyTurnLive, attempted: sendToolAttempted \|\| sendToolSucceeded, ended/);
  assert.match(source, /if \(isSendToolName\(toolName\)\) sendToolAttemptedSessions\.add/);
});
