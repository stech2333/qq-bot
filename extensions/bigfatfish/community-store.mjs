import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { hash, sourceAllowed, knowledgeAllowed } from './community-adapters.mjs';
import { memoryTerms } from './memory-recall.mjs';
import {conceptKey,senseKey,termAliases,retrievalWords,relevance,normalized,expressionScene} from './community-retrieval.mjs';

const require = createRequire(import.meta.url);
export const day = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const ARCHIVE_MAX_BYTES = 10 * 1024 * 1024;
const OMIT_LOG_KEY = /(?:cookie|authorization|api.?key|access.?token|password|credential|prompt|reasoning_content|raw.?response|system.?message|\btext\b|\bcontent\b)/i;
function cleanLogValue(value,key='',depth=0) {
  if(depth>5||OMIT_LOG_KEY.test(key)||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')return undefined;
  if(value===null)return undefined;
  if(typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:undefined;
  if(typeof value==='string')return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,key==='url'?500:key==='title'?200:1000);
  if(Array.isArray(value))return value.slice(0,50).map((v,i)=>cleanLogValue(v,String(i),depth+1)).filter(v=>v!==undefined);
  if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value)){const clean=cleanLogValue(v,k,depth+1);if(clean!==undefined)out[k]=clean;}return out;}
  return undefined;
}
export function searchTerms(text) {
  const q = String(text).normalize('NFKC').toLowerCase();
  return [...new Set([...memoryTerms(q), ...(q.match(/[\u4e00-\u9fff]+/g) || []).flatMap(w => Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2)))])].slice(0, 60);
}
const decode = row => row ? JSON.parse(row.data) : null;
export const termKey = value => String(value).normalize('NFKC').trim().toLowerCase();
export class CommunityStore {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'state', 'community.sqlite');
    this.archiveDir = path.join(root, 'logs', 'bridge', 'community-learning');
    this.archiveMaxBytes = ARCHIVE_MAX_BYTES;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.file);
    try {
      this.db.exec('PRAGMA busy_timeout=100; PRAGMA foreign_keys=ON;');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (version > 3) throw Error('社区数据库版本高于当前程序，请升级程序');
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
      if(version<3){
        if(version===2)this.backup();
        this.tx(()=>{
          this.db.exec(`
            CREATE TABLE learning_sessions(id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL);
            CREATE TABLE source_state(id TEXT PRIMARY KEY REFERENCES sources(id), data TEXT NOT NULL);
            CREATE TABLE material_queue(source TEXT NOT NULL REFERENCES sources(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, updated INTEGER NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, PRIMARY KEY(source,id,fingerprint));
            CREATE INDEX material_pending ON material_queue(source,status,retry_at,updated);
            CREATE TABLE learning_goals(id TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL);
            ALTER TABLE knowledge ADD COLUMN term_key TEXT;
            CREATE INDEX knowledge_term ON knowledge(term_key,status);
            ALTER TABLE candidates ADD COLUMN term_key TEXT;
            CREATE INDEX candidates_term ON candidates(term_key,status);
            ALTER TABLE usage ADD COLUMN session_id TEXT;
            CREATE INDEX usage_session ON usage(session_id);
            ALTER TABLE community_logs ADD COLUMN session_id TEXT;
            ALTER TABLE community_logs ADD COLUMN platform TEXT;
            ALTER TABLE community_logs ADD COLUMN phase TEXT;
            CREATE INDEX logs_session ON community_logs(session_id,id);
            DROP INDEX one_active_job;
            CREATE UNIQUE INDEX one_active_job ON jobs((1)) WHERE status IN ('IDLE','DISCOVERING','FETCHING','FILTERING','READING','EXTRACTING','VALIDATING','PUBLISHING','CANCELLING');
            PRAGMA user_version=3;
          `);
          for(const r of this.db.prepare('SELECT id,term FROM knowledge').all())this.db.prepare('UPDATE knowledge SET term_key=? WHERE id=?').run(termKey(r.term),r.id);
          for(const r of this.db.prepare('SELECT id,data FROM candidates').all())this.db.prepare('UPDATE candidates SET term_key=? WHERE id=?').run(termKey(decode(r).term||''),r.id);
          // V4 documents may include unread candidates. Re-discover them instead of trusting completion markers.
          this.db.exec('DELETE FROM documents; UPDATE sources SET cursor=0;');
        });
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
      if(old && ['platform','adapter','file','endpoint','connector','target'].some(k=>old[k]!==source[k]))throw Error('来源身份不能改写，请使用新来源编号登记不同材料入口');
      this.db.prepare('INSERT INTO sources(id,revision,cursor,data) VALUES(?,?,0,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,cursor=0,data=excluded.data')
        .run(source.id, revision + 1, JSON.stringify(source));
      if (!source.license.allowStore || source.license.expiresAt && source.license.expiresAt <= Date.now()) this.purgeSource(source.id);
      this.db.prepare('DELETE FROM source_state WHERE id=?').run(source.id);
    });
  }
  purgeSource(id) {
    const affected=this.db.prepare('SELECT DISTINCT knowledge FROM evidence WHERE source=?').all(id);
    this.db.prepare('DELETE FROM evidence WHERE source=?').run(id);
    this.db.prepare('DELETE FROM documents WHERE source=?').run(id);
    this.db.prepare('DELETE FROM material_queue WHERE source=?').run(id);
    this.db.prepare('DELETE FROM learning_goals WHERE json_extract(data,\'$.source\')=?').run(id);
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
  latestJob() {return decode(this.db.prepare('SELECT data FROM jobs ORDER BY at DESC,rowid DESC LIMIT 1').get());}
  saveJob(job) { this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,version=excluded.version,data=excluded.data').run(job.id, job.status, job.version, job.at, JSON.stringify(job)); }
  archiveLog(record) {
    try {
      fs.mkdirSync(this.archiveDir,{recursive:true});
      const line=JSON.stringify(cleanLogValue(record))+'\n',bytes=Buffer.byteLength(line);
      const date=day(record.at);let part=0,file;
      do {
        file=path.join(this.archiveDir,date+(part?'.'+part:'')+'.jsonl');
        if(!fs.existsSync(file)||fs.statSync(file).size+bytes<=this.archiveMaxBytes)break;
        part++;
      } while(part<1000);
      fs.appendFileSync(file,line,{encoding:'utf8',flag:'a'});
      this.archiveWarning='';
      return file;
    } catch {
      if(!this.archiveWarning){
        this.archiveWarning='社区学习JSONL归档失败，SQLite日志仍正常';
        console.warn('[BigFatFish community] '+this.archiveWarning);
      }
      return '';
    }
  }
  log({level='info',code,job=null,source=null,message,data={},session=null,platform=null,phase=null}) {
    const at=Date.now(),cleanData=cleanLogValue(data)||{},cleanMessage=String(message||'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500);
    let id;
    this.tx(()=>{
      const result=this.db.prepare('INSERT INTO community_logs(at,level,code,job,source,message,data,session_id,platform,phase) VALUES(?,?,?,?,?,?,?,?,?,?)').run(at,level,code,job,source,cleanMessage,JSON.stringify(cleanData),session,platform,phase);
      id=Number(result.lastInsertRowid);
      this.db.exec('DELETE FROM community_logs WHERE id < (SELECT id FROM community_logs ORDER BY id DESC LIMIT 1 OFFSET 1999)');
    });
    const record={id,archiveId:'community:'+id,at,level,code,job,source,message:cleanMessage,data:cleanData,session_id:session,platform,phase};
    this.archiveLog(record);
    return record;
  }
  logs(job=null) { return (job?this.db.prepare('SELECT * FROM community_logs WHERE job=? ORDER BY id DESC LIMIT 100').all(job):this.db.prepare('SELECT * FROM community_logs ORDER BY id DESC LIMIT 100').all()).map(r=>cleanLogValue({...r,data:JSON.parse(r.data)})); }
  logPage(since=0) { const rows=this.db.prepare('SELECT * FROM community_logs WHERE id>? ORDER BY id LIMIT 100').all(since).map(r=>cleanLogValue({...r,data:JSON.parse(r.data)}));const range=this.db.prepare('SELECT min(id) first,max(id) last FROM community_logs').get();return {rows,cursor:rows.at(-1)?.id||since,hasMore:!!rows.length&&rows.at(-1).id<range.last,reset:since>0&&since<(range.first||0)-1}; }
  session() { return decode(this.db.prepare('SELECT data FROM learning_sessions ORDER BY at DESC LIMIT 1').get()); }
  saveSession(s) { this.db.prepare('INSERT INTO learning_sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(s.id,s.at,JSON.stringify({...s,updatedAt:Date.now()})); }
  sessionSummary(id) {
    if(!id)return {completed:0,failed:0,added:0};
    const rows=this.db.prepare("SELECT data FROM jobs WHERE json_extract(data,'$.session')=?").all(id).map(decode);
    return {completed:rows.filter(r=>r.status==='COMPLETED').length,failed:rows.filter(r=>['RETRYABLE','BLOCKED','PAUSED','ERROR'].includes(r.status)).length,added:rows.reduce((n,r)=>n+(Number(r.added)||0),0)};
  }
  sourceState(id) { return decode(this.db.prepare('SELECT data FROM source_state WHERE id=?').get(id))||{id,status:'NEEDS_AUTH',nextAt:0,failures:0}; }
  saveSourceState(s) { this.db.prepare('INSERT OR REPLACE INTO source_state VALUES(?,?)').run(s.id,JSON.stringify(s)); }
  latestMaterial(source,id) {const row=this.db.prepare('SELECT data,status,retry_at FROM material_queue WHERE source=? AND id=? ORDER BY updated DESC LIMIT 1').get(source,id);return row?{...decode(row),status:row.status,retryAt:row.retry_at}:null;}
  enqueue(source,items,cursor) { return this.tx(()=>{let added=0;for(const item of items){
    const old=item.stableVideo?this.latestMaterial(source.id,item.id):null;
    if(old){
      const changed=old.status!=='SKIPPED'&&item.subtitleVersion&&old.subtitleVersion&&item.subtitleVersion!==old.subtitleVersion;
      const metadata=Object.fromEntries(Object.entries(item).filter(([,v])=>v!==undefined));
      // Comment counts and metadata are observations, not a request to learn this video again.
      this.checkpoint(old,changed?'QUEUED':old.status,{...metadata,fingerprint:old.fingerprint,...(changed?{offset:0,readCursor:{stage:'subtitles',offset:0},reading:undefined,extracted:undefined,approved:undefined,prepared:undefined,validation:undefined,finished:false,ranked:true}:{})},changed?0:old.retryAt||0);continue;
    }
    const r={...item,source:source.id,platform:source.platform,discoveredAt:Date.now(),updatedAt:Date.now(),offset:0,failures:0};added+=Number(this.db.prepare("INSERT OR IGNORE INTO material_queue VALUES(?,?,?,'DISCOVERED',?,0,?)").run(source.id,item.id,item.fingerprint,Date.now(),JSON.stringify(r)).changes);
  }this.advance(source,cursor);return added;}); }
  pending(source,limit=32,now=Date.now()) { return this.db.prepare("SELECT data,status,retry_at FROM material_queue WHERE source=? AND status IN ('DISCOVERED','QUEUED','READING','EXTRACTING','VALIDATING','RETRYABLE') AND retry_at<=? ORDER BY updated,id LIMIT ?").all(source,now,limit).map(r=>({...decode(r),status:r.status,retryAt:r.retry_at})); }
  material(source,id,fingerprint) {const r=this.db.prepare('SELECT data,status,retry_at FROM material_queue WHERE source=? AND id=? AND fingerprint=?').get(source,id,fingerprint);return r?{...decode(r),status:r.status,retryAt:r.retry_at}:null;}
  checkpoint(row,status,patch={},retryAt=0) {const data={...row,...patch,updatedAt:Date.now(),retryAt};this.db.prepare('UPDATE material_queue SET status=?,updated=?,retry_at=?,data=? WHERE source=? AND id=? AND fingerprint=?').run(status,data.updatedAt,retryAt,JSON.stringify(data),row.source,row.id,row.fingerprint);return {...data,status};}
  requeue(source=null) { const where=source?' AND source=?':'';this.db.prepare("UPDATE material_queue SET status='QUEUED' WHERE status IN ('READING','EXTRACTING','VALIDATING')"+where).run(...(source?[source]:[])); }
  conflicts(term) {const keys=termAliases(term),slots=keys.map(()=>'?').join(',');return {published:this.db.prepare(`SELECT data FROM knowledge WHERE term_key IN (${slots}) AND status='published' LIMIT 12`).all(...keys).map(decode),pending:this.db.prepare(`SELECT data FROM candidates WHERE term_key IN (${slots}) AND status='pending' LIMIT 12`).all(...keys).map(decode)};}
  candidateKey(c) {return hash(JSON.stringify([c.kind,conceptKey(c.term),senseKey(c.meaning)]));}
  evidenceRefs(c,source,items) {
    if(c.refs)return c.refs.filter(r=>{const s=this.source(r.source);return s&&sourceAllowed(s)&&s.revision===r.revision&&typeof r.context==='string'&&r.context.includes(r.quote);});
    return (c.evidence||[]).flatMap(e=>{const item=items.find(i=>i.id===e.id);if(!item||!item.text?.includes(e.quote))return[];const at=item.text.indexOf(e.quote);return [{id:hash(source.id+':'+item.id+':'+hash(e.quote)),source:source.id,revision:source.revision,platform:source.platform,document:item.id,fingerprint:item.fingerprint,url:item.url,title:item.title,quote:e.quote,context:item.text.slice(Math.max(0,at-100),at+e.quote.length+100)}];});
  }
  legacyCandidate(row) {
    const c=decode(row);if(c.refs)return {...c,pendingIds:[...new Set([...(c.pendingIds||[]),row.id])]};
    const job=this.job(row.job),source=job&&this.source(job.source);if(!sourceAllowed(source))return null;
    const refs=(c.evidence||[]).map(e=>{const item=this.latestMaterial(source.id,e.id);return {id:hash(source.id+':'+e.id+':'+hash(e.quote)),source:source.id,revision:source.revision,platform:source.platform,document:e.id,fingerprint:item?.fingerprint||'legacy',url:item?.url,title:item?.title,quote:e.quote,context:e.quote,legacy:true};});
    return {...c,refs,pendingIds:[row.id],firstSeenAt:job.at,lastVerifiedAt:job.completedAt||job.at,lastReviewedEvidence:hash(refs.map(r=>r.id).sort().join('|')),reviewAttempts:1};
  }
  prepareCandidates(job,source,item,extracted,now=Date.now()) {
    const counters={duplicates:0,enriched:0,reviews:0},map=new Map(),add=c=>{
      if(!c)return;const key=this.candidateKey(c),refs=this.evidenceRefs(c,source,[item]);if(!refs.length)return;
      const old=map.get(key);if(old){counters.duplicates++;old.refs=[...new Map([...old.refs,...refs].map(r=>[r.id,r])).values()].slice(-4);old.pendingIds=[...new Set([...old.pendingIds,...c.pendingIds||[]])];return;}
      map.set(key,{...c,finalStatus:['rejected','expired'].includes(c.finalStatus)?c.finalStatus:undefined,refs,pendingIds:c.pendingIds||[],firstSeenAt:c.firstSeenAt||now,reviewAttempts:c.reviewAttempts||0,key});
    };
    // Retire only a few obsolete rows per real read; do not bulk re-review historical candidates.
    const stale=this.db.prepare("SELECT c.id,c.data FROM candidates c JOIN jobs j ON j.id=c.job WHERE c.status='pending' AND coalesce(json_extract(c.data,'$.firstSeenAt'),j.at)<? LIMIT 3").all(now-90*86400000);
    for(const r of stale){const c=decode(r);this.db.prepare("UPDATE candidates SET status='expired',data=? WHERE id=? AND status='pending'").run(JSON.stringify({...c,finalStatus:'expired',failureRules:['CANDIDATE_EXPIRED']}),r.id);}
    // Indexed exact-term matches first; a bounded learning-time scan also finds old contextual candidates.
    const words=[...new Set(extracted.flatMap(c=>termAliases(c.term)))],slots=words.map(()=>'?').join(',');
    const rows=this.db.prepare(`SELECT id,job,data FROM candidates WHERE status='pending' AND (${slots?'term_key IN ('+slots+') OR ':''}instr(?,term_key)>0) ORDER BY json_extract(data,'$.lastVerifiedAt') LIMIT 24`).all(...words,normalized(item.text));
    for(const row of rows){const c=this.legacyCandidate(row);if(!c)continue;
      const fresh=extracted.find(x=>this.candidateKey(x)===this.candidateKey(c));
      if(fresh){const refs=this.evidenceRefs(fresh,source,[item]);if(refs.some(r=>!c.refs.some(e=>e.id===r.id)))counters.enriched++;add(c);continue;}
      // Copy a real sentence, never a generated quote. Same video cannot inflate independent support.
      if((c.refs||[]).some(r=>r.platform===source.platform&&r.document===item.id))continue;
      const sentence=item.text.split(/(?<=[。！？.!?\n])/u).find(s=>s.length>=4&&s.length<=240&&termAliases(c.term).some(t=>normalized(s).includes(t)));
      if(sentence){const refs=this.evidenceRefs({...c,evidence:[{id:item.id,quote:sentence}],refs:undefined},source,[item]);add({...c,refs:[...c.refs,...refs].slice(-4)});counters.enriched++;}
      if(counters.enriched>=3)break;
    }
    for(const c of extracted)add({...c,refs:this.evidenceRefs(c,source,[item])});
    const candidates=[];
    for(const c of map.values()){
      c.independentSources=new Set(c.refs.map(r=>r.platform+':'+r.document)).size;
      c.evidenceVersion=hash(c.refs.map(r=>r.id).sort().join('|'));
      const key=c.key,known=this.db.prepare('SELECT status,data FROM candidates WHERE id=?').get(key);
      if(known&&['rejected','expired','published'].includes(known.status)&&decode(known).evidenceVersion===c.evidenceVersion){counters.duplicates++;continue;}
      const published=this.conflicts(c.term).published.find(k=>senseKey(k.meaning)===senseKey(c.meaning)&&k.kind===c.kind);
      if(published&&c.refs.every(r=>this.db.prepare('SELECT 1 FROM evidence WHERE knowledge=? AND source=? AND document=? AND quote=?').get(published.id,r.source,r.document,r.quote))){counters.duplicates++;continue;}
      const oldData=known?decode(known):null;
      c.newEvidenceCount=c.refs.filter(r=>!oldData?.refs?.some(e=>e.id===r.id)).length;
      if(oldData&&known.status!=='published'){c.lastReviewedEvidence=oldData.lastReviewedEvidence||c.lastReviewedEvidence;c.nextReviewAt=oldData.nextReviewAt||c.nextReviewAt;c.reviewAttempts=Math.max(c.reviewAttempts,oldData.reviewAttempts||0);c.firstSeenAt=Math.min(c.firstSeenAt,oldData.firstSeenAt||now);}
      if(now-c.firstSeenAt>90*86400000){c.finalStatus='expired';c.failureRules=['CANDIDATE_EXPIRED'];}
      if(c.reviewAttempts>=4){c.finalStatus='rejected';c.failureRules=['REVIEW_LIMIT'];}
      c.reviewEligible=!c.finalStatus&&c.evidenceVersion!==c.lastReviewedEvidence&&(c.nextReviewAt||0)<=now&&(c.confidence>=.85||c.independentSources>=2);
      candidates.push(c);
    }
    return {candidates,counters};
  }
  reviewPayload(c) {return {...Object.fromEntries(['kind','term','meaning','usage','contextTerms','confidence','conflict','strategy','timeSensitive','validUntil'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])),evidence:c.refs?c.refs.map(r=>({id:r.id,quote:r.quote})):c.evidence};}
  hold(job,candidates) {for(const c of candidates){
    const id=c.key||this.candidateKey(c),old=decode(this.db.prepare('SELECT data FROM candidates WHERE id=?').get(id));
    const next={...old,...c,firstSeenAt:old?.firstSeenAt||c.firstSeenAt||Date.now(),finalStatus:c.finalStatus||'pending'};
    this.db.prepare('INSERT INTO candidates(id,job,status,data,term_key) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET job=excluded.job,status=excluded.status,data=excluded.data,term_key=excluded.term_key').run(id,job.id,next.finalStatus,JSON.stringify(next),conceptKey(c.term));
    for(const previous of c.pendingIds||[])if(previous!==id)this.db.prepare("UPDATE candidates SET status='merged',data=json_set(data,'$.mergedInto',?) WHERE id=? AND status='pending'").run(id,previous);
  }}
  goals() {return this.db.prepare('SELECT data FROM learning_goals ORDER BY updated DESC LIMIT 16').all().map(decode);}
  goal(term,source,reason) {const id=hash(termKey(term)+':'+source);this.db.prepare('INSERT OR REPLACE INTO learning_goals VALUES(?,?,?)').run(id,Date.now(),JSON.stringify({id,term,source,reason}));this.db.exec('DELETE FROM learning_goals WHERE id IN (SELECT id FROM learning_goals ORDER BY updated DESC LIMIT -1 OFFSET 100)');}
  stats(source=null) {const params=source?[source]:[],where=source?' WHERE source=?':'';const rows=this.db.prepare('SELECT status,count(*) n FROM material_queue'+where+' GROUP BY status').all(...params),counts=Object.fromEntries(rows.map(r=>[r.status,r.n]));const k=this.db.prepare("SELECT kind,count(*) n FROM knowledge WHERE status='published' GROUP BY kind").all();return {discovered:rows.reduce((n,r)=>n+r.n,0),completed:counts.COMPLETED||0,skipped:counts.SKIPPED||0,blocked:counts.BLOCKED||0,pending:rows.filter(r=>!['COMPLETED','SKIPPED','BLOCKED'].includes(r.status)).reduce((n,r)=>n+r.n,0),published:k.reduce((n,r)=>n+r.n,0),slang:k.find(r=>r.kind==='slang')?.n||0,strategies:k.find(r=>r.kind==='strategy')?.n||0,unverified:this.db.prepare("SELECT count(*) n FROM candidates WHERE status='pending'").get().n,multipleSenses:this.db.prepare("SELECT count(*) n FROM (SELECT term_key FROM knowledge WHERE status='published' GROUP BY term_key HAVING count(*)>1)").get().n};}
  seen(source, item) { return !!this.db.prepare('SELECT 1 FROM documents WHERE source=? AND id=? AND fingerprint=?').get(source, item.id, item.fingerprint); }
  reserve(job, stage, input, output, rates, policy) {
    return this.tx(() => {
      const date = day(Date.now()), rows = this.db.prepare('SELECT data FROM usage WHERE day=?').all(date).map(decode);
      if(rows.some(r=>r.status==='overrun'))throw Error('社区学习预算计量异常，今日已暂停模型调用');
      const tokens = rows.reduce((n, r) => n + r.input + r.output, 0), cost = rows.reduce((n, r) => n + r.cost, 0);
      const budgetCost = (input * rates.input + output * rates.output) / 1e6;
      const sessionCost=job.session?this.usage(null,job.session).costUpperBound:0;
      if ((policy.dailyTokenBudget!=null&&tokens+input+output>policy.dailyTokenBudget)||(policy.dailyInputTokens!=null&&rows.reduce((n,r)=>n+r.input,0)+input>policy.dailyInputTokens)||(policy.dailyOutputTokens!=null&&rows.reduce((n,r)=>n+r.output,0)+output>policy.dailyOutputTokens)||(policy.dailyCostLimit!=null&&cost+budgetCost>policy.dailyCostLimit)||(policy.sessionCostLimit!=null&&sessionCost+budgetCost>policy.sessionCostLimit))throw Error('社区学习费用或Token保护阈值已触发，请调整配置后继续');
      const record = { id: randomUUID(), job:job.id, session:job.session||null, stage, model:job.model||null, input, output, cost: budgetCost, status: 'reserved', at: Date.now(), rates };
      this.db.prepare('INSERT INTO usage(id,day,job,stage,data,session_id) VALUES(?,?,?,?,?,?)').run(record.id, date, job.id, stage, JSON.stringify(record),job.session||null); return record;
    });
  }
  settle(reservation, usage) {
    const stored=decode(this.db.prepare('SELECT data FROM usage WHERE id=?').get(reservation.id));
    if(!stored||stored.status!=='reserved')return;
    reservation=stored;
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
    const clean={...row.observed};for(const key of ['estimatedOutput','estimatedReasoning'])if(Number.isSafeInteger(observed[key])&&observed[key]>=0)clean[key]=observed[key];
    if(observed.usage&&['input','output','reasoning','cacheHit'].every(k=>Number.isSafeInteger(observed.usage[k])&&observed.usage[k]>=0)
      &&observed.usage.cacheHit<=observed.usage.input&&observed.usage.reasoning<=observed.usage.output)clean.usage=Object.fromEntries(['input','output','reasoning','cacheHit'].map(k=>[k,observed.usage[k]]));
    this.db.prepare('UPDATE usage SET data=? WHERE id=?').run(JSON.stringify({...row,observed:clean,updatedAt:Date.now()}),row.id);
  }
  finishRequest(reservation,state) {const row=decode(this.db.prepare('SELECT data FROM usage WHERE id=?').get(reservation.id));if(row&&!row.requestState)this.db.prepare('UPDATE usage SET data=? WHERE id=?').run(JSON.stringify({...row,requestState:state,terminalAt:Date.now()}),row.id);}
  reconcileUsage() {
    const report={settled:0,unknown:0,recoveredRequests:0};
    this.tx(()=>{for(const r of this.db.prepare("SELECT data FROM usage WHERE json_extract(data,'$.status')='reserved'").all()) {
      const row=decode(r),job=this.job(row.job);
      // Do not touch another live request. Terminal jobs or expired dead owners are recoverable.
      let ended=!!row.requestState;
      if(!ended&&job){let alive=true;try{process.kill(job.ownerPid,0);}catch{alive=false;}ended=!alive&&(['COMPLETED','RETRYABLE','CANCELLED','BLOCKED','ERROR','PAUSED'].includes(job.status)||job.deadline<=Date.now());}
      if(!ended)continue;
      if(!row.requestState){this.finishRequest(row,'INTERRUPTED');report.recoveredRequests++;}
      const u=row.observed?.usage;
      if(u&&['input','output','reasoning','cacheHit'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)&&u.reasoning<=u.output&&u.cacheHit<=u.input){
        try{this.settle(row,u);}catch(e){if(decode(this.db.prepare('SELECT data FROM usage WHERE id=?').get(row.id)).status!=='overrun')throw e;}report.settled++;
      }else report.unknown++;
    }});return report;
  }
  usage(job=null,session=null) {
    const where=job?'job=?':session?'session_id=?':'day=?',arg=job||session||day(Date.now()),get=p=>`json_extract(data,'$.${p}')`,reserved=`${get('status')}='reserved'`;
    const sum=e=>`coalesce(sum(${e}),0)`;
    const fields={calls:'count(*)',tasks:sum("stage='select'"),input:sum(get('input')),output:sum(get('output')),costUpperBound:sum(get('cost')),reserved:sum(reserved),measuredCalls:sum(`NOT (${reserved})`),unknownCalls:sum(`(${reserved}) AND ${get('observed.usage.input')} IS NULL`),estimatedOutput:sum(`CASE WHEN ${reserved} THEN ${get('observed.estimatedOutput')} ELSE 0 END`),estimatedReasoning:sum(`CASE WHEN ${reserved} THEN ${get('observed.estimatedReasoning')} ELSE 0 END`),updatedAt:`coalesce(max(coalesce(${get('updatedAt')},${get('at')})),0)`};
    for(const k of ['input','output','reasoning','cacheHit'])fields['c_'+k]=sum(`CASE WHEN ${reserved} THEN ${get('observed.usage.'+k)} ELSE ${get(k)} END`);
    for(const k of ['input','output'])fields['p_'+k]=sum(`CASE WHEN ${reserved} THEN ${get(k)} ELSE 0 END`);
    const r=this.db.prepare('SELECT '+Object.entries(fields).map(([k,e])=>e+' AS '+k).join(',')+' FROM usage WHERE '+where).get(arg);
    const confirmed=Object.fromEntries(['input','output','reasoning','cacheHit'].map(k=>[k,r['c_'+k]])),pending={input:r.p_input,output:r.p_output};for(const k of Object.keys(r))if(/^[cp]_/.test(k))delete r[k];return {...r,reasoning:confirmed.reasoning,cacheHit:confirmed.cacheHit,confirmed,pending};
  }
  request() {const r=decode(this.db.prepare('SELECT data FROM usage ORDER BY rowid DESC LIMIT 1').get());return r?{...r,elapsedMs:Math.max(0,(r.terminalAt||r.updatedAt&&r.status!=='reserved'&&r.updatedAt||Date.now())-r.at),complete:r.status!=='reserved'||!!r.requestState,actual:r.status==='reserved'?r.observed?.usage||null:{input:r.input,output:r.output,reasoning:r.reasoning,cacheHit:r.cacheHit}}:null;}
  publish(job, source, items, candidates, guard, {finalize=true,append=false,filteredDuplicates=job.candidateStats?.duplicates||0}={}) {
    const committed=this.tx(() => {
      const current = this.source(source.id);
      if (!guard() || job.generation !== this.generation() || current?.revision !== source.revision || !sourceAllowed(current)) throw Error('学习代际或来源许可已变化，禁止旧结果发布');
      let added=0,updated=0,evidenceAdded=0,duplicates=filteredDuplicates;const publication={},publicationDetails={};
      for (const c of candidates) {
        if(c.reviewEligible!==undefined&&!c.verifiedAt)throw Error('社区候选尚未完成证据复核，禁止发布');
        const originalKey=hash(JSON.stringify([c.kind,c.term.normalize('NFKC').toLowerCase(),c.meaning.normalize('NFKC')]));
        const equivalent=this.conflicts(c.term).published.find(k=>k.kind===c.kind&&senseKey(k.meaning)===senseKey(c.meaning));
        const key=c.mergeInto||equivalent?.id||originalKey;
        const row=this.db.prepare('SELECT * FROM knowledge WHERE id=?').get(key),old=decode(row);
        if(c.mergeInto&&(!old||old.kind!==c.kind||conceptKey(old.term)!==conceptKey(c.term)))throw Error('社区同义知识合并目标无效');
        if (row?.status === 'revoked') continue;
        const refs=this.evidenceRefs(c,source,items);if(!refs.length)throw Error('社区候选证据来源失效');
        const fresh=refs.filter(r=>!this.db.prepare('SELECT 1 FROM evidence WHERE knowledge=? AND source=? AND document=? AND quote=?').get(key,r.source,r.document,r.quote));
        const {evidence:quotedEvidence,...content}=this.reviewPayload(c);
        const next={...content,...(old?{term:old.term,meaning:old.meaning}:{}),contextTerms:[...new Set([...(old?.contextTerms||[]),...c.contextTerms])].slice(0,10),id:key,version:(row?.version||0)+1,at:old?.at||Date.now(),updatedAt:Date.now()};
        const metadataChanged=old&&['usage','contextTerms','confidence','validUntil','timeSensitive'].some(k=>JSON.stringify(old[k])!==JSON.stringify(next[k]));
        const duplicate=old&&!fresh.length&&!metadataChanged;
        this.db.prepare('INSERT OR REPLACE INTO candidates(id,job,status,data,term_key) VALUES(?,?,?,?,?)').run(c.key||this.candidateKey(c),job.id,'published',JSON.stringify({...c,finalStatus:'published',knowledgeId:key}),conceptKey(c.term));
        for(const id of c.pendingIds||[])this.db.prepare("UPDATE candidates SET status='published',data=json_set(data,'$.knowledgeId',?,'$.finalStatus','published') WHERE id=? AND status IN ('pending','merged')").run(key,id);
        const ids=[...new Set(refs.map(r=>r.document))];
        for(const id of ids){publicationDetails[id]??={added:0,updated:0,evidenceAdded:0,duplicates:0};publicationDetails[id][duplicate?'duplicates':old?'updated':'added']++;publicationDetails[id].evidenceAdded+=fresh.filter(r=>r.document===id).length;}
        if(duplicate){duplicates++;continue;}
        this.db.prepare('INSERT INTO knowledge(id,kind,term,status,version,at,data,term_key) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data')
          .run(key,c.kind,next.term,'published',next.version,next.at,JSON.stringify(next),conceptKey(next.term));
        for (const r of fresh) {
          this.db.prepare('INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?,?)').run(key,r.source,r.document,hash(r.fingerprint+':'+r.quote),r.quote,r.url,Date.now());
        }
        this.db.prepare('INSERT INTO revisions(knowledge,at,action,data) VALUES(?,?,?,?)').run(key, Date.now(), old ? 'reinforce' : 'publish', JSON.stringify(old || next));
        this.db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(key);
        this.db.prepare('INSERT INTO knowledge_fts VALUES(?,?)').run(key, searchTerms([next.term,...termAliases(next.term),next.meaning,next.usage,...next.contextTerms].join(' ')).join(' '));
        if(!old)added++;else updated++;evidenceAdded+=fresh.length;for(const id of ids)publication[id]=(publication[id]||0)+1;
      }
      this.hold(job,job.pending||[]);for(const c of (job.pending||[]).filter(c=>!c.finalStatus))this.goal(c.term,source.id,'候选缺少充分证据');for(const c of candidates.filter(c=>c.kind==='slang'||c.conflict))this.goal(c.term,source.id,'寻找其他语境与跨材料证据');
      for (const item of items) {
        if(item.complete!==false)this.db.prepare('INSERT OR IGNORE INTO documents VALUES(?,?,?,?)').run(source.id,item.id,item.fingerprint,Date.now());
        const row=this.material(source.id,item.id,item.fingerprint);if(row)this.checkpoint(row,item.complete===false?'QUEUED':'COMPLETED',{offset:item.nextOffset??row.offset,readCursor:Object.hasOwn(item,'readCursor')?item.readCursor:row.readCursor,segments:[...new Set([...(row.segments||[]),hash((item.contentType||'body')+':'+item.text)])].slice(-500),reading:undefined,extracted:undefined,approved:undefined,prepared:undefined,validation:undefined,failures:0,error:undefined,finished:item.complete!==false,completedAt:item.complete===false?null:Date.now()});
      }
      const totals={added,updated,evidenceAdded,duplicates};
      if(append){for(const k of Object.keys(totals))totals[k]+=job[k]||0;for(const [id,n] of Object.entries(job.publication||{}))publication[id]=(publication[id]||0)+n;for(const [id,counts] of Object.entries(job.publicationDetails||{})){publicationDetails[id]??={added:0,updated:0,evidenceAdded:0,duplicates:0};for(const [k,n] of Object.entries(counts))publicationDetails[id][k]+=n;}}
      const nextJob={...job,...totals,publication,publicationDetails,status:finalize?'COMPLETED':'PUBLISHING',finished:finalize,progress:finalize?100:90,version:job.version+1,completedAt:finalize?Date.now():undefined};
      this.saveJob(nextJob);return {added,nextJob};
    });
    Object.assign(job,committed.nextJob);return committed.added;
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
  list({offset=0,limit=100}={}) { return this.db.prepare('SELECT * FROM knowledge ORDER BY at DESC,id LIMIT ? OFFSET ?').all(limit,offset).map(r => ({ ...decode(r), status: r.status, version: r.version,sources:this.db.prepare('SELECT DISTINCT url FROM evidence WHERE knowledge=? LIMIT 4').all(r.id).map(e=>e.url) })); }
  communityStrategies(cutoff=0) {const out=[];for(const r of this.db.prepare("SELECT * FROM knowledge WHERE kind='strategy' AND status='published'").all()){const k=decode(r),e=this.db.prepare('SELECT DISTINCT source,document,at FROM evidence WHERE knowledge=?').all(r.id).filter(e=>e.at>cutoff&&knowledgeAllowed(this.source(e.source)));if(new Set(e.map(x=>x.source+':'+x.document)).size>=3&&new Set(e.map(x=>day(x.at))).size>=2)out.push(k.strategy);}return [...new Set(out)];}
  search(query, { limit = 3, maxChars = 1800, kinds, mode='explain', recent='', scene='' } = {}) {
    this.expireSources();
    if(mode==='expression'&&!expressionScene(query,scene).allowed)return [];
    const terms = [...new Set([...searchTerms(query),...retrievalWords(query).flatMap(searchTerms)])].slice(0,100); if (!terms.length) return [];
    const matches = this.db.prepare('SELECT id,bm25(knowledge_fts) AS rank FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT 40').all(terms.map(t => '"' + t.replaceAll('"','""') + '"').join(' OR '));
    const sources = new Map(this.sources().filter(s=>knowledgeAllowed(s)).map(s=>[s.id,s])), out=[]; let chars=0;
    for (const m of matches) {
      const row = this.db.prepare("SELECT * FROM knowledge WHERE id=? AND status='published'").get(m.id); if (!row || kinds && !kinds.includes(row.kind)) continue;
      const k = decode(row), evidence = this.db.prepare('SELECT source,url,at FROM evidence WHERE knowledge=?').all(row.id).filter(e=>sources.has(e.source));
      if (!evidence.length) continue;
      if(k.validUntil&&k.validUntil<=Date.now())continue;
      const match=relevance({...k,evidenceCount:evidence.length},query,{mode,recent});if(!match)continue;
      out.push({id:k.id,kind:k.kind,term:k.term,meaning:k.meaning,usage:k.usage,contextTerms:k.contextTerms,confidence:k.confidence,conflict:k.conflict,version:row.version,sources:[...new Set(evidence.map(e=>e.url))].slice(0,2),rank:m.rank,...match,origin:'community'});
    }
    const best=new Map();for(const r of out)best.set(conceptKey(r.term),Math.max(best.get(conceptKey(r.term))||0,r.contextScore));
    const seen=new Set();return out.filter(r=>!best.get(conceptKey(r.term))||r.contextScore===best.get(conceptKey(r.term))).sort((a,b)=>b.score-a.score||a.rank-b.rank).filter(r=>{const key=conceptKey(r.term);if(seen.has(key))return false;const size=JSON.stringify(r).length;if(chars+size>maxChars)return false;seen.add(key);chars+=size;return true;}).slice(0,Math.min(limit,mode==='expression'?2:3));
  }
}
