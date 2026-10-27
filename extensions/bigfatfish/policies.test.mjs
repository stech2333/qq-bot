import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BigFatFish, normalizeState, validateSettings } from './runtime.mjs';
import { interestScore, nextCheckTime, clockParts, keywordHit, recallFacts } from './policies.mjs';
import { PrivacyGuard } from './chat-security.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-policies-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const config = { bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321', allow: { groups: ['123456', '123457'], private: [] }, deny: { groups: [], private: [] } };
  const app = new BigFatFish(root, config), now = Date.now();
  app.settings = validateSettings({ interests: ['AI', 'DeepSeek'], interestWeights: { AI: 3, DeepSeek: 3 }, coldStart: { dryRun: false, quietStart: 0, quietEnd: 0 }, topicLearning: { enabled: false }, participation: { enabled: false } });
  const state = { lastIncomingAt: now - 60 * 60000, unread: [], recentMessages: [
    { messageId: '1', userId: '111111', plain: 'AI 和 DeepSeek 很有意思', time: now - 60 * 60000 },
    { messageId: '2', userId: '222222', plain: '我也在研究 AI', time: now - 60 * 60000 }
  ], pendingThoughts: [], activeTopics: [] };
  app.bind('group:123456', state);
  const hooks = { state: () => state, save() {}, format: st => app.formatMemory(st), agentTokenOk: () => true, allowed: () => true, memoryEnabled: () => true };
  const memory = async body => {
    let result; await app.handle({ method: 'POST', headers: { 'x-agent-token': 'valid' } }, new URL('http://localhost/api/socialV2/memory-append'), async () => ({ key: 'group:123456', ...body }), value => { result = value; }, hooks); return result;
  };
  return { app, state, now, root, memory };
}
test('interest matching respects English word boundaries, weights and recency', t => {
  const { app, state, now } = fixture(t);
  assert.equal(keywordHit('chair repair', 'AI'), false);
  const hot = interestScore(state, app.settings, now).score;
  const old = interestScore(state, app.settings, now + 12 * 3600000).score;
  assert.ok(hot > old);
  app.settings.interestWeights = { AI: 0, DeepSeek: 0 };
  assert.equal(interestScore(state, app.settings, now).parts.relevance, 0);
});
test('repetition is bounded and multiple real participants improve the score', t => {
  const { app, state, now } = fixture(t);
  const one = { recentMessages: [{ userId: '1', time: now, plain: 'AI '.repeat(1000) }] };
  const single = interestScore(one, app.settings, now);
  const duplicate = interestScore({ recentMessages: [...one.recentMessages, ...one.recentMessages] }, app.settings, now);
  assert.equal(single.parts.relevance, duplicate.parts.relevance);
  const group = interestScore(state, app.settings, now);
  assert.ok(group.parts.diversity > single.parts.diversity);
});
test('checks skip quiet hours and excluded weekdays in Shanghai time', t => {
  const { app, state } = fixture(t);
  app.settings.coldStart.quietStart = 23; app.settings.coldStart.quietEnd = 8;
  app.settings.schedule.weekdays = [1];
  const at = Date.parse('2026-10-23T14:58:00Z');
  const next = nextCheckTime(state, app.settings, at, () => 0);
  assert.equal(clockParts(next).weekday, 1); assert.equal(clockParts(next).hour, 8);
});
test('dry-run records eligibility without reserving quota or making a model attempt', t => {
  const { app, state } = fixture(t); app.settings.coldStart.dryRun = true;
  assert.equal(app.beginWake('group:123456', state, 'proactiveCheck'), false);
  assert.equal(app.ledger.attempts.length, 0); assert.deepEqual(app.ledger.leases, {});
  assert.match(state.bigfatfish.decisions.at(-1).reason, /演练/);
  assert.equal(state.bffColdRound, false, 'a skipped proactive round must not block later ordinary sends');
});

test('native proactive switches stop an eligible wake and an already generating proactive send', t => {
  const { app, state } = fixture(t), key = 'group:123456';
  assert.equal(app.beginWake(key, state, 'proactiveCheck'), true);
  app.config.socialV2 = { proactive: { enabled: false } };
  assert.match(app.sendGate(key, state), /主动.*关闭/);
  app.cancelAttempt(key);
  assert.equal(app.beginWake(key, state, 'proactiveCheck'), false);
  state.bigfatfish.lastAttemptAt = 0;
  assert.equal(app.beginWake(key, state, 'timeout'), true, 'explicit finite-sleep wake still works with opportunistic proactive checks disabled');
  assert.equal(app.sendGate(key, state), '');
  app.config.socialV2 = { enabled: false, proactive: { enabled: true } };
  assert.equal(app.beginWake(key, state, 'proactiveCheck'), false);
});

test('interest scoring cannot override a configured dynamic probability miss with a second guaranteed wake', t => {
  const { app, state } = fixture(t);
  app.settings.participation.enabled = true;
  const event = { self_id: '123456789', user_id: '111111', message: [] };
  const options = { kind: 'group', text: 'AI 和 DeepSeek', random: () => 1 };
  let draws = 0;
  const missed = app.chatDecision('group:123456', state, event, { ...options, random: () => { draws++; return 0.6; } });
  assert.equal(missed.selected, false); assert.equal(missed.probability, 0.6); assert.equal(draws, 1);
  const selected = app.chatDecision('group:123456', state, event, { ...options, random: () => 0.59 });
  assert.equal(selected.reason, 'interest'); assert.equal(selected.probability, 0.6);
  assert.equal(app.interestWake('group:123456', state), true, 'native scoring path remains available');
  assert.equal(app.interestWake('group:123456', state), false, 'native scoring path still respects cooldown');
});

test('interest scoring does not override an explicit conversation with another group member', t => {
  const { app, state } = fixture(t);
  app.settings.participation.enabled = true;
  const event = { self_id: '123456789', user_id: '111111', message: [{ type: 'at', data: { qq: '222222' } }] };
  const result = app.chatDecision('group:123456', state, event, { kind: 'group', text: 'AI 和 DeepSeek', random: () => 1 });
  assert.equal(result.selected, false); assert.equal(state.bigfatfish.lastInterestWakeAt, 0);
});
test('global reservations prevent two conversations spending the final slot', t => {
  const { app, state, now } = fixture(t); app.settings.schedule.globalDailyCap = 1;
  const other = structuredClone(state); other.bigfatfish = normalizeState(); app.bind('group:123457', other);
  assert.equal(app.beginWake('group:123456', state, 'proactiveCheck'), true);
  assert.match(app.proactiveDecision('group:123457', other, now).reason, /全局每日/);
  app.sent('group:123456', '你好'); app.sent('group:123456', '第二条');
  assert.equal(app.ledger.events.length, 1); assert.equal(state.bigfatfish.coldCount, 1);
  const reload = new BigFatFish(app.root, app.config); assert.equal(reload.ledger.events.length, 1);
});
test('no response, retries and inference budgets stop repeated paid wakeups', t => {
  const { app, state, now } = fixture(t);
  state.bigfatfish.awaitingReplyAt = now - 31 * 60000; state.bigfatfish.unanswered = 1;
  assert.match(app.proactiveDecision('group:123456', state, now).reason, /连续主动未获回应/);
  state.bigfatfish.unanswered = 0; state.bigfatfish.lastAttemptAt = now - 60000;
  assert.match(app.proactiveDecision('group:123456', state, now).reason, /退避/);
  state.bigfatfish.lastAttemptAt = 0; app.settings.schedule.dailyAttemptCap = 0;
  assert.match(app.proactiveDecision('group:123456', state, now).reason, /推理次数/);
});

test('a natural follow-up acknowledges a proactive message even without repeating its topic', t => {
  const { app, state, now } = fixture(t);
  app.settings.participation.enabled = true;
  app.chatDecision('group:123456', state, { user_id: '111111' }, { kind: 'group', text: '肥鱼聊聊模型', nickname: '肥鱼', now: now - 1000 });
  app.sent('group:123456', '模型训练可以从数据准备开始');
  state.bigfatfish.awaitingReplyAt = now; state.bigfatfish.unanswered = 1; state.bigfatfish.lastTopic = 'AI';
  const decision = app.chatDecision('group:123456', state, { user_id: '111111' }, { kind: 'group', text: '那具体怎么做', now: now + 1000, random: () => 1 });
  assert.equal(decision.involved, true); assert.equal(state.bigfatfish.awaitingReplyAt, 0); assert.equal(state.bigfatfish.unanswered, 0);
});

test('a late direct response clears unanswered history, but unrelated group messages do not', t => {
  const { app, state } = fixture(t); state.bigfatfish.unanswered = 2;
  const ev = { self_id: '123456789', user_id: '111111', message: [{ type: 'text', data: { text: '周末去爬山' } }] };
  app.inbound('group:123456', { ...ev, message_id: 'unrelated' });
  app.chatDecision('group:123456', state, ev, { kind: 'group', text: '周末去爬山', random: () => 1 });
  assert.equal(state.bigfatfish.unanswered, 2);
  app.inbound('group:123456', { ...ev, message_id: 'reply', message: [{ type: 'at', data: { qq: '123456789' } }] });
  assert.equal(state.bigfatfish.unanswered, 0);
});
test('private proactive, stale conversations and same-topic repetition are blocked', t => {
  const { app, state, now } = fixture(t);
  assert.match(app.proactiveDecision('private:123456', state, now).reason, /私聊主动/);
  state.lastIncomingAt = now - 100 * 3600000;
  assert.match(app.proactiveDecision('group:123456', state, now).reason, /近期真人/);
  state.lastIncomingAt = now - 60 * 60000; state.bigfatfish.lastTopic = 'AI'; state.bigfatfish.lastColdAt = now - 5 * 3600000;
  assert.match(app.proactiveDecision('group:123456', state, now).reason, /同一话题/);
});
test('source must be a real message from this conversation, not fabricated or self-authored', async t => {
  const { state, memory } = fixture(t);
  state.recentMessages.push({ messageId: 'self', userId: '123456789', plain: '我喜欢茶', isSelf: true });
  for (const sourceMessageId of [undefined, 'unknown', 'self']) {
    assert.equal((await memory({ category: 'longTerm', content: '喜欢喝茶', extra: { sourceMessageId } })).ok, false);
    assert.equal((await memory({ category: 'summary', content: '大家讨论喝茶', extra: { sourceMessageId } })).ok, false);
  }
  assert.equal(state.bigfatfish.facts.length, 0);
});
test('facts deduplicate per speaker and support explicit corrections without changing another speaker', async t => {
  const { state, memory } = fixture(t);
  for (const [content, sourceMessageId] of [['喜欢喝茶！', '1'], ['喜欢喝茶', '1'], ['喜欢喝茶', '2']]) assert.equal((await memory({ category: 'longTerm', content, extra: { sourceMessageId } })).ok, true);
  assert.equal(state.bigfatfish.facts.length, 2);
  const fact = state.bigfatfish.facts[0];
  assert.equal((await memory({ category: 'longTerm', content: '现在喜欢喝水', extra: { sourceMessageId: '2', replaceId: fact.id } })).ok, false);
  assert.equal((await memory({ category: 'longTerm', content: '现在喜欢喝水', extra: { sourceMessageId: '1', replaceId: fact.id } })).ok, true);
  // A rejected transaction restores a cloned snapshot; inspect the current stored fact by ID.
  assert.equal(state.bigfatfish.facts.length, 2); assert.equal(state.bigfatfish.facts.find(f => f.id === fact.id).text, '现在喜欢喝水');
  assert.equal(state.bigfatfish.facts.find(f => f.id !== fact.id).text, '喜欢喝茶');
});
test('recall excludes expired and low-confidence facts and ranks current relevance', () => {
  const now = Date.now(), settings = validateSettings({});
  const facts = [{ text: '喜欢喝茶', confidence: 1, at: now }, { text: '喜欢 AI 模型', confidence: 1, at: now - 86400000 },
    { text: 'AI 旧约定', expiresAt: now - 1 }, { text: 'AI 猜测', confidence: 0.2 }];
  const rows = recallFacts(facts, 'AI', settings.memory, new PrivacyGuard(), now);
  assert.equal(rows.length, 1, 'unrelated facts no longer fill otherwise unused recall slots'); assert.equal(rows[0].text, '喜欢 AI 模型');
});
test('partial settings preserve existing policy groups and reject invalid numeric values', t => {
  fixture(t);
  assert.throws(() => validateSettings({ schedule: { minCheckMinutes: 20, maxCheckMinutes: 10 } }));
  assert.throws(() => validateSettings({ schedule: { weekdays: [] } }));
  assert.throws(() => validateSettings({ interests: ['AI'], interestWeights: { AI: 10 } }));
  assert.throws(() => validateSettings({ memory: { minConfidence: NaN } }));
});
test('saving a single schedule field preserves other controls and reschedules once', async t => {
  const { app, state } = fixture(t); let count = 0, result;
  app.settings.schedule.hourlyCap = 4;
  await app.handle({ method: 'POST', headers: {} }, new URL('http://localhost/api/bigfatfish/settings'), async () => ({ schedule: { minCheckMinutes: 12 } }), value => { result = value; }, { reschedule() { count++; } });
  assert.equal(result.ok, true); assert.equal(app.settings.schedule.hourlyCap, 4); assert.equal(app.settings.schedule.minCheckMinutes, 12);
  assert.equal(app.settings.interestWeights.AI, 3); assert.equal(state.bigfatfish.nextCheckAt, 0); assert.equal(count, 1);
});
test('memory pruning retains important facts when capacity is reached', t => {
  const { app, state, now } = fixture(t); app.settings.memory.maxFacts = 1;
  state.bigfatfish.facts = [{ id: 'important', text: '长期约定', at: now - 86400000, importance: 1 }, { id: 'minor', text: '临时话题', at: now, importance: 0 }];
  app.cleanMemory(state, now); assert.equal(state.bigfatfish.facts[0].id, 'important');
});
