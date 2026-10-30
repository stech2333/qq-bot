import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fixture, candidate } from './community-test-fixture.mjs';
import { fixture as styleFixture, A, B } from './style-test-fixture.mjs';
import { createSlangEntry } from '../../integrations/qq-bridge/src/slang-learner.js';
import { GlobalStyle } from './global-style.mjs';
import { expressionConceptKey, expressionTags, relevance } from './community-retrieval.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

function word(app,term='摸鱼',scope='public',meaning='工作间隙暂时偷闲'){
  const e=createSlangEntry({content:term,scope,meaning,usage:'在工作疲惫的轻松闲聊中自嘲或调侃，严肃求助不使用',source:'manual',status:'candidate'});
  return app.slang.approveManual(e,{scope});
}
function seed(f,entries){const file=path.join(f.root,'state/slang.json');fs.writeFileSync(file,JSON.stringify(entries));const raw=fs.readFileSync(file,'utf8');const rows=f.app.slang.connectUnified();return {rows,file,raw,db:f.app.community.store};}
function preview(app,key,query,history=[]){const st={bigfatfish:app.states.get(key)?.bigfatfish,recentMessages:history.map(plain=>({plain,isSelf:false})),unread:[{plain:query,isSelf:false}],activeTopics:[],pendingThoughts:[]};app.bind(key,st);const turn=app.delivery.begin(key,st),prompt=app.instruction(key,st,{turnId:turn});return {st,turn,prompt,d:app.styleResolver.diagnostics.get(key)};}

test('migration backs up SQLite, legacy data and audits; only verified senses become formal',t=>{
  const f=fixture(t),confirmed=word(f.app),pending=createSlangEntry({content:'待审核',meaning:'未经核验的词义',status:'candidate'});
  fs.writeFileSync(path.join(f.root,'state/bigfatfish-slang-audit.json'),'[]');
  const {db,file,raw}=seed(f,[confirmed,pending]),m=f.app.slang.unified.migration;
  assert.equal(m.added,1);assert.equal(m.pending,1);assert.equal(db.applicationState().publishedCount,1);
  assert.equal(db.list({status:'pending'})[0].term,'待审核');
  for(const name of ['slang.json','community.sqlite','bigfatfish-slang-audit.json','manifest.json'])assert.ok(fs.existsSync(path.join(m.backup,name)));
  f.app.slang.unified.entries()[0].count++;f.app.slang.unified.save();assert.equal(fs.readFileSync(file,'utf8'),raw);
  const k=db.list({status:'published'})[0],record=JSON.parse(db.db.prepare("SELECT data FROM candidates WHERE job='qq-slang' AND status='published'").get().data);
  assert.equal(record.entry.senses.length,0);assert.equal(record.entry.meaning,'');assert.equal(record.knowledge[0].id,k.id);
});
test('repeat migration and saves preserve knowledge version and evidence; deleted candidates stay deleted',t=>{
  const f=fixture(t);seed(f,[word(f.app)]);const db=f.app.community.store,k=db.list()[0],before=db.db.prepare('SELECT count(*) n FROM evidence').get().n;
  f.app.slang.unified.initialize();f.app.slang.unified.save();assert.equal(f.app.slang.unified.migration.repeated,true);
  assert.equal(db.list()[0].version,k.version);assert.equal(db.db.prepare('SELECT count(*) n FROM evidence').get().n,before);
  f.app.slang.unified.save([]);assert.equal(db.list({status:'published'}).length,0);
  f.app.slang.unified.save([word(f.app)]);assert.equal(db.list({status:'published'}).length,0);
});
test('rollback restores the consistent database snapshot and pauses automatic remigration',t=>{
  const f=fixture(t);const {file,raw,db}=seed(f,[word(f.app)]),backup=f.app.slang.unified.migration.backup;
  db.close();f.app.community.store=null;
  execFileSync(process.execPath,['scripts/migrate-unified-knowledge.mjs','--root='+f.root,'--rollback='+backup],{windowsHide:true});
  const restored=new DatabaseSync(path.join(f.root,'state/community.sqlite'),{readOnly:true});
  try{assert.equal(restored.prepare('SELECT count(*) n FROM knowledge').get().n,0);}finally{restored.close();}
  assert.equal(fs.readFileSync(file,'utf8'),raw);assert.equal(fs.existsSync(path.join(f.root,'state/knowledge-migration-paused.json')),true);
  assert.throws(()=>f.app.slang.unified.initialize(),/回滚/);
});
test('exact existing external sense is merged with QQ provenance instead of double publication',async t=>{
  const f=fixture(t);f.setup();await f.run();const db=f.app.community.store,k=db.list()[0],e=word(f.app,'摸鱼','public',k.meaning);
  seed(f,[e]);assert.equal(db.applicationState().publishedCount,1);assert.equal(f.app.slang.unified.migration.merged,1);
  assert.equal(db.list()[0].version,k.version);assert.ok(db.db.prepare('SELECT count(*) n FROM evidence WHERE knowledge=?').get(k.id).n>=2);
  f.app.slang.unified.save([]);assert.equal(db.list({status:'published'}).length,1);assert.equal(db.search('摸鱼是什么意思')[0].id,k.id);
});
test('group-limited senses, same spelling and QQ query interfaces never cross conversation scope',t=>{
  const f=fixture(t);const a=word(f.app,'开摆',A,'本群开黑时暂时休息'),b=word(f.app,'开摆',B,'本群游戏里切换休闲玩法');
  seed(f,[a,b]);const db=f.app.community.store;assert.equal(db.applicationState(Date.now(),A).groupLimitedCount,2);
  assert.equal(db.search('开摆是什么意思',{key:A})[0].meaning,a.meaning);
  assert.equal(db.search('开摆是什么意思',{key:B})[0].meaning,b.meaning);
  assert.equal(db.search('开摆是什么意思',{key:'private:333333'}).length,0);
  assert.equal(f.app.slang.contextEntries([],A,'','开摆是什么意思')[0].content,'开摆');
  assert.equal(db.applicationState(Date.now(),A).sessionUsableCount,1);
});
test('manual group confirmation rejects private facts and unsupported source scopes',t=>{
  const f=fixture(t),e=createSlangEntry({content:'群内用词',status:'candidate'});
  assert.throws(()=>f.app.slang.approveManual(e,{scope:A,meaning:'他叫李四，家住秘密地址'}));
  assert.throws(()=>f.app.slang.approveManual(e,{scope:'group:999999',meaning:'游戏时休息'}));
});
test('QQ message provenance contains references only and loses applicability below required support',t=>{
  const f=fixture(t),st=f.state(A),now=Date.now();st.recentMessages=Array.from({length:3},(_,i)=>({messageId:String(100+i),userId:'111111',time:now-10000-i,plain:'摸鱼是工作间隙休息',isSelf:false,styleSourceVersion:2,sourceScope:A}));
  const e=word(f.app);e.senses[0].manual=false;e.senses[0].evidence=st.recentMessages.map(m=>({key:A,id:m.messageId,time:m.time}));
  seed(f,[e]);const db=f.app.community.store;assert.equal(db.search('摸鱼是什么意思',{key:B}).length,1);
  const evidence=db.db.prepare('SELECT * FROM evidence').all();assert.ok(evidence.every(e=>e.quote===''&&e.url===''&&e.fingerprint.startsWith('qq:')));
  assert.ok(db.sources().every(s=>s.sourceType==='qq'&&!s.license));
  f.app.learningWindow.forget(A,'100');assert.equal(db.search('摸鱼是什么意思',{key:B}).length,0);
});
test('fresh QQ candidates and administrator publication use one SQLite store with no JSON dual write',t=>{
  const f=fixture(t);const {file,raw}=seed(f,[]),entries=f.app.slang.unified.entries();
  entries.push(createSlangEntry({content:'开摆',scope:A,status:'candidate'}));f.app.slang.unified.save(entries);
  assert.equal(f.app.community.store.list({status:'pending',platform:'qq'}).length,1);
  const e=entries[0];f.app.slang.approveManual(e,{scope:A,meaning:'本群游戏时暂时休息',usage:'游戏疲惫时轻松调侃'});f.app.slang.unified.save(entries);
  assert.equal(f.app.community.store.list({status:'published',platform:'qq'}).length,1);assert.equal(fs.readFileSync(file,'utf8'),raw);
  const k=f.app.community.store.list()[0];f.app.community.store.revoke(k.id);assert.equal(f.app.community.retrieve('开摆是什么意思',{key:A}).length,0);
});
test('scene opportunity uses verified usage without literal term, stays independent of global v0 and honors cooldown',t=>{
  const f=fixture(t);seed(f,[word(f.app)]);
  const p=preview(f.app,A,'今天上班又加班，工作任务压得我好累，哈哈');
  assert.equal(f.app.globalStyle.state.version,0);assert.equal(p.d.contextualKnowledgeSelectedCount,1);assert.match(p.prompt,/"term":"摸鱼"/);
  f.app.styleResolver.auditPrompt(p.turn,p.prompt);f.app.styleResolver.injected(p.turn);
  assert.equal(preview(f.app,A,'今天上班又加班，工作任务压得我好累，哈哈').d.contextualKnowledgeSelectedCount,0);
  assert.equal(preview(f.app,B,'今天上班又加班，工作任务压得我好累，哈哈').d.contextualKnowledgeSelectedCount,1);
  assert.ok(p.st.bigfatfish.expressionUse.recent.some(r=>r.id===expressionConceptKey({term:'摸鱼'})));
  assert.equal(f.app.community.store.expressionIndex.postings instanceof Map,true);
});
test('normal chatter does not inject dictionary definitions; serious, no-memes and closing suppress expressions',t=>{
  const f=fixture(t);seed(f,[word(f.app)]);
  const p=preview(f.app,A,'上班摸鱼真舒服哈哈');assert.equal(p.st.bffKnowledgeSelections.length,0);assert.match(p.prompt,/日常接话不要自动解释词义/);
  for(const q of ['请准确解释SQL报错','今天加班好累，但别玩梗，认真回答','晚安，不聊了'])assert.equal(preview(f.app,A,q).d.contextualKnowledgeSelectedCount,0);
  const explicit=preview(f.app,A,'摸鱼是什么意思？');assert.equal(explicit.st.bffKnowledgeSelections[0].term,'摸鱼');
});
test('scene tags cannot learn positive applicability from forbidden context clauses',()=>{
  assert.ok(!expressionTags(candidate({meaning:'娱乐时的口语称呼',usage:'适合轻松娱乐；禁用于游戏、工作和学习',contextTerms:[]})).includes('game'));
});
test('video attribution alone is insufficient relevance; an actual political discussion can match its expression',()=>{
  const political=candidate({term:'鉴证',meaning:'指网络上的政治与意识形态讨论，视频评论区中常见',usage:'用于调侃网络政治讨论'});
  assert.equal(relevance(political,'复习视频没听懂，笑死',{mode:'expression'}),null);
  assert.ok(relevance(political,'网友又在评论区争论政治和意识形态，笑死',{mode:'expression'}));
});
test('style progress identifies real quota blockers without pretending an unstarted study failed',t=>{
  const f=styleFixture(t);f.enough();f.app.research.ledger=Array.from({length:f.app.settings.learningResearch.maxPerDay},()=>({kind:'topic',at:Date.now()}));
  const p=f.app.globalStyle.view().progress;assert.equal(p.sample.messages>=20,true);assert.ok(p.blockers.some(b=>b.code==='RESEARCH_DAILY_QUOTA'));
  assert.equal(p.research.status,'not_started');assert.equal(p.research.failureCount,0);assert.ok(p.research.nextAt>Date.now());assert.equal(f.app.globalStyle.state.version,0);
});
test('style candidate identity survives condition ordering and restart; independent evidence accumulates to normal publication',async t=>{
  const f=styleFixture(t);let order=false;
  const runner=job=>{const r=f.output(job);r.expressions[0].when=order?['general','light']:['light','general'];order=!order;return r;};
  for(let i=0;i<24;i++)f.feed(A,i);await f.learn(runner);const first=f.app.globalStyle.state.candidates[0];assert.equal(first.observations,1);
  f.app.globalStyle=new GlobalStyle(f.app);assert.equal(f.app.globalStyle.state.candidates[0].observations,1);
  for(let round=1;round<3;round++){for(let i=round*24;i<(round+1)*24;i++)f.feed(A,i);await f.learn(runner);}
  assert.equal(f.app.globalStyle.state.candidates.length,1);assert.equal(f.app.globalStyle.state.candidates[0].id,first.id);
  assert.equal(f.app.globalStyle.state.candidates[0].observations,3);assert.equal(f.app.globalStyle.state.expressionExamples.length,1);assert.equal(f.app.globalStyle.state.version,1);
});
test('style study failure records a bounded reason and recovers through existing retry timing',async t=>{
  const f=styleFixture(t);f.enough();await f.learn(()=>'{invalid');const p=f.app.styleLearning.progress();assert.equal(p.research.failureCount,1);assert.equal(p.research.lastFailure.code,'INVALID_JSON');
  f.app.globalStyle.state.research.nextAt=0;await f.learn(job=>f.output(job));assert.equal(f.app.globalStyle.state.research.status,'accumulating');assert.equal(f.app.globalStyle.state.research.failureCount,1);
});
test('unified bridge patch reproduces only the knowledge seams and is idempotent',()=>{
  const require=createRequire(import.meta.url),patch=require('../../scripts/unified-knowledge-bridge-patch.cjs');let current=fs.readFileSync(new URL('../../integrations/qq-bridge/src/bridge.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),prior=current;
  for(const e of [...patch.edits].reverse()){assert.ok(prior.includes(e.after));prior=prior.replace(e.after,e.before);}
  const once=(s,a,b)=>{assert.equal(s.split(a).length,2);return s.replace(a,b);};assert.equal(patch.patchBridge(prior,once),current);assert.equal(patch.patchBridge(current,once),current);
});
test('actual console query and manual confirmation use SQLite, keep group scope and do not send QQ',async t=>{
  let handler;const server={address:()=>({port:3106}),listen(_p,_h,ready){ready();},on(){}};
  const h=await bridgeHarness({config:{consolePort:3106,allow:{groups:['123456','123457'],private:[]},bigfatfish:{expectedQQ:'123456789'}},globals:{http:{createServer(fn){handler=fn;return server;}}}});t.after(()=>h.close());h.startConsoleServer();
  const call=async(url,method='GET',body)=>{const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url,method,headers:{host:'127.0.0.1:3106','x-console-token':'fixture-console-token',...(body?{'content-type':'application/json'}:{})}});let result;await handler(req,{writeHead(){},end(x){result=JSON.parse(x);}});return result;};
  const added=await call('/api/slang','POST',{content:'开摆',scope:A,meaning:'本群游戏时暂时休息',usage:'游戏压力下轻松调侃'});assert.equal(added.ok,true);
  const own=await call('/api/socialV2/slang/query?key='+A+'&q=开摆');assert.equal(own.entries[0].content,'开摆');
  const other=await call('/api/socialV2/slang/query?key='+B+'&q=开摆');assert.equal(other.entries.length,0);
  assert.equal(h.bff.community.store.list({status:'published',platform:'qq'}).length,1);assert.equal(fs.existsSync(path.join(h.temp,'state/slang.json')),false);assert.equal(h.calls.sent.length,0);
});
