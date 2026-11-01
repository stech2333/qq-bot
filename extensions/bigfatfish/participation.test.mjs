import test from 'node:test';
import assert from 'node:assert/strict';
import { participationDecision, participationSettings, normalizeParticipation, recordParticipationSent, participationBatchMs,
  suggestChatAction, PARTICIPATION_RETIRED } from './participation.mjs';
import { BigFatFish, normalizeState, validateSettings } from './runtime.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const config = participationSettings(), NOW = 1800000000000;
const event = (user = '111111', segments = []) => ({ self_id: '123456789', user_id: user, message: segments });
function decide(state, text, { now = NOW, random = () => 0.5, ev = event(), ...options } = {}) {
  return participationDecision(state, ev, { kind: 'group', text, nickname: '肥鱼', now, random, ...options }, config);
}

test('ambient join is gated by evidence and only thinned by one probability', () => {
  const settings = participationSettings({ ambientJoinProbability: 0.8, directBatchMs: 300, engagedBatchMs: 1200, ambientBatchMs: 2000 });
  // 没有兴趣词、没有话题重合、不是面向全群的提问 ⇒ 不掷骰子，直接安静。
  const quiet = participationDecision({}, event(), { kind: 'group', text: '周末去爬山', now: NOW, random: () => 0 }, settings);
  assert.equal(quiet.probability, 0); assert.equal(quiet.selected, false); assert.equal(quiet.reasonCode, 'NO_EVIDENCE');
  // 兴趣证据存在时才用 ambientJoinProbability 抽稀；random 决定是否真的插话。
  const keen = participationDecision({}, event(), { kind: 'group', text: 'AI 模型新进展', interests: ['AI'], now: NOW, random: () => 0.1 }, settings);
  assert.equal(keen.probability, 0.8); assert.equal(keen.selected, true); assert.equal(keen.reason, 'interest');
  const shy = participationDecision({}, event(), { kind: 'group', text: 'AI 模型新进展', interests: ['AI'], now: NOW, random: () => 0.9 }, settings);
  assert.equal(shy.selected, false); assert.equal(shy.reason, null);
  assert.equal(participationBatchMs('addressed', 8000, settings), 300);
  assert.equal(participationBatchMs('followUp', 8000, settings), 1200);
  assert.equal(participationBatchMs('ambient', 8000, settings), 2000);
});

test('retired probability keys are migrated away instead of silently kept', () => {
  const settings = participationSettings({ idleProbability: 0.8, engagedProbability: 0.5, interestProbability: 0.6, floorProbability: 0.03 });
  assert.equal(settings.ambientJoinProbability, 0.8);
  for (const key of PARTICIPATION_RETIRED) assert.equal(Object.hasOwn(settings, key), false, key);
  // 旧键即使取值离谱也不再报错：它们没有语义了，静默丢弃比拦住启动更安全。
  assert.doesNotThrow(() => participationSettings({ engagedProbability: 2 }));
  const migrated = validateSettings({ participation: { idleProbability: 0.9, engagedProbability: 0.5 } });
  assert.equal(migrated.participation.ambientJoinProbability, 0.9);
  assert.equal(Object.hasOwn(migrated.participation, 'idleProbability'), false);
  assert.throws(() => participationSettings({ ambientJoinProbability: 2 }));
  assert.throws(() => participationSettings({ aliases: '肥鱼' }));
});

test('a confirmed conversation is never left unanswered by a dice roll', () => {
  // 直接称呼、平台@、引用机器人、私聊：一律必答，不看随机数。
  for (const [text, options] of [['肥鱼你觉得怎么样', {}], ['早上好', { ev: event('111111', [{ type: 'at', data: { qq: '123456789' } }]) }],
    ['这张图呢', { quoteTargetIsSelf: true }], ['你好', { kind: 'private' }]]) {
    const r = decide({}, text, { random: () => 0.999, ...options });
    assert.equal(r.selected, true, text); assert.equal(r.probability, 1, text);
  }
  for (const name of ['肥鱼', '古月方鲸']) {
    const result = decide({}, name + '，这个问题你怎么看', { random: () => 1 });
    assert.equal(result.reason, 'addressed'); assert.equal(result.probability, 1); assert.equal(result.direct, true);
  }
});

test('an ongoing exchange keeps answering even at a losing draw', () => {
  const st = {}; decide(st, '肥鱼，解释一下秘密分享'); recordParticipationSent(st, '秘密分享可以使用多项式插值', NOW);
  // 同一人接着问：旧的 engagedProbability(0.6~0.95) 会漏答，现在必须是 1。
  const r = decide(st, '那多项式插值具体怎么做', { now: NOW + 5000, random: () => 0.999 });
  assert.equal(r.reason, 'followUp'); assert.equal(r.probability, 1); assert.equal(r.selected, true);
  assert.equal(normalizeState({ participation: st.participation }).mode, 'CASUAL');
});

test('ambient annealing only cools evidenced interjections; messages to others get no bonus', () => {
  const st = {}; decide(st, '肥鱼讲讲秘密分享'); recordParticipationSent(st, '秘密分享是这样的', NOW);
  const probabilities = [];
  for (let i = 1; i <= 8; i++) probabilities.push(decide(st, '秘密分享还能怎么做', { now: NOW + i * 1000, ev: event('222222') }).probability);
  assert.ok(probabilities.every((p, i) => i === 0 || p < probabilities[i - 1]), 'annealing must be monotonic');
  assert.ok(probabilities.at(-1) < probabilities[0]);
  assert.equal(st.participation.phase, 'quiet');
  // 有人在@别人：既不算兴趣命中，也没有话题加成 ⇒ 完全安静，不再有 0.03 的兜底概率。
  const targeted = decide({}, 'AI 模型新进展', { ev: event('111111', [{ type: 'at', data: { qq: '222222' } }]), interests: ['AI'] });
  assert.equal(targeted.interestMatch, false); assert.equal(targeted.probability, 0); assert.equal(targeted.selected, false);
  assert.equal(targeted.involved, false);
});

test('time decay removes stale ambient evidence; a new direct call still wins', () => {
  const st = {}; decide(st, '肥鱼讲讲秘密分享');
  const stale = decide(st, '秘密分享还能怎么做', { now: NOW + 301000 });
  assert.ok(stale.probability < config.ambientJoinProbability * 0.6);
  assert.equal(decide(st, '肥鱼再聊聊', { now: NOW + 302000, random: () => 1 }).reason, 'addressed');
});

test('recent delivered exchanges recover after restart so an unnamed follow-up is still recognized', () => {
  const recentMessages = [{ userId: '111111', text: '肥鱼讲讲密码学', time: NOW - 15000 }, { isSelf: true, plain: '密码学可以研究秘密分享', time: NOW - 10000 }];
  const r = decide({}, '那具体怎么做', { recentMessages, random: () => 0.999 });
  assert.equal(r.reason, 'followUp'); assert.equal(r.probability, 1);
});

test('bot messages do not reheat a cooling conversation; conversation state is isolated and bounded', () => {
  const st = {}; decide(st, '肥鱼讲讲密码学'); decide(st, '周末去爬山了', { now: NOW + 1000, ev: event('222222') });
  const before = st.participation.offTopicMessages; recordParticipationSent(st, '嗯', NOW + 2000);
  assert.equal(st.participation.offTopicMessages, before); assert.equal(st.participation.phase, 'cooling');
  assert.equal(normalizeParticipation({}).phase, 'idle');
  assert.equal(normalizeState({ participation: st.participation }).participation.offTopicMessages, before);
});

test('action selection offers sticker and reaction forms without forcing them', () => {
  const sticker = { candidateCount: 3, bestConfidence: 0.9, scene: 'casual_chat' };
  const calm = { candidateCount: 3, bestConfidence: 0.2, scene: 'casual_chat' };
  assert.equal(suggestChatAction({ selected: false }), 'SILENT');
  assert.equal(suggestChatAction({ selected: true, direct: true, text: '在', sticker, reactionAvailable: false }), 'STICKER');
  assert.equal(suggestChatAction({ selected: true, direct: true, text: '这段代码为什么会报编译错误', sticker, reactionAvailable: false }), 'MIXED');
  assert.equal(suggestChatAction({ selected: true, direct: true, text: '这段代码为什么会报编译错误', sticker: calm }), 'TEXT');
  assert.equal(suggestChatAction({ selected: true, direct: true, text: '晚安', sticker, closing: true }), 'TEXT');
  assert.equal(suggestChatAction({ selected: true, direct: false, continuation: true, text: '哈哈', scene: 'casual_chat', sticker: null, reactionAvailable: true }), 'EMOJI_REACTION');
  assert.equal(suggestChatAction({ selected: true, direct: false, continuation: true, text: '哈哈', scene: 'casual_chat', sticker: null, reactionAvailable: false }), 'TEXT');
});

test('decision exposes a single action, reason code and context version', () => {
  const st = { memoryRevision: 7 };
  const r = decide(st, '肥鱼，这张图好离谱', { sticker: { candidateCount: 2, bestConfidence: 0.8, scene: 'casual_banter' } });
  assert.equal(r.direct, true); assert.equal(r.action, 'STICKER');
  assert.equal(r.reasonCode, 'DIRECT_ADDRESSED'); assert.equal(r.contextVersion, 7);
  assert.equal(r.suggestedReplyMode, 'CASUAL');
  const quiet = decide({}, '周末去爬山');
  assert.equal(quiet.action, 'SILENT'); assert.equal(quiet.reasonCode, 'NO_EVIDENCE');
});

test('real bridge treats 古月方鲸 as a mandatory addressed wake and keeps it through an unrelated batch', async t => {
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] } },
    files: { 'state/bigfatfish-settings.json': { participation: { idleProbability: 0.5, aliases: ['肥鱼', '古月方鲸'] } } },
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
test('real bridge schedules short batches and upgrades an ambient batch immediately when addressed', async t => {
  const timers = [];
  const h = await bridgeHarness({ config: { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456'], private: [] } },
    globals: { setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimeout: () => {} } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789');
  const st = h.getSocialV2State('group:123456');
  h.appendSocialV2Message('group:123456', '群友', '肥鱼你好', '肥鱼你好', false, false, '1001', [], '111111');
  h.scheduleWakeV2('group:123456', 'ambient'); assert.equal(timers.at(-1).ms, 1500);
  h.scheduleWakeV2('group:123456', 'interest'); assert.equal(st.pendingWakeReason, 'interest');
  h.scheduleWakeV2('group:123456', 'addressed'); assert.equal(timers.at(-1).ms, 100);
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
