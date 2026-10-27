import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const TABLES = ['archives', 'facts', 'peers', 'policies', 'session_roots', 'summaries'];
const QQ = /^[1-9]\d{4,15}$/;
const SESSION = /^(group|private):[1-9]\d{4,15}$/;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const record = entry => entry?.data?.record ?? entry?.data;
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
function json(file) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch (error) { return { ok: false, missing: error.code === 'ENOENT' }; }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Only explicit loopback addresses are probed. A configured remote host is never
// resolved, redirected to, or sent a console token by this local checker.
export function localEndpoint(value, protocols = ['http:', 'https:']) {
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export function auditLegacy(root) {
  const repo = path.join(root, 'integrations/qq-bridge');
  const loaded = json(path.join(repo, 'state/legacy-import.json'));
  const result = { available: loaded.ok, valid: false, counts: {}, sessions: 0, summaries: 0, facts: 0,
    bound: 0, unbound: 0, bindingErrors: 0, sourceCompared: false, sourceDrift: 0, sourceErrors: 0 };
  const legacy = loaded.value;
  if (!object(legacy) || legacy.version !== 1 || !object(legacy.tables) || !object(legacy.bound)) return result;
  for (const name of TABLES) {
    const entries = legacy.tables[name];
    if (!Array.isArray(entries) || entries.some(entry => !object(entry) || typeof entry.key !== 'string' || !object(record(entry)))) return result;
    if (new Set(entries.map(entry => entry.key)).size !== entries.length) return result;
    result.counts[name] = entries.length;
  }
  const peers = new Set();
  for (const name of ['summaries', 'facts', 'peers']) for (const entry of legacy.tables[name]) {
    const value = record(entry);
    const key = value.peerKey ?? value.rootKey;
    if (typeof key === 'string' && key) peers.add(key);
  }
  const summaries = new Set(legacy.tables.summaries.map(entry => record(entry).peerKey).filter(key => typeof key === 'string' && key));
  result.valid = true;
  result.sessions = peers.size;
  result.summaries = legacy.tables.summaries.filter(entry => !!String(record(entry).summary ?? '').trim()).length;
  result.facts = legacy.tables.facts.length;
  result.bound = Object.keys(legacy.bound).filter(key => peers.has(key)).length;
  result.unbound = peers.size - result.bound;
  // The runtime imports by a summary peerKey, not an OpenID or a filename.
  result.importableSessions = summaries.size;
  const state = json(path.join(repo, 'state/social-v2.json'));
  for (const [oldKey, target] of Object.entries(legacy.bound)) {
    if (!peers.has(oldKey) || !SESSION.test(target) || !object(state.value?.conversations?.[target]?.bigfatfish)) result.bindingErrors++;
  }
  const source = path.join(root, 'data-bridge/legacy-memory');
  if (!fs.existsSync(source)) return result;
  result.sourceCompared = true;
  for (const name of TABLES) {
    const folder = path.join(source, name);
    const current = new Map();
    try {
      for (const file of fs.readdirSync(folder).filter(file => file.endsWith('.json'))) {
        const data = json(path.join(folder, file));
        if (!data.ok) { result.sourceErrors++; continue; }
        current.set(path.basename(file, '.json'), digest(data.value));
      }
    } catch { result.sourceErrors++; continue; }
    for (const entry of legacy.tables[name]) {
      if (current.get(entry.key) !== digest(entry.data)) result.sourceDrift++;
      current.delete(entry.key);
    }
    result.sourceDrift += current.size;
  }
  return result;
}

// Response data and error messages stay inside the probe. Reports contain only
// fixed messages, counts and booleans; no tokens, paths or memory text.
export async function probeJson(url, token, { timeoutMs = 2500, fetchImpl = fetch } = {}) {
  if (!localEndpoint(String(url))) return { kind: 'blocked' };
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'manual',
      headers: token ? { 'x-console-token': token } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200) { await response.body?.cancel(); return { kind: 'http', status: response.status }; }
    if (!response.body) return { kind: 'invalid' };
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); return { kind: 'invalid' }; }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return { kind: 'ok', data: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch { return { kind: 'unavailable' }; }
}

export async function checkReadiness(root, { online = false, managerPort = 3105, probe = probeJson, env = process.env } = {}) {
  root = path.resolve(root);
  const repo = path.join(root, 'integrations/qq-bridge');
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  const exists = (id, files, message) => {
    const found = files.every(isFile);
    add(id, found ? 'pass' : 'fail', found ? message : '文件缺失或无法读取：' + message);
  };
  const cfgResult = json(path.join(repo, 'config.json'));
  const cfg = object(cfgResult.value) ? cfgResult.value : {};
  add('config.json', cfgResult.ok && object(cfgResult.value) ? 'pass' : 'fail', '桥接配置必须是可解析的 JSON 对象');
  const snapshot = json(path.join(repo, 'UPSTREAM-SNAPSHOT.json'));
  add('upstream.pinned', /^[a-f0-9]{40}$/i.test(snapshot.value?.commit ?? '') ? 'pass' : 'fail', '上游基线须记录完整 commit');
  exists('runtime.files', ['src/bridge.js', 'src/mcp-snowluma-safe.js', 'public/console.html'].map(file => path.join(repo, file)), '桥接入口、QQ 工具和控制台文件完整');
  exists('dsh.installed', [path.join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')], 'DSH 本机运行入口存在');
  exists('bridge.dependencies', ['@snowluma/sdk', '@modelcontextprotocol/sdk', 'zod'].map(name => path.join(repo, 'node_modules', name, 'package.json')), '桥接所需 SDK 与工具依赖存在');
  exists('dsh.profile', ['cordis.yml', 'cordis.patch.yml', 'package.json'].map(file => path.join(root, 'data-bridge/profiles/web', file)), '新版 DSH 使用独立 web profile');
  exists('manager.files', ['scripts/bridge-manager.mjs', 'scripts/open-bridge-manager.ps1', 'scripts/start-qq.ps1', 'extensions/bigfatfish/services.mjs', 'extensions/bigfatfish/manager.html', '一键启动.vbs'].map(file => path.join(root, file)), '一键启动与管理入口文件完整');
  add('account.config', QQ.test(String(cfg.bigfatfish?.expectedQQ ?? '')) && QQ.test(String(cfg.ownerQQ ?? '')) ? 'pass' : 'fail', '机器人账号与管理员账号格式有效');
  const lists = [cfg.allow?.groups, cfg.allow?.private];
  const validLists = lists.every(list => Array.isArray(list) && list.every(id => QQ.test(String(id))));
  const allowed = new Set(validLists ? [...lists[0].map(id => `group:${id}`), ...lists[1].map(id => `private:${id}`)] : []);
  add('access.explicit', cfg.allowAllWhenEmpty === false && validLists && allowed.size > 0 ? 'pass' : 'fail', '参与范围使用明确的群聊/私聊名单');
  const tokenOk = typeof cfg.consoleToken === 'string' && cfg.consoleToken.length >= 16;
  add('console.auth', tokenOk ? 'pass' : 'fail', '控制台配置了管理令牌');
  const dsh = localEndpoint(cfg.dsh?.baseUrl), gateway = localEndpoint(cfg.snowluma?.httpUrl);
  add('dsh.local', dsh ? 'pass' : 'fail', '本机验收要求 DSH 指向回环地址');
  add('gateway.local', gateway && localEndpoint(cfg.snowluma?.wsUrl, ['ws:', 'wss:']) ? 'pass' : 'fail', 'QQ 网关 HTTP 与 WebSocket 指向回环地址');
  const portOk = port => Number.isInteger(port) && port > 0 && port <= 65535;
  const ports = [managerPort, cfg.consolePort, dsh ? Number(dsh.port || (dsh.protocol === 'https:' ? 443 : 80)) : null];
  add('ports.distinct', ports.every(portOk) && new Set(ports).size === ports.length ? 'pass' : 'fail', '管理页、桥接与 DSH 端口有效且互不冲突');
  const mode = json(path.join(repo, 'state/mode.json'));
  add('behavior.reserved2', mode.value?.mode === 'reserved2' && cfg.socialV2?.enabled === true ? 'pass' : 'fail', '启用二代仿真聊天行为');
  exists('persona.file', [path.join(repo, 'roles/大肥鱼.md')], '大肥鱼角色卡存在');
  const settings = json(path.join(repo, 'state/bigfatfish-settings.json'));
  add('behavior.dryRun', settings.missing || settings.value?.coldStart?.dryRun === true ? 'pass' : settings.ok && settings.value?.coldStart?.dryRun === false ? 'warn' : 'fail',
    settings.ok && settings.value?.coldStart?.dryRun === false ? '冷场主动已启用真实发送，测试群验收前需核对' : '冷场主动采用演练配置，缺省值为演练');
  const tools = cfg.socialV2?.tools;
  add('stickers.config', cfg.socialV2?.sticker?.enabled === true && cfg.socialV2?.sticker?.collect?.enabled === true &&
    ['listStickers', 'getStickerImage', 'sendSticker', 'collectSticker', 'stickerNote'].every(key => tools?.[key] === true) ? 'pass' : 'fail', 'QQ 收藏、看图、备注及发送接口已启用');
  const ffmpeg = cfg.socialV2?.voice?.ffmpegPath;
  const ffmpegFound = typeof ffmpeg === 'string' && !!ffmpeg && isFile(path.resolve(repo, ffmpeg));
  add('media.ffmpeg', ffmpegFound ? 'pass' : 'pending', ffmpegFound ? '动图/音频处理所需 ffmpeg 文件可用；完整功能仍需实测' : '未找到已配置的 ffmpeg，需核对安装与目录');
  const voiceDir = cfg.bigfatfish?.voiceToolDir || env.QQ_BRIDGE_VOICE_TOOL_DIR || path.join(repo, '../voice-tool');
  const voiceFound = typeof voiceDir === 'string' && ['voice-cli.mjs', 'voice-gui.mjs'].every(file => isFile(path.resolve(repo, voiceDir, file)));
  add('voice.installed', voiceFound ? 'pass' : 'pending', voiceFound ? '独立 voice-tool 的 CLI 与 GUI 入口存在；功能仍需实测' : '未找到完整的独立 voice-tool，需安装或设置实际目录');
  const migration = auditLegacy(root);
  add('memory.snapshot', migration.valid ? 'pass' : 'fail', '旧记忆迁移快照结构完整');
  const noLegacy = migration.valid && Object.values(migration.counts).every(count => count === 0) && migration.bound === 0 && migration.bindingErrors === 0;
  add('memory.source', noLegacy ? 'pass' : !migration.sourceCompared ? 'pending' : migration.sourceErrors ? 'fail' : migration.sourceDrift ? 'warn' : 'pass',
    noLegacy ? '未保留旧通道历史数据，无需核对历史源库' : !migration.sourceCompared ? '旧记忆源库未找到，无法核对快照' : migration.sourceErrors ? '旧记忆源库存在无法读取的表或记录' : migration.sourceDrift ? '旧库与快照已有差异，正式切换前需重新核对' : '旧记忆源库与快照逐条核对一致');
  add('memory.bindings', !migration.valid || migration.bindingErrors ? 'fail' : migration.unbound ? 'pending' : 'pass',
    !migration.valid ? '迁移快照无效，无法核对绑定' : migration.bindingErrors ? '存在无效绑定或绑定目标缺少落盘状态' : migration.unbound ? '旧会话待管理员核对身份后明确绑定，未自动猜测 QQ 号' : '旧记忆绑定与目标落盘状态已核对');
  if (online) {
    const managerUrl = portOk(managerPort) ? new URL(`http://127.0.0.1:${managerPort}/api/manager/status`) : null;
    const bridgeUrl = portOk(cfg.consolePort) ? new URL(`http://127.0.0.1:${cfg.consolePort}/api/bigfatfish/status`) : null;
    for (const [name, url] of [['manager', managerUrl], ['bridge', bridgeUrl]]) {
      if (!url || !tokenOk) { add(`${name}.online`, 'fail', '配置无效，未执行本机状态探测'); continue; }
      const anonymous = await probe(url);
      add(`${name}.authBoundary`, anonymous.kind === 'http' && [401, 403].includes(anonymous.status) ? 'pass' : anonymous.kind === 'unavailable' ? 'pending' : 'fail',
        anonymous.kind === 'unavailable' ? '服务未就绪，匿名访问拦截待验证' : '状态接口应拒绝未携带管理令牌的访问');
      // If an unexpected service owns this port, do not give it a token.
      if (anonymous.kind !== 'http' || ![401, 403].includes(anonymous.status)) {
        add(`${name}.online`, 'pending', '未确认状态接口鉴权边界，跳过携带令牌的探测'); continue;
      }
      const status = await probe(url, cfg.consoleToken);
      const data = status.data;
      const recognized = status.kind === 'ok' && object(data) && data.ok === true && (name === 'manager' ? object(data.services?.dsh) && object(data.services?.bridge) : object(data.settings) && Array.isArray(data.sessions));
      add(`${name}.online`, recognized ? 'pass' : status.kind === 'unavailable' ? 'pending' : 'fail', '携带管理令牌可读取对应服务的状态接口');
      if (recognized && name === 'manager') {
        for (const service of ['dsh', 'bridge']) add(`${service}.listening`, data.services[service].running === true ? 'pass' : 'pending', `${service === 'dsh' ? 'DSH' : '桥接'} 服务端口已启动；端口状态不代表 QQ 已登录`);
      }
      if (recognized && name === 'bridge') {
        add('qq.login', QQ.test(String(data.gatewayQQ ?? '')) && String(data.gatewayQQ) === String(cfg.bigfatfish?.expectedQQ) ? 'pass' : data.gatewayQQ ? 'fail' : 'pending', '桥接报告的已登录 QQ 须与配置账号一致');
        const upstream = await probe(new URL('/api/status', url), cfg.consoleToken);
        add('dsh.connected', upstream.kind === 'ok' && upstream.data?.dshReady === true ? 'pass' : 'pending', '桥接与 DSH 的实际连接状态已就绪');
      }
    }
    if (!checks.some(check => check.id === 'qq.login')) add('qq.login', 'pending', '桥接状态尚不可读取，QQ 登录身份待验证');
    if (!checks.some(check => check.id === 'dsh.connected')) add('dsh.connected', 'pending', '桥接状态尚不可读取，DSH 实际连接待验证');
  } else add('services.online', 'skipped', '未探测服务；加 --online 可检查本机只读状态接口');
  for (const [id, message] of [['acceptance.chat', '测试群实测真实 @、自然接话、去重与断线恢复'],
    ['acceptance.media', '测试 QQ 收藏、GIF 原样发送和独立语音失败回退'], ['acceptance.cutover', '验证个人 QQ 架构的真实收发与重启恢复']]) add(id, 'pending', message);
  const summary = Object.fromEntries(['pass', 'warn', 'fail', 'pending', 'skipped'].map(status => [status, checks.filter(check => check.status === status).length]));
  return { version: 1, checkedAt: new Date().toISOString(), mode: online ? 'local-online' : 'offline', summary,
    noCheckFailures: summary.fail === 0, qqAcceptanceComplete: false, migration, checks };
}

export function formatReport(report) {
  const labels = { pass: '通过', warn: '注意', fail: '失败', pending: '待完成', skipped: '未检查' };
  const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(report.checkedAt));
  return [`# QQ Bridge 本机验收报告`, '', `检查时间：${time}（北京时间）；模式：${report.mode}`, '',
    `通过 ${report.summary.pass}；注意 ${report.summary.warn}；失败 ${report.summary.fail}；待完成 ${report.summary.pending}；未检查 ${report.summary.skipped}。`, '',
    'QQ 真机验收与服务切换尚需单独完成。依赖文件存在、端口可达均不等于业务验收通过。', '',
    `旧记忆：${report.migration.sessions} 个会话，${report.migration.facts} 条事实，${report.migration.summaries} 份非空摘要；已绑定 ${report.migration.bound}，待绑定 ${report.migration.unbound}。`, '',
    '| 检查 | 状态 | 结果 |', '| --- | --- | --- |',
    ...report.checks.map(check => `| ${check.id} | ${labels[check.status]} | ${check.message} |`), ''].join('\n');
}
