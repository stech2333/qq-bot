import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish } from './runtime.mjs';
import { PLUGIN_REVIEWS, FEATURE_OWNERSHIP, PLUGIN_CONFLICTS, pluginIntegrationReport, installedPlugins, detectPluginRuntime } from './plugin-registry.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');

test('every reviewed plugin has a single owner, a real commit and explicit reasons', () => {
  assert.equal(PLUGIN_REVIEWS.length, 4);
  for (const review of PLUGIN_REVIEWS) {
    assert.match(review.commit, /^[0-9a-f]{40}$/, review.id);
    assert.ok(review.owner && typeof review.owner === 'string', review.id);
    assert.ok(Array.isArray(review.reasons) && review.reasons.length >= 2, review.id);
    assert.ok(['adopted', 'adopted-with-patch', 'not-adopted-primary', 'rejected'].includes(review.decision), review.id);
    assert.ok(review.rollback, review.id);
    // 未验证的东西必须写清楚，不能默认写成通过。
    assert.ok(Array.isArray(review.unverified), review.id);
  }
});

test('feature ownership is unique and covers the merged chat path', () => {
  const features = FEATURE_OWNERSHIP.map(o => o.feature);
  assert.equal(new Set(features).size, features.length);
  for (const required of ['长期记忆', '心情', '聊天参与决策', '主动唤醒', '表情库存与选图', '图片与 GIF 理解', '社区知识与黑话', '全局风格']) {
    assert.ok(features.includes(required), required);
  }
});

test('the report never claims a plugin is loaded without evidence', () => {
  const report = pluginIntegrationReport(root);
  assert.equal(report.schemaVersion, 2);
  for (const plugin of report.plugins) {
    assert.equal(plugin.loaded, 'unverified');
    assert.equal(typeof plugin.installed, 'boolean');
    assert.equal(typeof plugin.enabled, 'boolean');
    if (!plugin.installed) { assert.match(plugin.loadedNote, /未安装/); assert.equal(plugin.enabled, false); }
  }
  assert.ok(Array.isArray(report.duplicates) && report.duplicates.length >= 1);
  assert.ok(Array.isArray(report.conflicts));
  assert.equal(report.conflictCount, report.conflicts.length);
});

test('conflict rules cover every reviewed plugin and name the local switch to turn off', () => {
  assert.equal(PLUGIN_CONFLICTS.length, PLUGIN_REVIEWS.length);
  for (const rule of PLUGIN_CONFLICTS) {
    assert.ok(PLUGIN_REVIEWS.some(r => r.id === rule.plugin), rule.plugin);
    assert.ok(['high', 'medium', 'low'].includes(rule.severity), rule.plugin);
    assert.ok(rule.collidesWith.length >= 1, rule.plugin);
    assert.ok(rule.failureMode && rule.evidence && rule.localSwitch, rule.plugin);
  }
});

test('enabled state is read from the plugins own config defaults, not assumed', () => {
  // 用临时 DSH_HOME 模拟"四个插件都装了、都用默认配置"的最坏情况。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-dshhome-'));
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-pluginroot-'));
  try {
    const profile = path.join(fakeRoot, 'data-bridge', 'profiles', 'web');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ dependencies: {
      'dsh-fish-memory': '^1.4.8', 'dsh-feiyu-mood': '^0.8.3', 'dsh-speak-up': '^0.2.7', 'dsh-vision': '^0.1.0'
    } }));
    const runtime = detectPluginRuntime(fakeRoot, { dshHome: home });
    // 没有任何配置文件时，fish-memory / speak-up 都是默认开启。
    assert.equal(runtime['dsh-fish-memory'].enabled, true);
    assert.equal(runtime['dsh-fish-memory'].configPresent, false);
    assert.equal(runtime['dsh-feiyu-mood'].enabled, true, '心情插件没有全局开关，装了就算启用');
    assert.equal(runtime['dsh-speak-up'].enabled, true);
    assert.equal(runtime['dsh-speak-up'].dryRun, true, 'speak-up 默认试运行：只记账不开回合');

    const report = pluginIntegrationReport(fakeRoot, { dshHome: home });
    const byId = Object.fromEntries(report.conflicts.map(c => [c.plugin, c]));
    const delegated = Object.fromEntries(report.delegations.map(c => [c.plugin, c]));
    // 记忆/心情已经被插件接管 → 归入 delegations，不再算冲突。
    assert.equal(delegated['dsh-fish-memory'].status, 'resolved');
    assert.equal(delegated['dsh-feiyu-mood'].status, 'resolved');
    assert.equal(byId['dsh-fish-memory'], undefined);
    assert.equal(byId['dsh-feiyu-mood'], undefined);
    assert.equal(byId['dsh-speak-up'].status, 'latent', '试运行期间是潜伏冲突');
    assert.equal(report.delegationCount, 2);
    assert.match(delegated['dsh-fish-memory'].localSwitch, /已执行/);

    // 管理员把 fish-memory 全局开关关掉、把 speak-up 试运行关掉，状态必须跟着变。
    fs.writeFileSync(path.join(home, 'fish-memory-config.json'), JSON.stringify({ 全局开关: false }));
    fs.writeFileSync(path.join(home, 'speak-up-config.json'), JSON.stringify({ 总开关: true, 试运行: false }));
    const after = pluginIntegrationReport(fakeRoot, { dshHome: home });
    const afterById = Object.fromEntries(after.conflicts.map(c => [c.plugin, c]));
    const afterDelegated = Object.fromEntries(after.delegations.map(c => [c.plugin, c]));
    assert.equal(afterDelegated['dsh-fish-memory'], undefined, '关掉全局开关后不再接管');
    assert.equal(afterById['dsh-speak-up'].status, 'active', '关掉试运行后变成真冲突');
    // speak-up（active）+ vision（low，装不上/只多一个工具）
    assert.equal(after.conflictCount, 2);
    assert.equal(afterById['dsh-vision'].severity, 'low');
    assert.equal(afterDelegated['dsh-feiyu-mood'].status, 'resolved', '心情仍由插件接管');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test('installedPlugins reads the real profile instead of assuming', () => {
  const installed = installedPlugins(root);
  for (const review of PLUGIN_REVIEWS) {
    assert.equal(typeof installed[review.id].installed, 'boolean');
    assert.equal(typeof installed[review.id].declaredInProfile, 'boolean');
  }
});

test('the admin endpoint exposes plugin integration and chat decision read-only', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-plugins-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = new BigFatFish(dir, { bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321', allow: { groups: ['123456'], private: [] } });
  let result, status;
  const request = (url, method = 'GET') => app.handle({ method, headers: {} }, new URL('http://localhost' + url), async () => ({}),
    (body, code) => { result = body; status = code; }, { state: () => ({}), save: () => true, agentTokenOk: () => true, allowed: () => true, memoryEnabled: () => true });

  assert.equal(await request('/api/bigfatfish/plugin-integration'), true);
  assert.equal(status, undefined);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.plugins.length, 4);

  assert.equal(await request('/api/bigfatfish/chat-decision'), true);
  assert.deepEqual(result.actions, ['TEXT', 'STICKER', 'EMOJI_REACTION', 'MIXED', 'SILENT']);
  // 写方法必须被拒绝，避免管理页被当成状态修改入口（handle 内部把错误转成 JSON 回执）。
  await request('/api/bigfatfish/plugin-integration', 'POST');
  assert.equal(result.ok, false); assert.match(String(result.error), /只读/);
  await request('/api/bigfatfish/chat-decision', 'POST');
  assert.equal(result.ok, false); assert.match(String(result.error), /只读/);
});
