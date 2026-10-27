import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish, normalizeState, validateSettings } from './runtime.mjs';
import { initiativeSettings } from './context-initiative.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
const KEY = 'group:123456', BOT = '123456789';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-initiative-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = new BigFatFish(root, { allow: { groups: ['123456'], private: [] }, bigfatfish: { expectedQQ: BOT }, socialV2: { enabled: true, proactive: { enabled: true } } });
  app.settings = validateSettings({ ...app.settings, contextInitiative: { enabled: true, probability: 0.18 }, coldStart: { ...app.settings.coldStart, quietStart: 0, quietEnd: 0 } });
  const now = Date.now(), messages = [1, 2].map(seq => ({ seq, messageId: String(seq), userId: '111111', plain: seq === 1 ? '刚看完一部电影' : '里面的配乐挺有意思', time: now - (3 - seq) * 1000, isSelf: false }));
  const st = { recentMessages: [...messages], unread: [...messages], lastIncomingAt: now - 1000, lastUnreadSeq: 2, lastReadThroughSeq: 0 };
  app.bind(KEY, st); return { app, st, now, next() { const m = { ...messages[1], messageId: String(++st.lastUnreadSeq), seq: st.lastUnreadSeq, time: Date.now() }; st.unread.push(m); st.recentMessages.push(m); return m; } };
}
test('18% is configurable and invalid settings are rejected', () => {
  assert.equal(initiativeSettings().probability, 0.18);
  for (const value of [-0.1, 1.1, NaN, '0.18']) assert.throws(() => initiativeSettings({ probability: value }));
  assert.throws(() => initiativeSettings({ cooldownMinutes: 0 }));
});
test('one draw per batch, including misses and restarts, never mutates pending or processed messages', t => {
  const { app, st, now } = fixture(t), before = JSON.stringify([st.unread, st.lastReadThroughSeq]); let draws = 0;
  assert.equal(app.contextInitiative.begin(KEY, st, now, () => { draws++; return 0.18; }), false);
  assert.equal(app.contextInitiative.begin(KEY, st, now, () => { draws++; return 0; }), false);
  st.bigfatfish = normalizeState(st.bigfatfish);
  assert.equal(app.contextInitiative.begin(KEY, st, now + 1, () => { draws++; return 0; }), false);
  assert.equal(draws, 1); assert.equal(JSON.stringify([st.unread, st.lastReadThroughSeq]), before);
});
test('a selected opportunity reserves shared budget, uses context and ignores cold-start dry-run/minimum idle', t => {
  const { app, st, now } = fixture(t);
  assert.equal(app.settings.coldStart.dryRun, true);
  assert.equal(app.contextInitiative.begin(KEY, st, now, () => 0.17999), true);
  assert.equal(app.ledger.attempts.length, 1); assert.equal(app.ledger.leases[KEY].kind, 'contextInitiative');
  assert.equal(app.contextInitiative.gate(KEY, st, now + 1, true), '');
  assert.match(app.contextInitiative.hint(st), /最近真人消息/); assert.match(app.contextInitiative.hint(st), /不.*重复回答/);
});
test('direct requests anywhere in the pending batch win over random sharing', t => {
  const { app, st, now } = fixture(t);
  st.unread[0].replyStyle = 'formal'; assert.equal(app.contextInitiative.available(KEY, st, now), false);
  delete st.unread[0].replyStyle; st.unread[0].addressedToBot = true; assert.equal(app.contextInitiative.available(KEY, st, now), false);
  delete st.unread[0].addressedToBot; st.bigfatfish.participation.lastDecision = { direct: false, involved: false, addressedElsewhere: true };
  assert.equal(app.contextInitiative.available(KEY, st, now), false);
});
test('private chats, disabled/denied groups, directed-only mode, quiet hours, caps and stale context prevent draws', t => {
  const f = fixture(t), { app, st, now } = f;
  assert.equal(app.contextInitiative.available('private:123456', st, now), false);
  app.config.deny = { groups: ['123456'] }; assert.equal(app.contextInitiative.available(KEY, st, now), false); app.config.deny = {};
  app.settings.participation.requireDirected = true; assert.equal(app.contextInitiative.available(KEY, st, now), false); app.settings.participation.requireDirected = false;
  app.settings.schedule.hourlyCap = 0; assert.equal(app.contextInitiative.begin(KEY, st, now, () => { throw Error('must not draw'); }), false); app.settings.schedule.hourlyCap = 1;
  app.settings.coldStart.quietStart = 0; app.settings.coldStart.quietEnd = 23; assert.equal(app.contextInitiative.available(KEY, st, Date.UTC(2026, 9, 25, 4)), false);
  app.settings.coldStart.quietEnd = 0; assert.equal(app.contextInitiative.available(KEY, st, now + 11 * 60000), false);
});
test('new input or consumed input invalidates an unsent opportunity and normal wake cancels its reservation', t => {
  const f = fixture(t), { app, st, now } = f;
  app.contextInitiative.begin(KEY, st, now, () => 0); f.next();
  assert.match(app.contextInitiative.gate(KEY, st, now + 1, true), /上下文已变化/);
  app.beginWake(KEY, st, 'addressed'); assert.equal(st.bigfatfish.contextInitiative.round, null); assert.equal(app.ledger.leases[KEY], undefined);
  app.contextInitiative.cancel(KEY, st); st.unread = []; assert.equal(app.contextInitiative.available(KEY, st, now), false);
});
test('one successful burst consumes shared quota once and does not increment cold-start counts', t => {
  const { app, st, now } = fixture(t); app.contextInitiative.begin(KEY, st, now, () => 0);
  app.sent(KEY, '配乐还挺抓人的'); app.sent(KEY, '尤其是结尾那段');
  assert.equal(app.ledger.events.length, 1); assert.equal(st.bigfatfish.coldCount, 0); assert.equal(app.ledger.leases[KEY], undefined);
  st.unread = []; st.lastReadThroughSeq = st.lastUnreadSeq;
  assert.equal(app.contextInitiative.gate(KEY, st, now + 1, true), '');
  assert.equal(app.contextInitiative.gate(KEY, st, now + 121000, true), '随机主动机会已过期');
});
test('cancelled, expired and offline queued initiative ids cannot be reused by a later context round', async t => {
  const h = await nativeFixture(t); const st = h.getSocialV2State(KEY);
  h.bff.contextInitiative.begin(KEY, st, Date.now(), () => 0); const id = st.bigfatfish.contextInitiative.round.id;
  h.bff.beginWake(KEY, st, 'addressed');
  const result = await h.deliverPrompt(KEY, 'old proactive content', { wakeReason: 'contextInitiative', initiativeId: id });
  assert.equal(result.ok, false); assert.equal(h.calls.prompts.length, 0);
});
async function nativeFixture(t) {
  const h = await bridgeHarness({ config: { ownerQQ: '987654321', allow: { groups: ['123456'], private: [] }, bigfatfish: { expectedQQ: BOT }, socialV2: { enabled: true, proactive: { enabled: true } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', BOT);
  h.bff.settings.contextInitiative = initiativeSettings({ enabled: true, probability: 1 });
  h.bff.settings.coldStart.quietStart = h.bff.settings.coldStart.quietEnd = 0;
  Object.assign(h.bff.settings.participation, { idleProbability: 0, engagedProbability: 0, interestProbability: 0, floorProbability: 0 });
  h.appendSocialV2Message(KEY, '群友', '刚看完一部电影', '刚看完一部电影', false, false, 'one', [], '111111');
  h.appendSocialV2Message(KEY, '群友', '里面的配乐挺有意思', '里面的配乐挺有意思', false, false, 'two', [], '111111');
  const st = h.getSocialV2State(KEY); st.bootstrapSent = true; st.wakeConfig.triggers = {};
  return h;
}
test('native scheduling combines a speculative opportunity into one model prompt and never sends QQ from the scheduler', async t => {
  const h = await nativeFixture(t), st = h.getSocialV2State(KEY);
  const reason = h.evaluateWakeTriggerV2(KEY, st, { user_id: '111111', message_id: 'two' }, 'group', '里面的配乐挺有意思', '里面的配乐挺有意思', false);
  assert.equal(reason, 'contextInitiative');
  await h.sendWakePromptV2(KEY, reason); assert.equal(h.calls.prompts.length, 1);
  assert.match(h.calls.prompts[0].content[0].text, /本轮上下文随机主动/); assert.equal(h.calls.sent.length, 0);
  const pending = (st.pendingWakeReasons || []).length; await h.sendWakePromptV2(KEY, reason);
  h.scheduleWakeV2(KEY, reason);
  assert.equal((st.pendingWakeReasons || []).length, pending); assert.equal(h.calls.prompts.length, 1);
});
test('native send guard blocks a stale proactive message when a new direct question arrives without clearing either input', async t => {
  const h = await nativeFixture(t), st = h.getSocialV2State(KEY);
  h.bff.contextInitiative.begin(KEY, st, Date.now(), () => 0);
  h.appendSocialV2Message(KEY, '群友', '肥鱼解释一下', '肥鱼解释一下', false, false, 'direct-new', [], '222222');
  st.unread.at(-1).replyStyle = 'formal';
  const unread = st.unread.length, through = st.lastReadThroughSeq;
  await assert.rejects(async () => h.sendMessagesV2(KEY, ['旧主动内容'], []), /随机主动|主动机会/);
  assert.equal(st.unread.length, unread); assert.equal(st.lastReadThroughSeq, through); assert.equal(h.calls.sent.length, 0);
});
test('native direct wake wins a shared timer and offline or paused opportunities never create a turn', async t => {
  const h = await nativeFixture(t), st = h.getSocialV2State(KEY);
  h.scheduleWakeV2(KEY, 'contextInitiative'); h.scheduleWakeV2(KEY, 'addressed');
  assert.equal(st.pendingWakeReason, 'addressed');
  h.setReady(false); await h.sendWakePromptV2(KEY, 'contextInitiative'); assert.equal(h.calls.prompts.length, 0);
  h.setReady(true); h.socialV2.paused = true; await h.sendWakePromptV2(KEY, 'contextInitiative'); assert.equal(h.calls.prompts.length, 0);
});
test('post-send bookkeeping failures never report a successful QQ delivery as failed or authorize a retry', t => {
  const { app, st, now } = fixture(t); app.contextInitiative.begin(KEY, st, now, () => 0);
  app.contextInitiative.persistLedger = () => { throw Error('fixture disk full'); };
  assert.doesNotThrow(() => app.sent(KEY, '已经成功发送的消息'));
  assert.equal(st.bigfatfish.contextInitiative.round.sent, true); assert.equal(app.ledger.events.length, 1);
  assert.match(app.contextInitiative.error, /记账失败/); assert.equal(app.contextInitiative.available(KEY, st, now + 600000), false);
});
test('an old initiative cannot mark a newly arrived question read, even through the compatibility mark-all path', async t => {
  const h = await nativeFixture(t), st = h.getSocialV2State(KEY);
  h.bff.contextInitiative.begin(KEY, st, Date.now(), () => 0);
  const originalThrough = st.lastUnreadSeq;
  h.appendSocialV2Message(KEY, '群友', '肥鱼解释一下', '肥鱼解释一下', false, false, 'must-answer-new', [], '222222');
  st.unread.at(-1).replyStyle = 'formal';
  h.acknowledgeMessagesV2(st, null);
  assert.equal(st.lastReadThroughSeq, originalThrough); assert.deepEqual(Array.from(st.unread, m => m.messageId), ['must-answer-new']);
  h.acknowledgeMessagesV2(st, st.lastUnreadSeq);
  assert.deepEqual(Array.from(st.unread, m => m.messageId), ['must-answer-new']);
  h.bff.beginWake(KEY, st, 'addressed');
  h.acknowledgeMessagesV2(st, st.lastUnreadSeq); assert.equal(st.unread.length, 0);
});
