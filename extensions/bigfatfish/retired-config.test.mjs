import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneRetiredConfig, migrateRetiredConfig, RETIRED_CONFIG_SECTIONS, RETIRED_CONFIG_VALUES } from './retired-config.mjs';

test('legacy sticker defaults written by the first install are removed so new defaults apply', () => {
  // 这正是本机 config.json 的真实形态：social 段 + 旧的 8/2/10。
  const file = { socialV2: { sticker: { promptMaxStickers: 8, collect: { maxPerMinute: 2, maxPerHour: 10, maxRemarkChars: 20 } } } };
  const result = migrateRetiredConfig(file);
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed.sort(), ['socialV2.sticker.collect.maxPerHour', 'socialV2.sticker.collect.maxPerMinute', 'socialV2.sticker.promptMaxStickers'].sort());
  // 删掉后由代码里的新默认接管：动态候选、不限额；QQ 原生备注上限保留。
  assert.equal(Object.hasOwn(file.socialV2.sticker, 'promptMaxStickers'), false);
  assert.deepEqual(file.socialV2.sticker.collect, { maxRemarkChars: 20 });
  assert.deepEqual(migrateRetiredConfig(file), { changed: false, removed: [] }, '第二次必须无变化');
});

test('values an administrator actually changed are never overwritten', () => {
  const file = { socialV2: { sticker: { promptMaxStickers: 5, collect: { maxPerMinute: 1, maxPerHour: 30 } } } };
  assert.deepEqual(migrateRetiredConfig(file), { changed: false, removed: [] });
  assert.equal(file.socialV2.sticker.promptMaxStickers, 5);
  assert.equal(file.socialV2.sticker.collect.maxPerHour, 30);
});

test('every retired value documents the legacy default it keys on', () => {
  for (const rule of RETIRED_CONFIG_VALUES) {
    assert.ok(Array.isArray(rule.path) && rule.path.length >= 2, JSON.stringify(rule));
    assert.equal(typeof rule.legacy, 'number', JSON.stringify(rule));
    assert.ok(rule.reason, JSON.stringify(rule));
  }
});

test('retired config sections are pruned without touching live sections', () => {
  const file = {
    dsh: { baseUrl: 'http://127.0.0.1:3086' },
    social: { enabled: true, triggerProbability: 0.1, burstEnabled: true },
    socialV2: { enabled: true, send: { maxSendPerMinute: 20 } },
    allow: { groups: ['123456'] }
  };
  const result = pruneRetiredConfig(file);
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed, ['social']);
  assert.equal(Object.hasOwn(file, 'social'), false);
  // 生效配置与其它段必须原样保留。
  assert.deepEqual(file.socialV2, { enabled: true, send: { maxSendPerMinute: 20 } });
  assert.deepEqual(file.allow, { groups: ['123456'] });
  assert.equal(file.dsh.baseUrl, 'http://127.0.0.1:3086');
});

test('pruning is idempotent and tolerant of odd shapes', () => {
  const once = { social: { a: 1 }, socialV2: {} };
  assert.deepEqual(pruneRetiredConfig(once), { changed: true, removed: ['social'] });
  assert.deepEqual(pruneRetiredConfig(once), { changed: false, removed: [] });
  for (const value of [null, undefined, [], 'x', 42]) assert.deepEqual(pruneRetiredConfig(value), { changed: false, removed: [] });
  assert.deepEqual([...RETIRED_CONFIG_SECTIONS], ['social']);
});

test('a config on disk keeps a backup and stays valid JSON after pruning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-config-'));
  const file = path.join(dir, 'config.json');
  const original = { social: { enabled: true }, socialV2: { enabled: true }, ownerQQ: 1 };
  fs.writeFileSync(file, JSON.stringify(original));
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (pruneRetiredConfig(parsed).changed) {
    fs.copyFileSync(file, file + '.pre-v3.bak');
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
  }
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.hasOwn(after, 'social'), false);
  assert.equal(after.socialV2.enabled, true);
  assert.equal(JSON.parse(fs.readFileSync(file + '.pre-v3.bak', 'utf8')).social.enabled, true, '备份必须保留原值');
  fs.rmSync(dir, { recursive: true, force: true });
});
