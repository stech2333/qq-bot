// 群友簿：跨会话记住「谁是谁」。
//
// 借鉴 dsh-qq-xiaofeiyu 的 lib/群友簿.js，但适配本项目的存储与权限：
//   · 身份只认 QQ 号；群名片随时会改，昵称只用来显示，不参与认人。
//   · 「谁说话就带谁那一份」——确定性注入，不做相似度检索。库小的时候检索是死循环：
//     库空 → 捞不到 → 更空。而"这个人是谁"根本不需要捞。
//   · 每个会话原本各存一份 memberImpressions（同一个人在 A 群和 B 群的印象互不相通）；
//     这一层按 QQ 号合并，跨群共享，但**私聊里的话不自动带进群**（由调用方决定 scope）。
//
// 可靠性（照抄它的教训）：
//   · 读取失败 = 当作空库用，但绝不回写覆盖原文件（否则一次截断就清空全部印象）；
//   · 写入先写 .tmp 再 rename，半截文件不会顶掉上一份好数据；
//   · 印象有上限（12 条 × 80 字），注入只带最近 4 条，避免上下文膨胀。

import fs from 'node:fs';
import path from 'node:path';

export const PEOPLE_LIMITS = Object.freeze({ maxImpressions: 12, impressionChars: 80, injectCount: 4, maxPeople: 2000 });

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const keyOf = (value) => String(value ?? '').replace(/[^0-9]/g, '');

export function normalizePeopleStore(raw) {
  const out = { version: 1, people: {} };
  if (!raw || typeof raw !== 'object' || !raw.people || typeof raw.people !== 'object') return out;
  for (const [key, person] of Object.entries(raw.people)) {
    const qq = keyOf(person?.qq || key);
    if (!/^[1-9]\d{4,15}$/.test(qq)) continue;
    out.people[qq] = {
      qq,
      nickname: clean(person.nickname, 24),
      aliases: Array.isArray(person.aliases) ? [...new Set(person.aliases.map(a => clean(a, 24)).filter(Boolean))].slice(0, 8) : [],
      firstSeen: Number(person.firstSeen) || 0,
      lastSeen: Number(person.lastSeen) || 0,
      count: Math.max(0, Number(person.count) || 0),
      groups: Array.isArray(person.groups) ? [...new Set(person.groups.map(g => keyOf(g)).filter(Boolean))].slice(0, 50) : [],
      impressions: (Array.isArray(person.impressions) ? person.impressions : [])
        .map(item => ({ text: clean(item?.text, PEOPLE_LIMITS.impressionChars), at: Number(item?.at) || 0, times: Math.max(1, Number(item?.times) || 1), scope: item?.scope === 'private' ? 'private' : 'any' }))
        .filter(item => item.text)
        .slice(-PEOPLE_LIMITS.maxImpressions)
    };
  }
  return out;
}

export class PeopleDirectory {
  constructor(root, { log = () => {} } = {}) {
    this.file = path.join(root, 'state', 'people.json');
    this.log = log;
    this.readOnly = false;
    this.store = { version: 1, people: {} };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return this.store;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.store = normalizePeopleStore(raw);
    } catch (error) {
      // 读坏了：当作空库用，但标记只读，避免把损坏文件覆盖成空库。
      this.readOnly = true;
      this.log(`群友簿读取失败，本轮只读不写：${error?.message ?? error}`);
    }
    return this.store;
  }

  save() {
    if (this.readOnly) return false;
    const people = Object.values(this.store.people);
    if (people.length > PEOPLE_LIMITS.maxPeople) {
      const keep = people.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, PEOPLE_LIMITS.maxPeople);
      this.store.people = Object.fromEntries(keep.map(p => [p.qq, p]));
    }
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 1), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
      return true;
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      this.log(`群友簿保存失败：${error?.message ?? error}`);
      return false;
    }
  }

  // 见到一次：更新昵称/末见/次数/所在群。只改内存，调用方批量结束时 save() 一次。
  see(qq, nickname, { groupId = '', now = Date.now() } = {}) {
    const id = keyOf(qq);
    if (!/^[1-9]\d{4,15}$/.test(id)) return null;
    let person = this.store.people[id];
    if (!person) {
      person = { qq: id, nickname: '', aliases: [], firstSeen: now, lastSeen: 0, count: 0, groups: [], impressions: [] };
      this.store.people[id] = person;
    }
    const name = clean(nickname, 24);
    if (name && name !== person.nickname) person.nickname = name; // 改名直接覆盖，不堆旧名
    person.lastSeen = now;
    person.count = (Number(person.count) || 0) + 1;
    const group = keyOf(groupId);
    if (group && !person.groups.includes(group)) person.groups = [...person.groups, group].slice(-50);
    return person;
  }

  find(ref) {
    const raw = clean(ref, 40);
    if (!raw) return null;
    const id = keyOf(raw);
    if (id && this.store.people[id]) return this.store.people[id];
    if (/^\d+$/.test(raw)) return null;
    // 昵称只做兜底，且必须唯一；撞名宁可认不出，也不猜错人。
    const hits = Object.values(this.store.people).filter(p => p.nickname === raw || p.aliases.includes(raw));
    return hits.length === 1 ? hits[0] : null;
  }

  remember(ref, text, { scope = 'any' } = {}) {
    const person = this.find(ref);
    if (!person) return { ok: false, error: `群友簿里没有这个人：${clean(ref, 20)}（等他先说句话就有了；昵称重名时用 QQ 号）` };
    const note = clean(text, PEOPLE_LIMITS.impressionChars);
    if (!note) return { ok: false, error: '内容不能为空' };
    const existing = person.impressions.find(item => item.text === note);
    if (existing) {
      existing.at = Date.now(); existing.times = (existing.times || 1) + 1;
      return { ok: true, person: person.qq, text: note, duplicate: true };
    }
    person.impressions.push({ text: note, at: Date.now(), times: 1, scope: scope === 'private' ? 'private' : 'any' });
    person.impressions = person.impressions.slice(-PEOPLE_LIMITS.maxImpressions);
    return { ok: true, person: person.qq, text: note, duplicate: false };
  }

  forget(ref, fragment = '') {
    const person = this.find(ref);
    if (!person) return { ok: false, error: '群友簿里没有这个人' };
    if (!fragment) { const n = person.impressions.length; person.impressions = []; return { ok: true, removed: n }; }
    const text = clean(fragment, 80);
    const before = person.impressions.length;
    person.impressions = person.impressions.filter(item => !item.text.includes(text));
    return { ok: true, removed: before - person.impressions.length };
  }

  // 注入用摘要：只带有印象的人；私聊专属印象不带进群。
  summary(qq, { channel = 'any' } = {}) {
    const person = this.store.people[keyOf(qq)];
    if (!person) return '';
    const impressions = person.impressions
      .filter(item => channel !== 'group' || item.scope !== 'private')
      .slice(-PEOPLE_LIMITS.injectCount)
      .map(item => item.text);
    if (!impressions.length) return '';
    const head = `${person.nickname || '群友'}（${person.qq}${person.count >= 10 ? `，聊过 ${person.count} 次` : ''}）`;
    return `${head}：${impressions.join('；')}`;
  }

  view(now = Date.now()) {
    const people = Object.values(this.store.people)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .map(person => ({ ...person, impressions: person.impressions.slice().reverse(), daysSince: person.lastSeen ? Math.floor((now - person.lastSeen) / 86400000) : null }));
    return { ok: true, total: people.length, writable: !this.readOnly, people };
  }
}
