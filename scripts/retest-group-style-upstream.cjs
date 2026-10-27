// Only the eight failed scripts from the final audit; all use isolated local fixtures.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), repo = path.join(root, 'integrations/qq-bridge');
const temp = path.join(root, '.cache/style-tests'); fs.mkdirSync(temp, { recursive: true });
const scripts = ['test-audit-bridge.mjs', 'test-audit-setup.mjs', 'test-slang-learn.mjs', 'test-token-economy.mjs', 'test-qq-model-view.mjs', 'test-reply-wait.mjs', 'test-audit-regressions.mjs', 'test-v2-initial-prompt.mjs'];
const env = { ...process.env, TEMP: temp, TMP: temp, QQ_BRIDGE_TEST_LIVE: '0', DSH_HOME: path.join(temp, 'unused-dsh-home'), DSH_INSTALL_MODULES: path.join(root, 'node_modules') };
const results = scripts.map(script => {
  const r = spawnSync(process.execPath, ['scripts/' + script], { cwd: repo, env, encoding: 'utf8', timeout: 60000, windowsHide: true });
  fs.writeFileSync(path.join(root, 'logs/group-style-' + script + '.log'), (r.stdout || '') + (r.stderr || '') + (r.error ? '\n' + r.error.message : ''));
  const pass = r.status === 0 && !r.error; console.log((pass ? 'PASS ' : 'FAIL ') + script); return { script, pass, code: r.status };
});
fs.writeFileSync(path.join(root, 'logs/group-style-upstream-retest.json'), JSON.stringify(results, null, 2));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
