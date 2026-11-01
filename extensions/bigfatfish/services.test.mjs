import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ServiceManager, localPort } from './services.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-services-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'integrations/qq-bridge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'integrations/qq-bridge/config.json'), JSON.stringify({
    consolePort: 3106, bigfatfish: { expectedQQ: '123456789' }, ownerQQ: '987654321', allow: { groups: [], private: [] },
    dsh: { baseUrl: 'http://127.0.0.1:3086' }, snowluma: { homeDir: path.join(root, 'snowluma'), httpUrl: 'http://127.0.0.1:3000' }
  }));
  const running = new Set(), calls = [];
  const manager = new ServiceManager(root, { isListening: async p => running.has(p), readyTimeoutMs: 0 });
  manager.gateway = async () => ({ ready: false });
  return { root, running, calls, manager };
}
test('one-click waits for each dependency and stops in reverse order', async t => {
  const { manager, calls } = fixture(t);
  manager.start = async name => calls.push('start:' + name);
  manager.waitReady = async name => calls.push('ready:' + name);
  manager.stop = async name => calls.push('stop:' + name);
  await manager.action({ action: 'restart', service: 'all' });
  assert.equal((await manager.action({ action: 'start', service: 'all' })).busy, false);
  assert.deepEqual(calls.slice(0, 9), ['stop:bridge', 'stop:dsh', 'stop:snowluma', 'start:snowluma', 'ready:snowluma', 'start:dsh', 'ready:dsh', 'start:bridge', 'ready:bridge']);
});
test('failed gateway readiness prevents downstream startup and clears the operation lock', async t => {
  const { manager, calls } = fixture(t);
  manager.start = async name => calls.push(name);
  manager.waitReady = async () => { throw Error('not ready'); };
  await assert.rejects(manager.action({ action: 'start', service: 'all' }), /not ready/);
  assert.deepEqual(calls, ['snowluma']); assert.equal(manager.busy, false);
});
test('running external services are reused and never killed', async t => {
  const { manager, running } = fixture(t); running.add(3086);
  manager.spawn = () => { throw Error('duplicate spawn'); };
  await manager.start('dsh');
  await assert.rejects(manager.stop('dsh'), /其他入口/);
  running.clear(); await assert.rejects(manager.start('bridge'), /先启动 DSH/);
});
test('concurrent or invalid actions cannot interrupt an existing startup', async t => {
  const { manager } = fixture(t); manager.busy = true;
  await assert.rejects(manager.action({ action: 'stop', service: 'all' }), /已有/);
  manager.busy = false;
  await assert.rejects(manager.action({ action: 'start', service: 'qq' }), /参数/);
});
test('spawn error is observable and process bookkeeping is cleared', async t => {
  const { manager, running } = fixture(t); running.add(3086);
  const child = new EventEmitter(); child.pid = 42; child.exitCode = null;
  manager.spawn = () => child; await manager.start('bridge');
  const error = new Error('fake'); error.code = 'ENOENT'; child.emit('error', error);
  assert.equal(manager.children.has('bridge'), false);
  assert.equal((await manager.status()).services.bridge.error, 'ENOENT');
});
test('local service addresses cannot redirect startup or credentials to a remote host', () => {
  assert.equal(localPort('http://127.0.0.1:3086'), 3086);
  for (const address of ['http://example.com:3086', 'http://user:secret@localhost:3086', 'file:///etc/passwd']) assert.throws(() => localPort(address));
});

test('model services inject the campus preload and never trust NODE_OPTIONS from a project .env', t => {
  const { manager, root } = fixture(t);
  // 真实事故：项目根 .env 写 NODE_OPTIONS 会让 DSH 直接拒绝启动
  // （"only the launching environment may set"），所以这里必须忽略它。
  fs.writeFileSync(path.join(root, '.env'), 'NODE_OPTIONS=--max-old-space-size=1024\nFOO=bar\n');
  for (const name of ['dsh', 'bridge']) {
    const env = manager.environment(name);
    assert.match(env.NODE_OPTIONS, /--import=file:.*model-network-preload\.mjs/);
    assert.doesNotMatch(env.NODE_OPTIONS, /max-old-space-size/, '.env 里的 NODE_OPTIONS 必须被忽略');
    assert.equal(env.FOO, 'bar', '普通变量仍然从项目 .env 读取');
  }
});

test('launching-environment NODE_OPTIONS is preserved and DSH_HOME .env is layered in', t => {
  const { manager, root } = fixture(t);
  fs.mkdirSync(path.join(root, 'data-bridge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data-bridge', '.env'), 'NO_PROXY=127.0.0.1\nNODE_OPTIONS=--trace-warnings\n');
  const previous = process.env.NODE_OPTIONS;
  try {
    manager.shouldRestore = undefined;
    // 模拟"启动器自己导出了 NODE_OPTIONS"——这是 DSH 允许的唯一来源。
    process.env.NODE_OPTIONS = '--enable-source-maps';
    const env = manager.environment('dsh');
    assert.match(env.NODE_OPTIONS, /--enable-source-maps/, '启动环境的 NODE_OPTIONS 必须保留');
    assert.match(env.NODE_OPTIONS, /--import=file:.*model-network-preload\.mjs/);
    assert.doesNotMatch(env.NODE_OPTIONS, /--trace-warnings/, 'DSH_HOME/.env 里的 NODE_OPTIONS 同样不可信');
    assert.equal(env.NO_PROXY, '127.0.0.1', 'NO_PROXY 这类启动环境变量应来自 DSH_HOME/.env');
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
  }
});
test('gateway startup uses bundled Node and enables discovery without changing saved runtime preferences', async t => {
  const { manager, root } = fixture(t); const home = path.join(root, 'snowluma'); fs.mkdirSync(home);
  for (const file of ['node.exe', 'index.mjs', 'check-node-version.cjs']) fs.writeFileSync(path.join(home, file), '');
  const commands = []; manager.exec = async (...args) => { commands.push(args); return {}; };
  const child = new EventEmitter(); child.pid = 123; child.exitCode = null;
  let started; manager.spawn = (exe, args, options) => { started = { exe, args, options }; return child; };
  await manager.start('snowluma');
  assert.equal(commands[0][0], path.join(home, 'node.exe'));
  assert.equal(started.exe, path.join(home, 'node.exe')); assert.equal(started.options.cwd, home);
  assert.equal(started.options.env.SNOWLUMA_HOOK_AUTOLOAD, 'true');
  assert.equal(fs.existsSync(path.join(home, 'config/runtime.json')), false);
});
test('stop-all leaves external components running without blocking other shutdowns', async t => {
  const { manager, running } = fixture(t); running.add(5099);
  const status = await manager.action({ action: 'stop', service: 'all' });
  assert.equal(status.services.snowluma.running, true);
  assert.match(status.step, /已保留/);
});
test('a signal-terminated child is stopped even when its numeric exit code is null', async t => {
  const { manager, running } = fixture(t); running.add(3086);
  const child = new EventEmitter(); child.pid = 42; child.exitCode = null; child.signalCode = null;
  child.kill = () => { child.signalCode = 'SIGTERM'; child.emit('exit', null, 'SIGTERM'); };
  manager.spawn = () => child;
  await manager.start('bridge'); await manager.stop('bridge');
  assert.equal(manager.children.has('bridge'), false);
});
