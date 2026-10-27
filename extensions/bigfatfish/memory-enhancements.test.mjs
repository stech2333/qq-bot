import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BigFatFish, normalizeState } from './runtime.mjs';
import { recallTrace, memoryFreshness } from './memory-recall.mjs';
import { PrivacyGuard } from './chat-security.mjs';

const KEY = 'group:123456', OTHER = 'group:123457', DAY = 86400000;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-memory-v2-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const app = new BigFatFish(root, { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456', '123457'], private: [] } });
  const states = new Map([KEY, OTHER].map(key => [key, { recentMessages: [], pendingThoughts: [], activeTopics: [], memberImpressions: {} }]));
  for (const [key, st] of states) app.bind(key, st);
  const hooks = { state: key => states.get(key), save: () => true, format: st => app.formatMemory(st), agentTokenOk: () => true, allowed: () => true, memoryEnabled: () => true };
  const call = async (route, body = {}, { key = KEY, method = 'POST', agent = false } = {}) => {
    let result; const url = new URL('http://localhost' + route), data = { key, ...body };
    if (method === 'GET') for (const [k, v] of Object.entries(data)) url.searchParams.set(k, v);
    await app.handle({ method, headers: agent ? { 'x-agent-token': key } : {} }, url, async () => data, r => result = r, hooks); return result;
  };
  const admin = (body, opts) => call('/api/bigfatfish/memory', { revision: states.get(opts?.key || KEY).bigfatfish.memoryRevision, ...body }, opts);
  const remember = (id, text, extra = {}, userId = '111111', key = KEY) => {
    states.get(key).recentMessages.push({ messageId: id, userId, plain: text, time: Date.now(), isSelf: false });
    return call('/api/socialV2/memory-append', { category: 'longTerm', content: text, extra: { sourceMessageId: id, ...extra } }, { agent: true, key });
  };
  return { app, states, hooks, admin, remember, call, root };
}
test('recall gates unrelated and empty questions, uses complete Chinese words and explains exclusions', () => {
  const now = Date.now(), privacy = new PrivacyGuard(), p = { recallLimit: 6, halfLifeDays: 30, minConfidence: 0.6, maxChars: 1000, evidenceThreshold: 0.15 };
  const facts = [{ id: 'coffee', text: '喜欢咖啡', at: now }, { id: 'shop', text: '周末去咖啡店', at: now },
    { id: 'expired', text: '咖啡约定', expiresAt: now - 1 }, { id: 'uncertain', text: '咖啡偏好', confidence: 0.2 }];
  const trace = recallTrace(facts, '咖啡', p, privacy, now);
  assert.deepEqual(trace.selected.map(f => f.id), ['coffee']);
  assert.match(trace.rows.find(r => r.id === 'shop').reason, /没有命中/);
  assert.match(trace.rows.find(r => r.id === 'expired').reason, /过期/);
  assert.match(trace.rows.find(r => r.id === 'uncertain').reason, /置信度/);
  for (const q of ['在吗', '哈哈', '模型训练', '我喜欢爬山']) assert.equal(recallTrace(facts, q, p, privacy, now).selected.length, 0);
});
test('stable facts do not decay and budgets explain stable slots and quoted character limits', () => {
  const now = Date.now(), p = { recallLimit: 5, halfLifeDays: 30, minConfidence: 0.6, maxChars: 1000, stableLimit: 1 };
  const facts = [{ id: 'a', text: '咖啡约定', at: now - 30 * DAY }, { id: 'b', text: '咖啡喜好', at: now - 90 * DAY, kind: 'stable' }, { id: 'c', text: '咖啡偏好', at: now, kind: 'stable' }];
  assert.equal(memoryFreshness(facts[0], p, now), 0.5); assert.equal(memoryFreshness(facts[1], p, now), 1);
  let trace = recallTrace(facts, '咖啡', p, new PrivacyGuard(), now);
  assert.equal(trace.selected.filter(f => f.kind === 'stable').length, 1); assert.ok(trace.rows.some(r => /长期事实名额/.test(r.reason)));
  trace = recallTrace(facts, '咖啡', { ...p, maxChars: 20 }, new PrivacyGuard(), now);
  assert.equal(trace.selected.length, 0); assert.ok(trace.rows.every(r => /字数/.test(r.reason)));
});
test('fact keys supersede only the same person and scope, preserve history and support restore', async t => {
  const f = fixture(t), metadata = { factKey: '个人.饮品', kind: 'stable', tags: ['饮品'] };
  assert.equal((await f.remember('1', '喜欢喝茶', metadata)).ok, true);
  await f.remember('2', '喜欢喝牛奶', metadata, '222222');
  await f.remember('3', '喜欢喝豆浆', metadata, '111111', OTHER);
  await f.remember('4', '现在喜欢喝咖啡', metadata);
  const s = f.states.get(KEY).bigfatfish;
  assert.deepEqual(s.facts.map(f => f.text).sort(), ['喜欢喝牛奶', '现在喜欢喝咖啡'].sort());
  assert.equal(s.memoryArchive.length, 1); assert.equal(f.states.get(OTHER).bigfatfish.facts[0].text, '喜欢喝豆浆');
  const restored = await f.admin({ action: 'restoreFact', archiveId: s.memoryArchive[0].archiveId });
  assert.equal(restored.ok, true); assert.ok(restored.facts.some(f => f.text === '喜欢喝茶')); assert.ok(!restored.facts.some(f => f.text === '现在喜欢喝咖啡'));
  assert.ok(normalizeState(s).memoryArchive.length);
});
test('explicit corrections archive the previous version and repeating a fact preserves stable metadata', async t => {
  const f = fixture(t); await f.remember('1', '喜欢喝茶', { factKey: '个人.饮品', kind: 'stable', tags: ['茶叶'] });
  await f.remember('2', '喜欢喝茶'); const s = f.states.get(KEY).bigfatfish;
  assert.equal(s.facts[0].kind, 'stable'); assert.deepEqual(s.facts[0].tags, ['茶叶']);
  await f.remember('3', '改喝咖啡', { replaceId: s.facts[0].id });
  assert.equal(s.memoryArchive[0].fact.text, '喜欢喝茶');
  assert.equal(s.facts[0].kind, 'stable');
});
test('daily new-memory quota survives delete/reload, duplicate writes and failed saves do not inflate evidence', async t => {
  const f = fixture(t); f.app.settings.memory.dailyQuota = 1;
  await f.remember('1', '喜欢喝茶'); await f.remember('1', '喜欢喝茶');
  let s = f.states.get(KEY).bigfatfish; assert.equal(s.memoryWrites.length, 1); assert.equal(s.facts[0].confirmations, 1);
  await f.admin({ action: 'delete', category: 'longTerm', id: s.facts[0].id });
  assert.equal((await f.remember('2', '喜欢喝咖啡')).ok, false);
  s = f.states.get(KEY).bigfatfish; assert.equal(normalizeState(s).memoryWrites.length, 1);
  f.app.settings.memory.dailyQuota = 2; f.hooks.save = () => { throw Error('disk'); };
  const before = structuredClone(s); assert.equal((await f.remember('3', '喜欢喝牛奶')).ok, false); assert.deepEqual(f.states.get(KEY).bigfatfish, before);
});
test('import preview is read-only and commit is scoped, revision-checked, attributed and never invokes a model', async t => {
  const f = fixture(t), st = f.states.get(KEY), before = structuredClone(st.bigfatfish);
  const r = await f.admin({ action: 'importPreview', name: '旧档案.md', text: '# 标题\n- 喜欢研究模型训练\n- 喜欢研究模型训练\n```js\n不应该导入这条代码\n```\n|表格内容不导入|\n约好周末一起讨论论文' });
  assert.deepEqual(st.bigfatfish, before); assert.equal(r.candidates.length, 2);
  assert.equal((await f.admin({ action: 'importCommit', importId: r.importId, ids: [r.candidates[0].id] }, { key: OTHER })).ok, false);
  const saved = await f.admin({ action: 'importCommit', importId: r.importId, ids: [r.candidates[0].id] });
  assert.equal(saved.ok, true); assert.equal(saved.facts[0].source.import, '旧档案.md'); assert.equal(saved.facts[0].source.admin, true);
  assert.equal((await f.admin({ action: 'importCommit', importId: r.importId, ids: [r.candidates[0].id] })).ok, false);
});
test('deleted memories and corrected historical variants cannot return through import or restore', async t => {
  const f = fixture(t); let r = await f.admin({ action: 'create', category: 'longTerm', content: '喜欢研究模型训练' });
  const id = r.facts[0].id;
  await f.admin({ action: 'update', category: 'longTerm', id, content: '喜欢研究图像生成' });
  r = await f.admin({ action: 'delete', category: 'longTerm', id }); assert.equal(r.archive.length, 0);
  const draft = await f.admin({ action: 'importPreview', text: '喜欢研究模型训练\n喜欢研究图像生成' }); assert.equal(draft.candidates.length, 0);
});
test('import errors and failed saves preserve the draft and all state', async t => {
  const f = fixture(t), draft = await f.admin({ action: 'importPreview', text: '喜欢研究模型训练' });
  f.hooks.save = () => false;
  const action = { action: 'importCommit', importId: draft.importId, ids: [draft.candidates[0].id] };
  assert.equal((await f.admin(action)).ok, false); assert.equal(f.states.get(KEY).bigfatfish.facts.length, 0);
  f.hooks.save = () => true; assert.equal((await f.admin(action)).ok, true);
  assert.equal((await f.admin({ action: 'importPreview', text: '文'.repeat(100001) })).ok, false);
});
test('recall preview is read-only, uses session isolation, and cannot reinforce facts', async t => {
  const f = fixture(t); await f.remember('1', '喜欢喝咖啡'); const s = f.states.get(KEY).bigfatfish, before = structuredClone(s.facts);
  const r = await f.admin({ recallQuery: '咖啡' }, { method: 'GET' }); assert.equal(r.previewRecall.rows[0].selected, true);
  assert.deepEqual(s.facts, before); assert.equal((await f.admin({ recallQuery: '咖啡' }, { method: 'GET', key: OTHER })).previewRecall.rows.length, 0);
  f.app.formatMemory(f.states.get(KEY)); assert.ok(s.lastRecall);
  await f.admin({ action: 'delete', category: 'longTerm', id: s.facts[0].id }); assert.equal(s.lastRecall, null);
});
test('expiration and capacity move facts to bounded history instead of silently destroying them', t => {
  const f = fixture(t), st = f.states.get(KEY), now = Date.now(); f.app.settings.memory.maxFacts = 1;
  st.bigfatfish.facts = [{ id: 'important', text: '研究模型训练', at: now, importance: 1 }, { id: 'old', text: '旧模型训练记录', at: now - DAY, importance: 0 }, { id: 'expired', text: '过期的模型讨论约定', expiresAt: now - 1 }];
  f.app.cleanMemory(st, now);
  assert.deepEqual(st.bigfatfish.facts.map(f => f.id), ['important']); assert.equal(st.bigfatfish.memoryArchive.length, 2);
  assert.ok(st.bigfatfish.memoryArchive.some(r => /过期/.test(r.reason)));
});
test('deleting a keyed current state also forgets superseded states from that person', async t => {
  const f = fixture(t), meta = { factKey: '个人.饮品' };
  await f.remember('1', '喜欢喝茶叶水', meta); await f.remember('2', '现在喜欢喝咖啡', meta);
  const r = await f.admin({ action: 'delete', category: 'longTerm', id: f.states.get(KEY).bigfatfish.facts[0].id });
  assert.equal(r.archive.length, 0);
  assert.equal((await f.admin({ action: 'importPreview', text: '喜欢喝茶叶水\n现在喜欢喝咖啡' })).candidates.length, 0);
});
test('a repeated tool call with the same source cannot refresh freshness or store secrets in metadata', async t => {
  const f = fixture(t); await f.remember('1', '喜欢喝茶'); const s = f.states.get(KEY).bigfatfish;
  s.facts[0].updatedAt = Date.now() - DAY; const before = s.facts[0].updatedAt;
  await f.remember('1', '喜欢喝茶'); assert.equal(s.facts[0].updatedAt, before);
  f.app.privacy.addSecret('private-secret-value');
  assert.equal((await f.remember('2', '喜欢喝咖啡', { factKey: 'private-secret-value' })).ok, false);
});
test('archived states are not reimported, and forgetting a history row leaves the current fact intact', async t => {
  const f = fixture(t); await f.remember('1', '喜欢喝茶叶水', { factKey: '个人.饮品' }); await f.remember('2', '现在喜欢喝咖啡', { factKey: '个人.饮品' });
  assert.equal((await f.admin({ action: 'importPreview', text: '喜欢喝茶叶水' })).candidates.length, 0);
  const s = f.states.get(KEY).bigfatfish;
  const result = await f.admin({ action: 'deleteArchive', archiveId: s.memoryArchive[0].archiveId });
  assert.equal(result.archive.length, 0); assert.equal(result.facts[0].text, '现在喜欢喝咖啡');
  assert.equal((await f.admin({ action: 'importPreview', text: '喜欢喝茶叶水' })).candidates.length, 0);
});
