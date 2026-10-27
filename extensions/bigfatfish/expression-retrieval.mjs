import { expressionText } from './expression-memory.mjs';

export class ExpressionRetrieval {
  constructor() { this.usage = new Map(); }
  retrieve(profile, { scene, condition, query = '', now = Date.now(), preview = false, personaSignature = '' }) {
    if (!profile) return [];
    const usageKey = profile.scope + ':' + personaSignature, used = this.usage.get(usageKey) || [], actions = new Set(), selected = [];
    const candidates = profile.expressionExamples.filter(e => e.scope === profile.scope && e.status === 'approved' && e.scene === scene && !e.avoid?.includes(scene)
      && (!e.expiresAt || e.expiresAt > now) && e.when?.some(k => k === condition || k === 'general') && expressionText(e))
      .map(e => ({ e, score: (e.when.includes(condition) ? 2 : 0) + Math.min(1, Number(e.confidence) || 0) + Math.min(1, (e.evidence?.speakerCount || 0) / 5) - used.filter(id => id === e.id).length * 1.5
        + (query.includes('为什么') && e.structure === 'reasoned' ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id));
    for (const { e, score } of candidates) {
      if (score <= 0 || actions.has(e.action) || used.slice(-2).filter(id => id === e.id).length >= 2) continue;
      selected.push(e); actions.add(e.action); if (selected.length === 2) break;
    }
    // Usage is recorded only after successful delivery; read-only previews never alter ranking.
    return selected;
  }
  markUsed(scope, signature, ids, now = Date.now()) {
    const key = scope + ':' + signature, used = this.usage.get(key) || [];
    this.usage.delete(key); this.usage.set(key, [...used, ...(ids.length ? ids : [null])].slice(-8));
    if (this.usage.size > 500) this.usage.delete(this.usage.keys().next().value);
    return now;
  }
}
