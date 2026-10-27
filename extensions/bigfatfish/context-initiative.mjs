import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { clockParts, quietAt } from './policies.mjs';

export function initiativeSettings(value = {}) {
  const p = { enabled: false, probability: 0.18, cooldownMinutes: 5, contextMinutes: 10, ...value };
  if (typeof p.enabled !== 'boolean' || !Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1) throw Error('随机主动开关或概率无效');
  for (const k of ['cooldownMinutes', 'contextMinutes']) if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 120) throw Error('随机主动时间范围须为1至120分钟');
  return Object.fromEntries(['enabled', 'probability', 'cooldownMinutes', 'contextMinutes'].map(k => [k, p[k]]));
}
export function initiativeState(value = {}) {
  const r = value?.round;
  return { lastBatch: String(value?.lastBatch || '').slice(0, 64), lastAttemptAt: Number(value?.lastAttemptAt) || 0,
    round: r && typeof r.id === 'string' && Number.isSafeInteger(r.throughSeq) && Number.isFinite(r.expiresAt)
      ? { id: r.id.slice(0, 64), throughSeq: r.throughSeq, expiresAt: r.expiresAt, sent: r.sent === true } : null };
}
// This opportunity is subordinate to ordinary replies. It never owns, clears or replays the unread queue.
export class ContextInitiative {
  constructor(app) { this.app = app; this.error = ''; }
  state(st) { return st.bigfatfish.contextInitiative ??= initiativeState(); }
  rows(st, now) { return (st.recentMessages || []).filter(m => !m.isSelf && Number(m.time) <= now && now - Number(m.time) <= this.app.settings.contextInitiative.contextMinutes * 60000 && String(m.plain || '').trim().length >= 2 && this.app.privacy.reference(String(m.plain))).slice(-20); }
  gate(key, st, now = Date.now(), sending = false) {
    const app = this.app, p = app.settings.contextInitiative, shared = app.settings.schedule, s = this.state(st), id = key.slice(6);
    if (this.error) return this.error;
    if (!p.enabled || p.probability <= 0 || app.config.socialV2?.enabled === false || app.config.socialV2?.proactive?.enabled === false) return '随机主动已关闭';
    if (!key.startsWith('group:') || !(app.config.allow?.groups || []).map(String).includes(id) || (app.config.deny?.groups || []).map(String).includes(id)) return '群聊未启用';
    if (app.settings.participation.requireDirected) return '仅回应明确找自己的消息';
    if (quietAt(now, app.settings.coldStart)) return '静默时段';
    const d = st.bigfatfish.participation?.lastDecision;
    if (d?.direct || d?.involved || d?.addressedElsewhere) return '正常回复或其他人的对话优先';
    if ((st.unread || []).some(m => !m.isSelf && (m.replyStyle === 'formal' || m.addressedToBot || m.quoteTargetIsSelf))) return '队列中有明确待回复消息';
    if (!Array.isArray(st.unread) || !st.unread.some(m => !m.isSelf && Number(m.seq) > Number(st.lastReadThroughSeq || 0))) {
      // A successful send can acknowledge the original batch. Further bubbles in that same
      // send operation remain allowed; no subsequent wake can reuse the consumed batch.
      if (!(sending && s.round?.sent)) return '没有新的待处理真人消息';
    }
    if (this.rows(st, now).length < 2) return '缺少近期上下文';
    if (sending) {
      if (!s.round || s.round.expiresAt <= now) return '随机主动机会已过期';
      if (Number(st.lastUnreadSeq || 0) !== s.round.throughSeq) return '上下文已变化，取消旧主动消息';
    } else if (s.lastAttemptAt && now - s.lastAttemptAt < p.cooldownMinutes * 60000) return '随机主动冷却中';
    app.pruneLedger(now);
    const own = s.round?.id;
    const events = app.ledger.events.filter(e => !(sending && e.id === own));
    const leases = Object.entries(app.ledger.leases).filter(([other]) => other !== key);
    const today = clockParts(now).day;
    if (events.filter(e => e.key === key && now - e.at < 3600000).length >= shared.hourlyCap) return '本会话小时主动额度已用完';
    if (events.filter(e => clockParts(e.at).day === today).length + leases.length >= shared.globalDailyCap) return '全局每日主动额度已用完';
    if (!sending) {
      const attempts = app.ledger.attempts.filter(e => clockParts(e.at).day === today);
      if (attempts.filter(e => e.key === key).length >= shared.dailyAttemptCap || attempts.length >= shared.globalDailyAttemptCap) return '今日主动推理额度已用完';
    }
    return '';
  }
  available(key, st, now = Date.now()) { return !this.gate(key, st, now); }
  batch(st) { return createHash('sha256').update(JSON.stringify((st.unread || []).filter(m => !m.isSelf).map(m => [m.seq, m.messageId]))).digest('hex'); }
  persistLedger() {
    const file = this.app.ledgerFile, tmp = file + '.' + process.pid + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.app.ledger, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file);
  }
  begin(key, st, now = Date.now(), random = Math.random) {
    const s = this.state(st), reason = this.gate(key, st, now), batch = this.batch(st);
    if (reason || s.lastBatch === batch) return false;
    s.lastBatch = batch;
    const selected = random() < this.app.settings.contextInitiative.probability;
    const decision = { kind: 'contextInitiative', at: now, probability: this.app.settings.contextInitiative.probability, allowed: selected, reason: selected ? '随机命中，结合当前上下文分享' : '随机未命中' };
    st.bigfatfish.decisions = [...(st.bigfatfish.decisions || []), decision].slice(-30);
    if (!selected) return false;
    const id = randomUUID(), before = structuredClone(this.app.ledger);
    this.app.ledger.attempts.push({ key, at: now, kind: 'contextInitiative', id });
    this.app.ledger.leases[key] = { until: now + 120000, kind: 'contextInitiative', id };
    try { this.persistLedger(); } catch { this.app.ledger = before; decision.allowed = false; decision.reason = this.error = '主动额度无法保存，随机主动已暂停'; return false; }
    s.lastAttemptAt = now; s.round = { id, throughSeq: Number(st.lastUnreadSeq || 0), expiresAt: now + 120000, sent: false };
    return true;
  }
  cancel(key, st) {
    const s = this.state(st), lease = this.app.ledger.leases[key];
    if (lease?.kind === 'contextInitiative') { delete this.app.ledger.leases[key]; try { this.persistLedger(); } catch { this.error = '主动额度无法保存，随机主动已暂停'; } }
    s.round = null;
  }
  sent(key, st) {
    const s = this.state(st); if (!s.round || s.round.sent) return;
    const now = Date.now(); s.round.sent = true;
    delete this.app.ledger.leases[key];
    this.app.ledger.events.push({ key, at: now, kind: 'contextInitiative', id: s.round.id });
    // QQ has already accepted this message. Bookkeeping failures must never turn
    // that successful delivery into a send error that could cause duplicate retries.
    try { this.persistLedger(); } catch { this.error = '主动发送已成功，但记账失败，随机主动已暂停'; }
  }
  hint(st) {
    if (!this.state(st).round) return '';
    return '【本轮上下文随机主动】这是一次主动分享机会，不是重复回答旧问题。根据本群最近真人消息、当前话题和角色卡，主动补充一条相关的具体观点、联想或小话题；不必等别人提问。先处理明确待答消息，已有回答不要重说；不得把其他群或私聊事实带过来，不编造现实经历，不为了开口硬造内容。有合适内容时直接用QQ发送工具发一轮自然消息；没有可补充的内容可以安静，不必说明抽签、概率或后台机制。不要连续刷屏，也不要机械追问。\n';
  }
  queues(st) {
    const pending = (st.unread || []).filter(m => !m.isSelf), round = this.state(st).round;
    return { pending: pending.length, directedPending: pending.filter(m => m.replyStyle === 'formal' || m.addressedToBot || m.quoteTargetIsSelf).length,
      processedThroughSeq: Number(st.lastReadThroughSeq || 0), recentOutgoing: (st.recentMessages || []).filter(m => m.isSelf).length,
      initiative: !round ? 'none' : round.expiresAt <= Date.now() ? 'expired' : round.sent ? 'sent' : 'generating', error: this.error };
  }
}
