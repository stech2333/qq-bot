import { expressionText } from './expression-memory.mjs';
import { expressionKey, fuseKnowledge, expressionScene, termAliases, containsTerm } from './community-retrieval.mjs';

const METRICS=['hits','selected','injected','sentTurns','literalUses','semanticUnknown'];
export function normalizeExpressionUse(value={}) {
  return {counts:Object.fromEntries(METRICS.map(k=>[k,Number.isSafeInteger(value.counts?.[k])&&value.counts[k]>=0?value.counts[k]:0])),
    recent:(Array.isArray(value.recent)?value.recent:[]).filter(r=>r&&/^[a-f0-9]{64}$/.test(r.id)&&Number.isFinite(r.at)).slice(-32).map(r=>({id:r.id,at:r.at,...(Number.isFinite(r.usedAt)?{usedAt:r.usedAt}:{})}))};
}
export function literalUse(text,k) {return termAliases(k.term).some(t=>containsTerm(text,t));}

export class ExpressionRetrieval {
  constructor() { this.usage = new Map(); }
  knowledge(app,key,st,query,scene,{now=Date.now()}={}) {
    if(!app.globalStyle.allowed(key)||!expressionScene(query,scene).allowed)return {hits:0,selected:[]};
    const native=app.slang?.contextEntries(app.slang.entries?.()||[],key,scene,query,{mode:'expression'})||[];
    const community=app.community.retrieve(query,{mode:'expression',scene,limit:2,maxChars:1800});
    const recent=normalizeExpressionUse(st.bigfatfish.expressionUse).recent;
    const pool=fuseKnowledge([...community,...native],{limit:4,maxChars:3500});
    const selected=fuseKnowledge(pool.filter(k=>!recent.some(r=>r.id===expressionKey(k)&&now-r.at<20*60000)),{limit:2,maxChars:Math.max(0,1800-(st.bffKnowledgeChars||0)),exclude:st.bffKnowledgeSelections||[]});
    return {hits:pool.length,selected};
  }
  retrieve(profile, { scene, condition, query = '', now = Date.now(), preview = false, personaSignature = '', conversationKey='' }) {
    if (!profile) return [];
    const usageKey = profile.scope + ':' + personaSignature+':'+conversationKey, used = this.usage.get(usageKey) || [], actions = new Set(), selected = [];
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
  markUsed(scope, signature, ids, now = Date.now(), conversationKey='') {
    const key = scope + ':' + signature+':'+conversationKey, used = this.usage.get(key) || [];
    this.usage.delete(key); this.usage.set(key, [...used, ...(ids.length ? ids : [null])].slice(-8));
    if (this.usage.size > 500) this.usage.delete(this.usage.keys().next().value);
    return now;
  }
}
