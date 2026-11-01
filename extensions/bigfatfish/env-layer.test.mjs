import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readIfExists = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

// 这是一条真实事故的回归测试：项目根 `.env` 里曾经写着
//   NODE_OPTIONS=--import=.../model-network-preload.mjs
//   NO_PROXY=...
// DSH 0.2.1+ 的 env 分层会**硬拒**这两类"只允许启动环境设置"的变量：
//   Error: dsh: <root>\.env sets "NODE_OPTIONS", which only the launching environment may set
// 结果就是 DSH 进程根本起不来，QQ 侧全盘不可用——而所有单测都还是绿的（没人真的启过 DSH）。
//
// 正确的分层：
//   · 项目根 .env      → 只能放普通配置（API key、说明性注释）
//   · DSH_HOME/.env    → 放 NO_PROXY 这类启动环境变量（不随仓库走）
//   · NODE_OPTIONS     → 只由 services.mjs 在 spawn 子进程时注入
test('project-root .env never sets variables DSH refuses to read from a repository', () => {
  const file = path.join(root, '.env');
  const text = readIfExists(file);
  if (text == null) return; // 没有 .env 也是合法部署
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m) continue;
    assert.notEqual(m[1], 'NODE_OPTIONS', '.env 里的 NODE_OPTIONS 会让 DSH 拒绝启动；改由 services.mjs 注入');
    assert.notEqual(m[1], 'NO_PROXY', '.env 里的 NO_PROXY 会让 DSH 拒绝启动；应放进 DSH_HOME/.env');
  }
});

test('DSH_HOME level env is where the launching-environment variables live', () => {
  const home = path.join(root, 'data-bridge');
  const text = readIfExists(path.join(home, '.env'));
  if (text != null) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (m) assert.notEqual(m[1], 'NODE_OPTIONS', 'DSH 对 NODE_OPTIONS 同样只认启动环境，不认 .env');
    }
  }
  // data-bridge/ 必须被 git 忽略：这里面是运行期私密配置。
  const ignore = readIfExists(path.join(root, '.gitignore')) || '';
  assert.match(ignore, /^data-bridge\/$/m, 'data-bridge/ 必须在 .gitignore 中');
});

test('the service manager injects the model preload itself instead of relying on .env', () => {
  const services = readIfExists(path.join(root, 'extensions', 'bigfatfish', 'services.mjs'));
  assert.ok(services, '需要 services.mjs');
  assert.match(services, /model-network-preload\.mjs/, '管理器必须在 spawn 时注入 preload');
  assert.match(services, /NODE_OPTIONS/, '注入方式就是给子进程设置 NODE_OPTIONS');
  assert.match(services, /data-bridge',\s*'\.env'|data-bridge\\\\.env|path\.join\(this\.root, 'data-bridge', '\.env'\)/, '管理器需要读取 DSH_HOME 级 .env');
});

test('a temp DSH_HOME .env parses into the child environment shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-env-'));
  try {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'NO_PROXY=127.0.0.1\n# comment\n\nDSH_LAUNCH_TOKEN=abc\n');
    const env = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2];
    }
    assert.deepEqual(env, { NO_PROXY: '127.0.0.1', DSH_LAUNCH_TOKEN: 'abc' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
