import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish } from './runtime.mjs';

// 插件优先的核心契约：装了 DSH 插件之后，本项目同名实现必须**停止写、停止注入**，
// 只保留只读/迁移能力。这里用"临时项目根 + 伪造 profile"模拟插件已安装。
function setup(t, { plugins = [], facts = true } = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-plugin-engine-'));
  const bridge = path.join(project, 'integrations', 'qq-bridge');
  fs.mkdirSync(path.join(bridge, 'state'), { recursive: true });
  const profile = path.join(project, 'data-bridge', 'profiles', 'web');
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(plugins.map(n => [n, '1.0.0'])) }));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const app = new BigFatFish(bridge, { bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321', allow: { groups: ['123456'], private: [] } });
  const st = { recentMessages: [], unread: [], activeTopics: [], pendingThoughts: [], memberImpressions: {} };
  app.bind('group:123456', st);
  if (facts) st.bigfatfish.facts.push({ id: 'f1', text: '喜欢讨论茶叶香气', at: Date.now(), confidence: 1, source: { userId: '111111' } });
  return { app, st, bridge };
}

test('without plugins the local memory keeps injecting and accepting writes', async t => {
  const { app, st } = setup(t);
  st.recentMessages.push({ messageId: 'm1', userId: '111111', plain: '你平时喜欢讨论茶叶香气吗', isSelf: false, time: Date.now() });
  assert.equal(app.engines.memory, 'local');
  assert.match(app.formatMemory(st), /喜欢讨论茶叶香气/);
});

test('with dsh-fish-memory installed the local fact block is not injected', async t => {
  const { app, st } = setup(t, { plugins: ['dsh-fish-memory'] });
  assert.equal(app.engines.memory, 'plugin');
  const block = app.formatMemory(st);
  assert.doesNotMatch(block, /【长期事实/);
  assert.doesNotMatch(block, /喜欢讨论茶叶香气/);
  // 社区知识/话题仍然属于本项目，不能被一起关掉。
  assert.equal(st.bigfatfish.facts.length, 1, '旧记忆数据必须保留，只是不再注入');
});

test('with the plugin installed the agent write path is refused instead of double-written', async t => {
  const { app, st } = setup(t, { plugins: ['dsh-fish-memory'] });
  let result = null;
  const request = { method: 'POST', headers: { 'x-agent-token': 'ok' } };
  const hooks = { state: () => st, save: () => true, format: s => app.formatMemory(s), agentTokenOk: () => true, allowed: () => true, memoryEnabled: () => true };
  const body = { key: 'group:123456', category: 'longTerm', content: '新事实', extra: { sourceMessageId: 'x' } };
  try {
    await app.handle(request, new URL('http://localhost/api/socialV2/memory-append'), async () => body, value => { result = value; }, hooks);
  } catch (error) { result = { ok: false, error: error.message }; }
  assert.equal(result?.ok, false);
  assert.match(String(result?.error), /记忆插件|remember/);
  assert.equal(st.bigfatfish.facts.length, 1, '不能新增第二条事实');
});

test('a delegated mood engine stops judging and injecting, but a plugin snapshot still reaches the prompt', async t => {
  const { app, st } = setup(t, { plugins: ['dsh-feiyu-mood'] });
  assert.equal(app.engines.mood, 'plugin');
  assert.equal(app.mood.delegated, true);
  assert.equal(app.mood.active('group:123456', st), false, '插件接管后本地不再判定');
  assert.equal(app.mood.hint(st), '', '本地不再注入心情');
  assert.equal(app.externalMoodLine(), '', '没有快照时不编心情');
  app.setExternalMood({ value: 45, label: '低落' });
  assert.match(app.externalMoodLine(), /低落/);
  assert.equal(app.setExternalMood({ value: 'x' }), null, '非法快照必须丢弃');
});
