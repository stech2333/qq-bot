// Legacy QQ interfaces project into CommunityStore; no second formal lexicon is saved.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeSlangEntry } from '../../integrations/qq-bridge/src/slang-learner.js';
import { safeGeneralText, senseId } from './slang-schema.mjs';
import { conceptKey, senseKey, termAliases } from './community-retrieval.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const decode=r=>r?JSON.parse(r.data):null;
const MARKER='migration:qq-slang-v1';
const groupScope=x=>/^group:[1-9]\d{4,15}$/.test(x||'');
export const safeScopedText=text=>!/(?:我叫|他叫|她叫|家住|住在|现实姓名|私人关系|联系方式)/.test(String(text||''))&&safeGeneralText(String(text||'').replace(/本群|群里|群友|内部约定/g,''));
export const knowledgeScope=k=>groupScope(k.scope)?k.scope:k.scope==='public'||!k.scope?'public':'unresolved';
export const scopeAllows=(k,key)=>knowledgeScope(k)==='public'||knowledgeScope(k)===key;
const indexText=k=>[k.term,...(k.aliases||[]),...termAliases(k.term),k.meaning,k.usage,...(k.contextTerms||[])].join(' ').normalize('NFKC').toLowerCase();
function index(store,k){const text=indexText(k),tokens=[...new Set([...(text.match(/[a-z0-9]+/g)||[]),...(text.match(/[\u4e00-\u9fff]+/g)||[]).flatMap(s=>Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)))])];store.db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(k.id);store.db.prepare('INSERT INTO knowledge_fts VALUES(?,?)').run(k.id,tokens.join(' '));}
const entryRow=(store,id)=>decode(store.db.prepare("SELECT data FROM candidates WHERE id=? AND job='qq-slang'").get('qq-word:'+id));

export function qqEntries(store) {
  return store.db.prepare("SELECT data FROM candidates WHERE job='qq-slang' AND status!='revoked' ORDER BY rowid").all().map(decode).map(record=>{
    const entry=structuredClone(record.entry),senses=[...(entry.senses||[])];
    for(const ref of record.knowledge||[]){const row=store.db.prepare("SELECT * FROM knowledge WHERE id=? AND status='published'").get(ref.id);if(!row)continue;const k=decode(row);
      const evidence=store.db.prepare('SELECT e.* FROM evidence e JOIN sources s ON s.id=e.source WHERE e.knowledge=?').all(k.id).filter(e=>e.source===ref.source&&store.evidenceLive(e));
      if(!evidence.length)continue;
      senses.push({id:ref.senseId||senseId(k.meaning),meaning:k.meaning,usage:k.usage,contextTerms:k.contextTerms||[],status:'confirmed',verified:true,
        generalizable:knowledgeScope(k)==='public',manual:ref.manual===true,verifiedAt:ref.verifiedAt||k.at,publicSources:ref.publicSources||[],confidence:k.confidence,
        evidence:evidence.filter(e=>e.fingerprint.startsWith('qq:')).map(e=>({key:store.source(e.source).key,id:e.document,time:e.at})),revision:row.version,knowledgeId:k.id});
    }
    const byId=new Map();for(const s of senses){const previous=byId.get(s.id);byId.set(s.id,previous?.status==='confirmed'&&s.status==='confirmed'?{...s,evidence:[...new Map([...previous.evidence,...s.evidence].map(r=>[r.key+':'+r.id,r])).values()]}:s);}
    entry.senses=[...byId.values()];const active=entry.senses.find(s=>s.status==='confirmed');
    if(active){entry.status='confirmed';entry.meaning=active.meaning;entry.usage=active.usage;}
    else if(entry.status==='confirmed')entry.status='candidate';
    return entry;
  });
}

export function syncQQEntries(store,incoming,{validRef=()=>false,allowedGroup=()=>false}={}) {
  const result={added:0,merged:0,pending:0,revoked:0};
  store.tx(()=>{
    const ids=new Set(incoming.map(e=>e.id));
    for(const row of store.db.prepare("SELECT * FROM candidates WHERE job='qq-slang' AND status!='revoked'").all()){
      const old=decode(row);if(ids.has(old.entry.id))continue;
      detach(store,old);store.db.prepare("UPDATE candidates SET status='revoked',data=? WHERE id=?").run(JSON.stringify({...old,deleted:true}),row.id);result.revoked++;
    }
    for(const original of incoming){
      const entry=normalizeSlangEntry(original);if(groupScope(original.scope))entry.scope=original.scope;
      entry.id=original.id||entry.id;entry.evidence=(original.evidence||[]).map(e=>({key:e.key,messageId:String(e.messageId||e.id||''),time:e.time})).slice(-48);
      const old=entryRow(store,entry.id);
      if(old?.deleted&&!original.restore)continue;
      const refs=[],pending=[];
      for(const sense of entry.senses||[]){
        const publicSense=sense.generalizable===true,scope=publicSense?'public':groupScope(entry.scope)?entry.scope:'unresolved';
        const safe=scope==='public'?safeGeneralText:safeScopedText;
        const evidence=(sense.evidence||[]).filter(r=>groupScope(r.key)&&validRef(r));
        const manual=sense.manual===true&&sense.verified===true;
        const valid=entry.status==='confirmed'&&sense.status==='confirmed'&&sense.verified===true&&scope!=='unresolved'&&safe(entry.content)&&safe(sense.meaning)&&safe(sense.usage||'')
          &&(scope==='public'?publicSense:allowedGroup(scope))&&(manual||evidence.length>=3&&evidence.length===(sense.evidence||[]).length);
        if(!valid){pending.push({...sense,status:['rejected','revoked'].includes(sense.status)?sense.status:'candidate'});continue;}
        // Exact meaning equivalence only; neither scope nor a revoked decision can be broadened.
        const existing=store.db.prepare("SELECT * FROM knowledge WHERE term_key=?").all(conceptKey(entry.content)).find(r=>{const k=decode(r);return senseKey(k.meaning)===senseKey(sense.meaning)&&knowledgeScope(k)===scope;});
        if(existing?.status==='revoked'){pending.push({...sense,status:'revoked'});continue;}
        const id=existing?.id||digest(JSON.stringify(['slang',conceptKey(entry.content),senseKey(sense.meaning),scope]));
        let k=existing?decode(existing):{id,kind:'slang',term:entry.content,meaning:sense.meaning,usage:sense.usage||'',contextTerms:sense.contextTerms||[],aliases:entry.aliases||[],confidence:sense.confidence??.95,conflict:false,scope,sourceType:'qq',at:Date.now(),version:1};
        if(!existing){store.db.prepare('INSERT INTO knowledge VALUES(?,?,?,?,?,?,?,?)').run(id,'slang',k.term,'published',1,k.at,JSON.stringify(k),conceptKey(k.term));index(store,k);result.added++;}
        else if(!(old?.knowledge||[]).some(r=>r.id===id&&r.senseId===sense.id))result.merged++;
        const observations=manual?[{key:scope,id:'admin:'+entry.id+':'+sense.id,time:sense.verifiedAt||Date.parse(entry.createdAt)||k.at}]:evidence;
        for(const group of new Set(observations.map(r=>r.key))){
          const source='qq_'+digest([manual?'admin':'message',group,entry.id,sense.id].join(':')).slice(0,24);
          const sourceData={id:source,platform:'qq',sourceType:'qq',enabled:true,allowUse:true,scope,key:group,manual,revision:1};
          store.db.prepare('INSERT OR IGNORE INTO sources(id,revision,cursor,data) VALUES(?,1,0,?)').run(source,JSON.stringify(sourceData));
          for(const r of observations.filter(r=>r.key===group))store.db.prepare('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?)').run(id,source,r.id,manual?'admin:'+sense.id:'qq:'+r.time,'','',r.time);
          refs.push({id,source,senseId:sense.id,manual,verifiedAt:sense.verifiedAt||k.at,publicSources:sense.publicSources||[]});
        }
      }
      const kept=new Set(refs.map(r=>r.id+':'+r.source));
      if(old)detach(store,{...old,knowledge:(old.knowledge||[]).filter(r=>!kept.has(r.id+':'+r.source))});
      // Formal text lives in knowledge only; candidates retain unapproved senses and provenance metadata.
      const stored={...entry,senses:pending,meaning:refs.length?'':entry.meaning,usage:refs.length?'':entry.usage};
      const record={recordType:'qq-slang',entry:stored,knowledge:refs,deleted:false};
      const status=pending.some(s=>s.status==='candidate')||!refs.length&&entry.status==='candidate'?'pending':entry.status==='rejected'?'rejected':'published';
      store.db.prepare('INSERT INTO candidates VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run('qq-word:'+entry.id,'qq-slang',status,JSON.stringify(record),conceptKey(entry.content));
      if(status==='pending')result.pending++;
    }
  });
  store.expressionIndex=null;return result;
}
function detach(store,record) {
  for(const r of record.knowledge||[]){store.db.prepare('DELETE FROM evidence WHERE knowledge=? AND source=?').run(r.id,r.source);
    if(!store.db.prepare('SELECT 1 FROM evidence WHERE knowledge=?').get(r.id)){store.db.prepare("UPDATE knowledge SET status='revoked',version=version+1 WHERE id=? AND status='published'").run(r.id);store.db.prepare('DELETE FROM knowledge_fts WHERE id=?').run(r.id);}}
}

export function migrateQQSlang(store,options={}) {
  const marker=decode(store.db.prepare('SELECT data FROM candidates WHERE id=?').get(MARKER));if(marker)return {...marker,repeated:true};
  const state=path.join(store.root,'state');if(fs.existsSync(path.join(state,'knowledge-migration-paused.json')))throw Error('统一词库迁移已回滚，需管理员重新执行迁移');
  const file=path.join(state,'slang.json');const raw=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):[];if(!Array.isArray(raw))throw Error('旧词库格式无效，未迁移');
  const deletedFile=file+'.deleted.json',deleted=fs.existsSync(deletedFile)?JSON.parse(fs.readFileSync(deletedFile,'utf8')):{};
  const backup=path.join(state,'knowledge-backups','qq-slang-'+Date.now()+'-'+randomUUID());fs.mkdirSync(backup,{recursive:true});
  const files=['slang.json','slang.json.deleted.json','bigfatfish-slang-audit.json','slang-research-jobs.json'];
  for(const name of files)if(fs.existsSync(path.join(state,name)))fs.copyFileSync(path.join(state,name),path.join(backup,name),fs.constants.COPYFILE_EXCL);
  store.db.prepare('VACUUM INTO ?').run(path.join(backup,'community.sqlite'));
  const entries=raw.filter(e=>!deleted[e.id]).map(normalizeSlangEntry).filter(e=>!deleted[e.id]);let stats;
  store.tx(()=>{stats=syncQQEntriesInTransaction(store,entries,options);
    for(const [id,value]of Object.entries(deleted))store.db.prepare('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?)').run('qq-word:'+id,'qq-slang','revoked',JSON.stringify({recordType:'qq-slang',entry:{...(value.entry||{}),id},knowledge:[],deleted:true}),conceptKey(value.entry?.content||''));
    const result={version:1,at:Date.now(),backup,legacyEntries:raw.length,deletedEntries:Object.keys(deleted).length,...stats};
    store.db.prepare('INSERT INTO candidates VALUES(?,?,?,?,?)').run(MARKER,'migration','completed',JSON.stringify(result),'');
  });
  const result=decode(store.db.prepare('SELECT data FROM candidates WHERE id=?').get(MARKER));
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({...result,files},null,2));return result;
}
// CommunityStore.tx is not nested: let the migration own the outer atomic transaction.
function syncQQEntriesInTransaction(store,entries,options){const tx=store.tx;store.tx=fn=>fn();try{return syncQQEntries(store,entries,options);}finally{store.tx=tx;}}

export class UnifiedSlang {
  constructor(app){this.app=app;this.cache=null;}
  db(){const db=this.app.community.open();db.qqAccess={allowed:key=>this.app.globalStyle.allowed(key),retained:r=>this.app.slang.sourceRetained(r)};return db;}
  options(){return {validRef:r=>this.app.slang.sourceRetained(r),allowedGroup:key=>this.app.learningSources.allowed(key)};}
  initialize(){const db=this.db();this.migration=migrateQQSlang(db,this.options());this.cache=qqEntries(db);return this.cache;}
  entries(){return this.cache??this.initialize();}
  save(entries=this.entries()){const db=this.db();syncQQEntries(db,entries,this.options());const fresh=qqEntries(db);entries.splice(0,entries.length,...fresh);this.cache=entries;return true;}
  deleted(id){return entryRow(this.db(),id)?.deleted===true||this.db().db.prepare("SELECT 1 FROM candidates WHERE id=? AND status='revoked'").get('qq-word:'+id)!=null;}
  restore(id){const db=this.db(),record=entryRow(db,id);if(!record)throw Error('没有可恢复的词条');const entry={...record.entry,restore:true,status:'candidate',senses:(record.entry.senses||[]).map(s=>({...s,status:'candidate',verified:false,manual:false}))};db.db.prepare("UPDATE candidates SET status='pending',data=? WHERE id=?").run(JSON.stringify({...record,deleted:false,knowledge:[],entry}),'qq-word:'+id);this.cache=qqEntries(db);return this.cache;}
}
