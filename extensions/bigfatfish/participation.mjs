import { keywordHit } from './policies.mjs';

export const PARTICIPATION_DEFAULTS = Object.freeze({ enabled: true, idleProbability: 0.25, engagedProbability: 0.95, interestProbability: 0.60,
  requireDirected: false, quoteReplies: true,
  aliases: Object.freeze(['大肥鱼', '肥鱼', '小鲸鱼', '蓝色大肥鱼', '古月方鲸']),
  floorProbability: 0.03, halfLifeMessages: 2, halfLifeSeconds: 90, exitSeconds: 300, followUpSeconds: 120,
  maxOffTopicMessages: 8, directBatchMs: 100, engagedBatchMs: 250, ambientBatchMs: 1500 });
export function participationSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('接话设置须为对象');
  const out = { ...PARTICIPATION_DEFAULTS, ...value };
  for (const name of ['enabled', 'requireDirected', 'quoteReplies']) if (typeof out[name] !== 'boolean') throw Error('接话开关须为布尔值');
  for (const key of ['idleProbability', 'engagedProbability', 'floorProbability', 'interestProbability']) if (!Number.isFinite(out[key]) || out[key] < 0 || out[key] > 1) throw Error('接话概率须在0至1之间');
  if (!Array.isArray(out.aliases) || out.aliases.length > 30 || out.aliases.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 60)) throw Error('明确称呼须为最多30个非空名称，每个最多60字');
  out.aliases = [...new Set(out.aliases.map(name => name.trim()))];
  for (const [key, min, max] of [['halfLifeMessages', 1, 20], ['halfLifeSeconds', 10, 3600], ['exitSeconds', 30, 7200],
    ['followUpSeconds', 10, 600], ['maxOffTopicMessages', 2, 40], ['directBatchMs', 100, 3000], ['engagedBatchMs', 100, 5000], ['ambientBatchMs', 100, 10000]]) {
    if (!Number.isInteger(out[key]) || out[key] < min || out[key] > max) throw Error('接话时序参数超出范围');
  }
  if (out.floorProbability > out.idleProbability || out.idleProbability > out.engagedProbability) throw Error('接话概率应满足安静≤旁观≤参与');
  return out;
}
export function normalizeParticipation(value = {}) {
  return { phase: ['idle', 'engaged', 'cooling', 'quiet'].includes(value.phase) ? value.phase : 'idle',
    lastRelevantAt: Number(value.lastRelevantAt) || 0, lastBotAt: Number(value.lastBotAt) || 0,
    offTopicMessages: Math.max(0, Number(value.offTopicMessages) || 0),
    participants: Array.isArray(value.participants) ? value.participants.map(String).slice(-6) : [],
    topicTokens: Array.isArray(value.topicTokens) ? value.topicTokens.filter(t => typeof t === 'string').slice(0, 80) : [],
    lastDecision: value.lastDecision && typeof value.lastDecision === 'object' ? value.lastDecision : null };
}
function tokens(text) {
  const words = String(text || '').toLowerCase().match(/[a-z][a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  const stop = new Set(['这个', '那个', '今天', '现在', '我们', '你们', '他们', '可以', '怎么', '什么', '就是', '不是', '一个', '然后', '觉得', 'the', 'this', 'that', 'and', 'for']);
  return [...new Set(words.flatMap(w => /[\u4e00-\u9fff]/.test(w) ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2)) : [w]))].filter(w => !stop.has(w)).slice(0, 80);
}
export function isDirectCall(text, aliases) {
  const body = String(text || '').trim();
  return aliases.some(name => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[，,。！？!?\\s])@?' + escaped + '(?:$|[，,、:：\\s！？!?]|你|您|帮(?:我|忙)|请|来(?:下|一下|看看)|说(?:下|一下|说|话|句话|两句)|讲(?:下|一下|讲)|在(?:吗|不在)|在线(?:吗|不)|怎么|为什么|如何|什么|啥|哪|多少|回我|理我|别装死|能(?:否|不能|帮)|可(?:以|否)|给(?:我|个))', 'i').test(body);
  });
}
export function participationDecision(state, event, { kind, text, quoteTargetIsSelf, nickname, interests = [], recentMessages = [], now = Date.now(), random = Math.random } = {}, config = PARTICIPATION_DEFAULTS) {
  const strict = kind === 'group' && config.requireDirected;
  if (!config.enabled && !strict) return { handled: false };
  state.participation = normalizeParticipation(state.participation);
  const p = state.participation, body = String(text || '').trim(), speaker = String(event?.user_id ?? event?.sender?.user_id ?? '');
  // Recover an ongoing exchange after restart without reviving old or unrelated chats.
  if (kind === 'group' && !p.lastRelevantAt && !p.lastBotAt) {
    const lastSelf = [...recentMessages].reverse().find(m => m.isSelf && Number(m.time) <= now);
    if (lastSelf && now - Number(lastSelf.time) < config.followUpSeconds * 1000) {
      p.lastRelevantAt = p.lastBotAt = Number(lastSelf.time); p.phase = 'engaged';
      p.topicTokens = tokens(lastSelf.plain || lastSelf.text);
      const previous = [...recentMessages].reverse().find(m => !m.isSelf && m.userId && Number(m.time) <= p.lastBotAt);
      if (previous) p.participants = [String(previous.userId)];
    }
  }
  const segments = Array.isArray(event?.message) ? event.message : [];
  const self = String(event?.self_id || '');
  const atSelf = segments.some(s => s.type === 'at' && String(s.data?.qq) === self);
  const otherTarget = segments.some(s => s.type === 'at' && String(s.data?.qq) !== self)
    || (!quoteTargetIsSelf && segments.some(s => s.type === 'reply'));
  const aliases = [...new Set([nickname, ...(config.aliases || PARTICIPATION_DEFAULTS.aliases)].filter(Boolean))];
  const named = (strict ? isDirectCall(body, aliases) : aliases.some(name => body.toLowerCase().includes(String(name).toLowerCase()))) || /^鲸[，,、：:\s!?？]/.test(body);
  const elapsed = now - Math.max(p.lastRelevantAt, p.lastBotAt);
  const recent = elapsed >= 0 && elapsed < config.followUpSeconds * 1000;
  const sameSpeaker = speaker && p.participants.includes(speaker);
  const words = tokens(body), overlap = words.some(w => p.topicTokens.includes(w));
  const followUpCue = /^(?:你|您|那|所以|然后|为什么|怎么|能|可以|展开|详细|具体|接着|请|解释|再|继续|嗯|好|对|不对|是的|不是|谢谢|哈哈|确实|懂了|还有|这个|这|没|[?？])/.test(body);
  const mediaResponse = !body && segments.some(s => ['image', 'face', 'mface'].includes(s.type));
  const continuation = !otherTarget && recent && (strict ? sameSpeaker && p.offTopicMessages === 0 && (followUpCue || overlap || mediaResponse)
    : p.offTopicMessages < 3 && ((sameSpeaker && (followUpCue || overlap || mediaResponse)) || overlap));
  let reason = null, probability;
  const robotQuestion = /^(?:你|您).*(?:机器人|人工智能|deepseek|claude|chatgpt|模型|\bai\b)/i.test(body)
    || /^(?:你|您)(?:是谁|叫什么|能做什么|会什么|有什么功能|在吗)[?？。！!\s]*$/.test(body);
  const nudge = sameSpeaker && recent && /^(?:人呢|在不在|回我|理我|别装死|说话啊|怎么不说话)/.test(body);
  const direct = kind === 'private' || atSelf || quoteTargetIsSelf || ((!otherTarget || !strict) && named)
    || (!otherTarget && (!strict || sameSpeaker && recent && p.offTopicMessages === 0) && (robotQuestion || nudge));
  const recipientConfirmed = !!(direct || continuation);
  const closing = /^(?:不聊了|晚安|先走了|拜拜|再见|先这样|不用回了)[。！!～~\s]*$/.test(body);
  // Recipient identity has already been established above. Explicit questions from that
  // uninterrupted partner are requests to the bot, not ambient participation lottery draws.
  const requestedFollowUp = strict && config.enabled && continuation && !closing
    && /[?？]|(?:怎么|如何|为什么|什么|多少|能不能|可不可以|解释|讲讲|展开|详细|继续说|接着说|帮我|请)|(?:吗|呢)[。！!～~\s]*$/.test(body);
  if (direct || continuation) {
    probability = direct || requestedFollowUp ? 1 : config.engagedProbability;
    reason = kind === 'private' ? 'private' : direct ? 'addressed' : 'followUp';
    p.phase = closing ? 'cooling' : 'engaged'; p.lastRelevantAt = now; p.offTopicMessages = closing ? 3 : 0;
    if (speaker) p.participants = [...new Set([...p.participants, speaker])].slice(-6);
    if (words.length) p.topicTokens = words;
  } else if (p.lastRelevantAt || p.lastBotAt) {
    p.offTopicMessages += otherTarget ? 2 : 1;
    const age = Math.max(0, now - p.lastRelevantAt);
    const exited = age >= config.exitSeconds * 1000 || p.offTopicMessages >= config.maxOffTopicMessages;
    p.phase = exited ? 'quiet' : 'cooling';
    probability = exited ? config.floorProbability : config.floorProbability + (config.engagedProbability - config.floorProbability)
      * 2 ** (-p.offTopicMessages / config.halfLifeMessages - age / (config.halfLifeSeconds * 1000));
    reason = 'cooling';
  } else {
    p.phase = 'idle'; probability = config.idleProbability; reason = 'ambient';
  }
  const interestMatch = kind === 'group' && !otherTarget && (!strict || recipientConfirmed) && interests.some(term => keywordHit(body, term));
  if (!direct && interestMatch) {
    probability = Math.max(probability, config.interestProbability ?? PARTICIPATION_DEFAULTS.interestProbability);
    if (['ambient', 'cooling'].includes(reason)) reason = 'interest';
  }
  if (strict && !recipientConfirmed) { probability = 0; reason = null; }
  p.lastDecision = { at: now, speaker, probability, recipientConfirmed, requestedFollowUp, involved: !!(direct || continuation), reason, direct, interestMatch, addressedElsewhere: otherTarget && !direct,
    selected: probability === 1 || random() < probability };
  return { ...p.lastDecision, handled: config.enabled || strict && !recipientConfirmed, reason: p.lastDecision.selected ? reason : null };
}
export function recordParticipationSent(state, text = '', now = Date.now()) {
  state.participation = normalizeParticipation(state.participation);
  const p = state.participation;
  if (p.lastDecision?.interestMatch && p.lastDecision.selected) { p.lastRelevantAt = now; p.phase = 'engaged'; p.offTopicMessages = 0; }
  // A bot's own replies never reheat a conversation that has already moved to other people.
  if (!p.lastRelevantAt && !p.lastBotAt) { p.lastRelevantAt = now; p.phase = 'engaged'; }
  p.lastBotAt = now;
  if (p.lastDecision?.involved || p.phase === 'engaged') {
    if (p.lastDecision?.speaker) p.participants = [...new Set([...p.participants, p.lastDecision.speaker])].slice(-6);
    const words = tokens(text); if (words.length) p.topicTokens = [...new Set([...p.topicTokens, ...words])].slice(-80);
  }
}
export function participationHint(state) {
  const p = normalizeParticipation(state.participation), d = p.lastDecision;
  if (!d) return '';
  const rule = d.direct ? '当前真人明确称呼或@了你，必须先回应这条真人消息；没有具体问题也简短应声，不得因随机概率、潜水或反AI味而已读不回。'
    : d.involved ? '当前有人在接你的话，优先及时用文字或收藏表情回应；不要以潜水、反AI味为由刻意已读不回。'
    : d.interestMatch && d.selected ? '当前消息涉及你的兴趣，有相关内容就积极接话；只回应当前语境，不硬提无关兴趣词。'
    : p.phase === 'cooling' || p.phase === 'quiet' ? '当前话题正在转向其他人，减少插话；无相关新内容就安静退出，不补发收尾感言。'
    : '当前是旁观插话机会，有相关、有趣内容才自然加入。';
  return `【接话状态】${rule} 固定权限、隐私和当前会话边界不变；不要编造答案。\n`;
}
export function participationBatchMs(reason, configured, settings) {
  const base = String(reason || '').split(/[:@]/)[0];
  const target = ['private', 'addressed', 'atMention', 'nameMention', 'question'].includes(base) ? settings.directBatchMs
    : ['followUp', 'engaged'].includes(base) ? settings.engagedBatchMs : settings.ambientBatchMs;
  return settings.enabled ? Math.min(Number(configured) || 8000, target) : Math.max(1000, Number(configured) || 8000);
}
