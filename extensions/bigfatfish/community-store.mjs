import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { hash, sourceAllowed } from './community-adapters.mjs';
import { memoryTerms } from './memory-recall.mjs';

const require = createRequire(import.meta.url);
export const day = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export function searchTerms(text) {
  const q = String(text).normalize('NFKC').toLowerCase();
  return [...new Set([...memoryTerms(q), ...(q.match(/[\u4e00-\u9fff]+/g) || []).flatMap(w => Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2)))])].slice(0, 60);
}
const decode = row => row ? JSON.parse(row.data) : null;
export class CommunityStore {
  constructor(root) {
    this.file = path.join(root, 'state', 'community.sqlite');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.file);
    try {
      this.db.exec('PRAGMA busy_timeout=100; PRAGMA foreign_keys=ON;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 2) throw Error('社区数据库版本高于当前程序，请升级程序');
      if (version === 0) {
        if (this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n) this.backup();
        this.tx(() => this.db.exec(`
          CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
          INSERT INTO meta VALUES(1,0);
          CREATE TABLE sources (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
          CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
          CREATE UNIQUE INDEX one_active_job ON jobs((1)) WHERE status IN ('IDLE','DISCOVERING','FETCHING','FILTERING','EXTRACTING','VALIDATING','PUBLISHING','CANCELLING');
          CREATE TABLE documents (source TEXT NOT NULL REFERENCES sources(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(source,id,fingerprint));
          CREATE TABLE knowledge (id TEXT PRIMARY KEY, kind TEXT NOT NULL, term TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
          CREATE TABLE candidates (id TEXT PRIMARY KEY, job TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
          CREATE TABLE evidence (knowledge TEXT NOT NULL REFERENCES knowledge(id), source TEXT NOT NULL REFERENCES sources(id), document TEXT NOT NULL, fingerprint TEXT NOT NULL, quote TEXT NOT NULL, url TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(knowledge,source,document,fingerprint));
          CREATE TABLE revisions (id INTEGER PRIMARY KEY, knowledge TEXT NOT NULL, at INTEGER NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL);
          CREATE TABLE usage (id TEXT PRIMARY KEY, day TEXT NOT NULL, job TEXT NOT NULL, stage TEXT NOT NULL, data TEXT NOT NULL);
          CREATE VIRTUAL TABLE knowledge_fts USING fts5(id UNINDEXED, terms, tokenize='unicode61');
          PRAGMA user_version=1;
        `));
      }
      if(version<2){
        if(version===1)this.backup();
        this.tx(()=>this.db.exec(`CREATE TABLE community_logs (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, level TEXT NOT NULL, code TEXT NOT NULL, job TEXT, source TEXT, message TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX community_logs_job ON community_logs(job,id); PRAGMA user_version=2;`));
      }
      this.db.exec('PRAGMA journal_mode=WAL;');
      this.db.exec('CREATE INDEX IF NOT EXISTS evidence_source ON evidence(source); CREATE INDEX IF NOT EXISTS jobs_time ON jobs(at DESC); CREATE INDEX IF NOT EXISTS usage_day ON usage(day);');
    } catch (e) { this.db.close(); throw e; }
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  close() { this.db.close(); }
  backup() {
    const file = this.file + '.backup-' + Date.now() + '-' + randomUUID();
    this.db.prepare('VACUUM INTO ?').run(file); return path.basename(file);
  }
  generation() { return this.db.prepare('SELECT generation FROM meta WHERE id=1').get().generation; }
  invalidate() { this.db.exec('UPDATE meta SET generation=generation+1 WHERE id=1'); }
  sources() { return this.db.prepare('SELECT * FROM sources ORDER BY id').all().map(r => ({ ...decode(r), revision: r.revision, cursor: r.cursor })); }
  source(id) { return this.sources().find(s => s.id === id); }
  saveSource(source, revision) {
    this.tx(() => {
      const old = this.source(source.id);
      if(!old && this.sources().length>=32)throw Error('授权来源最多32个');
      if ((old?.revision ?? 0) !== revision) throw Error('来源版本已变化，请刷新');
      if(old && ['platform','adapter','file','endpoint'].some(k=>old[k]!==source[k]))throw Error('来源身份不能改写，请使用新来源编号登记不同材料入口');
      this.db.prepare('INSERT INTO sources(id,revision,cursor,data) VALUES(?,?,0,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,cursor=0,data=excluded.data')
        .run(source.id, revision + 1, JSON.stringify(source));
      if (!source.license.allowStore || source.license.expiresAt && source.license.expiresAt <= Date.now()) this.purgeSource(source.id);
      this.invalidate();
    });
  }
  purgeSource(id) {
    const affected=this.db.prepare('SELECT DISTINCT knowledge FROM evidence WHERE source=?').all(id);
    this.db.prepare('DELETE FROM evidence WHERE source=?').run(id);
    this.db.prepare('DELETE FROM documents WHERE source=?').run(id);
    this.db.prepare("DELETE FROM candidates WHERE job IN (SELECT id FROM jobs WHERE json_extract(data,'$.source')=?)").run(id);
    for(const {knowledge}of affected) if(!this.db.prepare('SELECT 1 FROM evidence WHERE knowledge=?').get(knowledge)) {
      // Keep the tombstone ID while erasing derived content and source quotations.
      this.db.prepare("UPDATE knowledge SET status='revoked',version=version+1,data=? WHERE id=?").run(JSON.stringify({id:knowledge,term:'已撤销来源',meaning:'',usage:'',contextTerms:[]}),knowledge);
      this.db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(knowledge);
      this.db.prepare('DELETE FROM revisions WHERE knowledge=?').run(knowledge);
    }
  }
  expireSources() {
    const expired=this.sources().filter(s=>s.license.expiresAt && s.license.expiresAt<=Date.now());
    if(!expired.length)return;
    this.tx(()=>{for(const s of expired)this.purgeSource(s.id);});
  }
  jobs() { return this.db.prepare('SELECT data FROM jobs ORDER BY at DESC LIMIT 30').all().map(decode); }
  job(id) { return decode(this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id)); }
  saveJob(job) { this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,version=excluded.version,data=excluded.data').run(job.id, job.status, job.version, job.at, JSON.stringify(job)); }
  log({level='info',code,job=null,source=null,message,data={}}) {
    this.tx(()=>{
      this.db.prepare('INSERT INTO community_logs(at,level,code,job,source,message,data) VALUES(?,?,?,?,?,?,?)').run(Date.now(),level,code,job,source,message,JSON.stringify(data));
      this.db.exec('DELETE FROM community_logs WHERE id < (SELECT id FROM community_logs ORDER BY id DESC LIMIT 1 OFFSET 1999)');
    });
  }
  logs(job=null) { return (job?this.db.prepare('SELECT * FROM community_logs WHERE job=? ORDER BY id DESC LIMIT 100').all(job):this.db.prepare('SELECT * FROM community_logs ORDER BY id DESC LIMIT 100').all()).map(r=>({...r,data:JSON.parse(r.data)})); }
  seen(source, item) { return !!this.db.prepare('SELECT 1 FROM documents WHERE source=? AND id=? AND fingerprint=?').get(source, item.id, item.fingerprint); }
  reserve(job, stage, input, output, rates, policy) {
    return this.tx(() => {
      const date = day(Date.now()), rows = this.db.prepare('SELECT data FROM usage WHERE day=?').all(date).map(decode);
      if(rows.some(r=>r.status==='overrun'))throw Error('社区学习预算计量异常，今日已暂停模型调用');
      const tokens = rows.reduce((n, r) => n + r.input + r.output, 0), cost = rows.reduce((n, r) => n + r.cost, 0);
      const calls = rows.filter(r => r.stage === 'select').length;
      const budgetCost = (input * rates.input + output * rates.output) / 1e6;
      if (tokens + input + output > policy.dailyTokenBudget || rows.reduce((n,r) => n+r.input,0)+input > policy.dailyInputTokens
        || rows.reduce((n,r) => n+r.output,0)+output > policy.dailyOutputTokens || cost + budgetCost > policy.dailyCostLimit
        || stage === 'select' && calls >= policy.maxPerDay) throw Error('社区学习每日Token、费用或任务预算已用完');
      const record = { id: randomUUID(), job:job.id, stage, input, output, cost: budgetCost, status: 'reserved', at: Date.now(), rates };
      this.db.prepare('INSERT INTO usage VALUES(?,?,?,?,?)').run(record.id, date, job.id, stage, JSON.stringify(record)); return record;
    });
  }
  settle(reservation, usage) {
    const { input, output, reasoning = 0, cacheHit = 0 } = usage || {};
    if (![input, output, reasoning, cacheHit].every(n => Number.isSafeInteger(n) && n >= 0) || cacheHit > input || reasoning > output) throw Error('模型未提供可信的实际usage，保留预算预留并拒绝发布');
    const overrun=input > reservation.input || output > reservation.output;
    const cost = (input * reservation.rates.input + output * reservation.rates.output) / 1e6;
    this.db.prepare('UPDATE usage SET data=? WHERE id=?').run(JSON.stringify({ ...reservation, input, output, reasoning, cacheHit, cost, updatedAt:Date.now(), status: overrun?'overrun':'measured', costKind: 'configured-upper-rate' }), reservation.id);
    if(overrun)throw Error('社区模型用量超过预算预留，已按返回值记账并暂停今日调用');
  }
  progress(reservation, observed) {
    const row=decode(this.db.prepare('SELECT data FROM usage WHERE id=?').get(reservation.id));
    if(!row||row.status!=='reserved')return;
    const clean={};for(const key of ['estimatedOutput','estimatedReasoning'])if(Number.isSafeInteger(observed[key])&&observed[key]>=0)clean[key]=observed[key];
    if(observed.usage&&['input','output','reasoning','cacheHit'].every(k=>Number.isSafeInteger(observed.usage[k])&&observed.usage[k]>=0)
      &&observed.usage.cacheHit<=observed.usage.input&&observed.usage.reasoning<=observed.usage.output)clean.usage=Object.fromEntries(['input','output','reasoning','cacheHit'].map(k=>[k,observed.usage[k]]));
    this.db.prepare('UPDATE usage SET data=? WHERE id=?').run(JSON.stringify({...row,observed:clean,updatedAt:Date.now()}),row.id);
  }
  usage(job=null) {
    const rows = (job?this.db.prepare('SELECT data FROM usage WHERE job=?').all(job):this.db.prepare('SELECT data FROM usage WHERE day=?').all(day(Date.now()))).map(decode);
    const measured=rows.map(r=>r.status==='reserved'?r.observed?.usage||{}:r),reserved=rows.filter(r=>r.status==='reserved');
    const sum=(values,key)=>values.reduce((n,r)=>n+(r[key]||0),0);
    return { calls: rows.length, tasks:rows.filter(r=>r.stage==='select').length, input: sum(rows,'input'), output: sum(rows,'output'), reasoning: sum(measured,'reasoning'), cacheHit: sum(measured,'cacheHit'), costUpperBound: sum(rows,'cost'), reserved: reserved.length, measuredCalls: rows.filter(r=>r.status!=='reserved').length,
      confirmed:{input:sum(measured,'input'),output:sum(measured,'output'),reasoning:sum(measured,'reasoning'),cacheHit:sum(measured,'cacheHit')},
      pending:{input:sum(reserved,'input'),output:sum(reserved,'output')},estimatedOutput:reserved.reduce((n,r)=>n+(r.observed?.estimatedOutput||0),0),estimatedReasoning:reserved.reduce((n,r)=>n+(r.observed?.estimatedReasoning||0),0),updatedAt:Math.max(0,...rows.map(r=>r.updatedAt||r.at||0)) };
  }
  publish(job, source, items, candidates, guard) {
    return this.tx(() => {
      const current = this.source(source.id);
      if (!guard() || job.generation !== this.generation() || current?.revision !== source.revision || !sourceAllowed(current)) throw Error('学习代际或来源许可已变化，禁止旧结果发布');
      let added = 0;
      for (const c of candidates) {
        const key = hash(JSON.stringify([c.kind, c.term.normalize('NFKC').toLowerCase(), c.meaning.normalize('NFKC')]));
        const row = this.db.prepare('SELECT * FROM knowledge WHERE id=?').get(key), old = decode(row);
        this.db.prepare('INSERT OR REPLACE INTO candidates VALUES(?,?,?,?)').run(hash(job.id + ':' + key), job.id, row?.status === 'revoked' ? 'revoked' : 'approved', JSON.stringify(c));
        if (row?.status === 'revoked') continue;
        const {evidence:quotedEvidence,...content}=c;
        const next = { ...content, id: key, version: (row?.version || 0) + 1, at: old?.at || Date.now(), updatedAt: Date.now() };
        this.db.prepare('INSERT INTO knowledge VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data')
          .run(key, c.kind, c.term, 'published', next.version, next.at, JSON.stringify(next));
        for (const e of c.evidence) {
          const item = items.find(i => i.id === e.id);
          this.db.prepare('INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?,?)').run(key, source.id, item.id, item.fingerprint, e.quote, item.url, Date.now());
        }
        this.db.prepare('INSERT INTO revisions(knowledge,at,action,data) VALUES(?,?,?,?)').run(key, Date.now(), old ? 'reinforce' : 'publish', JSON.stringify(old || next));
        this.db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(key);
        this.db.prepare('INSERT INTO knowledge_fts VALUES(?,?)').run(key, searchTerms([c.term, c.meaning, c.usage, ...c.contextTerms].join(' ')).join(' '));
        if (!old) added++;
      }
      for (const item of items) this.db.prepare('INSERT OR IGNORE INTO documents VALUES(?,?,?,?)').run(source.id, item.id, item.fingerprint, Date.now());
      job.added = added; job.status = 'IDLE'; job.finished = true; job.progress=100; job.version++; job.completedAt = Date.now();
      // IDLE is a finished display state; store COMPLETED so the unique active-job constraint is released.
      this.saveJob({ ...job, status: 'COMPLETED', phase: 'IDLE' });
      this.advance(source, job.nextCursor ?? source.cursor);
      return added;
    });
  }
  advance(source, cursor) { this.db.prepare('UPDATE sources SET cursor=? WHERE id=? AND revision=?').run(cursor, source.id, source.revision); }
  revoke(id) {
    this.tx(() => {
      const row = this.db.prepare('SELECT * FROM knowledge WHERE id=?').get(id); if (!row) throw Error('知识不存在');
      this.db.prepare('INSERT INTO revisions(knowledge,at,action,data) VALUES(?,?,?,?)').run(id, Date.now(), 'revoke', row.data);
      this.db.prepare("UPDATE knowledge SET status='revoked',version=version+1 WHERE id=?").run(id);
      this.db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(id); this.invalidate();
    });
  }
  list() { return this.db.prepare('SELECT * FROM knowledge ORDER BY at DESC LIMIT 100').all().map(r => ({ ...decode(r), status: r.status, version: r.version })); }
  search(query, { limit = 4, maxChars = 1200, kinds } = {}) {
    this.expireSources();
    const terms = searchTerms(query); if (!terms.length) return [];
    const matches = this.db.prepare('SELECT id,bm25(knowledge_fts) AS rank FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT 40').all(terms.map(t => '"' + t.replaceAll('"','""') + '"').join(' OR '));
    const sources = new Map(this.sources().filter(s=>sourceAllowed(s)).map(s=>[s.id,s])), out=[]; let chars=0;
    for (const m of matches) {
      const row = this.db.prepare("SELECT * FROM knowledge WHERE id=? AND status='published'").get(m.id); if (!row || kinds && !kinds.includes(row.kind)) continue;
      const k = decode(row), evidence = this.db.prepare('SELECT source,url,at FROM evidence WHERE knowledge=?').all(row.id).filter(e=>sources.has(e.source));
      if (!evidence.length) continue;
      const exact = String(query).normalize('NFKC').toLowerCase().includes(k.term.toLowerCase());
      if (!exact && !k.contextTerms.some(t=>terms.includes(t))) continue;
      const contextScore=k.contextTerms.filter(t=>terms.includes(t)||String(query).includes(t)).length;
      out.push({ id: k.id, kind: k.kind, term: k.term, meaning: k.meaning, usage: k.usage, contextTerms: k.contextTerms, version: row.version, sources: [...new Set(evidence.map(e=>e.url))].slice(0,2), rank: m.rank, exact, contextScore });
    }
    const best=new Map();for(const r of out)best.set(r.term,Math.max(best.get(r.term)||0,r.contextScore));
    return out.filter(r=>!best.get(r.term)||r.contextScore===best.get(r.term)).sort((a,b)=>Number(b.exact)-Number(a.exact)||b.contextScore-a.contextScore||a.rank-b.rank).filter(r=>{const size=JSON.stringify(r).length;if(chars+size>maxChars)return false;chars+=size;return true;}).slice(0,limit);
  }
}
