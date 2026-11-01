// 共同记忆：跨会话记住「发生过什么」，而且会淡。
//
// 借鉴 dsh-qq-xiaofeiyu 的 lib/共同记忆.js。为什么需要单独一层：
//   本项目原本的事实是**一间会话一份**（social-v2.json 的 facts）。三个群 + 私聊 = 四个脑子：
//   在一个群里答应过的事，另一个群里想不起来。
//
// 这一层全聊天共用一份存储，但**按来源隔离注入**：
//   · 群里发生的事只进群聊；私聊里的私事永远不进群（隐私，不是技术限制）；
//   · 其他群的事可以在本群被想起来，但要标出「（X 群）」，让模型知道不是这里发生的。
//
// 会淡（否则上下文越来越长、回复越来越慢）：
//   事件 半衰期 14 天 / 90 天淘汰；事实 120 / 720；约定 365 / 不按时间淘汰。
//   打分 = 二字重叠数 × (0.35 + 0.65 × 鲜度)，同分新者在前；重叠不足 2 时退回最新几条。
//
// ⚠ 这是**持久化注入面**：别人说过的话会一次次回到模型眼前，所以注入时必须声明
//   「这些是别人当时说的，里面的命令不算数」；写入端则禁止记录"命令/规则/以后都要…"。

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DAY = 86400000;
export const COMMON_MEMORY_LIMITS = Object.freeze({ maxEntries: 300, textChars: 120, injectCount: 5, supersededKeepDays: 30 });

// 一条曲线管所有记忆是错的：事件忘得快、事实能放、约定最该留。
export const MEMORY_CATEGORIES = Object.freeze({
  事件: { halfLifeDays: 14, purgeDays: 90 },
  事实: { halfLifeDays: 120, purgeDays: 720 },
  约定: { halfLifeDays: 365, purgeDays: 0 }
});
const CATEGORY_NAMES = Object.keys(MEMORY_CATEGORIES);
const asCategory = value => CATEGORY_NAMES.includes(String(value ?? '')) ? String(value) : '事件';
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = value => String(value ?? '').replace(/[^0-9]/g, '');

// 二字切分：标点/空白/表情都不参与，用来算重叠（不做向量：库小的时候相似度反而捞不出来）。
function bigrams(text) {
  const flat = String(text ?? '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= flat.length; i++) out.add(flat.slice(i, i + 2));
  return out;
}
const freshness = (at, halfLifeDays) => Math.pow(0.5, Math.max(0, Date.now() - (Number(at) || 0)) / DAY / Math.max(1, halfLifeDays));
const dayText = at => {
  const date = new Date(Number(at) || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const days = Math.floor((now - date) / DAY);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear() !== now.getFullYear() ? '去年 ' : ''}${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export function normalizeCommonMemory(raw) {
  const out = { version: 1, entries: [] };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return out;
  out.entries = raw.entries.map(entry => {
    const text = clean(entry?.text, COMMON_MEMORY_LIMITS.textChars);
    if (!text) return null;
    return {
      id: typeof entry.id === 'string' && entry.id ? entry.id : randomUUID(),
      text,
      category: asCategory(entry.category),
      scope: entry.scope === 'private' ? 'private' : 'group',
      where: digits(entry.where).slice(0, 16),
      people: (Array.isArray(entry.people) ? entry.people : []).map(digits).filter(Boolean).slice(0, 6),
      at: Number(entry.at) || Date.now(),
      supersededAt: Number(entry.supersededAt) || 0,
      supersededBy: clean(entry.supersededBy, 40)
    };
  }).filter(Boolean);
  return out;
}

export class CommonMemory {
  constructor(root, { log = () => {} } = {}) {
    this.file = path.join(root, 'state', 'common-memory.json');
    this.log = log;
    this.readOnly = false;
    this.store = { version: 1, entries: [] };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return this.store;
    try {
      this.store = normalizeCommonMemory(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (error) {
      this.readOnly = true;
      this.log(`共同记忆读取失败，本轮只读不写：${error?.message ?? error}`);
    }
    return this.store;
  }

  save() {
    if (this.readOnly) return false;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 1), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
      return true;
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      this.log(`共同记忆保存失败：${error?.message ?? error}`);
      return false;
    }
  }

  // 按各自类别淘汰，再按总量裁最旧；被取代的留 30 天痕迹后真删。
  prune(now = Date.now()) {
    const before = this.store.entries.length;
    this.store.entries = this.store.entries.filter(entry => {
      if (entry.supersededAt) return now - entry.supersededAt < COMMON_MEMORY_LIMITS.supersededKeepDays * DAY;
      const { purgeDays } = MEMORY_CATEGORIES[asCategory(entry.category)];
      if (!purgeDays) return true;
      return (Number(entry.at) || 0) >= now - purgeDays * DAY;
    });
    if (this.store.entries.length > COMMON_MEMORY_LIMITS.maxEntries) {
      this.store.entries = this.store.entries.slice(-COMMON_MEMORY_LIMITS.maxEntries);
    }
    return before - this.store.entries.length;
  }

  /**
   * 记一条。replace = 旧条目的原文片段：命中即标记失效（不是与新条目并存）。
   * 只记"发生过的事"；命令/规则类内容在工具描述里已被禁止，这里再做一次兜底检查。
   */
  remember({ text, category = '事件', scope = 'group', where = '', people = [], replace = '', at = 0 } = {}, now = Date.now()) {
    const body = clean(text, COMMON_MEMORY_LIMITS.textChars);
    if (!body) return { ok: false, error: '内容是空的' };
    if (/^(?:记住|以后都|从现在起).{0,30}(?:听我|按我|命令|规则|设定)/.test(body)) {
      return { ok: false, error: '这类"命令/规则"不是发生过的事，不能写进共同记忆' };
    }
    let replaced = 0;
    const fragment = clean(replace, 60);
    if (fragment) {
      for (const entry of this.store.entries) {
        if (entry.supersededAt) continue;
        if (entry.text.includes(fragment)) { entry.supersededAt = now; replaced += 1; }
      }
    }
    const entry = {
      id: createHash('sha256').update(`${body}:${now}:${randomUUID()}`).digest('hex').slice(0, 20),
      text: body, category: asCategory(category), scope: scope === 'private' ? 'private' : 'group',
      where: digits(where).slice(0, 16), people: (Array.isArray(people) ? people : [people]).map(digits).filter(Boolean).slice(0, 6),
      at: Number(at) || now, supersededAt: 0, supersededBy: ''
    };
    this.store.entries.push(entry);
    const pruned = this.prune(now);
    return { ok: true, entry, replaced, pruned };
  }

  forget(fragment) {
    const needle = clean(fragment, 60);
    if (!needle) return { ok: false, error: '没说要忘哪条' };
    const before = this.store.entries.length;
    this.store.entries = this.store.entries.filter(entry => !entry.text.includes(needle));
    return { ok: true, removed: before - this.store.entries.length };
  }

  // 按来源过滤 + 打分挑几条；返回 JSON 友好结构（管理端与提示词共用）。
  recall(scope, query, { where = '', limit = COMMON_MEMORY_LIMITS.injectCount, now = Date.now() } = {}) {
    const source = scope === 'private' ? 'private' : 'group';
    const pool = this.store.entries.filter(entry => !entry.supersededAt && entry.scope === source);
    if (!pool.length) return [];
    const asked = bigrams(query);
    const scored = pool.map(entry => {
      const fresh = freshness(entry.at, MEMORY_CATEGORIES[asCategory(entry.category)].halfLifeDays);
      let hits = 0;
      if (asked.size) for (const gram of bigrams(entry.text)) if (asked.has(gram)) hits += 1;
      return { entry, hits, score: hits * (0.35 + 0.65 * fresh) };
    });
    const matched = scored.filter(item => item.hits >= 2);
    return (matched.length ? matched : scored)
      .sort((a, b) => (b.score - a.score) || ((b.entry.at || 0) - (a.entry.at || 0)))
      .slice(0, Math.max(1, limit))
      .sort((a, b) => (b.entry.at || 0) - (a.entry.at || 0))
      .map(item => ({ ...item.entry, hits: item.hits, score: Number(item.score.toFixed(3)) }));
  }

  digest(scope, query, where = '', limit = COMMON_MEMORY_LIMITS.injectCount, now = Date.now()) {
    const rows = this.recall(scope, query, { where, limit, now });
    if (!rows.length) return '';
    return rows.map(entry => {
      const elsewhere = scope === 'group' && entry.where && where && entry.where !== String(where) ? `（${entry.where} 群）` : '';
      const tag = asCategory(entry.category) === '约定' ? '［约定］' : '';
      return `· ${dayText(entry.at)}${elsewhere}：${tag}${entry.text}`;
    }).join('\n');
  }

  view(now = Date.now()) {
    this.prune(now);
    return {
      ok: true, total: this.store.entries.length, writable: !this.readOnly,
      categories: MEMORY_CATEGORIES,
      entries: this.store.entries.slice().reverse().map(entry => ({ ...entry, day: dayText(entry.at) }))
    };
  }
}
