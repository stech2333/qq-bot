import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function windowSettings(value = {}) {
  const maxMessages = value.maxMessages ?? 10000;
  if (!Number.isInteger(maxMessages) || maxMessages < 200 || maxMessages > 50000) throw Error('学习记录上限须为200至50000条');
  return { maxMessages };
}
// This window is independent of model context. Each group owns a bounded, expiring journal.
export class LearningWindow {
  constructor(app) { this.app = app; this.windows = new Map(); this.errors = new Map(); }
  hours() { return Math.max(this.app.settings.topicLearning.lookbackHours, this.app.settings.slangPolicy.lookbackHours, this.app.settings.globalStyleLearning?.lookbackHours || 0); }
  file(key) { return path.join(this.app.root, 'state', 'learning-window', createHash('sha256').update(key).digest('hex').slice(0, 24) + '.jsonl'); }
  valid(m, now) {
    return m && !m.isSelf && m.topicLearningAllowed !== false && m.messageId != null && String(m.messageId).trim()
      && /^[1-9]\d{4,15}$/.test(String(m.userId)) && String(m.userId) !== String(this.app.config.bigfatfish?.expectedQQ)
      && Number.isFinite(m.time) && m.time > 0 && m.time <= now && now - m.time <= this.hours() * 3600000
      && this.app.privacy.reference(String(m.plain ?? m.text ?? ''));
  }
  load(key, now) {
    if (!this.windows.has(key)) {
      let rows = [];
      try { if (fs.existsSync(this.file(key))) rows = fs.readFileSync(this.file(key), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
      catch { this.errors.set(key, '学习记录无法读取，已停止覆盖，请检查文件'); }
      this.windows.set(key, { rows: new Map(rows.filter(m => this.valid(m, now)).map(m => [String(m.messageId), m])), compactAt: 0 });
    }
    return this.windows.get(key);
  }
  ingest(key, st, messages, now = Date.now()) {
    if (!key.startsWith('group:') && !this.app.globalStyle?.allowed(key)) return false;
    const win = this.load(key, now); if (this.errors.has(key)) return false;
    const added = [];
    for (const m of st.bigfatfish.memoryControl?.accumulation === false ? [] : (messages || [])) {
      if (!this.valid(m, now) || win.rows.has(String(m.messageId))) continue;
      const row = { messageId: String(m.messageId), userId: String(m.userId), time: m.time, plain: String(m.plain ?? m.text ?? '').slice(0, 500),
        hasForward: m.hasForward === true, hasMedia: m.hasMedia === true, quoted: m.quoted === true, quoteTargetIsSelf: m.quoteTargetIsSelf === true, styleSourceVersion: 1 };
      win.rows.set(row.messageId, row); added.push(row);
    }
    const all = [...win.rows.values()].sort((a, b) => a.time - b.time), rows = all.filter(m => this.valid(m, now)).slice(-this.app.settings.learningWindow.maxMessages);
    const compact = rows.length !== all.length || now - win.compactAt >= 3600000;
    try {
      const file = this.file(key); fs.mkdirSync(path.dirname(file), { recursive: true });
      if (compact) {
        const tmp = file + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, rows.map(m => JSON.stringify(m) + '\n').join(''), { mode: 0o600 }); fs.renameSync(tmp, file); win.compactAt = now;
      } else if (added.length) fs.appendFileSync(file, added.map(m => JSON.stringify(m) + '\n').join(''), { mode: 0o600 });
      win.rows = new Map(rows.map(m => [m.messageId, m]));
    } catch { this.errors.set(key, '学习记录保存失败，本轮学习已暂停'); return false; }
    return added.length > 0;
  }
  messages(key, st, now = Date.now()) {
    const win = key.startsWith('group:') || this.app.globalStyle?.allowed(key) ? this.load(key, now) : null;
    if (this.errors.has(key)) return [];
    return [...new Map([...(win?.rows.values() || []), ...(st.recentMessages || [])].filter(m => this.valid(m, now)).map(m => [String(m.messageId), { ...win?.rows.get(String(m.messageId)), ...m }])).values()]
      .sort((a, b) => a.time - b.time).slice(-this.app.settings.learningWindow.maxMessages);
  }
  snapshot(key, st, now = Date.now()) {
    const rows = this.messages(key, st, now);
    return { messages: rows.length, oldestAt: rows[0]?.time || 0, maxMessages: this.app.settings.learningWindow.maxMessages, hours: this.hours(), error: this.errors.get(key) || '' };
  }
}
