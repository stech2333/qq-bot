import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const EFFORTS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
function normalize(input, previous) {
  const id = previous?.id || randomUUID().replaceAll('-', '');
  const name = String(input.name ?? previous?.name ?? '').trim();
  if (!name || name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) throw fail('名称必填，最多80字');
  const baseURL = String(input.baseURL ?? previous?.baseURL ?? '').trim().replace(/\/+$/, '');
  if (baseURL) {
    let url; try { url = new URL(baseURL); } catch { throw fail('接口基址无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw fail('接口基址必须为不含凭据、查询参数的 HTTPS 地址');
    if (/\/(chat\/completions|messages|responses|models)\/?$/.test(url.pathname)) throw fail('请填写 API 基址，例如 https://token.nuaa.edu.cn/v1，不包含 chat/completions 等操作路径');
  }
  const model = String(input.model ?? previous?.model ?? '').trim();
  if (model.length > 200 || /\s|[\x00-\x1f]/.test(model)) throw fail('模型 ID 不能包含空白，最多200字');
  const protocol = input.protocol ?? previous?.protocol ?? 'openai-completions';
  const effort = input.effort ?? previous?.effort ?? '';
  if (!PROTOCOLS.includes(protocol) || !EFFORTS.includes(effort)) throw fail('协议或思考档位无效');
  const number = (field, fallback, lo, hi) => {
    const value = Number(input[field] ?? previous?.[field] ?? fallback);
    if (!Number.isInteger(value) || value < lo || value > hi) throw fail(`${field} 超出范围`);
    return value;
  };
  for (const key of ['vision', 'deepseekCompat', 'enabled']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw fail(`${key} 必须为布尔值`);
  const contextWindow = number('contextWindow', 65536, 4096, 2000000), maxTokens = number('maxTokens', 4096, 128, 131072);
  if (maxTokens > contextWindow) throw fail('单次输出上限不能大于上下文容量');
  return { id, name, baseURL, model, protocol, effort,
    enabled: input.enabled ?? previous?.enabled ?? true,
    vision: input.vision ?? previous?.vision ?? false,
    deepseekCompat: input.deepseekCompat ?? previous?.deepseekCompat ?? false,
    contextWindow, maxTokens,
    keyStored: previous?.keyStored === true, createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(),
    lastTest: previous?.lastTest ?? null };
}
export function poolRoute(entry) { return `qq-pool-${entry.id}`; }
export function poolCredential(entry) { return `QQ_POOL_${entry.id.toUpperCase()}`; }
// Public, credential-free reachability check. Ordinary 401/403/404 responses are not
// evidence that an authenticated model request will fail; only identify explicit network policy pages.
export async function inspectApiAccess(entry, request = fetch) {
  let response;
  try {
    response = await request(entry.baseURL + '/models', { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (![401, 403, 483].includes(response.status) || !/text\/html/i.test(response.headers.get('content-type') || '')) return null;
    const reader = response.body?.getReader(); if (!reader) return null;
    // Some campus gateways embed a large logo before the short policy notice.
    const limit = 512 * 1024, decoder = new TextDecoder(); let text = '', size = 0;
    try {
      while (size < limit) {
        const chunk = await reader.read(); if (chunk.done) break;
        const part = chunk.value.subarray(0, limit - size); size += part.length; text += decoder.decode(part, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    const visible = text.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    if (!/仅限校内访问|校外.{0,80}(?:VPN|门户)/i.test(visible)) return null;
    return { code: 'CAMPUS_NETWORK_REQUIRED', message: `接口仅限校内网络访问，请连接校园 VPN 后重试，或切回原接口（HTTP ${response.status}）` };
  } catch { return null; } // An unauthenticated preflight cannot replace the real model test.
  finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
}
export function poolSelection(entry) {
  return { provider: poolRoute(entry), model: entry.model, ...(entry.effort ? { reasoningEffort: entry.effort } : {}) };
}
export function poolProfile(entry) {
  const model = { id: entry.model, name: entry.model, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens,
    input: entry.vision ? ['text', 'image'] : ['text'],
    reasoningEfforts: entry.effort && entry.effort !== 'off' ? { off: null, [entry.effort]: entry.effort } : false };
  const compat = entry.protocol === 'openai-completions'
    ? { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens',
      ...(entry.deepseekCompat ? { thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true } : {}) } : undefined;
  return { displayName: entry.name, apiKeyEnv: poolCredential(entry), api: entry.protocol, baseURL: entry.baseURL,
    models: [model], ...(compat ? { compat } : {}), timeoutMs: 120000, streamIdleTimeoutMs: 120000,
    retryPolicy: { mode: 'normal', maxRetries: 1 } };
}

// Metadata only. The actual keys belong to DSH's credential service, never to this document or HTTP responses.
export class ApiPool {
  constructor(root, options) {
    this.file = path.join(root, 'state', 'api-pool.json'); this.options = options; this.tail = Promise.resolve(); this.testing = new Set();
    this.state = { version: 1, revision: 0, activeId: null, entries: [] };
    this.error = '';
    try {
      if (fs.existsSync(this.file)) {
        const doc = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (doc.version !== 1 || !Number.isInteger(doc.revision) || !Array.isArray(doc.entries) || doc.entries.length > 50 ||
            doc.entries.some(e => !/^[a-f0-9]{32}$/.test(e.id) || e.apiKey || e.key || e.secret) ||
            new Set(doc.entries.map(e => e.id)).size !== doc.entries.length ||
            (doc.activeId !== null && !doc.entries.some(e => e.id === doc.activeId))) throw new Error('invalid');
        doc.entries = doc.entries.map(e => ({ ...normalize(e, e), lastTest: e.lastTest?.status === 'running' ? { status: 'interrupted', at: Date.now(), message: '服务重启，测试已中断' } : e.lastTest }));
        this.state = doc;
      }
    } catch { this.error = 'API 池文件损坏或不可读，已停止模型切换，请检查本机状态文件'; }
  }
  lock(work) { const next = this.tail.then(work); this.tail = next.catch(() => {}); return next; }
  check() { if (this.error) throw fail(this.error, 503); }
  commit(next) { this.check(); next.revision = this.state.revision + 1; write(this.file, next); this.state = next; }
  selection() {
    this.check();
    if (!this.state.activeId) return null;
    const entry = this.state.entries.find(e => e.id === this.state.activeId);
    if (!entry?.enabled || !entry.keyStored || !entry.baseURL || !entry.model) throw fail('当前 API 池条目未就绪', 503);
    return poolSelection(entry);
  }
  snapshot() {
    return { ok: !this.error, error: this.error || undefined, revision: this.state.revision,
      activeId: this.state.activeId, fallback: this.options.fallback(), ready: this.options.ready(),
      entries: this.state.entries.map(e => ({ ...e, apiKey: undefined })) };
  }
  async rpc(method, args) {
    if (!this.options.ready()) throw fail('DSH 未连接，请先启动模型服务', 503);
    let response;
    try { response = await this.options.rpc(method, args); }
    catch { throw fail('DSH 请求未完成，请检查模型服务连接', 503); }
    if (!response?.result?.ok) {
      const code = String(response?.result?.error?.code ?? '');
      if (/CONFLICT/i.test(code)) throw fail('DSH 配置已变化，请刷新后重试', 409);
      throw fail(`DSH 配置操作失败（${/^[A-Z_/-]{1,60}$/i.test(code) ? code : '请求被拒绝'}）`, 502);
    }
    return response.result.value;
  }
  async mutate(entry, remove = false) {
    const doc = await this.rpc('settings.describe', {});
    const ns = doc.namespaces?.find(n => n.ns === 'llm-pi-ai');
    if (!doc.writable || !ns) throw fail('当前 DSH 未启用可编辑的多供应商适配器', 503);
    await this.rpc('settings.mutate', { ns: ns.ns, expectedRevision: ns.revision,
      ops: [{ op: remove ? 'unset' : 'set', path: ['providers', poolRoute(entry)], ...(remove ? {} : { value: poolProfile(entry) }) }] });
  }
  revision(value) { if (value !== this.state.revision) throw fail('API 池已被其他操作修改，请刷新后重试', 409); }
  entry(id) { const e = this.state.entries.find(e => e.id === id); if (!e) throw fail('API 条目不存在', 404); return e; }
  async verifyCredential(entry) {
    const ref = poolCredential(entry); const info = await this.rpc('credentials.describe', { refs: [ref] });
    if (!info?.[ref]?.configured) throw fail('该条目没有可用的 API Key，请编辑后重新保存', 400);
  }
  async save(input) {
    return this.lock(async () => {
      this.check(); this.revision(input.revision);
      const previous = input.id ? this.entry(input.id) : undefined;
      if (previous && this.testing.has(previous.id)) throw fail('该条目正在测试，请稍后编辑', 409);
      if (!previous && this.state.entries.length >= 50) throw fail('API 池最多保存50个条目');
      const entry = normalize(input, previous);
      if (entry.id === this.state.activeId && !entry.enabled) throw fail('请先切换到其他条目，再停用当前条目');
      const key = input.apiKey;
      if (key !== undefined && typeof key !== 'string') throw fail('API Key 格式无效');
      if (previous && (key?.trim() || ['baseURL', 'model', 'protocol', 'effort', 'vision', 'deepseekCompat', 'contextWindow', 'maxTokens'].some(field => entry[field] !== previous[field]))) entry.lastTest = null;
      if (key?.trim()) {
        if (key.trim().length < 8 || key.trim().length > 4096 || /\s|[\x00-\x1f]/.test(key.trim())) throw fail('API Key 格式无效');
        await this.rpc('credentials.set', { ref: poolCredential(entry), value: key.trim() });
        this.options.secret?.(key.trim()); entry.keyStored = true;
      }
      if (entry.id === this.state.activeId) {
        if (!entry.baseURL || !entry.model || !entry.keyStored) throw fail('当前条目必须保留接口、模型和密钥');
        await this.mutate(entry);
      }
      try {
        this.commit({ ...this.state, entries: previous ? this.state.entries.map(e => e.id === entry.id ? entry : e) : [...this.state.entries, entry] });
      } catch {
        if (previous?.id === this.state.activeId) { try { await this.mutate(previous); } catch { this.error = 'API 池写入失败，请重启服务前检查配置'; } }
        if (!previous) { try { await this.rpc('credentials.unset', { ref: poolCredential(entry) }); } catch {} }
        throw fail('API 池保存失败，请检查磁盘；已保存的密钥可能已更新', 500);
      }
      if (entry.id === this.state.activeId) this.options.changed();
      return { ok: true, id: entry.id, ...this.snapshot() };
    });
  }
  async activate(input) {
    return this.lock(async () => {
      this.check(); this.revision(input.revision);
      const entry = input.id === null ? null : this.entry(input.id);
      if (entry) {
        if (!entry.enabled || !entry.baseURL || !entry.model || !entry.keyStored) throw fail('请先启用条目并填写接口、模型和 API Key');
        await this.verifyCredential(entry); await this.mutate(entry);
      }
      this.commit({ ...this.state, activeId: entry?.id ?? null }); this.options.changed();
      return { ...this.snapshot(), message: '已切换，下一次模型请求生效；进行中的回复继续完成' };
    });
  }
  async remove(input) {
    return this.lock(async () => {
      this.check(); this.revision(input.revision); const entry = this.entry(input.id);
      if (this.state.activeId === entry.id) throw fail('不能删除正在使用的条目，请先切换');
      if (this.testing.has(entry.id)) throw fail('该条目正在测试，请稍后删除', 409);
      await this.mutate(entry, true);
      await this.rpc('credentials.unset', { ref: poolCredential(entry) });
      this.commit({ ...this.state, entries: this.state.entries.filter(e => e.id !== entry.id) });
      return this.snapshot();
    });
  }
  async test(input) {
    const entry = await this.lock(async () => {
      this.check(); this.revision(input.revision); const e = structuredClone(this.entry(input.id));
      if (this.testing.has(e.id)) throw fail('该条目正在测试', 409);
      if (!e.enabled || !e.baseURL || !e.model || !e.keyStored) throw fail('请先完成条目配置');
      await this.verifyCredential(e); await this.mutate(e);
      this.testing.add(e.id);
      try { this.commit({ ...this.state, entries: this.state.entries.map(x => x.id === e.id ? { ...x, lastTest: { status: 'running', at: Date.now(), message: '内部会话测试中，不发送 QQ 消息' } } : x) }); }
      catch (err) { this.testing.delete(e.id); throw err; }
      return e;
    });
    const start = Date.now(); let result;
    try {
      const access = await this.options.inspectAccess?.(entry);
      if (access?.code === 'CAMPUS_NETWORK_REQUIRED') result = { status: 'failed', code: access.code, at: Date.now(), elapsedMs: Date.now() - start, message: access.message };
      else {
        const text = await this.options.probe({ key: `api-pool:${entry.id}`, modelSelection: poolSelection(entry), timeoutMs: 60000,
          prompt: '这是内部接口连通性测试。请仅回复 API_POOL_OK；不要调用任何工具，不要发送任何QQ消息。' });
        if (!String(text ?? '').includes('API_POOL_OK')) throw new Error('unexpected');
        result = { status: 'passed', at: Date.now(), elapsedMs: Date.now() - start, message: '模型流式文本调用成功；图片、联网和工具能力需另行验证' };
      }
    } catch { result = { status: 'failed', at: Date.now(), elapsedMs: Date.now() - start, message: '模型调用失败或超时，请检查接口协议、模型权限、密钥和额度' }; }
    return this.lock(async () => {
      this.testing.delete(entry.id);
      // DSH's session/selectModel also saves a global default. An internal probe must not leave
      // that default pointing at the tested route, especially when the probe itself failed.
      try { await this.restoreTestDefault(entry); }
      catch { result = { ...result, status: 'failed', message: '测试已结束，但恢复 DSH 默认模型未完成；请检查 DSH 模型设置' }; }
      this.commit({ ...this.state, entries: this.state.entries.map(e => e.id === entry.id ? { ...e, lastTest: result } : e) });
      return { ...this.snapshot(), test: result };
    });
  }
  async restoreTestDefault(entry) {
    const doc = await this.rpc('settings.describe', {});
    const ns = doc.namespaces?.find(n => n.ns === 'agent-default-model');
    if (!ns || ns.value?.provider !== poolRoute(entry)) return;
    const selected = this.selection() || this.options.fallback();
    await this.rpc('settings.mutate', { ns: ns.ns, expectedRevision: ns.revision, ops: [
      { op: 'set', path: ['provider'], value: selected.provider },
      { op: 'set', path: ['model'], value: selected.model },
      selected.reasoningEffort ? { op: 'set', path: ['reasoningEffort'], value: selected.reasoningEffort } : { op: 'unset', path: ['reasoningEffort'] }
    ] });
  }
  async handle(req, url, readBody, send) {
    if (!url.pathname.startsWith('/api/model-pool')) return false;
    if (req.headers['x-agent-token'] !== undefined || req.headers['x-agent-call'] !== undefined) { send({ ok: false, error: 'API 池仅限管理页面访问' }, 403); return true; }
    try {
      if (req.method === 'GET' && url.pathname === '/api/model-pool') send(this.snapshot());
      else if (req.method === 'POST') {
        const action = { '/api/model-pool/save': 'save', '/api/model-pool/activate': 'activate', '/api/model-pool/delete': 'remove', '/api/model-pool/test': 'test' }[url.pathname];
        if (!action) throw fail('接口不存在', 404);
        const body = await readBody(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('请求格式无效');
        send(await this[action](body));
      } else throw fail('请求方法不支持', 405);
    } catch (err) { send({ ok: false, error: err.status ? err.message : 'API 池操作未完成，请检查本机服务和状态文件' }, err.status || 500); }
    return true;
  }
}
