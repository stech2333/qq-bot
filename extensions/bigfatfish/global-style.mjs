import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES, enumList } from './expression-memory.mjs';

export const STYLE_TRAITS = {
  tone: { casual: '自然随和', restrained: '认真克制', playful: '轻松幽默' },
  wording: { plain: '用词直白', colloquial: '自然口语', vivid: '用具体形象的说法' },
  sentences: { short: '简短完整的句子', mixed: '长短句自然交替', detailed: '需要时充分解释' },
  structure: { direct: '先表达结论或态度，再按需要补理由', reasoned: '围绕具体理由展开', example: '用贴切的具体例子帮助说明' },
  engagement: { addView: '接住话题后补充自己的具体观点', followTopic: '围绕对方实际话题自然延续', acknowledge: '简短回应实际内容，再按需要展开' },
  paragraphs: { compact: '表达紧凑，不刻意拆碎', separated: '一个完整意思一段', mixed: '按内容自然分段' },
  punctuation: { plain: '标点克制', expressive: '合适时少量使用语气标点' },
  emotes: { rare: '少用表情', normal: '按语境适量使用表情', frequent: '闲聊中适度使用表情，严肃问题不用' }
};
const DEFAULTS = { enabled: true, apply: true, lookbackHours: 720, minMessages: 20, minDays: 3, refreshHours: 6, minNewMessages: 10, dailyCap: 4, maxChanges: 2 };
export function globalStyleSettings(value = {}) {
  const p = Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, value?.[k] ?? v]));
  for (const k of ['enabled', 'apply']) if (typeof p[k] !== 'boolean') throw Error('统一风格开关必须为布尔值');
  for (const [k, lo, hi] of [['lookbackHours', 72, 720], ['minMessages', 20, 500], ['minDays', 3, 30], ['refreshHours', 1, 168], ['minNewMessages', 3, 100], ['dailyCap', 0, 30], ['maxChanges', 1, 3]]) {
    if (!Number.isInteger(p[k]) || p[k] < lo || p[k] > hi) throw Error(`globalStyleLearning.${k} 超出范围`);
  }
  if (p.minDays > p.minMessages || p.minDays > Math.floor(p.lookbackHours / 24) + 1) throw Error('覆盖日期数超过消息数或回看窗口');
  return p;
}
// The old mixed-corpus file is deliberately never written or applied.
const empty = () => ({ schemaVersion: 2, revision: 0, version: 0, published: [], history: [], migration: { legacyImported: false, source: 'admin-only' } });
export class GlobalStyle {
  constructor(app) {
    this.app = app; this.legacyFile = path.join(app.root, 'state', 'global-style.json'); this.file = path.join(app.root, 'state', 'global-expressions.json'); this.state = empty(); this.error = '';
    this.legacy = { present: fs.existsSync(this.legacyFile), applied: false, autoLearningRetired: true };
    try {
      if (fs.existsSync(this.file)) {
        const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (state.schemaVersion !== 2 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.history)) throw Error();
        enumList(STRATEGIES, state.published, 6); this.state = state;
      }
    } catch { this.error = '通用表达经验损坏，已停止覆盖'; }
  }
  allowed(key) {
    const match = /^(group|private):([1-9]\d{4,15})$/.exec(key); if (!match) return false;
    const field = match[1] === 'group' ? 'groups' : 'private';
    return (this.app.config.allow?.[field] || []).map(String).includes(match[2]) && !(this.app.config.deny?.[field] || []).map(String).includes(match[2]);
  }
  save(next) {
    if (this.error) throw Error(this.error);
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, this.file); this.state = next;
  }
  strategies(scene) {
    if (this.error || !this.app.settings.globalStyleLearning.apply) return [];
    return this.state.published.filter(id => ['help', 'technical'].includes(scene) ? ['explain', 'clarify', 'independent_view'].includes(id) : id !== 'explain').slice(0, 2);
  }
  // Compatibility callers must not inject a second copy. Resolver owns application.
  hint() { return ''; }
  job() { return null; }
  view() { return { ok: true, ...structuredClone(this.state), choices: STRATEGIES, legacy: this.legacy, policy: this.app.settings.globalStyleLearning,
    replyDelivery: this.app.settings.replyDelivery, error: this.error }; }
  admin(method, body) {
    if (method === 'GET') return this.view();
    if (method !== 'POST' || body.revision !== this.state.revision) throw Error('通用表达版本已变化，请刷新');
    const next = structuredClone(this.state);
    if (body.action === 'publish') next.published = enumList(STRATEGIES, body.strategies, 6);
    else if (body.action === 'reset') next.published = [];
    else if (body.action === 'rollback') { const old = next.history.find(h => h.version === body.version); if (!old) throw Error('通用表达版本不存在'); next.published = [...old.published]; }
    else throw Error('通用表达只允许管理员确认发布');
    if (JSON.stringify(next.published) !== JSON.stringify(this.state.published)) { next.version++; next.history.push({ version: next.version, at: Date.now(), published: [...next.published] }); next.history = next.history.slice(-20); }
    next.revision++; this.save(next); return this.view();
  }
}
