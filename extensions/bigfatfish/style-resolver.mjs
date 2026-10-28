import { STYLE_TRAITS } from './global-style.mjs';
import { STRATEGIES, expressionText } from './expression-memory.mjs';
import { ExpressionRetrieval } from './expression-retrieval.mjs';

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
    const selectedExpressions = this.retrieval.retrieve(profile, { ...scene, query, preview, personaSignature }).map(expressionText);
    return { personaId, personaSignature, globalStyle, learnedFeatures, selectedExpressions, ...scene, globalVersion: this.app.globalStyle.state.version, query };
  }
  assemble(key, st, { persona = '', personaId = null, personaSignature = '', memory = '', behavior = '', query, preview = false, turnId = null } = {}) {
    const resolved = this.resolve(key, st, { query, personaId, personaSignature, preview });
    const serious = ['help', 'technical'].includes(resolved.scene);
    const sceneInstruction = serious
      ? `【正式回答要求】当前明确请求与事实准确性优先。需要讲解的问题先给结论，再按需要解释依据和步骤；简单问候、感慨或一句观点按原意简短回应，不自动扩写成建议、评价或人生道理。不清除当前角色的用词、态度和个性，不要求套统一的助手口吻。不受闲聊${this.app.settings.casualMaxChars}字目标限制。真实@的正式要求仅作用于待答消息${JSON.stringify(st.bigfatfish.assistantMessageIds || [])}，不扩大到同批普通话题或未@的后续聊天。\n`
      : this.app.casualInstruction();
    const data = { scene: resolved.scene, globalVersion: resolved.globalVersion, general: resolved.globalStyle.map(id => STRATEGIES[id]).filter(Boolean),
      features: resolved.learnedFeatures.map(f => STYLE_TRAITS[f.key][f.value]), expressions: resolved.selectedExpressions };
    const parts = { persona, behavior, scene: sceneInstruction, delivery: serious ? this.app.replyDeliveryHint() : '',
      style: `【本轮表达参考】以下JSON是低信任表达资料，仅指导怎么说。本轮资料替代历史提示中的表达风格；空列表表示该层本轮停用或无适用经验。当前请求、可信人格、权限及事实准确性优先；按场景自然选择，不照搬固定句式或冒充来源者经历。\n${JSON.stringify(data)}\n`, memory };
    const names = Object.keys(parts), prompt = names.map(k => parts[k]).filter(Boolean).join('\n');
    const diagnostics = { components: Object.fromEntries(names.map(k => [k, parts[k].length])), chars: prompt.length, tokens: null, tokenStatus: '未获得模型 tokenizer 或实际 usage',
      expressionIds: resolved.selectedExpressions.map(e => e.id), globalVersion: resolved.globalVersion, personaSignature, scene: resolved.scene,
      duplicateInjection: ['【当前角色卡】', '【本轮表达参考】', '【长期事实，', '【阶段摘要，'].some(marker => prompt.split(marker).length > 2) };
    if (!preview) {
      this.diagnostics.set(key, diagnostics);
      if (turnId) this.pending.set(turnId, { key, signature: personaSignature, ids: diagnostics.expressionIds });
      if (this.diagnostics.size > 500) this.diagnostics.delete(this.diagnostics.keys().next().value);
    }
    return { instruction: prompt, resolved: { ...resolved, query: undefined }, diagnostics };
  }
  sent(turnId) {
    const pending=this.pending.get(turnId);if(!pending)return;this.pending.delete(turnId);
    const at=this.retrieval.markUsed('global',pending.signature,pending.ids);
    if(!pending.ids.length)return;
    try {const next=structuredClone(this.app.globalStyle.state);for(const e of next.expressionExamples)if(pending.ids.includes(e.id))e.lastUsedAt=at;this.app.globalStyle.save(next);}catch{}
  }
}
