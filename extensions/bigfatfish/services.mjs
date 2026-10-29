import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readOneBotTokens } from '../../integrations/qq-bridge/src/snowluma-conn.js';

const exec = promisify(execFile);
export const START_ORDER = ['snowluma', 'dsh', 'bridge'];
export const STOP_ORDER = [...START_ORDER].reverse();
export function localPort(value, protocol = 'http:') {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== protocol || url.username || url.password) throw new Error('服务地址必须为本机回环地址');
  return Number(url.port || (protocol === 'http:' ? 80 : 443));
}
export function listening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(700); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
  });
}
export class ServiceManager {
  constructor(root, { spawnProcess = spawn, runExec = exec, isListening = listening, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), readyTimeoutMs = 45000 } = {}) {
    this.root = root; this.repo = path.join(root, 'integrations/qq-bridge'); this.logDir = path.join(root, 'logs/bridge');
    this.spawn = spawnProcess; this.listening = isListening; this.sleep = sleep; this.readyTimeoutMs = readyTimeoutMs;
    this.exec = runExec;
    this.children = new Map(); this.errors = new Map(); this.busy = false; this.step = '';
    fs.mkdirSync(this.logDir, { recursive: true });
  }
  config() { return JSON.parse(fs.readFileSync(path.join(this.repo, 'config.json'), 'utf8')); }
  home() { return this.config().snowluma.homeDir || path.join(this.root, 'integrations/SnowLuma'); }
  ports() {
    const c = this.config(); let runtime = {};
    try { runtime = JSON.parse(fs.readFileSync(path.join(this.home(), 'config/runtime.json'), 'utf8')); } catch {}
    return { snowluma: Number(runtime.webuiPort || 5099), dsh: localPort(c.dsh.baseUrl), bridge: Number(c.consolePort) };
  }
  environment(name) {
    if (name === 'snowluma') return { ...process.env, SNOWLUMA_WEBUI_HOST: '127.0.0.1',
      SNOWLUMA_HOOK_AUTOLOAD: this.config().bigfatfish.startup?.autoHook === false ? 'false' : 'true' };
    const env = { ...process.env, DSH_HOME: path.join(this.root, 'data-bridge') };
    const file = path.join(this.root, '.env');
    for (const line of fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    const preload = '--import=' + pathToFileURL(path.join(this.root, 'extensions/bigfatfish/model-network-preload.mjs')).href;
    if (!String(env.NODE_OPTIONS || '').split(/\s+/).includes(preload)) env.NODE_OPTIONS = [env.NODE_OPTIONS, preload].filter(Boolean).join(' ');
    return env;
  }
  async gateway() {
    const cfg = this.config(), uiPort = this.ports().snowluma;
    const result = { webuiRunning: await this.listening(uiPort), webuiPort: uiPort, connected: false, loginVerified: false, online: false, ready: false };
    try {
      const account = readOneBotTokens(this.home()).find(item => item.uin === String(cfg.bigfatfish.expectedQQ));
      const base = account?.http ? `http://127.0.0.1:${account.http.port}` : cfg.snowluma.httpUrl;
      localPort(base);
      if (account?.http && !['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(account.http.host)) return result;
      const token = account?.http?.token || cfg.snowluma.accessToken || '';
      const get = async action => {
        const response = await fetch(`${base}/${action}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'error', signal: AbortSignal.timeout(1500) });
        if (!response.ok) return null;
        const body = await response.json(); return body.retcode === 0 ? body.data : null;
      };
      const [login, status] = await Promise.all([get('get_login_info'), get('get_status')]);
      result.connected = !!login; result.loginVerified = !!login && String(login.user_id) === String(cfg.bigfatfish.expectedQQ);
      result.online = status?.online === true; result.receiveHealthy = status?.good === true;
      result.ready = result.loginVerified && result.online;
    } catch {}
    return result;
  }
  async status() {
    const cfg = this.config(), ports = this.ports(), services = {};
    for (const name of START_ORDER) services[name] = { running: await this.listening(ports[name]), owned: this.children.has(name), pid: this.children.get(name)?.pid ?? null, error: this.errors.get(name) || '' };
    return { ok: true, managerVersion: 2, services, gateway: await this.gateway(), busy: this.busy, step: this.step, warning: this.errors.get('qq') || '', consolePort: cfg.consolePort,
      account: cfg.bigfatfish.expectedQQ, owner: cfg.ownerQQ, allow: cfg.allow };
  }
  async start(name) {
    if (!START_ORDER.includes(name)) throw new Error('组件名称无效');
    if (await this.listening(this.ports()[name])) return;
    if (this.children.has(name)) return;
    if (name === 'bridge' && !await this.listening(this.ports().dsh)) throw new Error('请先启动 DSH，或使用一键启动');
    if (name === 'snowluma') {
      const home = this.home();
      for (const file of ['node.exe', 'index.mjs', 'check-node-version.cjs']) if (!fs.existsSync(path.join(home, file))) throw new Error('SnowLuma 安装不完整');
      await this.exec(path.join(home, 'node.exe'), [path.join(home, 'check-node-version.cjs')], { windowsHide: true, cwd: home, timeout: 10000 });
      if (process.platform === 'win32') {
        try { await this.exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.root, 'scripts/start-qq.ps1')], { windowsHide: true, timeout: 15000 }); }
        catch { this.errors.set('qq', '未能自动打开 QQ，请手动打开已安装的 QQ'); }
      }
    }
    const args = name === 'snowluma' ? [path.join(this.home(), 'index.mjs')] : name === 'dsh'
      ? [path.join(this.root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--host', '127.0.0.1', '--port', String(this.ports().dsh), '--no-open'] : [path.join(this.repo, 'src/bridge.js')];
    const fds = ['out', 'err'].map(kind => fs.openSync(path.join(this.logDir, `${name}.${kind}.log`), 'a'));
    let child;
    try { child = this.spawn(name === 'snowluma' ? path.join(this.home(), 'node.exe') : process.execPath, args,
      { cwd: name === 'snowluma' ? this.home() : this.repo, env: this.environment(name), windowsHide: true, stdio: ['ignore', ...fds] }); }
    finally { fds.forEach(fd => fs.closeSync(fd)); }
    this.children.set(name, child); this.errors.delete(name);
    child.once('error', error => { this.errors.set(name, error.code || '启动失败'); if (this.children.get(name) === child) this.children.delete(name); });
    child.once('exit', code => { if (this.children.get(name) === child) this.children.delete(name); if (code) this.errors.set(name, `退出码 ${code}`); });
  }
  async waitReady(name) {
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.listening(this.ports()[name])) return;
      if (this.errors.has(name)) throw new Error(`${name} 启动失败：${this.errors.get(name)}`);
      await this.sleep(400);
    }
    throw new Error(`${name} 未在等待时间内就绪，请查看管理页中的错误和本机日志`);
  }
  async stop(name) {
    if (!START_ORDER.includes(name)) throw new Error('组件名称无效');
    const child = this.children.get(name);
    if (!child) { if (await this.listening(this.ports()[name])) throw new Error('该服务由其他入口启动，请在原入口停止'); return; }
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode != null) return resolve();
      const timer = setTimeout(resolve, 5000); timer.unref?.(); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill();
    });
    if (child.exitCode === null && child.signalCode == null && this.children.get(name) === child) throw new Error('停止尚未完成，请稍后刷新');
  }
  async action(body) {
    if (this.busy) throw new Error('已有启停操作进行中');
    if (!['start', 'stop', 'restart'].includes(body.action) || !['all', ...START_ORDER].includes(body.service)) throw new Error('操作参数无效');
    this.busy = true;
    try {
      const external = [];
      if (body.action !== 'start') for (const name of body.service === 'all' ? STOP_ORDER : [body.service]) {
        if (body.service === 'all' && !this.children.has(name) && await this.listening(this.ports()[name])) { external.push(name); continue; }
        this.step = `正在停止 ${name}`; await this.stop(name);
      }
      if (body.action !== 'stop') for (const name of body.service === 'all' ? START_ORDER : [body.service]) { this.step = `正在启动 ${name}`; await this.start(name); await this.waitReady(name); }
      this.step = body.action === 'stop' ? '服务已停止，管理页保持可用' : '服务已启动；QQ 登录与网关接入状态见下方';
      if (external.length) this.step += `；${external.join('、')} 由其他入口启动，已保留`;
    } finally { this.busy = false; }
    return await this.status();
  }
}
