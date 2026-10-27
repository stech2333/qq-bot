import { createHash } from 'node:crypto';
import { canonicalize } from './chat-security.mjs';
import { interestTopic, normalizeInterests } from './interest-memory.mjs';
import { keywordHit } from './policies.mjs';

export const TOPIC_DEFAULTS = Object.freeze({ enabled: true, lookbackHours: 168, minMessages: 5, minSpeakers: 2,
  soloMinMessages: 8, retentionDays: 90, maxTopics: 30, sampleLimit: 10000, autoResearch: true, autoConfirm: true });
export function topicSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('话题学习设置须为对象');
  const p = { ...TOPIC_DEFAULTS, ...value };
  for (const key of ['enabled', 'autoResearch', 'autoConfirm']) if (typeof p[key] !== 'boolean') throw Error('话题学习开关须为布尔值');
  for (const [key, min, max] of [['lookbackHours', 1, 720], ['minMessages', 3, 20], ['minSpeakers', 2, 10], ['soloMinMessages', 3, 20], ['retentionDays', 1, 365], ['maxTopics', 1, 30], ['sampleLimit', 50, 50000]]) {
    if (!Number.isInteger(p[key]) || p[key] < min || p[key] > max) throw Error(`topicLearning.${key} 超出范围`);
  }
  if (p.soloMinMessages < p.minMessages || p.minSpeakers > p.minMessages) throw Error('单人消息门槛不能低于多人门槛，人数门槛不能高于消息门槛');
  return Object.fromEntries(Object.keys(TOPIC_DEFAULTS).map(key => [key, p[key]]));
}
const keyOf = text => canonicalize(text).toLowerCase().replace(/\s+/g, ' ').trim();
const STOP = new Set(('我 你 他 她 它 我们 你们 他们 大家 这个 那个 这些 那些 什么 怎么 为什么 怎么样 可以 可能 应该 还是 就是 不是 没有 有人 一下 一些 很多 一点 今天 昨天 明天 现在 刚才 最近 时候 这样 那样 感觉 觉得 确实 直接 其实 已经 一直 然后 但是 所以 因为 如果 虽然 而且 还有 一个 真的 了吗 呢 吗 啊 哦 嗯 吧 了 的 是 在 和 与 又 都 把 被 给 让 也 就 还 很 太 不 没 有 说 看 听 来 去 到 得 着 过 这 那 谁 谁有 能 不能 好不好 行 不行 怎么办 好像 东西 事情 问题 内容 话题 消息 回复 回答 聊天 喜欢 讨厌 学习 研究 讨论 聊聊 表情 表情包 图片 机器人 肥鱼 哈哈 哈哈哈 呵呵 hhh the this that and for with from you your can are').split(/\s+/));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
for (const word of '我在 你在 他在 还在 能不能 有没有 可不可以 好不好 不知道 知道 明白 办法 死了 笑死 笑死了 不是吧 什么鬼 多少 几个 一把 一只 那就 只要 需要 想要 def return print true false none null const let var function import export'.split(' ')) STOP.add(word);
export function discussionTerms(value, privacy, aliases = []) {
  const text = canonicalize(value).replace(/\[CQ:[^\]]*\]|\[[^\]]{1,60}\]|https?:\/\/\S+|@[^\s，。！？]+/g, ' ').slice(0, 1500);
  if (!privacy.reference(text)) return [];
  const pieces = [...segmenter.segment(text)].filter(part => part.isWordLike), terms = new Map();
  for (let i = 0; i < pieces.length; i++) for (let count = 1; count <= 4 && i + count <= pieces.length; count++) {
    const span = pieces.slice(i, i + count);
    if (span.some(part => STOP.has(keyOf(part.segment)))) break;
    if (span.some((part, index) => index && !/^\s*$/.test(text.slice(span[index - 1].index + span[index - 1].segment.length, part.index)))) break;
    const end = span.at(-1), topic = interestTopic(text.slice(span[0].index, end.index + end.segment.length), privacy);
    if (!topic || topic.length > 20 || /^(?:哈|呵|嘿|啊|哦|嗯|[0-9])+$/.test(topic) || aliases.some(alias => keyOf(topic).includes(keyOf(alias)))) continue;
    terms.set(keyOf(topic), topic);
  }
  return [...terms.values()].slice(0, 100);
}
export class DiscussionTopics {
  constructor(app) { this.app = app; this.cache = new WeakMap(); this.terms = new WeakMap(); }
  scan(state, messages, now = Date.now()) {
    const app = this.app, p = app.settings.topicLearning;
    if (!p.enabled || state.memoryControl?.accumulation === false) return false;
    const seen = new Set(), repeated = new Set();
    const recent = [...(messages || [])].reverse().filter(m => {
      const at = Number(m?.time), uid = String(m?.userId || ''), id = String(m?.messageId ?? '');
      if (!m || m.isSelf || m.topicLearningAllowed === false || !id || !/^[1-9]\d{4,15}$/.test(uid) || uid === String(app.config.bigfatfish?.expectedQQ)
        || !Number.isFinite(at) || at <= 0 || at > now || now - at > p.lookbackHours * 3600000) return false;
      const text = String(m.plain ?? m.text ?? '');
      if (!app.privacy.reference(text) || seen.has(id)) return false;
      seen.add(id);
      const signature = uid + ':' + keyOf(text); if (repeated.has(signature)) return false;
      repeated.add(signature); return true;
    }).slice(0, p.sampleLimit).reverse();
    const signature = () => (state.learnedInterests || []).map(t => [t.topic, t.status, t.admin, t.research?.status, t.evidence?.length, t.lastSeen]);
    const cacheKey = JSON.stringify([p, signature(), recent.map(m => [m.messageId, m.time])]);
    if (this.cache.get(state) === cacheKey) return false;
    const original = normalizeInterests(state.learnedInterests), aliases = app.settings.participation.aliases || [], stats = new Map();
    const existing = original.filter(t => t.admin || t.status === 'blocked' || t.origin !== 'discussion'
      || discussionTerms(t.topic, app.privacy, aliases).some(term => keyOf(term) === keyOf(t.topic)));
    for (const message of recent) {
      const text = String(message.plain ?? message.text ?? ''), aliasKey = JSON.stringify(aliases);
      let memo = this.terms.get(message);
      if (!memo || memo.aliasKey !== aliasKey) { memo = { aliasKey, terms: discussionTerms(text, app.privacy, aliases) }; this.terms.set(message, memo); }
      const terms = [...memo.terms];
      for (const entry of existing) if (keywordHit(text, entry.topic)) terms.push(entry.topic);
      for (const topic of new Set(terms)) {
        const key = keyOf(topic); let stat = stats.get(key);
        if (!stat) { stat = { topic, evidence: new Map() }; stats.set(key, stat); }
        stat.evidence.set(String(message.messageId), { messageId: String(message.messageId), userId: String(message.userId), at: Number(message.time), positive: true });
      }
    }
    const ranked = [...stats.values()].filter(s => s.evidence.size >= 3 || existing.some(t => keyOf(t.topic) === keyOf(s.topic))).sort((a, b) => b.evidence.size - a.evidence.size || b.topic.length - a.topic.length);
    const selected = [];
    for (const stat of ranked) {
      if (selected.some(other => keyOf(other.topic).includes(keyOf(stat.topic)) && other.evidence.size === stat.evidence.size
        && [...stat.evidence.keys()].every(id => other.evidence.has(id)))) continue;
      selected.push(stat); if (selected.length >= 45) break;
    }
    const before = JSON.stringify(original);
    for (const stat of selected) {
      let entry = existing.find(t => keyOf(t.topic) === keyOf(stat.topic));
      if (existing.some(t => t.status === 'blocked' && keywordHit(stat.topic, t.topic))) continue;
      const evidence = [...stat.evidence.values()].sort((a, b) => a.at - b.at), people = new Set(evidence.map(e => e.userId)).size;
      const qualified = evidence.length >= p.minMessages && people >= p.minSpeakers || evidence.length >= p.soloMinMessages;
      if (!entry) { entry = { id: createHash('sha256').update(keyOf(stat.topic)).digest('hex').slice(0, 16), topic: stat.topic, status: 'candidate', admin: false, origin: 'discussion', evidence: [], firstSeen: evidence[0].at, lastSeen: 0 }; existing.push(entry); }
      if (entry.admin || (entry.origin !== 'discussion' && !qualified)) continue;
      entry.origin = 'discussion';
      const merged = new Map(entry.evidence.map(e => [e.messageId, e])); evidence.forEach(e => merged.set(e.messageId, e));
      entry.evidence = [...merged.values()].sort((a, b) => a.at - b.at).slice(-100);
      entry.lastSeen = Math.max(entry.lastSeen, evidence.at(-1).at);
      // Qualified candidates are reviewed asynchronously before becoming active.
      if (qualified && entry.research?.status === 'approved' && p.autoConfirm) { entry.status = 'active'; entry.confirmedAt ||= now; }
    }
    const protectedEntries = existing.filter(t => t.admin || t.status === 'blocked');
    state.learnedInterests = [...protectedEntries, ...existing.filter(t => !t.admin && t.status !== 'blocked')
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.lastSeen - a.lastSeen).slice(0, Math.max(0, 60 - protectedEntries.length))].slice(0, 60);
    this.cache.set(state, JSON.stringify([p, signature(), recent.map(m => [m.messageId, m.time])]));
    return before !== JSON.stringify(state.learnedInterests);
  }
  snapshot(state, now = Date.now()) {
    const topics = this.app.interestMemory.view(state, now), activeIds = new Set(this.app.interestMemory.active(state, now).map(t => t.id));
    const brief = ({ evidence, ...topic }) => topic;
    return { active: topics.filter(t => activeIds.has(t.id)).sort((a, b) => b.messages - a.messages || b.lastSeen - a.lastSeen).slice(0, this.app.settings.topicLearning.maxTopics).map(brief),
      candidates: topics.filter(t => t.status === 'candidate').slice(0, 10).map(brief), learning: this.app.settings.topicLearning };
  }
}
