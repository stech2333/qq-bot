import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeMemoryControl } from './memory-control.mjs';
import { interestTopic } from './interest-memory.mjs';
import { archiveFact, forgetFact, memoryDigest, memoryMetadata, supersedeMatching, importCandidates } from './memory-history.mjs';
import { recallTrace, memoryFreshness } from './memory-recall.mjs';

const KEY = /^(group|private):[1-9]\d{4,15}$/;
const copy = value => structuredClone(value);
const safeNumber = (value, fallback, min, max) => {
  const n = value ?? fallback;
  if (!Number.isFinite(n) || n < min || n > max) throw Error('记忆置信度、重要度或有效期无效');
  return n;
};
export class MemoryManager {
  constructor(app) { this.app = app; this.imports = new Map(); }
  forgetSourceFact(state, fact) {
    state.memoryDeleted=[...new Set([...state.memoryDeleted,memoryDigest(fact.text)])].slice(-1000);
    state.lastRecall=null;
  }
  bind(state) {
    state.memoryControl = normalizeMemoryControl(state.memoryControl);
    // Retire old per-conversation styles on migration; facts and interests stay scoped.
    delete state.style; delete state.groupStyle; delete state.styleResearch;
    for (const fact of state.facts || []) if (fact && typeof fact === 'object') delete fact.styleEvidence;
    state.memoryRevision = Math.max(0, Number(state.memoryRevision) || 0);
    state.memoryArchive ??= []; state.memoryDeleted ??= []; state.memoryWrites ??= [];
  }
  reserveWrite(state, sourceId, now = Date.now()) {
    const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
    state.memoryWrites = state.memoryWrites.filter(r => now - r.at < 8 * 86400000).slice(-1000);
    if (state.memoryWrites.some(r => r.sourceId === sourceId)) return;
    if (state.memoryWrites.filter(r => new Date(r.at + 8 * 3600000).toISOString().slice(0, 10) === today).length >= this.app.settings.memory.dailyQuota) throw Error('本会话今日新记忆额度已用完');
    state.memoryWrites.push({ sourceId, at: now });
  }
  hint(st) { this.app.cleanMemory(st); return this.app.globalStyle.hint(st); }
  targetChars(st) {
    this.app.cleanMemory(st);
    return this.app.settings.casualMaxChars;
  }
  snapshot(st) {
    return copy({ bigfatfish: st.bigfatfish, activeTopics: st.activeTopics ?? [], pendingThoughts: st.pendingThoughts ?? [], memberImpressions: st.memberImpressions ?? {} });
  }
  backup(key, snapshot) {
    const directory = path.join(this.app.root, 'state', 'memory-backups');
    fs.mkdirSync(directory, { recursive: true });
    const prefix = createHash('sha256').update(key).digest('hex').slice(0, 16) + '-';
    const name = `${prefix}${Date.now()}-${randomUUID()}.json`;
    // Store only memory and policy state, never a conversation's full chat transcript or tokens.
    const s = snapshot.bigfatfish;
    fs.writeFileSync(path.join(directory, name), JSON.stringify({ version: 1, key, at: Date.now(), memory: {
      facts: s.facts, memoryArchive: s.memoryArchive, memoryDeleted: s.memoryDeleted, memoryWrites: s.memoryWrites,
      summary: s.summary, summaryMeta: s.summaryMeta, memoryControl: s.memoryControl,
      memoryRevision: s.memoryRevision, learnedInterests: s.learnedInterests, activeTopics: snapshot.activeTopics,
      pendingThoughts: snapshot.pendingThoughts, memberImpressions: snapshot.memberImpressions
    } }), { flag: 'wx', mode: 0o600 });
    const files = fs.readdirSync(directory).filter(n => n.startsWith(prefix) && n.endsWith('.json')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 5))) fs.unlinkSync(path.join(directory, old));
  }
  begin(key, st, hooks) {
    const before = this.snapshot(st);
    try { this.backup(key, before); } catch { throw Error('记忆备份失败，已取消修改'); }
    return { key, st, hooks, before };
  }
  rollback(tx) { if (tx) Object.assign(tx.st, tx.before); }
  finish(tx) {
    try {
      this.app.cleanMemory(tx.st);
      tx.st.bigfatfish.lastRecall = null;
      tx.st.bigfatfish.memoryRevision++;
      if (tx.hooks.save({ strict: true }) === false) throw Error('记忆未能保存');
    } catch { this.rollback(tx); throw Error('记忆保存失败，修改未生效'); }
  }
  view(key, st, query = '') {
    this.app.cleanMemory(st);
    const s = st.bigfatfish, q = String(query).trim().toLowerCase();
    return { ok: true, key, revision: s.memoryRevision, control: copy(s.memoryControl),
      facts: copy(s.facts.filter(f => !q || f.text.toLowerCase().includes(q))).map(f => ({ ...f, freshness: memoryFreshness(f, this.app.settings.memory), expired: !!f.expiresAt && f.expiresAt <= Date.now() })),
      archive: copy(s.memoryArchive), lastRecall: copy(s.lastRecall ?? null), deletedCount: s.memoryDeleted.length,
      summary: s.summary, summaryMeta: copy(s.summaryMeta), learningWindow: this.app.learningWindow.snapshot(key, st),
      interests: this.app.interestMemory.view(s).filter(t => !q || t.topic.toLowerCase().includes(q)), interestLearning: this.app.settings.topicLearning,
      limits: { facts: this.app.settings.memory.maxFacts, summaryChars: this.app.settings.memory.summaryMaxChars,
        backups: 5 } };
  }
  async admin(req, body, hooks) {
    const key = String(body.key ?? '');
    if (!KEY.test(key)) throw Error('会话 key 无效');
    const field = key.startsWith('group:') ? 'groups' : 'private', target = key.split(':')[1];
    if (!this.app.states.has(key) && ![...(this.app.config.allow?.[field] ?? []), ...(this.app.config.deny?.[field] ?? [])].map(String).includes(target)) throw Error('请选择已配置的会话');
    const st = hooks.state(key); this.app.bind(key, st);
    if (req.method === 'GET') {
      const view = this.view(key, st, body.query);
      if (body.recallQuery !== undefined) { const { selected, ...trace } = recallTrace(st.bigfatfish.facts, String(body.recallQuery).slice(0, 300), this.app.settings.memory, this.app.privacy); view.previewRecall = trace; }
      return view;
    }
    if (req.method !== 'POST') throw Error('方法不支持');
    const s = st.bigfatfish;
    if (!Number.isSafeInteger(body.revision) || body.revision !== s.memoryRevision) throw Error('记忆已变化，请刷新后再修改');
    if (body.action === 'importPreview') {
      for (const [id, draft] of this.imports) if (Date.now() - draft.at > 900000) this.imports.delete(id);
      if (this.imports.size >= 20) throw Error('导入预览过多，请稍后重试');
      const result = importCandidates(body.text, this.app.privacy);
      const candidates = result.candidates.filter(row => !s.memoryDeleted.includes(row.digest) && !s.facts.some(f => memoryDigest(f.text) === row.digest)
        && !s.memoryArchive.some(entry => memoryDigest(entry.fact?.text) === row.digest));
      const importId = randomUUID(), name = String(body.name || '手动档案').replace(/[\r\n\\/]/g, '_').slice(0, 80);
      this.imports.set(importId, { key, at: Date.now(), revision: s.memoryRevision, candidates, name });
      return { ok: true, key, revision: s.memoryRevision, importId, candidates: candidates.map(({ digest, ...row }) => row), skipped: result.skipped + result.candidates.length - candidates.length };
    }
    const tx = this.begin(key, st, hooks);
    try {
      switch (body.action) {
        case 'deleteArchive': {
          const entry = s.memoryArchive.find(row => row.archiveId === body.archiveId);
          if (!entry) throw Error('历史记忆不存在或不属于此会话');
          const digest = memoryDigest(entry.fact.text);
          s.memoryDeleted = [...new Set([...s.memoryDeleted, digest])].slice(-1000);
          s.memoryArchive = s.memoryArchive.filter(row => memoryDigest(row.fact?.text) !== digest);
          break;
        }
        case 'importCommit': {
          const draft = this.imports.get(body.importId);
          if (!draft || draft.key !== key || draft.revision !== s.memoryRevision || Date.now() - draft.at > 900000) throw Error('导入预览已过期或记忆已变化，请重新预览');
          if (!Array.isArray(body.ids) || !body.ids.length || body.ids.some(id => !draft.candidates.some(row => row.id === id))) throw Error('请选择当前预览中的候选');
          const chosen = draft.candidates.filter(row => body.ids.includes(row.id));
          if (s.facts.length + chosen.length > this.app.settings.memory.maxFacts) throw Error('导入后超出记忆容量，请减少选择或先整理旧记忆');
          for (const row of chosen) s.facts.push({ id: randomUUID(), text: this.app.text(row.text), at: Date.now(), updatedAt: Date.now(),
            confidence: 1, importance: 0.5, kind: 'event', tags: [], confirmations: 1, sourceIds: [],
            source: { admin: true, import: draft.name, line: row.line }, expiresAt: null });
          // Delete the preview only after the transaction is durably saved below.
          break;
        }
        case 'restoreFact': {
          const entry = s.memoryArchive.find(row => row.archiveId === body.archiveId);
          if (!entry || !this.app.privacy.reference(entry.fact.text) || s.memoryDeleted.includes(memoryDigest(entry.fact.text))) throw Error('历史记忆不存在或已删除');
          if (entry.fact.expiresAt && entry.fact.expiresAt <= Date.now()) throw Error('这条历史记忆已过期，请核实后手动新增');
          if (s.facts.length >= this.app.settings.memory.maxFacts && !s.facts.some(f => f.id === entry.fact.id)) throw Error('记忆容量已满，请先整理');
          const existing = s.facts.find(f => f.id === entry.fact.id);
          if (existing) { archiveFact(s, existing, '管理员恢复旧版本前的状态'); s.facts = s.facts.filter(f => f !== existing); }
          const fact = { ...copy(entry.fact), updatedAt: Date.now() }; delete fact.styleEvidence; s.facts.push(fact); supersedeMatching(s, fact, this.app.privacy);
          s.memoryArchive = s.memoryArchive.filter(row => row.archiveId !== entry.archiveId);
          break;
        }
        case 'create': case 'update': {
          if (body.category === 'interest') {
            const topic = interestTopic(body.content, this.app.privacy);
            if (!topic) throw Error('兴趣主题须为2至30字的具体主题名');
            s.learnedInterests ??= [];
            const id = createHash('sha256').update(topic.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
            let entry = s.learnedInterests.find(t => t.id === id);
            if (!entry) { entry = { id, topic, evidence: [], firstSeen: Date.now(), lastSeen: Date.now() }; s.learnedInterests.push(entry); }
            entry.admin = true; entry.status = 'active';
            break;
          }
          if (!['longTerm', 'summary'].includes(body.category)) throw Error('只能管理长期事实或阶段摘要');
          const content = this.app.text(body.content);
          const limit = body.category === 'summary' ? this.app.settings.memory.summaryMaxChars : 500;
          if (content.length > limit) throw Error(`记忆不能超过 ${limit} 字`);
          if (body.category === 'summary') {
            s.summary = content; s.summaryMeta = { at: Date.now(), source: { admin: true } };
          } else {
            const fact = body.action === 'update' ? s.facts.find(f => f.id === body.id) : null;
            if (body.action === 'update' && !fact) throw Error('记忆不存在或不属于此会话');
            if (!fact && s.facts.length >= this.app.settings.memory.maxFacts) throw Error('记忆容量已满，请先整理旧记忆');
            const metadata = memoryMetadata(body, fact || {});
            if ((metadata.factKey && !this.app.privacy.reference(metadata.factKey)) || metadata.tags.some(tag => !this.app.privacy.reference(tag))) throw Error('事实键或检索词不适合保存');
            const confidence = safeNumber(body.confidence, fact?.confidence ?? 1, 0, 1), importance = safeNumber(body.importance, fact?.importance ?? 0.5, 0, 1);
            const days = safeNumber(body.expiresInDays, 0, 0, 3650);
            const next = { text: content, confidence, importance, ...metadata, updatedAt: Date.now(), source: fact?.source || { admin: true },
              confirmations: 1, sourceIds: [], expiresAt: body.expiresInDays === undefined && fact ? fact.expiresAt : (days ? Date.now() + days * 86400000 : null) };
            if (fact) { archiveFact(s, fact); Object.assign(fact, next); supersedeMatching(s, fact, this.app.privacy); }
            else {
              if (s.facts.some(f => f.text === content)) throw Error('已有相同记忆，请编辑原记录');
              s.facts.push({ id: randomUUID(), at: Date.now(), ...next });
              supersedeMatching(s, s.facts.at(-1), this.app.privacy);
            }
          }
          break;
        }
        case 'delete':
          if (body.category === 'summary') { s.summary = ''; s.summaryMeta = null; }
          else if (body.category === 'longTerm') {
            if (!s.facts.some(f => f.id === body.id)) throw Error('记忆不存在或不属于此会话');
            forgetFact(s, s.facts.find(f => f.id === body.id));
            s.facts = s.facts.filter(f => f.id !== body.id);
          } else throw Error('记忆类别无效');
          break;
        case 'clearExpired': break; // finish performs scoped expiry and capacity cleanup.
        case 'interestConfirm': case 'interestBlock': case 'interestResume': {
          const entry = (s.learnedInterests || []).find(t => t.id === body.id);
          if (!entry) throw Error('兴趣不存在或不属于当前会话');
          entry.admin = body.action === 'interestConfirm';
          entry.status = entry.admin ? 'active' : body.action === 'interestBlock' ? 'blocked' : 'candidate';
          if (!entry.admin) { entry.evidence = []; entry.research = { status: 'pending' }; }
          break;
        }
        case 'controls':
          if (typeof body.accumulation !== 'boolean' || typeof body.personalization !== 'boolean') throw Error('记忆开关必须为布尔值');
          s.memoryControl = { accumulation: body.accumulation, personalization: body.personalization };
          break;
        default: throw Error('未知记忆管理操作');
      }
      this.finish(tx);
      if (body.action === 'importCommit') this.imports.delete(body.importId);
      return this.view(key, st);
    } catch (error) { this.rollback(tx); throw error; }
  }
}
