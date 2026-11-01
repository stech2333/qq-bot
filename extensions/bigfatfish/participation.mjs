import { keywordHit } from './policies.mjs';

// V4.2 接话模型：证据优先，概率只用于"没人点名时要不要插话"的抽稀。
//
// 旧模型有四个概率（idle/engaged/interest/floor）叠在一起，结果最糟的一档是**已经在跟机器人说话**
// 的人仍然要过 0.6~0.95 的骰子，被无视的概率高达四成。这不是"自然"，是漏答。
// 现在的规则只有两条：
//   ① 已经确认在跟机器人说话（点名/@/引用/私聊/同一人连续追问）→ 必答，不掷骰子。
//   ② 没人点名 → 先看有没有具体证据（兴趣词、话题重合、对着全群提的问题）；没有证据就安静，
//      有证据才用 ambientJoinProbability 抽稀一次，避免每次都插话。
export const PARTICIPATION_DEFAULTS = Object.freeze({ enabled: true, ambientJoinProbability: 0.30,
  requireDirected: false, quoteReplies: true,
  aliases: Object.freeze(['大肥鱼', '肥鱼', '小鲸鱼', '蓝色大肥鱼', '古月方鲸']),
  halfLifeMessages: 2, halfLifeSeconds: 90, exitSeconds: 300, followUpSeconds: 120,
  maxOffTopicMessages: 8, directBatchMs: 100, engagedBatchMs: 250, ambientBatchMs: 1500 });
// 已弃用但仍可能出现在旧 settings.json / 控制台请求里的键。读取时迁移，保存时丢弃。
export const PARTICIPATION_RETIRED = Object.freeze(['idleProbability', 'engagedProbability', 'interestProbability', 'floorProbability']);
const EVIDENCE_WEIGHTS = Object.freeze({ INTEREST: 1, TOPIC_OVERLAP: 0.6, OPEN_QUESTION: 0.5 });

export function participationSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('接话设置须为对象');
  const source = { ...value };
  // 迁移：旧的"旁观接话概率"就是新的 ambientJoinProbability；其余三个概率不再有独立语义。
  if (source.ambientJoinProbability === undefined && Number.isFinite(source.idleProbability)) {
    source.ambientJoinProbability = source.idleProbability;
  }
  const out = { ...PARTICIPATION_DEFAULTS, ...source };
  for (const name of PARTICIPATION_RETIRED) delete out[name];
  for (const name of ['enabled', 'requireDirected', 'quoteReplies']) if (typeof out[name] !== 'boolean') throw Error('接话开关须为布尔值');
  if (!Number.isFinite(out.ambientJoinProbability) || out.ambientJoinProbability < 0 || out.ambientJoinProbability > 1) throw Error('无人点名时的插话概率须在0至1之间');
  if (!Array.isArray(out.aliases) || out.aliases.length > 30 || out.aliases.some(name => typeof name !== 'string' || !name.trim() || name.trim().length > 60)) throw Error('明确称呼须为最多30个非空名称，每个最多60字');
  out.aliases = [...new Set(out.aliases.map(name => name.trim()))];
  for (const [key, min, max] of [['halfLifeMessages', 1, 20], ['halfLifeSeconds', 10, 3600], ['exitSeconds', 30, 7200],
    ['followUpSeconds', 10, 600], ['maxOffTopicMessages', 2, 40], ['directBatchMs', 100, 3000], ['engagedBatchMs', 100, 5000], ['ambientBatchMs', 100, 10000]]) {
    if (!Number.isInteger(out[key]) || out[key] < min || out[key] > max) throw Error('接话时序参数超出范围');
  }
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
// 决策产出的行动类型。EMOJI_REACTION 只有在网关确认支持消息表情回应时才会被选中。
export const CHAT_ACTIONS = Object.freeze(['TEXT', 'STICKER', 'EMOJI_REACTION', 'MIXED', 'SILENT']);
/**
 * 由"是否已确认对话对象 + 场景 + 可用动作"推导建议行动，不发消息、不依赖随机数。
 * sticker: { candidateCount, bestConfidence, scene }；reactionAvailable: 网关是否支持表情回应。
 */
export function suggestChatAction({ selected, direct, continuation, closing, mediaResponse, text, scene = '', sticker = null, reactionAvailable = false }) {
  if (!selected) return 'SILENT';
  const casual = ['casual_chat', 'casual_banter'].includes(String(scene || sticker?.scene || ''));
  const confident = Number(sticker?.candidateCount) > 0 && Number(sticker?.bestConfidence) >= 0.6;
  const short = String(text || '').trim().length <= 12;
  // 认真求助、技术问题、严肃或敏感场景一律文字；选图逻辑本身也会把这些场景排除。
  if (closing) return 'TEXT';
  if (confident && casual) {
    if (mediaResponse || short) return 'STICKER';
    return 'MIXED';
  }
  if (reactionAvailable && casual && short && !direct && continuation) return 'EMOJI_REACTION';
  return 'TEXT';
}
export function participationDecision(state, event, { kind, text, quoteTargetIsSelf, nickname, interests = [], recentMessages = [], now = Date.now(), random = Math.random, sticker = null, reactionAvailable = false, contextVersion } = {}, config = PARTICIPATION_DEFAULTS) {
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
  // 只有明确在推进话题的接话（提问、要求展开、指向性开头）才算"已确认的连续对话"。
  // 单纯"嗯/好/哈哈/谢谢"是应答而不是提问，不该被强制生成一轮回复。
  const followUpCue = /^(?:你|您|那|所以|然后|为什么|怎么|能|可以|展开|详细|具体|接着|请|解释|再|继续|还有|这个|这|没|[?？])/.test(body);
  const acknowledgement = /^(?:嗯|哦|噢|好|好的|行|行吧|对|不对|是|是的|不是|谢谢|谢了|哈哈|确实|懂了|明白|ok|OK)/.test(body);
  const mediaResponse = !body && segments.some(s => ['image', 'face', 'mface'].includes(s.type));
  // 只有"同一个人继续在跟机器人说话"才算已确认的连续对话，必答。
  // 别人接着同一话题说（只有 overlap）属于可插话的旁观机会，走证据路径，不自动升级为必答。
  const continuation = !otherTarget && recent && !acknowledgement && (strict ? sameSpeaker && p.offTopicMessages === 0 && (followUpCue || overlap || mediaResponse)
    : p.offTopicMessages < 3 && sameSpeaker && (followUpCue || overlap || mediaResponse));
  let reason = null, probability = 0, reasonCode = '';
  const robotQuestion = /^(?:你|您).*(?:机器人|人工智能|deepseek|claude|chatgpt|模型|\bai\b)/i.test(body)
    || /^(?:你|您)(?:是谁|叫什么|能做什么|会什么|有什么功能|在吗)[?？。！!\s]*$/.test(body);
  const nudge = sameSpeaker && recent && /^(?:人呢|在不在|回我|理我|别装死|说话啊|怎么不说话)/.test(body);
  const direct = kind === 'private' || atSelf || quoteTargetIsSelf || (!otherTarget && named)
    || (!otherTarget && (!strict || sameSpeaker && recent && p.offTopicMessages === 0) && (robotQuestion || nudge));
  const recipientConfirmed = !!(direct || continuation);
  const closing = /^(?:不聊了|晚安|先走了|拜拜|再见|先这样|不用回了)[。！!～~\s]*$/.test(body);
  // 已确认在跟机器人说话：必答，不再掷骰子。旧的 engagedProbability 正是在这里造成漏答。
  if (direct || continuation) {
    probability = 1;
    reason = kind === 'private' ? 'private' : direct ? 'addressed' : 'followUp';
    reasonCode = direct ? (kind === 'private' ? 'DIRECT_PRIVATE' : 'DIRECT_ADDRESSED') : 'CONVERSATION_CONTINUATION';
    p.phase = closing ? 'cooling' : 'engaged'; p.lastRelevantAt = now; p.offTopicMessages = closing ? 3 : 0;
    if (speaker) p.participants = [...new Set([...p.participants, speaker])].slice(-6);
    if (words.length) p.topicTokens = words;
  } else {
    // 没人点名：先收集证据，没有具体证据就不参与（不再有"纯随机接话"）。
    const evidence = [];
    const interestMatch = kind === 'group' && !otherTarget && interests.some(term => keywordHit(body, term));
    if (interestMatch) evidence.push('INTEREST');
    const coolingBefore = !!(p.lastRelevantAt || p.lastBotAt);
    // 兴趣命中不是"无关消息"：不计离题、不参与退火，否则同一话题的第二句会被自己压掉。
    if (coolingBefore && !interestMatch) p.offTopicMessages += otherTarget ? 2 : 1;
    else if (!coolingBefore) p.phase = 'idle';
    if (overlap) evidence.push('TOPIC_OVERLAP');
    const openQuestion = !otherTarget && /[?？]\s*$/.test(body) && !named;
    if (openQuestion) evidence.push('OPEN_QUESTION');
    const strongest = evidence.reduce((best, code) => Math.max(best, EVIDENCE_WEIGHTS[code] || 0), 0);
    if (!strongest) {
      probability = 0; reason = null; reasonCode = evidence.length ? 'EVIDENCE_TOO_WEAK' : 'NO_EVIDENCE';
      if (p.lastRelevantAt || p.lastBotAt) {
        const age = Math.max(0, now - p.lastRelevantAt);
        p.phase = age >= config.exitSeconds * 1000 || p.offTopicMessages >= config.maxOffTopicMessages ? 'quiet' : 'cooling';
      }
    } else {
      const age = Math.max(0, now - p.lastRelevantAt);
      // 退火只作用在"旁观插话"上：越久没接上、无关消息越多，越不容易再插进去。
      // 兴趣命中是新一轮明确信号，不参与退火。
      const anneal = evidence.includes('INTEREST') ? 1
        : (p.lastRelevantAt || p.lastBotAt) ? 2 ** (-p.offTopicMessages / config.halfLifeMessages - age / (config.halfLifeSeconds * 1000)) : 1;
      probability = Math.min(1, config.ambientJoinProbability * strongest * anneal);
      reason = evidence.includes('INTEREST') ? 'interest' : 'ambient';
      reasonCode = evidence.includes('INTEREST') ? 'AMBIENT_INTEREST_EVIDENCE' : evidence.includes('TOPIC_OVERLAP') ? 'AMBIENT_TOPIC_OVERLAP' : 'AMBIENT_OPEN_QUESTION';
      if (evidence.includes('INTEREST')) { p.lastRelevantAt = now; p.phase = 'engaged'; p.offTopicMessages = 0; }
      else if (p.lastRelevantAt || p.lastBotAt) p.phase = age >= config.exitSeconds * 1000 || p.offTopicMessages >= config.maxOffTopicMessages ? 'quiet' : 'cooling';
    }
  }
  const interestMatch = kind === 'group' && !otherTarget && interests.some(term => keywordHit(body, term));
  if (strict && !recipientConfirmed) { probability = 0; reason = null; reasonCode = 'DIRECTED_ONLY_MODE'; }
  const selected = probability >= 1 || (probability > 0 && random() < probability);
  const action = suggestChatAction({ selected, direct, continuation, closing, mediaResponse, text: body, scene: sticker?.scene ?? '', sticker, reactionAvailable });
  p.lastDecision = { at: now, speaker, probability, recipientConfirmed, requestedFollowUp: false, involved: !!(direct || continuation), reason, direct, interestMatch,
    addressedElsewhere: otherTarget && !direct, selected, action, reasonCode,
    contextVersion: contextVersion !== undefined ? contextVersion : Math.max(0, Number(state.memoryRevision) || 0),
    suggestedReplyMode: state.mode === 'ASSISTANT' ? 'ASSISTANT' : 'CASUAL' };
  return { ...p.lastDecision, handled: config.enabled || strict && !recipientConfirmed, reason: selected ? reason : null };
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
  const action = d.action || (d.selected ? 'TEXT' : 'SILENT');
  const rule = d.direct ? '当前真人明确称呼或@了你，必须先回应这条真人消息；没有具体问题也简短应声，不得因潜水或反AI味而已读不回。'
    : d.involved ? '当前有人在接你的话，优先及时回应；不要以潜水、反AI味为由刻意已读不回。'
    : d.interestMatch && d.selected ? '当前消息涉及你的兴趣，有相关内容就积极接话；只回应当前语境，不硬提无关兴趣词。'
    : p.phase === 'cooling' || p.phase === 'quiet' ? '当前话题正在转向其他人，减少插话；无相关新内容就安静退出，不补发收尾感言。'
    : '当前是旁观插话机会，有相关、有趣内容才自然加入。';
  // 行动类型只是建议，最终仍由模型决定说不说；这里给出可选的表达形式，避免只会打字。
  const form = action === 'STICKER' ? '本轮可以只用一张语义匹配的收藏表情回应，不必配文字。'
    : action === 'MIXED' ? '本轮可以先一句文字，再按语境补一张贴切的表情。'
    : action === 'EMOJI_REACTION' ? '本轮可以只给这条消息一个表情回应，不强行生成文字。'
    : action === 'SILENT' ? '本轮没有具体证据支持开口，沉默是正常结果。' : '';
  return `【接话状态】${rule}${form}固定权限、隐私和当前会话边界不变；不要编造答案。\n`;
}
export function participationBatchMs(reason, configured, settings) {
  const base = String(reason || '').split(/[:@]/)[0];
  const target = ['private', 'addressed', 'atMention', 'nameMention', 'question'].includes(base) ? settings.directBatchMs
    : ['followUp', 'engaged', 'interest'].includes(base) ? settings.engagedBatchMs : settings.ambientBatchMs;
  return settings.enabled ? Math.min(Number(configured) || 8000, target) : Math.max(1000, Number(configured) || 8000);
}
