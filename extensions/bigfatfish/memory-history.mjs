import { createHash, randomUUID } from 'node:crypto';

export const memoryDigest = text => createHash('sha256').update(String(text).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')).digest('hex');
export function memoryMetadata(input = {}, previous = {}) {
  const key = String(input.factKey ?? previous.factKey ?? '').trim().normalize('NFKC');
  if (key && (!/^[\p{L}\p{N}_-]{1,30}(?:\.[\p{L}\p{N}_-]{1,30}){0,2}$/u.test(key) || key.length > 80)) throw Error('事实键须为对象.方面，最多80字');
  const kind = input.kind ?? previous.kind ?? 'event';
  if (!['event', 'stable'].includes(kind)) throw Error('记忆类型须为事件或长期事实');
  const tags = input.tags ?? previous.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 8 || tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 20)) throw Error('检索词最多8个，每个1至20字');
  return { factKey: key, kind, tags: [...new Set(tags.map(t => t.trim()))] };
}
export function archiveFact(state, fact, reason = '已被修正') {
  state.memoryArchive ??= [];
  state.memoryArchive.push({ archiveId: randomUUID(), at: Date.now(), reason, fact: structuredClone(fact) });
  state.memoryArchive = state.memoryArchive.slice(-200);
}
export function forgetFact(state, fact) {
  state.memoryDeleted ??= [];
  const belongs = row => row.fact?.id === fact.id || (fact.factKey && row.fact?.factKey === fact.factKey && String(row.fact?.source?.userId || '') === String(fact.source?.userId || ''));
  const versions = (state.memoryArchive || []).filter(belongs);
  state.memoryDeleted = [...new Set([...state.memoryDeleted, memoryDigest(fact.text), ...versions.map(row => memoryDigest(row.fact.text))])].slice(-1000);
  state.memoryArchive = (state.memoryArchive || []).filter(row => !belongs(row) && memoryDigest(row.fact?.text) !== memoryDigest(fact.text));
  state.lastRecall = null;
}
export function supersedeMatching(state, fact, privacy) {
  if (!fact.factKey) return;
  for (const old of [...state.facts]) {
    if (old.id === fact.id || old.factKey !== fact.factKey || String(old.source?.userId || '') !== String(fact.source?.userId || '')) continue;
    if (!privacy.reference(old.text)) continue;
    archiveFact(state, old, '同一人的事实键已有新状态');
    state.facts = state.facts.filter(f => f !== old);
  }
}
// Parse locally into reviewable candidates. No file paths are read and no model call is made.
export function importCandidates(text, privacy) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 100000) throw Error('档案须为不超过100KB的纯文本');
  let inCode = false; const seen = new Set(), candidates = []; let skipped = 0;
  for (const [line, raw] of text.split(/\r?\n/).entries()) {
    if (/^\s*(```|~~~)/.test(raw)) { inCode = !inCode; continue; }
    if (inCode || /^\s*(?:#|\||---|\*\*\*|<!--)/.test(raw)) { skipped++; continue; }
    const value = raw.replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, '').trim();
    if (!value) continue;
    if (value.length < 5 || value.length > 500 || !privacy.reference(value)) { skipped++; continue; }
    const digest = memoryDigest(value); if (seen.has(digest)) continue; seen.add(digest);
    candidates.push({ id: randomUUID(), text: value, line: line + 1, digest });
    if (candidates.length === 200) break;
  }
  return { candidates, skipped };
}
