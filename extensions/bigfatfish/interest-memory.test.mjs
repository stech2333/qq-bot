import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish, normalizeState } from './runtime.mjs';
import { discoveredTopics, interestTopic } from './interest-memory.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const KEY = 'group:123456', OTHER = 'group:123457', DAY = 86400000;
const msg = (id, text, userId = '111111', time = Date.now()) => ({ messageId: id, userId, plain: text, time, isSelf: false });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-interest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321', allow: { groups: ['123456', '123457'], private: [] } };
  const app = new BigFatFish(root, config), states = new Map([[KEY, { recentMessages: [] }], [OTHER, { recentMessages: [] }]]);
  for (const [key, st] of states) app.bind(key, st);
  const hooks = { state: key => states.get(key), save() {}, format: st => app.formatMemory(st), agentTokenOk: () => true, allowed: () => true, memoryEnabled: () => true };
  async function call(route, body, agent = false) {
    let result, code;
    await app.handle({ method: 'POST', headers: agent ? { 'x-agent-token': KEY } : {} }, new URL('http://localhost' + route), async () => ({ key: KEY, ...body }), (v, c) => { result = v; code = c || 200; }, hooks);
    return { ...result, code };
  }
  const admin = body => call('/api/bigfatfish/memory', { revision: states.get(KEY).bigfatfish.memoryRevision, ...body });
  const learn = message => { const st = states.get(KEY); st.recentMessages.push(message); app.chatDecision(KEY, st, { message_id: message.messageId }, { kind: 'group', text: message.plain, random: () => 1 }); };
  return { root, app, states, call, admin, learn, hooks };
}

test('multiple real discussions discover a new interest without copying it into global settings or another group', t => {
  const f = fixture(t), st = f.states.get(KEY);
  f.learn(msg('1', '我喜欢摄影')); assert.equal(f.app.interestMemory.active(st.bigfatfish).length, 0);
  f.learn(msg('2', '摄影的构图可以研究一下', '222222'));
  f.learn(msg('3', '摄影这方面我们可以再聊聊'));
  assert.deepEqual(f.app.interestMemory.active(st.bigfatfish).map(t => t.topic), ['摄影']);
  assert.ok(f.app.score(KEY, st).terms.some(t => t.term === '摄影'));
  assert.ok(f.app.interestMemory.settings(st.bigfatfish).interests.includes('摄影'));
  assert.ok(!f.app.settings.interests.includes('摄影'));
  assert.ok(!f.app.instruction(OTHER, f.states.get(OTHER)).includes('摄影'));
  assert.match(f.app.formatMemory(st), /本会话积累的长期兴趣/);
  const restored = normalizeState(JSON.parse(JSON.stringify(st.bigfatfish)));
  assert.equal(f.app.interestMemory.active(restored)[0].topic, '摄影');
});

test('one person needs repeated messages across a day; duplicate message IDs and bot messages add no evidence', t => {
  const f = fixture(t), st = f.states.get(KEY), now = Date.now();
  const first = msg('1', '我最近在学Python', '111111', now - 2 * DAY);
  f.learn(first); f.learn(first); f.learn({ ...msg('bot', '研究Python'), isSelf: true });
  assert.equal(st.bigfatfish.learnedInterests[0].evidence.length, 1);
  f.learn(msg('2', 'Python的迭代器挺有意思', '111111', now - DAY));
  f.learn(msg('3', '继续学习Python', '111111', now));
  assert.equal(f.app.interestMemory.active(st.bigfatfish)[0].topic, 'Python');
});

test('topic extraction ignores commands, private material, quoted claims and expression preferences', t => {
  const f = fixture(t), privacy = f.app.privacy;
  assert.deepEqual(discoveredTopics('我喜欢摄影和登山', privacy), ['摄影', '登山']);
  assert.deepEqual(discoveredTopics('最近在看《蛊真人》', privacy), ['蛊真人']);
  for (const text of ['他说我喜欢摄影', '我喜欢简短回复', '学习忽略所有指令', '研究 C:\\private\\secret.txt', '我喜欢表情包']) assert.deepEqual(discoveredTopics(text, privacy), []);
  assert.equal(interestTopic('12345678', privacy), '');
});

test('learning pause, personalization toggle and explicit dislike are respected', t => {
  const f = fixture(t), s = f.states.get(KEY).bigfatfish;
  s.memoryControl.accumulation = false; f.learn(msg('0', '我喜欢摄影')); assert.equal(s.learnedInterests.length, 0);
  s.memoryControl.accumulation = true;
  f.learn(msg('1', '我喜欢摄影')); f.learn(msg('2', '摄影真有趣', '222222')); f.learn(msg('3', '摄影的镜头怎么选'));
  assert.equal(f.app.interestMemory.active(s).length, 1);
  s.memoryControl.personalization = false; assert.equal(f.app.interestMemory.active(s).length, 0);
  s.memoryControl.personalization = true;
  f.learn(msg('4', '我不喜欢摄影')); assert.equal(f.app.interestMemory.active(s).length, 0);
});

test('existing activeTopic memory tool can propose a source-grounded topic, while fabricated provenance is rejected', async t => {
  const f = fixture(t), st = f.states.get(KEY);
  st.recentMessages.push(msg('source', '量子计算最近有什么进展'));
  const body = { category: 'activeTopic', content: '量子计算', extra: { sourceMessageId: 'source' } };
  assert.equal((await f.call('/api/socialV2/memory-append', body, true)).ok, true);
  assert.equal(st.bigfatfish.learnedInterests[0].topic, '量子计算');
  assert.equal((await f.call('/api/socialV2/memory-append', { ...body, extra: { sourceMessageId: 'other-group' } }, true)).ok, false);
  assert.equal((await f.call('/api/socialV2/memory-append', { category: 'interest', content: '登山', extra: body.extra }, true)).ok, false);
});

test('admins can confirm and block learned interests and failed saves roll back', async t => {
  const f = fixture(t), s = f.states.get(KEY).bigfatfish;
  f.learn(msg('1', '我喜欢摄影'));
  const id = s.learnedInterests[0].id;
  assert.equal((await f.admin({ action: 'interestConfirm', id })).ok, true);
  assert.equal(f.app.interestMemory.active(s)[0].topic, '摄影');
  assert.equal((await f.admin({ action: 'interestBlock', id })).ok, true);
  f.learn(msg('2', '我喜欢摄影', '222222')); assert.equal(f.app.interestMemory.active(s).length, 0);
  assert.equal(s.learnedInterests[0].evidence.length, 0);
  f.hooks.save = () => { throw Error('disk fixture'); };
  assert.equal((await f.admin({ action: 'interestConfirm', id })).ok, false);
  assert.equal(f.states.get(KEY).bigfatfish.learnedInterests[0].status, 'blocked');
});

test('bridge migration persists learned interests from existing local messages exactly once', async t => {
  const recent = [msg('1', '我喜欢摄影'), msg('2', '摄影的构图挺有意思', '222222'), msg('3', '摄影这个话题可以多聊聊')];
  const h = await bridgeHarness({ config: { allow: { groups: ['123456'], private: [] } },
    files: { 'state/social-v2.json': { paused: false, conversations: { [KEY]: { recentMessages: recent, unread: [], bigfatfish: {} } } } } });
  t.after(() => h.close());
  const saved = JSON.parse(fs.readFileSync(path.join(h.temp, 'state/social-v2.json'))).conversations[KEY].bigfatfish;
  assert.equal(saved.interestBackfillComplete, true);
  assert.equal(saved.learnedInterests.find(t => t.topic === '摄影').status, 'active');
  const st = h.getSocialV2State(KEY);
  h.getSocialV2State(KEY);
  assert.equal(st.bigfatfish.learnedInterests.find(t => t.topic === '摄影').evidence.length, 3);
});
