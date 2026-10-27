// Closed vocabulary: learned text can never create a system instruction or an identity.
export const SCENES = { casual_chat: '日常交流', casual_banter: '轻松吐槽', technical: '技术讨论', help: '认真求助', closing: '结束话题' };
export const ACTIONS = { respond: '围绕当前内容回应', add_view: '有依据时补充一个相关观点', brief_rebuttal: '简短说明不同意见及理由', clarify: '信息不足时提出必要澄清', acknowledge: '简短接住当前内容', conclude: '表达完整后结束或保持沉默' };
export const STRUCTURES = { direct: '先说结论，再按需要解释', reasoned: '按具体依据展开', example: '用一个相关例子说明', short: '用简短完整的句子', mixed: '按内容自然安排句长' };
export const CONDITIONS = { light: '轻松交流', explicit_help: '明确求助', disagreement: '存在不同意见', incomplete: '缺少关键信息', ending: '对话结束', general: '当前话题相关' };
export const STRATEGIES = { follow_topic: '围绕对方实际内容接话', concise: '简单闲聊用简短完整的表达', independent_view: '有具体依据时表达自己的观点', explain: '需要解释时给出清晰依据与步骤', allow_silence: '话题结束或没有新内容时可以保持沉默', clarify: '仅在必要时澄清缺失信息' };
export const day = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
export function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw Error('表达结果 Schema 无效');
}
export function enumValue(table, value) { if (!Object.hasOwn(table, value)) throw Error('表达枚举无效'); return value; }
export function enumList(table, value, max = 4) {
  if (!Array.isArray(value) || value.length > max) throw Error('表达条件无效');
  return [...new Set(value.map(v => enumValue(table, v)))];
}
export function validateExpression(raw) {
  exactObject(raw, ['scene', 'action', 'structure', 'strategy', 'when', 'avoid', 'sourceMessageIds', 'confidence']);
  for (const [k, table] of Object.entries({ scene: SCENES, action: ACTIONS, structure: STRUCTURES, strategy: STRATEGIES })) enumValue(table, raw[k]);
  const when = enumList(CONDITIONS, raw.when), avoid = enumList(SCENES, raw.avoid);
  if (!Array.isArray(raw.sourceMessageIds) || raw.sourceMessageIds.length < 3 || raw.sourceMessageIds.length > 48 || raw.sourceMessageIds.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/.test(id))) throw Error('表达来源无效');
  if (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw Error('表达置信度无效');
  // A learned banter action must never qualify itself for serious scenes.
  if (['help', 'technical'].includes(raw.scene) && ['acknowledge', 'conclude'].includes(raw.action)) throw Error('认真场景表达动作不适用');
  return { ...raw, when, avoid, sourceMessageIds: [...new Set(raw.sourceMessageIds)] };
}
export function expressionText(e) {
  // Decode only the closed vocabulary; never serialize stored/model prose into a prompt.
  if (!Object.hasOwn(SCENES, e.scene) || !Object.hasOwn(ACTIONS, e.action) || !Object.hasOwn(STRUCTURES, e.structure) || !Object.hasOwn(STRATEGIES, e.strategy)) return null;
  return { id: e.id, scene: SCENES[e.scene], action: ACTIONS[e.action], strategy: STRATEGIES[e.strategy], structure: STRUCTURES[e.structure],
    when: (e.when || []).filter(k => Object.hasOwn(CONDITIONS, k)).map(k => CONDITIONS[k]), avoid: (e.avoid || []).filter(k => Object.hasOwn(SCENES, k)).map(k => SCENES[k]) };
}
