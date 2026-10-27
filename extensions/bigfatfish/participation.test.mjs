import test from 'node:test';
import assert from 'node:assert/strict';
import { participationDecision, participationSettings, normalizeParticipation, recordParticipationSent, participationBatchMs } from './participation.mjs';
import { BigFatFish, normalizeState, validateSettings } from './runtime.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const config = participationSettings(), NOW = 1800000000000;
test('configured high ambient probabilities and engaged batching are honored', () => {
  const settings = participationSettings({ idleProbability: 0.8, directBatchMs: 300, engagedBatchMs: 1200, ambientBatchMs: 2000 });
  const result = participationDecision({}, event(), { kind: 'group', text: '周末去爬山', now: NOW, random: () => 0.7 }, settings);
  assert.equal(result.probability, 0.8); assert.equal(result.selected, true);
  assert.equal(participationBatchMs('addressed', 8000, settings), 300);
  assert.equal(participationBatchMs('followUp', 8000, settings), 1200);
  assert.equal(participationBatchMs('ambient', 8000, settings), 2000);
});
const event = (user = '111111', segments = []) => ({ self_id: '123456789', user_id: user, message: segments });
function decide(state, text, { now = NOW, random = () => 0.5, ev = event(), ...options } = {}) {
  return participationDecision(state, ev, { kind: 'group', text, nickname: '肥鱼', now, random, ...options }, config);
}

test('ordinary group chances are 50 percent and interest chances are 60 percent with one draw', () => {
  const settings = participationSettings({ idleProbability: 0.5, engagedProbability: 0.5, interestProbability: 0.6 });
  const pick = (text, draw, st = {}, ev = event()) => participationDecision(st, ev, { kind: 'group', text, interests: ['AI'], now: NOW, random: () => draw }, settings);
  assert.equal(pick('周末爬山', 0.49).selected, true); assert.equal(pick('周末爬山', 0.5).selected, false);
  assert.equal(pick('AI 模型新进展', 0.59).selected, true); assert.equal(pick('AI 模型新进展', 0.6).selected, false);
  const cooling = { participation: { lastRelevantAt: NOW - 400000, lastBotAt: NOW - 400000, offTopicMessages: 8 } };
  const interested = pick('AI 模型新进展', 0.59, cooling); assert.equal(interested.probability, 0.6); assert.equal(interested.reason, 'interest');
  recordParticipationSent(cooling, '模型新进展可以聊聊', NOW);
  assert.equal(cooling.participation.phase, 'engaged'); assert.equal(cooling.participation.offTopicMessages, 0);
  const targeted = pick('AI 模型新进展', 0.59, {}, event('111111', [{ type: 'at', data: { qq: '222222' } }]));
  assert.equal(targeted.interestMatch, false); assert.equal(targeted.probability, 0.5); assert.equal(targeted.selected, false);
});

test('explicit configured aliases always trigger without changing assistant permissions', () => {
  for (const name of ['肥鱼', '古月方鲸']) {
    const result = decide({}, name + '，这个问题你怎么看', { random: () => 1 });
    assert.equal(result.reason, 'addressed'); assert.equal(result.probability, 1); assert.equal(result.direct, true);
  }
  const settings = participationSettings({ aliases: ['古月方鲸', '方鲸'], interestProbability: 0.6 });
  assert.deepEqual(settings.aliases, ['古月方鲸', '方鲸']);
  assert.throws(() => participationSettings({ aliases: '肥鱼' })); assert.throws(() => participationSettings({ interestProbability: 1.1 }));
});

test('real bridge treats 古月方鲸 as a mandatory addressed wake and keeps it through an unrelated batch', async t => {
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] } },
    files: { 'state/bigfatfish-settings.json': { participation: { idleProbability: 0.5, engagedProbability: 0.5, interestProbability: 0.6, aliases: ['肥鱼', '古月方鲸'] } } },
    globals: { setTimeout: (fn, ms) => ({ fn, ms, unref() {} }), clearTimeout() {} } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789');
  const key = 'group:123456', st = h.getSocialV2State(key);
  h.appendSocialV2Message(key, '群友', '古月方鲸，在吗', '古月方鲸，在吗', false, false, '1001', [], '111111');
  const reason = h.evaluateWakeTriggerV2(key, st, event(), 'group', '古月方鲸，在吗', '古月方鲸，在吗', false);
  assert.equal(reason, 'addressed'); h.scheduleWakeV2(key, reason);
  h.scheduleWakeV2(key, 'ambient'); assert.equal(st.pendingWakeReason, 'addressed');
  assert.match(h.buildWakePromptV2(key, st.pendingWakeReason), /必须先回应/);
  assert.equal(st.bigfatfish.mode, 'CASUAL');
});
test('direct mentions, platform at, replies and private messages always trigger even with a losing random draw', () => {
  for (const [text, options] of [['肥鱼你觉得怎么样', {}], ['早上好', { ev: event('111111', [{ type: 'at', data: { qq: '123456789' } }]) }],
    ['这张图呢', { quoteTargetIsSelf: true }], ['你好', { kind: 'private' }]]) {
    const r = decide({}, text, { random: () => 1, ...options }); assert.equal(r.selected, true); assert.equal(r.probability, 1);
  }
});
test('joining gives relevant follow-ups a 95 percent chance without granting assistant permissions', () => {
  const st = {}; decide(st, '肥鱼，解释一下秘密分享'); recordParticipationSent(st, '秘密分享可以使用多项式插值', NOW);
  const r = decide(st, '那多项式插值具体怎么做', { now: NOW + 5000, random: () => 0.9 });
  assert.equal(r.reason, 'followUp'); assert.equal(r.probability, 0.95);
  assert.equal(normalizeState({ participation: st.participation }).mode, 'CASUAL');
});
test('unrelated messages anneal monotonically; messages to another person cool faster', () => {
  const st = {}; decide(st, '肥鱼讲讲秘密分享'); recordParticipationSent(st, '秘密分享是这样的', NOW);
  const probabilities = [];
  for (let i = 1; i <= 8; i++) probabilities.push(decide(st, '周末去爬山了', { now: NOW + i * 1000, ev: event('222222') }).probability);
  assert.ok(probabilities.every((p, i) => i === 0 || p < probabilities[i - 1]));
  assert.equal(probabilities.at(-1), 0.03); assert.equal(st.participation.phase, 'quiet');
  const other = {}; decide(other, '肥鱼解释密码学');
  const targeted = decide(other, '周末去爬山了', { now: NOW + 1000, ev: event('111111', [{ type: 'at', data: { qq: '222222' } }]) });
  assert.ok(targeted.probability < probabilities[0]); assert.equal(targeted.involved, false);
});
test('time decay, a renewed invitation and a genuine random miss work correctly', () => {
  const st = {}; decide(st, '肥鱼讲讲秘密分享');
  assert.equal(decide(st, '周末去爬山了', { now: NOW + 301000 }).probability, 0.03);
  assert.equal(decide(st, '肥鱼再聊聊', { now: NOW + 302000, random: () => 1 }).reason, 'addressed');
  const miss = decide({}, '周末去爬山了', { random: () => 0.99 }); assert.equal(miss.reason, null); assert.equal(miss.probability, 0.25);
});
test('recent delivered exchanges recover after restart so an unnamed follow-up is still recognized', () => {
  const recentMessages = [{ userId: '111111', text: '肥鱼讲讲密码学', time: NOW - 15000 }, { isSelf: true, plain: '密码学可以研究秘密分享', time: NOW - 10000 }];
  const r = decide({}, '那具体怎么做', { recentMessages, random: () => 0.5 });
  assert.equal(r.reason, 'followUp'); assert.equal(r.probability, 0.95);
});
test('bot messages do not reheat a cooling conversation; conversation state is isolated and bounded', () => {
  const st = {}; decide(st, '肥鱼讲讲密码学'); decide(st, '周末去爬山了', { now: NOW + 1000, ev: event('222222') });
  const before = st.participation.offTopicMessages; recordParticipationSent(st, '嗯', NOW + 2000);
  assert.equal(st.participation.offTopicMessages, before); assert.equal(st.participation.phase, 'cooling');
  assert.equal(normalizeParticipation({}).phase, 'idle');
  assert.equal(normalizeState({ participation: st.participation }).participation.offTopicMessages, before);
  assert.throws(() => participationSettings({ engagedProbability: 2 }));
  assert.throws(() => validateSettings({ participation: { idleProbability: 0.9, engagedProbability: 0.5 } }));
});
test('real bridge schedules short batches and upgrades an ambient batch immediately when addressed', async t => {
  const timers = [];
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] } },
    globals: { setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimeout: () => {} } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789');
  const st = h.getSocialV2State('group:123456');
  h.appendSocialV2Message('group:123456', '群友', '肥鱼你好', '肥鱼你好', false, false, '1001', [], '111111');
  h.scheduleWakeV2('group:123456', 'ambient'); assert.equal(timers.at(-1).ms, 1500);
  h.scheduleWakeV2('group:123456', 'interest'); assert.equal(st.pendingWakeReason, 'interest');
  h.scheduleWakeV2('group:123456', 'addressed'); assert.equal(timers.at(-1).ms, 500);
  assert.equal(st.pendingWakeReason, 'addressed');
  const reason = h.evaluateWakeTriggerV2('group:123456', st, event(), 'group', '肥鱼你好', '肥鱼你好', false);
  assert.equal(reason, 'addressed');
  const prompt = h.buildWakePromptV2('group:123456', reason); assert.match(prompt, /本轮接话优先/); assert.doesNotMatch(prompt, /可以装傻、已读乱回/);
});

test('dynamic participation preserves explicit native keyword and speaker subscriptions without a second random draw', async t => {
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] } },
    files: { 'state/bigfatfish-settings.json': { participation: { idleProbability: 0, floorProbability: 0 }, interestPolicy: { enabled: false } } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789');
  const st = h.getSocialV2State('group:123456'); st.wakeConfig.triggers = { keywords: ['回归关注词'], probability: 1 };
  assert.equal(h.evaluateWakeTriggerV2('group:123456', st, event(), 'group', '回归关注词', '回归关注词', false), 'keyword:回归关注词');
  st.wakeConfig.triggers = { speakerIds: ['111111'], probability: 1 };
  assert.equal(h.evaluateWakeTriggerV2('group:123456', st, event(), 'group', '周末去爬山', '周末去爬山', false), 'speaker:111111');
  st.wakeConfig.triggers = { probability: 1 };
  assert.equal(h.evaluateWakeTriggerV2('group:123456', st, event(), 'group', '周末去爬山', '周末去爬山', false), null);
});
