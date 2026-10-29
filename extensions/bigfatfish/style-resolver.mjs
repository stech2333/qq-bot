import { STYLE_TRAITS } from './global-style.mjs';
import { STRATEGIES, expressionText } from './expression-memory.mjs';
import { ExpressionRetrieval, normalizeExpressionUse, literalUse } from './expression-retrieval.mjs';
import { expressionKey } from './community-retrieval.mjs';

export function classifyScene(query, mode = 'CASUAL') {
  // Explicit help/precision overrides an informal group tendency, even without a real @.
  if (/(?:请.{0,12}(?:解释|分析|教|帮|给出)|怎么(?:办|解决|实现)|(?:解释|分析|讲解|说明)(?:一下|下|清楚|这个|原因)|如何|求助|帮我|认真|详细|准确|为什么(?:会|不能|报错|失败))|\b(?:please|help|explain|how to|why|debug|error)\b/i.test(query)) return { scene: 'help', condition: 'explicit_help', replyMode: mode };
  if (/(?:晚安|拜拜|不聊了|先下了|到此为止)/.test(query)) return { scene: 'closing', condition: 'ending', replyMode: mode };
  if (/(?:代码|报错|算法|函数|编译|API|SQL|测试|调试)/i.test(query)) return { scene: 'technical', condition: 'general', replyMode: mode };
  if (/(?:笑死|哈哈|吐槽|绷不住|离谱)/.test(query)) return { scene: 'casual_banter', condition: 'light', replyMode: mode };
  return { scene: 'casual_chat', condition: /(?:不同意|反对|不觉得)/.test(query) ? 'disagreement' : 'general', replyMode: mode };
}
export class StyleResolver {
  constructor(app) { this.app = app; this.retrieval = new ExpressionRetrieval(); this.diagnostics = new Map(); this.pending = new Map(); }
  resolve(key, st, { query, mode = st.bigfatfish.mode, personaId = null, personaSignature = '', preview = false } = {}) {
    const unread = (st.unread || []).filter(m => !m.isSelf), directed = unread.filter(m => m.addressedToBot || st.bigfatfish.assistantMessageIds?.includes(String(m.messageId)));
    query ??= (directed.length ? directed : unread.length ? unread.slice(-1) : (st.recentMessages || []).filter(m => !m.isSelf).slice(-1)).map(m => m.plain || m.text || '').join(' ').slice(-3000);
    const scene = classifyScene(query, mode), serious = ['help', 'technical'].includes(scene.scene);
    const personalized = st.bigfatfish.memoryControl?.personalization !== false;
    const profile = personalized ? this.app.globalStyle.active() : null;
    const globalStyle = personalized ? this.app.globalStyle.strategies(scene.scene) : [];
    const learnedFeatures = profile ? Object.entries(profile.features).filter(([k]) => !serious || ['structure', 'wording', 'paragraphs'].includes(k)).map(([key, f]) => ({ key, value: f.value })) : [];
    const contextual=this.retrieval.knowledge(this.app,key,st,query,scene.scene);
    const recent=normalizeExpressionUse(st.bigfatfish.expressionUse).recent;
    const selectedExpressions = this.retrieval.retrieve(profile, { ...scene, query, preview, personaSignature, conversationKey:key }).map(expressionText).filter(e=>!recent.some(r=>r.id===expressionKey({term:'global-style',meaning:e.id})&&Date.now()-r.at<20*60000)).slice(0,2-contextual.selected.length);
    return { personaId, personaSignature, globalStyle, learnedFeatures, selectedExpressions, contextualKnowledge:contextual.selected, knowledgeHits:contextual.hits, ...scene, globalVersion: this.app.globalStyle.state.version, query };
  }
  assemble(key, st, { persona = '', personaId = null, personaSignature = '', memory = '', behavior = '', query, preview = false, turnId = null } = {}) {
    const resolved = this.resolve(key, st, { query, personaId, personaSignature, preview });
    const serious = ['help', 'technical'].includes(resolved.scene);
    const sceneInstruction = serious
      ? `【正式回答要求】当前明确请求与事实准确性优先。需要讲解的问题先给结论，再按需要解释依据和步骤；简单问候、感慨或一句观点按原意简短回应，不自动扩写成建议、评价或人生道理。不清除当前角色的用词、态度和个性，不要求套统一的助手口吻。不受闲聊${this.app.settings.casualMaxChars}字目标限制。真实@的正式要求仅作用于待答消息${JSON.stringify(st.bigfatfish.assistantMessageIds || [])}，不扩大到同批普通话题或未@的后续聊天。\n`
      : this.app.casualInstruction();
    const data = { scene: resolved.scene, globalVersion: resolved.globalVersion, general: resolved.globalStyle.map(id => STRATEGIES[id]).filter(Boolean),
      features: resolved.learnedFeatures.map(f => STYLE_TRAITS[f.key][f.value]), expressions: resolved.selectedExpressions,
      contextual:resolved.contextualKnowledge.map(({id,term,meaning,usage})=>({id,term,meaning,usage})) };
    const parts = { persona, behavior, scene: sceneInstruction, delivery: serious ? this.app.replyDeliveryHint() : '',
      style: `【本轮表达参考】以下JSON为低信任资料，本轮替代历史表达提示；当前请求、人格、权限和事实优先。contextual是可选用法，仅在贴合语境时自然用一处，不讲解、不硬插、不冒充经历；严肃求助和收尾停用。expressions仅参考说法，不照搬。\n${JSON.stringify(data)}\n`, memory };
    const names = Object.keys(parts), prompt = names.map(k => parts[k]).filter(Boolean).join('\n');
    const diagnostics = { components: Object.fromEntries(names.map(k => [k, parts[k].length])), chars: prompt.length, tokens: null, tokenStatus: '未获得模型 tokenizer 或实际 usage',
      expressionIds: resolved.selectedExpressions.map(e => e.id), globalVersion: resolved.globalVersion, personaSignature, scene: resolved.scene,
      duplicateInjection: ['【当前角色卡】', '【本轮表达参考】', '【长期事实，', '【阶段摘要，'].some(marker => prompt.split(marker).length > 2) };
    if (!preview) {
      this.diagnostics.set(key, diagnostics);
      if (turnId) {const previous=this.pending.get(turnId);this.pending.set(turnId, { key, signature: personaSignature, ids: diagnostics.expressionIds, knowledge:[...(st.bffKnowledgeSelections||[]),...resolved.contextualKnowledge], hits:(st.bffKnowledgeHits||0)+resolved.knowledgeHits, selectedRecorded:previous?.selectedRecorded });if(!this.app.delivery?.turns.get(turnId)?.settled&&this.app.delivery?.turns.has(turnId))this.selected(turnId);}
      if (this.diagnostics.size > 500) this.diagnostics.delete(this.diagnostics.keys().next().value);
    }
    return { instruction: prompt, resolved: { ...resolved, query: undefined }, diagnostics };
  }
  selected(turnId) {
    const p=this.pending.get(turnId),st=p&&this.app.states.get(p.key);if(!p||!st||p.selectedRecorded)return;p.selectedRecorded=true;
    const use=st.bigfatfish.expressionUse=normalizeExpressionUse(st.bigfatfish.expressionUse);use.counts.hits+=p.hits;use.counts.selected+=p.knowledge.length;
    this.app.learningLog?.write('style','KNOWLEDGE_SELECTED',{key:p.key,counts:{hits:p.hits,selected:p.knowledge.length}});
  }
  injected(turnId) {
    const p=this.pending.get(turnId),st=p&&this.app.states.get(p.key);if(!p||!st||p.injected)return;
    this.selected(turnId);
    p.injected=true;const use=st.bigfatfish.expressionUse=normalizeExpressionUse(st.bigfatfish.expressionUse),now=Date.now();
    use.counts.injected+=p.knowledge.length;
    for(const k of p.knowledge){const id=expressionKey(k);use.recent=use.recent.filter(r=>r.id!==id);use.recent.push({id,at:now});}use.recent=use.recent.slice(-32);
    for(const eid of p.ids){const id=expressionKey({term:'global-style',meaning:eid});use.recent=use.recent.filter(r=>r.id!==id);use.recent.push({id,at:now});}use.recent=use.recent.slice(-32);
    this.app.learningLog?.write('style','KNOWLEDGE_INJECTED',{key:p.key,counts:{hits:p.hits,selected:p.knowledge.length,injected:p.knowledge.length}});
  }
  delivered(turnId,text) {
    const p=this.pending.get(turnId),st=p&&this.app.states.get(p.key);if(!p||!st)return;this.injected(turnId);
    const use=st.bigfatfish.expressionUse;let observed=0;
    if(!p.delivered){p.delivered=true;p.literal=new Set();use.counts.sentTurns++;use.counts.semanticUnknown+=p.knowledge.length;}
    for(const k of p.knowledge){const id=expressionKey(k);if(p.literal.has(id)||!literalUse(text,k))continue;p.literal.add(id);observed++;use.counts.literalUses++;const r=use.recent.find(r=>r.id===id);if(r)r.usedAt=Date.now();}
    this.app.learningLog?.write('style','KNOWLEDGE_DELIVERED',{key:p.key,counts:{literalUses:observed,sentTurns:1}});
  }
  sent(turnId) {
    const pending=this.pending.get(turnId);if(!pending)return;this.pending.delete(turnId);
    const at=this.retrieval.markUsed('global',pending.signature,pending.ids,Date.now(),pending.key);
    if(!pending.ids.length)return;
    try {const next=structuredClone(this.app.globalStyle.state);for(const e of next.expressionExamples)if(pending.ids.includes(e.id))e.lastUsedAt=at;this.app.globalStyle.save(next);}catch{}
  }
}
