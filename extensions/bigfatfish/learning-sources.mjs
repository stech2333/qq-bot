import { createHash } from 'node:crypto';
import { day } from './expression-memory.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex').slice(0,24);
export class LearningSources {
  constructor(app) { this.app=app; this.cache=new Map(); }
  allowed(key) { return /^group:[1-9]\d{4,15}$/.test(key) && this.app.globalStyle.allowed(key); }
  eligible(key) { return this.allowed(key) && !!this.app.states.get(key) && this.app.states.get(key).bigfatfish?.memoryControl?.accumulation !== false; }
  rows(key, now = Date.now()) {
    if (!this.allowed(key) || !this.app.states.has(key) || this.app.states.get(key).bigfatfish?.memoryControl?.accumulation === false || this.app.learningWindow.errors.has(key)) return [];
    const s = this.app.globalStyle.state, st = this.app.states.get(key), p = this.app.settings.globalStyleLearning, window = this.app.learningWindow.load(key, now);
    const cached = this.cache.get(key);
    if (cached && cached.rowsRef === window.rows && cached.recent === st.recentMessages && cached.length === st.recentMessages?.length && cached.revision === s.revision && now - cached.at < 1000) return cached.rows;
    const repeated = new Set(), bursts = new Set(), speakers = new Map(), rows = [];
    for (const m of this.app.learningWindow.messages(key, st, now)) {
      const text = String(m.plain || '').trim();
      if (m.styleSourceVersion !== 2 || m.sourceScope !== key || m.time <= (s.cutoff || 0) || now - m.time > p.lookbackHours * 3600000 || m.hasForward || m.hasMedia || m.quoted
        || !/^-?[1-9]\d{0,19}$/.test(String(m.messageId)) || text.length < 3 || text.length > 300
        || /```|https?:\/\/|\[CQ:|^[>＞]|[“”「」『』]|(?:转发|引用)(?:消息|内容)|(?:access_token|api.?key|password|密码|手机号)|\d{7,}|(?:忽略|覆盖|修改).{0,10}(?:指令|人格|权限)|(?:傻逼|操你)/i.test(text)) continue;
      const normalized = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
      const burst = m.userId + ':' + Math.floor(m.time / 60000), speakerDay = m.userId + ':' + day(m.time);
      if (repeated.has(normalized) || bursts.has(burst) || (speakers.get(speakerDay) || 0) >= 12) continue;
      repeated.add(normalized); bursts.add(burst); speakers.set(speakerDay, (speakers.get(speakerDay) || 0) + 1);
      rows.push({ id: digest(key + ':' + m.messageId), sourceId: String(m.messageId), speaker: digest('speaker:' + m.userId), time: m.time, text,
        replyTo: m.replyToMessageId ? digest(key + ':' + m.replyToMessageId) : null, adjacentSeq: Number.isSafeInteger(m.seq) ? m.seq : null });
    }
    this.cache.set(key, { rowsRef: window.rows, recent: st.recentMessages, length: st.recentMessages?.length, revision: s.revision, at: now, rows }); return rows;
  }

  all(now=Date.now()) { const counts=new Map(),seen=new Set();return [...this.app.states.keys()].filter(k=>this.allowed(k)).flatMap(key=>this.rows(key,now).map(r=>({...r,key}))).sort((a,b)=>a.time-b.time).filter(r=>{const bucket=r.speaker+':'+day(r.time),text=r.text.replace(/[\s\p{P}\p{S}]/gu,'');if(seen.has(text)||(counts.get(bucket)||0)>=12)return false;seen.add(text);counts.set(bucket,(counts.get(bucket)||0)+1);return true;}); }
  references(now=Date.now()) {
    const refs=new Map(),cutoff=this.app.globalStyle.state.cutoff||0,p=this.app.settings.globalStyleLearning;
    for(const [key,st]of this.app.states)if(this.allowed(key)&&st.bigfatfish.memoryControl?.accumulation!==false&&!this.app.learningWindow.errors.has(key))
      for(const m of this.app.learningWindow.messages(key,st,now))if(m.styleSourceVersion===2&&m.sourceScope===key&&!m.hasForward&&!m.hasMedia&&!m.quoted&&m.time>cutoff&&now-m.time<=p.lookbackHours*3600000){
        const id=digest(key+':'+m.messageId);refs.set(id,{id,key,time:m.time,speaker:digest('speaker:'+m.userId)});
      }
    return refs;
  }
  sample(now=Date.now()) { const rows=this.all(now); return {messages:rows.length, days:new Set(rows.map(r=>day(r.time))).size,speakers:new Set(rows.map(r=>r.speaker)).size,groups:new Set(rows.map(r=>r.key)).size}; }
}
