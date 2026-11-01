// 可重复执行的运行数据备份。只复制，不移动、不删除生产文件。
// 用法：node scripts/backup-state.mjs [--label v4.2-pre-refactor]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const labelArg = process.argv.indexOf('--label');
const label = labelArg > 0 && process.argv[labelArg + 1] ? String(process.argv[labelArg + 1]) : 'manual';
const dest = path.join(root, 'backups', label);
fs.mkdirSync(dest, { recursive: true });

const bridge = path.join(root, 'integrations', 'qq-bridge');
const bridgeState = path.join(bridge, 'state');
const entries = [];

// destRel 是备份目录内的相对路径；source 是绝对源路径。
function copyFile(destRel, source) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  const target = path.join(dest, destRel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  const buffer = fs.readFileSync(source);
  entries.push({ path: destRel, source: source.slice(root.length + 1).replace(/\\/g, '/'), bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
  return true;
}

function copyDir(destRel, sourceDir, filter = () => true) {
  if (!fs.existsSync(sourceDir)) return;
  for (const name of fs.readdirSync(sourceDir)) {
    const full = path.join(sourceDir, name);
    if (!fs.statSync(full).isFile() || !filter(name)) continue;
    copyFile(`${destRel}/${name}`, full);
  }
}

// 1. 人格与角色卡
copyDir('role-cards', path.join(bridge, 'roles'));
copyDir('qq-bridge/state/persona-prompts', path.join(bridgeState, 'persona-prompts'));
for (const name of ['bigfatfish-personas.json', 'current-role.json', 'mode.json', 'legacy-import.json']) {
  copyFile(`qq-bridge/state/${name}`, path.join(bridgeState, name));
}

// 2. QQ Bridge 配置
for (const name of ['config.json', 'config.example.json', 'package.json']) copyFile(`qq-bridge/${name}`, path.join(bridge, name));

// 3. DSH Profile 与插件配置
for (const name of ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']) {
  copyFile(`data-bridge/profiles/web/${name}`, path.join(root, 'data-bridge', 'profiles', 'web', name));
}
const pluginDirs = [path.join(root, 'data-bridge', 'plugins'), path.join(bridge, 'plugins')];
for (const dir of pluginDirs) {
  const prefix = path.relative(root, dir).replace(/\\/g, '/');
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (name === 'node_modules' || name === '.git') continue;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && stat.size < 2 * 1024 * 1024) copyFile(`plugins/${prefix === 'data-bridge/plugins' ? 'dsh' : 'bridge'}/${path.relative(dir, full).replace(/\\/g, '/')}`, full);
    }
  };
  walk(dir);
}

// 4. 记忆 / 风格 / 黑话 / 图片 / 社区知识 / 学习检查点 / API 池
const stateFiles = [
  'social-v2.json', 'bigfatfish-settings.json', 'bigfatfish-proactive.json', 'sessions.json',
  'global-style.json', 'global-style-v3.json', 'slang.json', 'stickers.json',
  'community.sqlite', 'community.sqlite-wal', 'community.sqlite-shm',
  'community-connectors.json', 'learning-research-budget.json', 'mood-budget.json',
  'api-pool.json', 'bigfatfish-slang-audit.json', 'slang-research-jobs.json', 'slang-session.json',
  'feedback.json'
];
for (const name of stateFiles) copyFile(`qq-bridge/state/${name}`, path.join(bridgeState, name));

// 5. 运行状态与日志尾部（不复制完整历史）
copyDir('qq-bridge/state/logs', bridgeState, name => /^bridge\.log(\.1)?$/.test(name));
copyDir('qq-bridge/state/usage', bridgeState, name => /^(tool-calls|token-usage)\.jsonl(\.1)?$/.test(name));
for (const name of ['agents', 'learning-agent', 'learning-window', 'slang-agent', 'sticker-agent']) {
  copyDir(`qq-bridge/state/${name}`, path.join(bridgeState, name));
}

const manifest = {
  schemaVersion: 1,
  label,
  createdAt: new Date().toISOString(),
  projectRoot: root,
  note: '只读快照：用于 V4.2 改造回滚。不要提交到 Git；backups/ 已在 .gitignore 中。',
  files: entries.sort((a, b) => a.path.localeCompare(b.path))
};
fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`已备份 ${entries.length} 个文件到 backups/${label}（共 ${entries.reduce((n, e) => n + e.bytes, 0)} 字节）`);
