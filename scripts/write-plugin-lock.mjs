// 由插件登记表生成 integrations/dsh-plugin-patches/upstream-lock.json。
// 目的：让"上游版本/提交/决策/回滚"只有一份事实来源（plugin-registry.mjs），避免文档与代码漂移。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_REVIEWS, FEATURE_OWNERSHIP, PLUGIN_CONFLICTS } from '../extensions/bigfatfish/plugin-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'integrations', 'dsh-plugin-patches', 'upstream-lock.json');
const lock = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  note: '本文件由 scripts/write-plugin-lock.mjs 生成，请勿手工编辑。',
  policy: {
    pluginFirst: true,
    patchRequiredFields: ['plugin', 'upstream', 'commit', 'patchVersion', 'files', 'apply', 'verify', 'rollback'],
    noNodeModulesEdits: true,
    // 冲突处理原则：不自动改行为，只在启动日志与管理端报出来，由管理员决定谁接管。
    conflictPolicy: 'report-only',
    conflictResolution: '如果要让插件接管某项功能，先关掉 PLUGIN_CONFLICTS[].localSwitch 描述的自研开关，再重启桥接；不允许两套同时生效。'
  },
  dshVersion: '0.2.1-rc.2',
  profile: 'web',
  entries: PLUGIN_REVIEWS.map(review => ({
    plugin: review.id,
    feature: review.feature,
    upstream: review.upstream,
    version: review.version,
    commit: review.commit,
    license: review.license,
    moduleImport: review.moduleImport,
    upstreamTests: review.tests,
    compatibility: review.compatibility,
    decision: review.decision,
    localOwner: review.owner,
    reasons: review.reasons,
    borrowed: review.borrowable,
    unverified: review.unverified,
    conflict: PLUGIN_CONFLICTS.find(rule => rule.plugin === review.id) || null,
    patchVersion: null,
    patches: [],
    apply: null,
    verify: null,
    rollback: review.rollback
  })),
  ownership: FEATURE_OWNERSHIP
};
fs.writeFileSync(out, JSON.stringify(lock, null, 2) + '\n');
console.log(`已写入 ${path.relative(root, out)}（${lock.entries.length} 个插件条目，全部未打补丁）`);
