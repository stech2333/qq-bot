import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { STYLE_TRAITS } from './global-style.mjs';
import { day, SCENES, ACTIONS, STRUCTURES, STRATEGIES, CONDITIONS, enumValue, enumList } from './expression-memory.mjs';

export const GROUP_KEY = /^group:[1-9]\d{4,15}$/;
export const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function groupStyleSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('群风格策略无效');
  const defaults = { enabled: true, apply: true, lookbackHours: 720, minMessages: 20, minDays: 3, minSpeakers: 2, featureMinMessages: 3, refreshHours: 6, minNewMessages: 10, dailyCap: 4, maxChanges: 2 };
  if (Object.keys(value).some(k => !Object.hasOwn(defaults, k))) throw Error('群风格策略包含未知字段');
  const p = { ...defaults, ...value };
  for (const k of ['enabled', 'apply']) if (typeof p[k] !== 'boolean') throw Error('群风格开关无效');
  for (const [k, lo, hi] of [['lookbackHours', 72, 720], ['minMessages', 20, 500], ['minDays', 3, 30], ['minSpeakers', 2, 20], ['featureMinMessages', 3, 48], ['refreshHours', 1, 168], ['minNewMessages', 3, 100], ['dailyCap', 0, 30], ['maxChanges', 1, 3]]) {
    if (!Number.isInteger(p[k]) || p[k] < lo || p[k] > hi) throw Error('群风格门槛无效：' + k);
  }
  if (p.minDays > Math.floor(p.lookbackHours / 24) + 1) throw Error('群风格日期门槛超出窗口');
  return p;
}
const empty = scope => ({ schemaVersion: 2, scope, version: 0, revision: 0, enabled: true, apply: true, locked: false, features: {}, expressionExamples: [], evidence: [], confidence: 0,
  createdAt: Date.now(), updatedAt: 0, lastLearnedAt: 0, cutoff: 0, blocked: {}, generation: randomUUID(), policy: {}, research: {}, lastSources: [], history: [], migration: { source: 'verified-group-window-v2', legacyGlobalImported: false } });
export class GroupStyle {
  constructor(app) { this.app = app; this.states = new Map(); this.errors = new Map(); this.rowsCache = new Map(); }
  file(key) { if (!GROUP_KEY.test(key)) throw Error('群风格作用域无效'); return path.join(this.app.root, 'state', 'group-styles', digest(key) + '.json'); }
  allowed(key) { return GROUP_KEY.test(key) && this.app.globalStyle.allowed(key); }
  load(key) {
    const file = this.file(key);
    if (!this.states.has(key)) {
      let state = empty(key);
      try {
        if (fs.existsSync(file)) {
          state = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (state.schemaVersion !== 2 || state.scope !== key || !Number.isSafeInteger(state.revision) || !Number.isSafeInteger(state.version) || !state.features || Array.isArray(state.features)
            || !Array.isArray(state.expressionExamples) || !Array.isArray(state.history) || typeof state.generation !== 'string' || !state.blocked || !Array.isArray(state.lastSources)) throw Error();
          groupStyleSettings(state.policy);
          for (const k of ['enabled', 'apply', 'locked']) if (typeof state[k] !== 'boolean') throw Error();
          const validEntry = e => e && ['candidate', 'approved', 'rejected'].includes(e.status) && Number.isFinite(e.confidence) && e.confidence >= 0 && e.confidence <= 1 && Array.isArray(e.evidence?.sources)
            && e.evidence.sources.length <= 48 && e.evidence.sources.every(r => /^[a-f\d]{24}$/.test(r.id) && /^[a-f\d]{24}$/.test(r.speaker) && Number.isFinite(r.time));
          for (const [k, f] of Object.entries(state.features)) if (!Object.hasOwn(STYLE_TRAITS, k) || !Object.hasOwn(STYLE_TRAITS[k], f.value) || !validEntry(f)
            || (f.previousApproved && (!validEntry(f.previousApproved) || f.previousApproved.status !== 'approved' || !Object.hasOwn(STYLE_TRAITS[k], f.previousApproved.value)))) throw Error();
          for (const e of state.expressionExamples) if (!validEntry(e) || e.scope !== key || !/^[a-f\d]{24}$/.test(e.id) || !Object.hasOwn(SCENES, e.scene) || !Object.hasOwn(ACTIONS, e.action)
            || !Object.hasOwn(STRUCTURES, e.structure) || !Object.hasOwn(STRATEGIES, e.strategy) || !Array.isArray(e.when) || !Array.isArray(e.avoid)
            || e.when.some(k => !Object.hasOwn(CONDITIONS, k)) || e.avoid.some(k => !Object.hasOwn(SCENES, k))) throw Error();
        }
      } catch { this.errors.set(key, '群风格记录损坏，已停止覆盖'); state = empty(key); }
      this.states.set(key, state);
    }
    return this.states.get(key);
  }
  policy(key) { return groupStyleSettings({ ...this.app.settings.groupStyleLearning, ...this.load(key).policy }); }
  save(key, state) {
    if (this.errors.has(key)) throw Error(this.errors.get(key));
    const file = this.file(key), tmp = file + '.' + randomUUID() + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    this.states.set(key, state); this.rowsCache.delete(key);
  }
  eligible(key) { const st = this.app.states.get(key); return this.allowed(key) && st?.bigfatfish?.memoryControl?.accumulation !== false && !!st && !this.errors.has(key) && this.load(key).enabled && this.policy(key).enabled; }
  rows(key, now = Date.now()) {
    if (!this.allowed(key) || !this.app.states.has(key) || this.app.states.get(key).bigfatfish?.memoryControl?.accumulation === false || this.errors.has(key)) return [];
    const s = this.load(key), st = this.app.states.get(key), p = this.policy(key), window = this.app.learningWindow.load(key, now);
    const cached = this.rowsCache.get(key);
    if (cached && cached.rowsRef === window.rows && cached.recent === st.recentMessages && cached.length === st.recentMessages?.length && cached.revision === s.revision && now - cached.at < 1000) return cached.rows;
    const repeated = new Set(), bursts = new Set(), speakers = new Map(), rows = [];
    for (const m of this.app.learningWindow.messages(key, st, now)) {
      const text = String(m.plain || '').trim();
      if (m.styleSourceVersion !== 2 || m.sourceScope !== key || m.time <= s.cutoff || now - m.time > p.lookbackHours * 3600000 || m.hasForward || m.hasMedia || m.quoted
        || !/^-?[1-9]\d{0,19}$/.test(String(m.messageId)) || text.length < 3 || text.length > 300
        || /```|https?:\/\/|\[CQ:|^[>＞]|[“”「」『』]|(?:转发|引用)(?:消息|内容)|(?:access_token|api.?key|password|密码|手机号)|\d{7,}|(?:忽略|覆盖|修改).{0,10}(?:指令|人格|权限)|(?:傻逼|操你)/i.test(text)) continue;
      const normalized = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
      const burst = m.userId + ':' + Math.floor(m.time / 60000), speakerDay = m.userId + ':' + day(m.time);
      if (repeated.has(normalized) || bursts.has(burst) || (speakers.get(speakerDay) || 0) >= 12) continue;
      repeated.add(normalized); bursts.add(burst); speakers.set(speakerDay, (speakers.get(speakerDay) || 0) + 1);
      rows.push({ id: digest(key + ':' + m.messageId), sourceId: String(m.messageId), speaker: digest(key + ':' + m.userId), time: m.time, text,
        replyTo: m.replyToMessageId ? digest(key + ':' + m.replyToMessageId) : null, adjacentSeq: Number.isSafeInteger(m.seq) ? m.seq : null });
    }
    this.rowsCache.set(key, { rowsRef: window.rows, recent: st.recentMessages, length: st.recentMessages?.length, revision: s.revision, at: now, rows }); return rows;
  }
  sample(key, now = Date.now()) {
    const rows = this.rows(key, now), p = this.policy(key);
    const days = new Set(rows.map(r => day(r.time))).size, speakers = new Set(rows.map(r => r.speaker)).size;
    const lengths = rows.map(r => r.text.length).sort((a, b) => a - b);
    return { messages: rows.length, days, speakers, qualified: rows.length >= p.minMessages && days >= p.minDays && speakers >= p.minSpeakers,
      statistics: { medianChars: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0, shortFraction: rows.length ? lengths.filter(n => n <= 20).length / rows.length : 0,
        questionFraction: rows.length ? rows.filter(r => /[?？]/.test(r.text)).length / rows.length : 0, expressiveFraction: rows.length ? rows.filter(r => /[!！…]/.test(r.text)).length / rows.length : 0 }, retentionHours: p.lookbackHours };
  }
  validEvidence(key, item, now = Date.now(), index) {
    if (item.manual) return true;
    const p = this.policy(key), rows = index || new Map(this.rows(key, now).map(r => [r.id, r]));
    const sources = item.evidence?.sources || [];
    return new Set(sources.map(r => r.id)).size >= p.featureMinMessages && sources.every(r => rows.get(r.id)?.time === r.time && rows.get(r.id)?.speaker === r.speaker)
      && new Set(sources.map(r => r.speaker)).size >= p.minSpeakers && new Set(sources.map(r => day(r.time))).size >= p.minDays;
  }
  active(key, now = Date.now()) {
    if (!this.allowed(key)) return null;
    const s = this.load(key), p = this.policy(key), st = this.app.states.get(key);
    if (this.errors.has(key) || !s.apply || !p.apply || st?.bigfatfish?.memoryControl?.personalization === false) return null;
    const index = new Map(this.rows(key, now).map(r => [r.id, r]));
    return { ...s, features: Object.fromEntries(Object.entries(s.features).map(([k, f]) => [k, f.status === 'approved' ? f : f.previousApproved]).filter(([k, f]) => f && Object.hasOwn(STYLE_TRAITS, k) && Object.hasOwn(STYLE_TRAITS[k], f.value) && f.status === 'approved' && this.validEvidence(key, f, now, index))),
      expressionExamples: s.expressionExamples.filter(e => e.scope === key && e.status === 'approved' && (!e.expiresAt || e.expiresAt > now) && this.validEvidence(key, e, now, index)) };
  }
  record(next, reason, now = Date.now()) {
    if (!next.history.length) next.history.push({ version: next.version, at: now, reason: 'baseline', features: {}, expressionExamples: [] });
    next.version++; next.history.push({ version: next.version, at: now, reason, features: structuredClone(next.features), expressionExamples: structuredClone(next.expressionExamples) }); next.history = next.history.slice(-20);
    next.evidence = [...new Map([...Object.values(next.features), ...next.expressionExamples].flatMap(e => e.evidence?.sources || []).map(r => [r.id, r])).values()];
    const scores = [...Object.values(next.features), ...next.expressionExamples].map(e => e.confidence || 0);
    next.confidence = scores.length ? Math.min(1, ...scores) : 0;
  }
  view(key) { const s = this.load(key); return { ok: true, ...structuredClone(s), policy: this.policy(key), sample: this.sample(key), active: this.active(key), error: this.errors.get(key) || '', traits: STYLE_TRAITS,
    vocabulary: { scene: SCENES, action: ACTIONS, structure: STRUCTURES, strategy: STRATEGIES, when: CONDITIONS, avoid: SCENES }, promptDiagnostics: this.app.styleResolver?.diagnostics.get(key) || null }; }
  admin(method, body) {
    if (method === 'GET' && !body.key) return { ok: true, groups: (this.app.config.allow?.groups || []).map(String).map(id => 'group:' + id).filter(key => this.allowed(key)) };
    const key = String(body.key || ''); if (!this.allowed(key)) throw Error('请选择已启用群');
    const s = this.load(key);
    if (method === 'GET' && body.action === 'evidence') {
      const entry = body.feature ? s.features[body.feature] : s.expressionExamples.find(e => e.id === body.id);
      if (!entry) throw Error('表达记录不存在');
      const index = new Map(this.rows(key).map(r => [r.id, r]));
      return { ok: true, scope: key, sources: (entry.evidence?.sources || []).map(e => index.get(e.id)).filter(Boolean).map(r => ({ id: r.id, speaker: r.speaker, time: r.time, text: r.text, replyTo: r.replyTo })) };
    }
    if (method === 'GET') return this.view(key);
    if (method !== 'POST' || body.revision !== s.revision) throw Error('群风格版本已变化，请刷新');
    const next = structuredClone(s), now = Date.now();
    if (body.action === 'configure') {
      for (const k of ['enabled', 'apply', 'locked']) if (Object.hasOwn(body, k)) { if (typeof body[k] !== 'boolean') throw Error('群风格开关无效'); next[k] = body[k]; }
      if (body.policy) next.policy = groupStyleSettings({ ...this.policy(key), ...body.policy });
    } else if (body.action === 'reset') {
      Object.assign(next, { features: {}, expressionExamples: [], evidence: [], confidence: 0, history: [], cutoff: now, blocked: {}, lastSources: [], generation: randomUUID(), lastLearnedAt: 0 }); next.version++;
    } else if (body.action === 'setFeature') {
      if (!Object.hasOwn(STYLE_TRAITS, body.feature) || !Object.hasOwn(STYLE_TRAITS[body.feature], body.value)) throw Error('群风格特征无效');
      next.features[body.feature] = { value: body.value, status: 'approved', manual: true, locked: true, confidence: 1, evidence: { sources: [], speakerCount: 0, dayCount: 0 }, at: now };
      this.record(next, 'admin');
    } else if (body.action === 'editExpression') {
      const entry = next.expressionExamples.find(e => e.id === body.id); if (!entry) throw Error('表达记录不存在');
      for (const [k, table] of Object.entries({ scene: SCENES, action: ACTIONS, structure: STRUCTURES, strategy: STRATEGIES })) entry[k] = enumValue(table, body[k]);
      entry.when = enumList(CONDITIONS, body.when); entry.avoid = enumList(SCENES, body.avoid);
      entry.locked = true; entry.status = 'candidate'; entry.editedByAdmin = true; entry.updatedAt = now; this.record(next, 'admin-edit');
    } else if (['approve', 'reject', 'delete', 'lock'].includes(body.action)) {
      const entry = body.feature ? next.features[body.feature] : next.expressionExamples.find(e => e.id === body.id);
      if (!entry) throw Error('表达记录不存在');
      const identity = body.feature ? 'feature:' + body.feature : 'expression:' + entry.id;
      if (body.action === 'delete') { if (body.feature) delete next.features[body.feature]; else next.expressionExamples = next.expressionExamples.filter(e => e.id !== body.id); next.blocked[identity] = now; }
      else if (body.action === 'lock') { if (typeof body.locked !== 'boolean') throw Error('锁定值无效'); entry.locked = body.locked; }
      else { if (body.action === 'approve' && !this.validEvidence(key, entry)) throw Error('来源已失效，不能发布'); entry.status = body.action === 'approve' ? 'approved' : 'rejected'; entry.reviewedAt = now; entry.locked = true; if (body.action === 'approve') delete entry.previousApproved; }
      this.record(next, body.action);
    } else if (body.action === 'rollback') {
      const old = next.history.find(h => h.version === body.version); if (!old) throw Error('群风格版本不存在');
      next.features = structuredClone(old.features); next.expressionExamples = structuredClone(old.expressionExamples);
      for (const k of Object.keys(next.features)) if (next.blocked['feature:' + k]) delete next.features[k];
      next.expressionExamples = next.expressionExamples.filter(e => !next.blocked['expression:' + e.id]);
      next.locked = true; this.record(next, 'rollback');
    } else throw Error('群风格操作无效');
    next.revision++; next.updatedAt = now; next.research = {}; this.save(key, next); return this.view(key);
  }
}
