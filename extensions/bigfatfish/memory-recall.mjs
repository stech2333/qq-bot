import { canonicalize } from './chat-security.mjs';

const DAY = 86400000;
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const STOP = new Set('我 你 他 她 它 我们 你们 他们 的 了 啊 呢 吗 在 是 有 和 就 都 也 还 很 这个 那个 什么 怎么 今天 昨天 现在 最近 时候 可以 知道 觉得 喜欢 之前 以前 记得 告诉 说 一下 哈哈 嗯嗯 在吗'.split(' '));
export function memoryTerms(text) {
  return [...new Set([...segmenter.segment(canonicalize(text).toLowerCase())]
    .filter(row => row.isWordLike && !STOP.has(row.segment) && !/^\d+$/.test(row.segment))
    .map(row => row.segment).filter(word => word.length > 1 || /^[a-z]$/i.test(word)))].slice(0, 80);
}
export function memoryFreshness(fact, policy, now = Date.now()) {
  if (fact.kind === 'stable') return 1;
  const age = Math.max(0, now - Number(fact.updatedAt || fact.at || now));
  return 2 ** (-age / ((policy.halfLifeDays || 90) * DAY));
}
export function memoryRoute(query, now=Date.now()) {
  const history=/(?:之前|以前|上次|昨天|前天|今天|最近|历史|决定|约定|结果|后来|记得|说过|聊过)/.test(query);
  const offset=8*3600000, start=Math.floor((now+offset)/86400000)*86400000-offset;
  const days=/前天/.test(query)?2:/昨天/.test(query)?1:/今天/.test(query)?0:null;
  return { history, timeRange:days===null?null:[start-days*86400000,start+(1-days)*86400000] };
}
// Relevance gates recall; freshness only orders eligible memories. Reading never reinforces a fact.
export function recallTrace(facts, query, policy, privacy, now = Date.now(), context = {}) {
  const terms = memoryTerms(query), source = Array.isArray(facts) ? facts.filter(f => f && typeof f.text === 'string') : [];
  const firstPerson = /(?:我(?:之前|以前|上次|喜欢|说过|的|记得)|关于我|我的偏好|what did I|my preference)/i.test(query);
  const preferenceQuery=firstPerson&&/(?:喜欢|偏好|爱好|preference)/i.test(query);
  const sets = source.map(f => new Set(memoryTerms(f.text + ' ' + (f.tags || []).join(' '))));
  const df = new Map(terms.map(term => [term, sets.filter(set => set.has(term)).length]));
  const weight = term => 1 + Math.log(1 + source.length / (1 + (df.get(term) || 0)));
  const total = terms.reduce((sum, term) => sum + weight(term), 0);
  const rows = source.map((fact, i) => {
    const matched = terms.filter(term => sets[i].has(term));
    const ownPreference=preferenceQuery&&String(fact.source?.userId||'')===String(context.userId)&&/(?:喜欢|偏好|爱好|preference)/i.test(fact.text+' '+(fact.factKey||''));
    const evidence = total ? Math.max(ownPreference?0.5:0, matched.reduce((sum, term) => sum + weight(term), 0) / total) : ownPreference?0.5:0;
    const freshness = memoryFreshness(fact, policy, now);
    const ownerMismatch = firstPerson && (!context.userId || String(fact.source?.userId || '') !== String(context.userId));
    const eventAt=Number(fact.source?.at || fact.at || 0);
    const outsideTime=context.timeRange && (eventAt<context.timeRange[0] || eventAt>=context.timeRange[1]);
    let reason = outsideTime ? '不在询问的事件时间范围' : ownerMismatch ? '不是当前成员的事实' : context.deleted?.includes(fact.id) ? '来源已删除' : !privacy.reference(fact.text) ? '隐私或不适合引用'
      : fact.expiresAt && fact.expiresAt <= now ? '已过期'
      : Number(fact.confidence ?? 1) < policy.minConfidence ? '置信度不足'
      : !terms.length && !ownPreference ? '问句缺少具体检索词'
      : !matched.length && !ownPreference ? '没有命中具体检索词'
      : evidence < (policy.evidenceThreshold ?? 0.15) ? '相关证据不足' : '';
    return { id: fact.id, fact, matched, evidence: +evidence.toFixed(3), freshness: +freshness.toFixed(3),
      score: evidence * 4 + Number(fact.importance ?? 0.5) + freshness + Math.min(0.5, Math.log2(Math.max(1, Number(fact.confirmations || 1))) / 10), reason, selected: false };
  });
  const selected = []; let chars = 0, stable = 0;
  for (const row of [...rows].filter(r => !r.reason).sort((a, b) => b.score - a.score)) {
    // Budget counts the actual quoted representation, including provenance and time.
    const size = JSON.stringify(memoryQuote(row.fact)).length + 1;
    row.reason = selected.length >= policy.recallLimit ? '召回条数已满'
      : row.fact.kind === 'stable' && stable >= (policy.stableLimit ?? 2) ? '长期事实名额已满'
      : chars + size > (policy.maxChars ?? 1600) ? '召回字数预算不足' : '';
    if (!row.reason) { row.selected = true; row.reason = '已召回'; selected.push(row.fact); chars += size; if (row.fact.kind === 'stable') stable++; }
  }
  return { selected, at: now, query: String(query).slice(0, 300), terms, chars,
    rows: rows.map(({ fact, score, ...r }) => ({ ...r, text: privacy.reference(fact.text) ? fact.text : '（不适合引用）', score: +score.toFixed(3) })) };
}
export function memoryQuote(fact) {
  return { id: fact.id, userId: fact.source?.userId || null, text: fact.text,
    recordedAt: fact.at ? new Date(fact.at).toISOString() : null, kind: fact.kind || 'event',
    ...(Number.isFinite(fact.source?.at) ? {sourceAt:new Date(fact.source.at).toISOString()} : {}),
    ...(fact.factKey ? { factKey: fact.factKey } : {}) };
}
