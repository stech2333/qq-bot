// Memory, mood and global style tests. Isolated files and fake model responses; no QQ connection.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), tmp = path.join(root, 'logs/module-tests-temp');
fs.mkdirSync(tmp, { recursive: true });
const env = { ...process.env, TEMP: tmp, TMP: tmp };
const groups = [
  ['--test', 'extensions/bigfatfish/memory-manager.test.mjs', 'extensions/bigfatfish/memory-enhancements.test.mjs', 'extensions/bigfatfish/mood.test.mjs', 'extensions/bigfatfish/global-style.test.mjs', 'extensions/bigfatfish/learning-research.test.mjs'],
  ['--test', '--test-name-pattern', 'facts deduplicate|recall excludes|memory pruning', 'extensions/bigfatfish/policies.test.mjs']
];
for (const args of groups) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}
