import { canonicalize } from './chat-security.mjs';
import { recallTrace } from './memory-recall.mjs';

export const POLICY_DEFAULTS = {
  interestPolicy: { enabled: true, wakeThreshold: 70, proactiveThreshold: 45, halfLifeMinutes: 180, wakeCooldownMinutes: 20 },
  schedule: { enabled: true, minCheckMinutes: 10, maxCheckMinutes: 20, weekdays: [1, 2, 3, 4, 5, 6, 7], hourlyCap: 1, globalDailyCap: 6,
    privateEnabled: false, replyWaitMinutes: 30, maxUnanswered: 2, maxIdleHours: 48, retryMinutes: 20, topicCooldownMinutes: 720,
    dailyAttemptCap: 6, globalDailyAttemptCap: 12, openingMotivation: '刚才聊的话题让我有了一个具体想法，想接着分享一点。' },
  memory: { maxFacts: 80, recallLimit: 8, halfLifeDays: 90, minConfidence: 0.6, pendingMinutes: 120, topicHours: 24, summaryMaxChars: 3000,
    maxChars: 1600, evidenceThreshold: 0.15, stableLimit: 2, dailyQuota: 8 }
};
export function policySettings(value) {
  const out = {};
  for (const [group, defaults] of Object.entries(POLICY_DEFAULTS)) {
    if (value[group] != null && (typeof value[group] !== 'object' || Array.isArray(value[group]))) throw Error(`${group} 设置无效`);
    out[group] = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, value[group]?.[key] ?? fallback]));
  }
  const ranges = {
    interestPolicy: { wakeThreshold: [0, 100], proactiveThreshold: [0, 100], halfLifeMinutes: [10, 10080], wakeCooldownMinutes: [1, 1440] },
    schedule: { minCheckMinutes: [1, 1440], maxCheckMinutes: [1, 1440], hourlyCap: [0, 10], globalDailyCap: [0, 100], replyWaitMinutes: [1, 1440],
      maxUnanswered: [1, 10], maxIdleHours: [1, 720], retryMinutes: [1, 1440], topicCooldownMinutes: [1, 10080], dailyAttemptCap: [0, 100], globalDailyAttemptCap: [0, 200] },
    memory: { maxFacts: [1, 200], recallLimit: [1, 20], halfLifeDays: [1, 3650], minConfidence: [0, 1], pendingMinutes: [1, 10080], topicHours: [1, 720], summaryMaxChars: [100, 4000],
      maxChars: [100, 10000], evidenceThreshold: [0, 1], stableLimit: [0, 20], dailyQuota: [0, 100] }
  };
  for (const [group, fields] of Object.entries(ranges)) for (const [key, [lo, hi]] of Object.entries(fields)) {
    const n = out[group][key]; if (!Number.isFinite(n) || n < lo || n > hi || (!['minConfidence', 'evidenceThreshold'].includes(key) && !Number.isInteger(n))) throw Error(`${group}.${key} 超出范围`);
  }
  for (const [g, k] of [['interestPolicy', 'enabled'], ['schedule', 'enabled'], ['schedule', 'privateEnabled']]) if (typeof out[g][k] !== 'boolean') throw Error(`${g}.${k} 必须为开关`);
  if (typeof out.schedule.openingMotivation !== 'string' || out.schedule.openingMotivation.length > 200) throw Error('主动开场动机最多200字');
  if (out.schedule.maxCheckMinutes < out.schedule.minCheckMinutes) throw Error('检查间隔上限不能小于下限');
  if (!Array.isArray(out.schedule.weekdays) || !out.schedule.weekdays.length || out.schedule.weekdays.some(n => !Number.isInteger(n) || n < 1 || n > 7)) throw Error('请选择有效的星期（1至7）');
  out.schedule.weekdays = [...new Set(out.schedule.weekdays)].sort();
  const weights = value.interestWeights ?? {};
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw Error('兴趣权重无效');
  out.interestWeights = Object.fromEntries((value.interests ?? []).map(term => {
    const weight = weights[term] ?? 1; if (!Number.isFinite(weight) || weight < 0 || weight > 5) throw Error('兴趣权重须介于0和5'); return [term, weight];
  }));
  return out;
}
export const clockParts = time => {
  const date = new Date(time + 8 * 3600000);
  return { day: date.toISOString().slice(0, 10), weekday: date.getUTCDay() || 7, hour: date.getUTCHours() };
};
export function quietAt(time, cold) {
  const h = clockParts(time).hour;
  return cold.quietStart === cold.quietEnd ? false : cold.quietStart < cold.quietEnd ? h >= cold.quietStart && h < cold.quietEnd : h >= cold.quietStart || h < cold.quietEnd;
}
export function keywordHit(text, term) {
  const s = canonicalize(text).toLowerCase(), key = canonicalize(term).toLowerCase();
  if (!key) return false;
  if (/^[a-z0-9]+$/.test(key)) return new RegExp(`(^|[^a-z0-9])${key}($|[^a-z0-9])`, 'i').test(s);
  return s.includes(key);
}
export const factKey = text => canonicalize(text).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export function interestScore(st, settings, now = Date.now()) {
  const recent = (st.recentMessages ?? []).filter(m => !m.isSelf && now - Number(m.time || 0) <= 24 * 3600000).slice(-40);
  const terms = [], matchedUsers = new Set(); let relevance = 0;
  for (const term of settings.interests) {
    const weight = settings.interestWeights[term] ?? 1; if (!weight) continue;
    const messages = recent.filter(m => keywordHit(m.plain ?? m.text, term));
    if (!messages.length) continue;
    const users = new Set(messages.map(m => String(m.userId ?? m.sender ?? 'unknown')));
    const age = Math.max(0, now - Math.max(...messages.map(m => Number(m.time || 0))));
    const strength = weight * 2 ** (-age / (settings.interestPolicy.halfLifeMinutes * 60000));
    relevance += 25 * strength; users.forEach(id => matchedUsers.add(id));
    terms.push({ term, strength: Math.round(strength * 100) / 100, users: users.size });
  }
  terms.sort((a, b) => b.strength - a.strength);
  const parts = { relevance: Math.min(60, Math.round(relevance)), diversity: Math.min(20, matchedUsers.size * 10),
    continuity: Math.min(10, recent.filter(m => terms.some(t => keywordHit(m.plain ?? m.text, t.term))).length * 2),
    pending: (st.pendingThoughts ?? []).some(t => !t.expiresAt || t.expiresAt > now) ? 10 : 0 };
  return { score: Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)), parts, terms: terms.slice(0, 8), at: now };
}
export function nextCheckTime(st, settings, now = Date.now(), random = Math.random) {
  const p = settings.schedule;
  let next = now + (p.minCheckMinutes + random() * (p.maxCheckMinutes - p.minCheckMinutes)) * 60000;
  next = Math.max(next, Number(st.bigfatfish?.lastAttemptAt || 0) + p.retryMinutes * 60000);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (p.weekdays.includes(clockParts(next).weekday) && !quietAt(next, settings.coldStart)) return Math.round(next);
    next = Math.floor(next / 60000) * 60000 + 60000;
  }
  return Math.round(next);
}
export function recallFacts(facts, text, memory, privacy, now = Date.now()) {
  return recallTrace(facts, text, memory, privacy, now).selected;
}
