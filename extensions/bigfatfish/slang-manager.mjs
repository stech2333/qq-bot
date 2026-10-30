import fs from 'node:fs';
import path from 'node:path';
import { keywordHit } from './policies.mjs';
import { normalizedTerm, safeGeneralText, publicSource, senseId, termId } from './slang-schema.mjs';
import { safeFetch } from '../../integrations/qq-bridge/src/safe-fetch.js';
import { memoryTerms } from './memory-recall.mjs';
import { ManualSlangResearch } from './manual-slang-research.mjs';
import { relevance, expressionScene } from './community-retrieval.mjs';
import { UnifiedSlang, safeScopedText } from './unified-slang.mjs';

export const SLANG_POLICY = Object.freeze({ enabled: true, autoConfirm: true, threshold: 80, minMessages: 4,
  candidateMinMessages: 3, autoResearch: true, researchMinMessages: 4, minSpeakers: 2, minSpanMinutes: 30, lookbackHours: 168, scanIntervalMinutes: 5, maxAutoPerDay: 20 });
export function slangPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('黑话策略须为对象');
  const next = { ...SLANG_POLICY, ...value };
  for (const key of ['enabled', 'autoConfirm', 'autoResearch']) if (typeof next[key] !== 'boolean') throw new Error('黑话策略开关必须为布尔值');
  for (const [key, lo, hi] of [['candidateMinMessages', 1, 100], ['researchMinMessages', 3, 100], ['threshold', 0, 100], ['minMessages', 2, 100], ['minSpeakers', 2, 20],
    ['minSpanMinutes', 1, 10080], ['lookbackHours', 1, 720], ['scanIntervalMinutes', 1, 1440], ['maxAutoPerDay', 0, 100]]) {
    if (!Number.isInteger(next[key]) || next[key] < lo || next[key] > hi) throw new Error(`slangPolicy.${key} 超出范围`);
  }
  return Object.fromEntries(Object.keys(SLANG_POLICY).map(key => [key, next[key]]));
}
const date = now => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
function persist(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Only the upstream lexicon stores words. This ledger stores quota/audit IDs, never chat copies.
export class SlangManager {
  constructor(app) {
    this.app = app; this.lastScanAt = 0; this.lastError = ''; this.auditWritable = true;
    this.manual = new ManualSlangResearch(app);
    this.file = path.join(app.root, 'state', 'bigfatfish-slang-audit.json');
    try {
      this.audit = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
      if (!Array.isArray(this.audit) || this.audit.some(e => !e || typeof e.id !== 'string' || !Number.isFinite(e.at))) throw new Error('invalid audit');
    } catch {
      this.audit = []; this.auditWritable = false; this.lastError = '入库记录无法读取，自动确认已暂停；修复记录后重启桥接';
    }
  }
  sourceExists(source) {
    if (!this.app.learningSources.allowed(source.key)) return false;
    const st=this.app.states.get(source.key);if(!st||st.bigfatfish.memoryControl?.accumulation===false)return false;
    return this.app.learningWindow.messages(source.key,st).some(m=>String(m.messageId)===source.id&&m.time===source.time);
  }
  connectUnified(){this.unified=new UnifiedSlang(this.app);const rows=this.unified.initialize();this.entries=()=>this.unified.entries();return rows;}
  approveManual(entry,body={}) {
    const scope=body.scope??entry.scope??'public';
    if(scope!=='public'&&!this.app.learningSources.allowed(scope))throw Error('群内表达必须选择已允许的原群');
    const safe=scope==='public'?safeGeneralText:safeScopedText;
    const input=body.senses??[{meaning:body.meaning??entry.meaning,usage:body.usage??entry.usage,contextTerms:entry.senses?.[0]?.contextTerms||[]}];
    if(!Array.isArray(input)||!input.length||input.length>8||input.some(s=>!s.meaning?.trim()||!safe(s.meaning)||!safe(s.usage||''))||!safe(entry.content))throw Error('仅能确认安全词义；私人事实和身份关系须保留在会话记忆中');
    entry.scope=scope==='public'?undefined:scope;entry.senses=input.map(s=>({id:senseId(s.meaning),meaning:s.meaning,usage:s.usage||'',contextTerms:(s.contextTerms||[]).filter(safe).slice(0,12),status:'confirmed',manual:true,verified:true,generalizable:scope==='public',verifiedAt:Date.now(),evidence:[]}));
    entry.meaning=entry.senses[0].meaning;entry.usage=entry.senses[0].usage;entry.status='confirmed';return entry;
  }
  safeSense(s,scope){const safe=scope?.startsWith('group:')?safeScopedText:safeGeneralText;return !!s.meaning?.trim()&&safe(s.meaning)&&safe(s.usage||'');}
  sourceRetained(source) {
    if (!this.app.learningSources.allowed(source.key) || !Number.isFinite(source.time) || source.time<=0 || source.time>Date.now()) return false;
    const deleted=this.app.learningWindow.deleted(source.key);
    return !this.app.learningWindow.errors.has(source.key) && !deleted.has(String(source.id));
  }
  reviewedSense(entry,s,{retained=false}={}) {
    const local=s.generalizable===false&&/^group:[1-9]\d{4,15}$/.test(entry.scope||'');
    const safe=local?safeScopedText:safeGeneralText;
    return s.verified&&(s.generalizable===true||local)&&safe(s.meaning)&&safe(s.usage||'')
      &&(s.manual||s.evidence?.length>=3&&s.evidence.every(e=>(!local||e.key===entry.scope)&&(retained?this.sourceRetained(e):this.sourceExists(e))));
  }
  validSense(s,entry={}) {return s.status==='confirmed'&&this.reviewedSense(entry,s,{retained:true});}
  visible(entry,key) {return this.app.globalStyle.allowed(key)&&entry.status==='confirmed'&&safeGeneralText(entry.content)&&entry.senses?.some(s=>this.validSense(s));}
  contextEntries(entries,key,scene='',query='',{mode='explain'}={}) {
    if(this.unified)return this.app.community.retrieve(query,{key,scene,mode,kinds:['slang','meme','culture']}).map(k=>({...k,content:k.term,status:'confirmed',example:''}));
    if(!this.app.globalStyle.allowed(key)||!query.trim())return[];
    if(mode==='expression'&&!expressionScene(query,scene).allowed)return[];
    const q=normalizedTerm(query),terms=memoryTerms(query),out=[];
    for(const e of entries){if((mode!=='expression'&&![e.normalized||normalizedTerm(e.content),...(e.aliases||[])].some(t=>q.includes(t)))||!this.visible(e,key))continue;
      if(mode==='expression'){for(const s of e.senses.filter(s=>this.validSense(s))){const k={id:e.id+':'+s.id,kind:'slang',term:e.content,meaning:s.meaning,usage:s.usage,contextTerms:s.contextTerms||[],confidence:.95,origin:'native',sources:s.publicSources||[]},match=relevance(k,query,{mode});if(match)out.push({...k,...match,content:e.content,senseId:s.id});}continue;}
      const senses=e.senses.filter(s=>this.validSense(s)).map(s=>({s,score:(s.contextTerms||[]).filter(t=>terms.includes(t)||q.includes(normalizedTerm(t))).length})).sort((a,b)=>b.score-a.score);
      for(const {s,score}of senses.slice(0,senses[0]?.score?1:2))out.push({id:e.id,content:e.content,status:'confirmed',count:e.count,meaning:s.meaning,usage:s.usage,senseId:s.id,contextTerms:s.contextTerms||[],contextScore:score,score:8+score,kind:'slang',term:e.content,confidence:.95,origin:'native',sources:s.publicSources||[]});
    }
    return out.slice(0,8);
  }
  async verifyPublicSources(urls,term,meaning) {
    const valid=[...new Set((Array.isArray(urls)?urls:[]).map(publicSource).filter(Boolean))].slice(0,2),terms=memoryTerms(meaning);
    this.publicCache??=new Map();
    for(const url of valid){const key=url+':'+normalizedTerm(term)+':'+meaning,cached=this.publicCache.get(key);if(cached&&Date.now()-cached.at<86400000){if(cached.valid)return[url];continue;}
      let approved=false;try{const page=await safeFetch(url,24000),text=page.body.replace(/<[^>]*>/g,' ');approved=page.statusCode===200&&normalizedTerm(text).includes(normalizedTerm(term))&&(text.includes(meaning)||terms.filter(t=>text.includes(t)).length>=Math.min(2,terms.length)&&terms.length>0);}catch{}
      this.publicCache.set(key,{at:Date.now(),valid:approved});if(this.publicCache.size>100)this.publicCache.delete(this.publicCache.keys().next().value);if(approved)return[url];
    }
    return[];
  }
  async applyResearch(entry,output,selected) {
    const senses=Array.isArray(output.senses)?output.senses:[];if(senses.length>4)throw Error('黑话释义过多');const results=[];
    for(const s of senses){const safe=safeGeneralText;if(!s||Object.keys(s).some(k=>!['meaning','usage','contextTerms','sourceMessageIds','publicSources','generalizable','privateReferences'].includes(k))||typeof s.meaning!=='string'||!s.meaning.trim()||!safe(s.meaning)||!safe(s.usage||'')||s.generalizable!==true||s.privateReferences!==false||!Array.isArray(s.contextTerms)||s.contextTerms.length>12||s.contextTerms.some(t=>!safe(t)))throw Error('黑话研究结果涉及私人信息或未形成通用词义');
      const ids=[...new Set(s.sourceMessageIds||[])],rows=ids.map(id=>selected.find(m=>m.messageId===id));if(ids.length<3||rows.some(r=>!r))throw Error('黑话释义来源无效');
      if(rows.some(r=>!this.sourceExists({key:r.sourceKey,id:r.sourceId,time:r.time})))throw Error('黑话释义来源已撤销');
      const publicSources=this.unified?(s.publicSources||[]).map(publicSource).filter(Boolean).slice(0,3):await this.verifyPublicSources(s.publicSources,entry.content,s.meaning);
      if(!this.unified&&!publicSources.length)continue;
      results.push({id:senseId(s.meaning),meaning:s.meaning.slice(0,300),usage:(s.usage||'').slice(0,300),contextTerms:s.contextTerms,status:this.unified?'confirmed':'candidate',generalizable:true,verified:true,verifiedAt:Date.now(),publicSources,confidence:output.confidence,revision:0,evidence:rows.map(r=>({key:r.sourceKey,id:r.sourceId,time:r.time}))});
    }
    return results;
  }
  evidence(content, now = Date.now(), scope) {
    const app = this.app, p = app.settings.slangPolicy, messages = new Map();
    for (const [key, state] of app.states) {
      const group = key.startsWith('group:') ? key.slice(6) : '';
      if (!group || scope?.startsWith('group:')&&scope!==key || !(app.config.allow?.groups || []).map(String).includes(group) || (app.config.deny?.groups || []).map(String).includes(group)) continue;
      if (state.bigfatfish?.memoryControl?.accumulation === false) continue;
      for (const m of app.learningWindow.messages(key, state, now)) {
        const at = Number(m.time), uid = String(m.userId || ''), text = String(m.plain ?? m.text ?? '');
        if (m.isSelf || m.styleSourceVersion !== 2 || m.sourceScope !== key || !/^-?[1-9]\d{0,19}$/.test(String(m.messageId)) || !/^[1-9]\d{4,15}$/.test(uid) || uid === String(app.config.bigfatfish.expectedQQ)
          || !Number.isFinite(at) || at <= 0 || at > now || now - at > p.lookbackHours * 3600000
          || !app.privacy.reference(text) || !keywordHit(text, content)) continue;
        messages.set(key + ':' + m.messageId, { at, uid, key });
      }
    }
    return [...messages.values()];
  }
  candidateAdmission(content, now = Date.now(), scope) {
    const text = String(content || '').trim(), required = this.app.settings.slangPolicy.candidateMinMessages;
    const safe = Boolean(text.length >= 2 && text.length <= 50 && this.app.privacy.reference(text) && !/\d{5,}|https?:|@|\[CQ:/i.test(text));
    const deletedFile=path.join(this.app.root,'state/slang.json.deleted.json');
    const deleted=this.unified?{[termId(text)]:this.unified.deleted(termId(text))}:fs.existsSync(deletedFile)?JSON.parse(fs.readFileSync(deletedFile,'utf8')):{};
    const messages = safe && !deleted[termId(text)] ? this.evidence(text, now, scope).length : 0;
    return { eligible: safe && !deleted[termId(text)] && messages >= required, messages, required,
      reason: !safe ? '词条未通过安全检查' : messages < required ? `进入候选需${required}条不同真人消息，当前${messages}条` : '已达到候选门槛' };
  }
  score(entry, now = Date.now()) {
    const app = this.app, p = app.settings.slangPolicy;
    const evidence = this.evidence(entry.content, now, entry.scope), speakers = new Set(evidence.map(m => m.uid)).size;
    const times = evidence.map(m => m.at), spanMinutes = times.length ? (Math.max(...times) - Math.min(...times)) / 60000 : 0;
    const meaning = String(entry.meaning || entry.senses?.find(s=>s.verified)?.meaning || '').trim();
    const injectedFields = [entry.content, meaning, entry.usage, entry.example].map(value => String(value || '').trim());
    const safe = String(entry.content || '').trim().length >= 2 && meaning && injectedFields.filter(Boolean).every(text => app.privacy.reference(text))
      && !/\d{5,}|https?:|@|\[CQ:/i.test(injectedFields.join(' '));
    const risk = String(entry.risk || '').trim();
    const riskOk = !risk || /^(?:无|无明显风险|暂无|低风险|none|low|无风险|无特殊风险)[。.!！\s]*$/i.test(risk);
    const parts = { frequency: Math.min(30, evidence.length * 5), speakers: Math.min(20, speakers * 10),
      spread: Math.min(15, Math.floor(spanMinutes / p.minSpanMinutes * 15)), meaning: meaning ? 20 : 0,
      freshness: times.some(at => now - at <= 86400000) ? 15 : 0 };
    const score = Object.values(parts).reduce((a, b) => a + b, 0), reasons = [];
    if (!entry.senses?.some(s => s.status === 'candidate' && this.reviewedSense(entry,s))) reasons.push('等待自动词义与来源核验');
    if (!['candidate', 'confirmed'].includes(entry.status)) reasons.push('词条已拒绝或撤销');
    if (!safe) reasons.push('词条或释义未通过安全检查');
    if (!riskOk) reasons.push('风险说明未通过自动检查');
    if (!meaning) reasons.push('等待原黑话研究工具补充释义');
    if (p.autoResearch && (entry.research ? entry.research.status !== 'approved' : !entry.lastInferenceCount)) reasons.push('等待语料研究确认');
    if (evidence.length < p.minMessages) reasons.push('真人消息不足');
    if (speakers < p.minSpeakers) reasons.push('不同发言者不足');
    if (spanMinutes < p.minSpanMinutes) reasons.push('使用时间跨度不足');
    if (score < p.threshold) reasons.push('评分未达门槛');
    return { id: entry.id, content: entry.content, status: entry.status, meaning, score, parts, research: entry.research,
      messages: evidence.length, speakers, spanMinutes: Math.floor(spanMinutes), eligible: !reasons.length, reasons };
  }
  scan(store, { force = false, now = Date.now() } = {}) {
    if(this.unified)return; // Research completion publishes directly; no second scoring/confirmation stage.
    const p = this.app.settings.slangPolicy;
    if (!p.enabled || this.app.config.slang?.enabled === false || !store || !this.auditWritable || (!force && now - this.lastScanAt < p.scanIntervalMinutes * 60000)) return;
    this.lastScanAt = now; this.lastError = '';
    if (!p.autoConfirm || !store.writable()) return;
    const used = this.audit.filter(e => date(e.at) === date(now)).length;
    let remaining = Math.max(0, p.maxAutoPerDay - used);
    for (const candidate of store.entries().filter(e => ['candidate','confirmed'].includes(e.status) && e.senses?.some(s => s.status === 'candidate')).map(e => e.id)) {
      if (!remaining) break;
      // The upstream save may normalize/cap and replace the whole entries array.
      const entry = store.entries().find(e => e.id === candidate);
      if (!entry || !['candidate','confirmed'].includes(entry.status)) continue;
      const result = this.score(entry, now); if (!result.eligible) continue;
      const record = { id: entry.id, at: now, score: result.score, status: 'reserved' };
      // Reserve quota durably first: a crash or save failure must not bypass the daily cap.
      const audit = [...this.audit.filter(e => now - e.at < 31 * 86400000), record];
      try { persist(this.file, audit); } catch { this.lastError = '入库额度记录保存失败，本次未修改原词库'; return; }
      this.audit = audit; remaining--;
      const before = structuredClone(entry);
      try {
        for (const sense of entry.senses || []) if (sense.status === 'candidate' && this.reviewedSense(entry,sense)) sense.status = 'confirmed';
        entry.status = 'confirmed'; entry.revision = (entry.revision || 0) + 1; entry.updatedAt = new Date(now).toISOString();
        if (store.save() !== true) throw new Error('词库未保存');
        record.status = 'confirmed';
      } catch {
        Object.assign(entry, before);
        record.status = 'failed'; this.lastError = '原词库保存失败，本次入库已撤回';
      }
      try { persist(this.file, this.audit); } catch { this.lastError = '入库记录写入失败，预留额度仍有效，请检查磁盘'; }
      this.app.learningLog?.write('slang',record.status==='confirmed'?'CONFIRMED':'CONFIRM_FAILED',{status:record.status==='confirmed'?'PERSISTED':'FAILED',counts:{confirmed:record.status==='confirmed'?1:0}});
    }
    this.app.learningLog?.write('slang','SCAN_COMPLETED',{status:'COMPLETED',counts:{total:store.entries().length,candidates:store.entries().filter(e=>e.status==='candidate').length,confirmed:store.entries().filter(e=>e.status==='confirmed').length}});
  }
  snapshot(store, now = Date.now()) {
    if (!store) throw new Error('原黑话词库未连接');
    const entries = store.entries(), candidates = entries.filter(e => e.status === 'candidate');
    return { ok: true, automatic:true,authority:this.unified?'community.sqlite':'legacy',research:this.app.research.snapshot(now),policy: this.app.settings.slangPolicy, nativeEnabled: this.app.config.slang?.enabled !== false, writable: store.writable(), lastScanAt: this.lastScanAt,
      lastError: this.lastError, todayUsed: this.audit.filter(e => date(e.at) === date(now)).length,
      totalCandidates: candidates.length, rows: candidates.slice(0, 500).map(e => this.score(e, now)).sort((a, b) => b.score - a.score),
      researchJobs: this.manual.snapshot(), audit: this.audit.slice(-50).reverse().map(e => ({ ...e, content: entries.find(word => word.id === e.id)?.content || '词条已删除' })) };
  }
}
