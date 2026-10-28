import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const keyOf = value => String(value || '').normalize('NFKC').trim().toLowerCase();
const message = error => /^(?:语料研究失败：|研究返回|研究结果|每日研究|词库|服务重启)/.test(String(error?.message)) ? String(error.message).slice(0, 160) : '研究调用未完成，请重试';
export class ManualSlangResearch {
  constructor(app) {
    this.app = app; this.file = path.join(app.root, 'state', 'slang-research-jobs.json'); this.jobs = []; this.chain = Promise.resolve(); this.writable = true;
    try {
      if (fs.existsSync(this.file)) this.jobs = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.jobs)) throw Error();
      for (const job of this.jobs) if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.stage = '服务重启中断，请重新提交未完成词条'; job.finishedAt = Date.now(); }
    } catch { this.writable = false; this.jobs = []; }
  }
  save() {
    if (!this.writable) throw Error('研究结果记录无法写入');
    const active = this.jobs.filter(j => ['queued', 'running'].includes(j.status));
    this.jobs = [...this.jobs.filter(j => !['queued', 'running'].includes(j.status)).slice(-Math.max(1, 30 - active.length)), ...active].sort((a, b) => a.createdAt - b.createdAt);
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.jobs, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  active(id) { return this.jobs.some(j => ['queued', 'running'].includes(j.status) && j.ids.includes(id)); }
  recover(store) {
    let changed = false, historyChanged = false;
    for (const job of this.jobs.filter(job => job.status === 'interrupted')) for (const entry of store.entries()) {
      if (entry.research?.jobId === job.id && ['queued', 'researching'].includes(entry.research.status)) {
        entry.research = { ...entry.research, status: 'failed', reason: job.stage, nextAt: 0 }; changed = true;
      }
    }
    if (changed && store.writable()) { store.save(); this.save(); }
    for (const entry of store.entries()) {
      const job = this.jobs.find(j => j.id === entry.research?.jobId);
      if (job && !job.results?.some(row => row.id === entry.id)) {
        job.results ||= []; job.results.push({ id: entry.id, content: entry.content, research: structuredClone(entry.research) }); job.results = job.results.slice(-200); historyChanged = true;
      }
    }
    if (historyChanged) this.save();
  }
  queue(candidates, store) {
    if (!store.writable() || !this.writable) throw Error('词库或研究记录只读，请检查后重试');
    if (!this.app.research.runner) throw Error('研究服务尚未就绪');
    const active = new Set(this.jobs.filter(j => ['queued', 'running'].includes(j.status)).flatMap(j => j.ids));
    const targets = candidates.filter(e => e.status === 'candidate' && !active.has(e.id) && !(e.research?.status === 'researching' && e.research.mode !== 'manual' && this.app.research.running));
    if (!targets.length) return { count: 0, alreadyQueued: candidates.length, jobId: this.jobs.find(j => j.ids.some(id => candidates.some(e => e.id === id)) && ['queued', 'running'].includes(j.status))?.id || '' };
    const job = { id: randomUUID(), ids: targets.map(e => e.id), words: targets.map(e => e.content), status: 'queued', stage: '等待DSH研究',
      total: targets.length, done: 0, approved: 0, uncertain: 0, failed: 0, skipped: 0, results: [], createdAt: Date.now(), finishedAt: 0 };
    const before = targets.map(e => [e.id, structuredClone(e.research)]);
    try {
      for (const entry of targets) entry.research = { status: 'queued', mode: 'manual', jobId: job.id, at: Date.now(), nextAt: Date.now() + 3600000, reason: '已排队，等待研究' };
      if (store.save() !== true) throw Error('词库研究状态保存失败'); this.jobs.push(job); this.save();
    } catch (error) {
      this.jobs = this.jobs.filter(j => j.id !== job.id);
      for (const [id, old] of before) { const entry = store.entries().find(e => e.id === id); if (entry) entry.research = old; }
      try { store.save(); } catch {} throw error;
    }
    this.chain = this.chain.then(() => this.run(job, store)).catch(() => { job.status = 'failed'; job.stage = '任务未完成，请检查服务后重试'; job.finishedAt = Date.now(); try { this.save(); } catch {} });
    return { count: job.total, jobId: job.id, alreadyQueued: candidates.length - job.total };
  }
  safeResult(row) {
    const result = {};
    for (const field of ['meaning', 'usage', 'example', 'risk', 'reason']) {
      const text = String(row[field] || '').trim().slice(0, field === 'reason' ? 160 : 300);
      if (text && !this.app.privacy.reference(text)) throw Error('研究返回包含不适合入库的内容'); result[field] = text;
    }
    result.sources = Array.isArray(row.sources) ? row.sources.map(s => this.publicUrl(s)).filter(Boolean).slice(0, 10) : [];
    return result;
  }
  publicUrl(value) {
    try {
      const url = new URL(String(value));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || /^(?:localhost|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[(?:::1\]|fc|fd|fe80))/i.test(url.hostname)
        || /\.(?:local|localhost|internal)$/i.test(url.hostname) || [...url.searchParams.keys()].some(k => /token|secret|password|api.?key|authorization|cookie/i.test(k))) return '';
      return this.app.privacy.reference(url.hostname + url.pathname + url.search + url.hash) ? url.href : '';
    } catch { return ''; }
  }
  preview(output) {
    const raw = String(output).slice(0, 16000), urls = /https?:\/\/[^\s"<>\\\]]+/g;
    const safe = raw.replace(urls, link => this.publicUrl(link) || '[链接已隐藏]');
    return this.app.privacy.reference(safe.replace(urls, '[公开来源]')) ? safe.slice(0, 4000) : '返回包含不适合展示的内容，已隐藏摘录';
  }
  async run(job, store) {
    job.status='running'; job.stage='等待全局词义验证'; this.save();
    for(const id of job.ids) {
      const entry=store.entries().find(e=>e.id===id);
      if(!entry||entry.status!=='candidate'||entry.research?.jobId!==job.id){job.skipped++;job.done++;continue;}
      const revision=entry.revision||0;
      try {
        if(this.app.config.slang?.enabled===false||!store.writable()||!this.app.research.runner)throw Error('研究服务已关闭');
        // Manual enqueue excludes automatic jobs, so gather the same verified group-only rows directly.
        const selected=[];
        for(const [key,st]of this.app.states)if(this.app.research.allowed(key)&&st.bigfatfish.memoryControl?.accumulation!==false)
          for(const m of this.app.learningWindow.messages(key,st))if(m.styleSourceVersion===2&&m.sourceScope===key&&/^-?[1-9]\d{0,19}$/.test(String(m.messageId))&&String(m.plain||'').includes(entry.content))selected.push({...m,messageId:key+':'+m.messageId,sourceKey:key,sourceId:String(m.messageId)});
        const rows=selected.slice(-30);if(rows.length<3)throw Error('研究结果缺少足够真人来源');
        if(!this.app.research.reserve({kind:'slang-manual'},Date.now()))throw Error('每日研究额度已用完');
        const output=await this.app.research.runner({kind:'slang-manual',key:'global',prompt:this.app.research.prompt({kind:'slang',entry},rows),timeoutMs:120000});
        const raw=String(output).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');const result=JSON.parse(raw);
        if(result.approved!==true||!Number.isFinite(result.confidence)||result.confidence<this.app.settings.learningResearch.minConfidence)throw Error('研究结果尚不确定');
        const senses=await this.app.slang.applyResearch(entry,result,rows);
        const current=store.entries().find(e=>e.id===id);
        if(!current||current.status!=='candidate'||current.research?.jobId!==job.id||(current.revision||0)!==revision||this.app.config.slang?.enabled===false||rows.some(r=>!this.app.slang.sourceExists({key:r.sourceKey,id:r.sourceId,time:r.time})))throw Error('词库或来源已变化');
        if(!senses.length)throw Error('研究结果缺少可信公开来源');
        current.senses=[...new Map([...(current.senses||[]),...senses].map(s=>[s.id,s])).values()];
        current.meaning=senses[0].meaning;current.usage=senses[0].usage;current.revision=revision+1;
        current.lastInferenceCount=current.count;current.updatedAt=new Date().toISOString();
        current.research={status:'approved',mode:'manual',jobId:job.id,at:Date.now(),reason:'公开来源及一般化检查通过'};
        if(store.save()!==true)throw Error('词库保存失败');job.approved++;
        this.app.slang.scan(store,{force:true});
      }catch(error){
        const current=store.entries().find(e=>e.id===id);
        if(current&&current.research?.jobId===job.id&&(current.revision||0)===revision){current.research={...current.research,status:'failed',reason:message(error)};try{store.save();}catch{}}
        job.failed++;
      }
      job.done++;this.save();
    }
    job.status=job.failed?'partial':'completed';job.finishedAt=Date.now();job.stage=`研究结束：通过${job.approved}，失败${job.failed}，跳过${job.skipped}`;this.save();
  }
  snapshot() { return this.jobs.slice(-15).reverse().map(j => ({ ...j, ids: [...j.ids], words: [...j.words] })); }
}
