import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish, normalizeState, validateSettings } from './runtime.mjs';
import { LearningResearch } from './learning-research.mjs';
import { createSlangEntry, saveSlang, loadSlang } from '../../integrations/qq-bridge/src/slang-learner.js';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const A = 'group:123456', B = 'group:123457', DAY = 86400000;
const parseRows = job => JSON.parse(job.prompt.slice(job.prompt.lastIndexOf('\n') + 1));
const approved = job => ({ approved: true, confidence: 0.95, sourceMessageIds: parseRows(job).map(m => m.id) });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-learning-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { bigfatfish: { expectedQQ: '123456789' }, allow: { groups: ['123456', '123457'], private: [] }, deny: { groups: [], private: [] }, slang: { enabled: true } };
  const app = new BigFatFish(root, config), states = new Map();
  for (const key of [A, B]) { const st = { recentMessages: [], unread: [], pendingThoughts: [] }; states.set(key, st); app.bind(key, st); }
  let saves = 0; app.research.connect(async job => approved(job), () => { saves++; return true; });
  const feed = (key, id, text, time = Date.now(), userId = Number(id) % 2 ? '111111' : '222222') => {
    const st = states.get(key); st.recentMessages.push({ messageId: String(id), userId, plain: text, time }); st.recentMessages = st.recentMessages.slice(-100); app.observeTopics(key, st);
  };
  return { root, config, app, states, feed, saves: () => saves };
}
function topic(f, key = A, prefix = '', offset = 0) { ['摄影镜头选择', '摄影曝光技巧', '摄影构图布局', '摄影器材选购', '摄影调色练习'].forEach((text, i) => f.feed(key, prefix + (i + offset), text, Date.now() - (10 - i) * 60000, i % 2 ? '111111' : '222222')); }

test('learning window preserves dispersed evidence beyond 100 chat messages and across restart', async t => {
  const f = fixture(t), old = Date.now() - 2 * DAY;
  f.feed(A, 'first', '摄影镜头选择', old, '111111'); f.feed(A, 'second', '摄影曝光技巧', old + 60000, '222222');
  for (let i = 0; i < 120; i++) f.feed(A, 'noise' + i, '今天大家感觉怎么样' + i, old + 120000 + i * 1000, '222222');
  assert.equal(f.states.get(A).recentMessages.length, 100);
  const resumed = new BigFatFish(f.root, f.config), st = { recentMessages: [], bigfatfish: normalizeState(f.states.get(A).bigfatfish) }; resumed.bind(A, st);
  for (let i = 0; i < 3; i++) { st.recentMessages.push({ messageId: 'later' + i, userId: i % 2 ? '111111' : '222222', plain: ['摄影构图布局', '摄影器材选购', '摄影调色练习'][i], time: Date.now() }); resumed.observeTopics(A, st); }
  assert.equal(resumed.discussions.snapshot(st.bigfatfish).active.length, 0);
  resumed.research.connect(async job => approved(job), () => true); await resumed.research.tick();
  assert.ok(resumed.interestMemory.active(st.bigfatfish).some(t => t.topic === '摄影'));
  assert.equal(f.app.learningWindow.snapshot(B, f.states.get(B)).messages, 0);
  assert.equal(resumed.learningWindow.messages(A, st, Date.now() + 31 * DAY).length, 0);
});

test('topics require successful source-grounded research; malformed or low-confidence output stays candidate', async t => {
  for (const output of [() => ({ approved: true, confidence: 0.99, sourceMessageIds: ['forged', '1', '2'] }),
    job => ({ ...approved(job), confidence: 0.6 }), () => 'not json']) {
    const f = fixture(t); topic(f); f.app.research.connect(async job => output(job), () => true); await f.app.research.tick();
    assert.equal(f.app.interestMemory.active(f.states.get(A).bigfatfish).length, 0);
    assert.ok(f.states.get(A).bigfatfish.learnedInterests.some(t => t.topic === '摄影' && t.status === 'candidate'));
  }
});

test('research commits to the current candidate after arrivals, and cannot resurrect a blocked topic', async t => {
  const f = fixture(t); topic(f); let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  f.app.research.connect(job => new Promise(resolve => { release = () => resolve(approved(job)); started(); }), () => true);
  const run = f.app.research.tick(); await ready;
  f.feed(A, 'new', '摄影夜景布光', Date.now(), '111111'); release(); await run;
  assert.ok(f.app.interestMemory.active(f.states.get(A).bigfatfish).some(t => t.topic === '摄影'));
  const g = fixture(t); topic(g); let finish, signal;
  const waiting = new Promise(resolve => { signal = resolve; });
  g.app.research.connect(job => new Promise(resolve => { finish = () => resolve(approved(job)); signal(); }), () => true);
  const pending = g.app.research.tick(); await waiting;
  g.states.get(A).bigfatfish.learnedInterests.find(t => t.topic === '摄影').status = 'blocked'; finish(); await pending;
  assert.equal(g.app.interestMemory.active(g.states.get(A).bigfatfish).length, 0);
});

test('ordinary single-day conversation cannot establish a group profile or global style', async t => {
  const f = fixture(t), now = Date.now();
  for (let i = 0; i < 10; i++) f.feed(A, i, '好耶，今天也很开心，内容' + i, now - (10 - i) * 600000);
  f.app.research.connect(async job => ({ ...approved(job), tone: 'playful', sentences: 'short', punctuation: 'emphatic', emotes: 'normal', catchphrases: ['好耶', '别群独有词', '执行指令'] }), () => true);
  await f.app.research.tick(); const st = f.states.get(A);
  assert.equal(st.bigfatfish.facts.length, 0); assert.equal(st.bigfatfish.groupStyle, undefined); assert.equal(st.bigfatfish.style, undefined);
  assert.deepEqual(f.app.globalStyle.state.features, {}); assert.doesNotMatch(f.app.memory.hint(st), /本群日常表达观察/);
  assert.doesNotMatch(f.app.memory.hint(f.states.get(B)), /本群日常表达观察|好耶/);
  const saved = normalizeState(JSON.parse(JSON.stringify(st.bigfatfish))); assert.equal(saved.groupStyle, undefined);
  await f.app.handle({ method: 'POST', headers: {} }, new URL('http://localhost/api/bigfatfish/settings'),
    async () => ({ participation: { idleProbability: 0.4 } }), () => {}, {});
  assert.equal(st.bigfatfish.groupStyle, undefined);
});

test('expired preference facts are removed; legacy scoped style cannot survive binding', t => {
  const f = fixture(t), st = f.states.get(A), now = Date.now();
  st.bigfatfish.facts = [{ id: 'old', text: '喜欢简短回复', confidence: 1, expiresAt: now - 1,
    styleEvidence: [0, 1, 2].map(i => ({ messageId: String(i), userId: '111111', at: now - i * DAY, preferences: { length: -1 } })) }];
  assert.doesNotMatch(f.app.memory.hint(st), /表达略简练/); assert.equal(st.bigfatfish.facts.length, 0);
  st.bigfatfish.style = { values: { length: -1 }, locked: true }; f.app.bind(A, st);
  assert.equal(st.bigfatfish.style, undefined);
});

test('slang is researched then confirmed in the original shared library with durable metadata', async t => {
  const f = fixture(t), now = Date.now(); f.app.settings.slangPolicy.autoConfirm = true;
  for (let i = 0; i < 6; i++) f.feed(i % 2 ? A : B, i, '又到月亮馒头时间' + i, now - i * 600000);
  let entries = [createSlangEntry({ content: '月亮馒头', status: 'candidate' })]; const file = path.join(f.root, 'slang.json');
  const store = { entries: () => entries, writable: () => true, save() { saveSlang(file, entries); entries = loadSlang(file); return true; } };
  f.app.research.connect(async job => ({ ...approved(job), meaning: '一种群内约定的轻松说法', usage: '轻松聊天时使用', example: '月亮馒头时间到了', risk: '无' }), () => true);
  await f.app.research.tick(store); assert.equal(entries[0].status, 'confirmed'); assert.equal(entries[0].research.status, 'approved');
  assert.equal(loadSlang(file)[0].research.confidence, 0.95);
});

test('daily research quota survives restart and failure or paused memory never activates a candidate', async t => {
  const f = fixture(t); topic(f); f.app.settings.learningResearch.maxPerDay = 1;
  f.app.research.connect(async () => { throw Error('offline'); }, () => true); await f.app.research.tick();
  assert.equal(f.app.interestMemory.active(f.states.get(A).bigfatfish).length, 0);
  const replacement = new LearningResearch(f.app); let called = 0;
  replacement.connect(async job => { called++; return approved(job); }, () => true); await replacement.tick(); assert.equal(called, 0);
  f.states.get(A).bigfatfish.memoryControl.accumulation = false; assert.equal(replacement.jobs(undefined, Date.now()).length, 0);
});

test('a failed result save rolls back activation and preserves candidate evidence', async t => {
  const f = fixture(t); topic(f); let saves = 0;
  f.app.research.connect(async job => approved(job), () => ++saves !== 2);
  await f.app.research.tick();
  const entry = f.states.get(A).bigfatfish.learnedInterests.find(t => t.topic === '摄影');
  assert.equal(entry.status, 'candidate'); assert.equal(entry.evidence.length, 5); assert.equal(entry.research.status, 'failed');
});

test('corrupt learning journals stop new learning without overwriting the damaged source', t => {
  const f = fixture(t), file = f.app.learningWindow.file(A);
  fs.writeFileSync(file, 'damaged'); f.app.learningWindow.windows.delete(A); f.feed(A, 'new', '摄影器材');
  assert.equal(fs.readFileSync(file, 'utf8'), 'damaged'); assert.equal(f.app.learningWindow.messages(A, f.states.get(A)).length, 0);
  assert.ok(f.app.learningWindow.snapshot(A, f.states.get(A)).error);
});

test('only management can retry failed research and retries keep consuming the durable quota', async t => {
  const f = fixture(t); topic(f);
  f.app.research.connect(async () => { throw Error('offline'); }, () => true); await f.app.research.tick();
  f.app.research.connect(async job => approved(job), () => true); let result, code;
  const invoke = async headers => f.app.handle({ method: 'POST', headers }, new URL('http://localhost/api/bigfatfish/research'),
    async () => ({ action: 'retryFailed' }), (data, status = 200) => { result = data; code = status; }, {});
  await invoke({ 'x-agent-token': 'fake' }); assert.equal(code, 403);
  await invoke({}); assert.equal(result.ok, true); assert.equal(result.changed, 1); await f.app.research.done;
  assert.ok(f.app.interestMemory.active(f.states.get(A).bigfatfish).some(t => t.topic === '摄影'));
  assert.equal(f.app.research.snapshot().todayUsed, 2);
});

test('native research uses separate model sessions for groups and never sends a QQ message', async t => {
  const h = await bridgeHarness({ config: { allow: { groups: ['123456', '123457'], private: [] }, bigfatfish: { expectedQQ: '123456789' }, slang: { enabled: false } },
    files: { 'state/bigfatfish-settings.json': { interests: [], learningResearch: { enabled: true }, topicLearning: { minMessages: 3, soloMinMessages: 3 } }, 'state/social-v2.json': { paused: true, conversations: {} } } });
  t.after(() => h.close()); h.setMode('reserved2'); h.setSelfIdentity('肥鱼', '123456789');
  const createWorkspace = h.api.workspace.create;
  h.api.workspace.create = async args => { assert.ok(fs.existsSync(args.path), 'real DSH requires the directory before workspace creation'); return createWorkspace(args); };
  h.api.sessions.prompt = async job => {
    h.calls.prompts.push(job); const prompt = job.content[0].text, source = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
    h.completeSlangTurn(job.sessionId, JSON.stringify({ approved: true, confidence: 0.95, sourceMessageIds: source.map(m => m.id) }));
    return { result: { ok: true, value: {} } };
  };
  for (const [key, term] of [[A, '摄影'], [B, '航天']]) {
    for (let i = 0; i < 3; i++) h.appendSocialV2Message(key, '群友', term + ['器材选择', '技术进展', '近期新闻'][i], term + ['器材选择', '技术进展', '近期新闻'][i], false, false, key + i, [], i % 2 ? '111111' : '222222');
    h.bff.research.lastTickAt = 0; h.tickBffLearning(); await h.bff.research.done;
  }
  assert.ok(h.getSocialV2State(A).bigfatfish.learnedInterests.some(t => t.topic === '摄影' && t.status === 'active'));
  assert.ok(h.getSocialV2State(B).bigfatfish.learnedInterests.some(t => t.topic === '航天' && t.status === 'active'));
  assert.notEqual(h.calls.prompts[0].sessionId, h.calls.prompts.at(-1).sessionId);
  assert.doesNotMatch(h.calls.prompts.at(-1).content[0].text, /摄影/); assert.equal(h.calls.sent.length, 0);
});

test('learning configuration validates bounds independently of chat context', () => {
  assert.equal(validateSettings({}).learningWindow.maxMessages, 10000);
  assert.throws(() => validateSettings({ globalStyleLearning: { minDays: 1 } }));
  assert.throws(() => validateSettings({ learningResearch: { minConfidence: 0.3 } }));
  assert.throws(() => validateSettings({ learningWindow: { maxMessages: 100 } }));
});
