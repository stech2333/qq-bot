import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './community-test-fixture.mjs';
import { CommunityStore } from './community-store.mjs';
import { containsTerm, relevance, fuseKnowledge } from './community-retrieval.mjs';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const A='group:123456',B='group:123457';
async function learned(t) {const f=fixture(t);f.setup();await f.run();f.configure({enabled:false});return f;}
const question=(f,key=A,query='摸鱼是什么意思？')=>{const st=f.state(key);st.unread=[{plain:query,isSelf:false}];return {st,prompt:f.app.instruction(key,st)};};

test('native, global and community state stay separate; STOPPED and style v0 do not disable published knowledge',async t=>{
  const f=await learned(t),calls=f.calls.length,{prompt}=question(f);
  const d=f.app.community.diagnosticsView(A);
  assert.equal(d.nativeSlangCount,0);assert.equal(d.globalStyleVersion,0);
  assert.equal(d.community.publishedCount,1);assert.equal(d.community.publishedByKind.slang,1);
  assert.equal(d.community.learningEnabled,false);assert.equal(d.community.retrievableCount,1);
  assert.match(prompt,/"term":"摸鱼"/);assert.match(prompt,/不代表整个社区知识库为空/);
  assert.equal(d.lastPrompt.globalStyleExpressionIds.length,0);assert.equal(d.lastPrompt.assembledKnowledgeCount,1);
  assert.equal(d.lastPrompt.injectedKnowledgeCount,0);assert.equal(f.calls.length,calls);
});
test('application off and denied sessions block memory and contextual injection with explicit reasons',async t=>{
  const f=await learned(t);f.configure({applyKnowledge:false});
  assert.doesNotMatch(question(f).prompt,/"term":"摸鱼"/);
  assert.equal(f.app.community.applicationView(A).reasonCode,'APPLICATION_DISABLED');
  f.configure({applyKnowledge:true});question(f,'group:999999','上班任务太多了好累');
  assert.equal(f.app.community.applicationView('group:999999').reasonCode,'SESSION_NOT_ALLOWED');
  assert.equal(f.app.styleResolver.diagnostics.get('group:999999').assembledKnowledgeCount,0);
});
test('source use revocation, expired license and expired knowledge cannot inject; chat never purges storage',async t=>{
  const f=await learned(t),db=f.app.community.store,s=db.source('synthetic'),k=db.list()[0];
  const update=patch=>db.db.prepare('UPDATE sources SET data=? WHERE id=?').run(JSON.stringify({...s,...patch}),s.id);
  update({allowUse:false});assert.doesNotMatch(question(f).prompt,/"term":"摸鱼"/);
  assert.equal(f.app.community.applicationView(A).reasonCode,'ALL_SOURCES_UNUSABLE');
  update({license:{...s.license,expiresAt:Date.now()-1}});assert.doesNotMatch(question(f).prompt,/"term":"摸鱼"/);
  assert.equal(db.stats().published,1);assert.equal(db.db.prepare('SELECT count(*) n FROM evidence').get().n,1);
  update({});db.db.prepare('UPDATE knowledge SET data=? WHERE id=?').run(JSON.stringify({...k,validUntil:Date.now()-1}),k.id);
  assert.doesNotMatch(question(f).prompt,/"term":"摸鱼"/);assert.equal(f.app.community.applicationView(A).reasonCode,'NO_VALID_KNOWLEDGE');
});
test('database absence, open failure, query failure and ordinary no-match have distinct bounded diagnostics',async t=>{
  const f=fixture(t);let d={};assert.deepEqual(f.app.community.retrieve('test',{key:A,diagnostics:d}),[]);assert.equal(d.reasonCode,'DATABASE_MISSING');
  fs.writeFileSync(path.join(f.root,'state/community.sqlite'),'invalid sqlite');d={};f.app.community.retrieve('test',{key:A,diagnostics:d});assert.equal(d.reasonCode,'DATABASE_OPEN_FAILED');assert.equal(d.databaseError,true);
  fs.unlinkSync(path.join(f.root,'state/community.sqlite'));f.setup();await f.run();d={};f.app.community.retrieve('月球采样岩石',{key:A,diagnostics:d});assert.equal(d.reasonCode,'NO_MATCH');assert.equal(d.databaseError,false);
  const db=f.app.community.store,search=db.search;db.search=()=>{throw Error('secret prompt 聊天内容');};d={};
  assert.doesNotThrow(()=>f.app.community.retrieve('聊天隐私',{key:A,diagnostics:d}));assert.equal(d.reasonCode,'DATABASE_QUERY_FAILED');assert.equal(d.databaseError,true);
  assert.equal(f.app.community.applicationView(A).databaseError,false);db.search=search;
  const logs=fs.readdirSync(f.app.learningLog.directory).map(n=>fs.readFileSync(path.join(f.app.learningLog.directory,n),'utf8')).join('');
  assert.match(logs,/DATABASE_QUERY_FAILED/);assert.match(logs,/sourceFilteredCount/);assert.doesNotMatch(logs,/secret prompt|聊天隐私|聊天内容|摸鱼/);
  f.app.learningLog.write=()=>{throw Error('logging unavailable');};assert.doesNotThrow(()=>f.app.community.retrieve('摸鱼',{key:A}));
});
test('exact term survives a missing FTS token; context and safety gates stay in place',async t=>{
  const f=await learned(t),db=f.app.community.store;
  // Reproduce the production numeric/single-character token omission without changing gates.
  db.db.prepare('UPDATE knowledge_fts SET terms=?').run('unrelated');
  assert.equal(f.app.community.retrieve('摸鱼是什么意思？',{key:A})[0].term,'摸鱼');
  db.db.prepare('UPDATE knowledge_fts SET terms=?').run('工作 偷闲 上班 压力 任务');
  assert.equal(f.app.community.retrieve('上班任务太多了好累',{key:A,mode:'expression'})[0].term,'摸鱼');
  for(const query of ['我被裁员了，房租交不上，认真帮我想想办法','朋友去世了','请准确解释SQL报错']) {
    const {st}=question(f,A,query);assert.equal(f.app.styleResolver.resolve(A,st).contextualKnowledge.length,0);
    assert.equal(f.app.community.applicationView(A).lastRetrieval.expression.reasonCode,'SCENE_SUPPRESSED');
  }
});
test('single-character Chinese glossary lookup requires a boundary; numeric terms remain exact',()=>{
  const k={term:'牢',kind:'slang',meaning:'测试已发布词义',usage:'测试用法',contextTerms:[],confidence:.9};
  assert.ok(relevance(k,'牢是什么意思？'));assert.ok(relevance(k,'牢'));
  assert.equal(containsTerm('坐牢是什么意思？','牢'),false);assert.equal(containsTerm('牢记这个规则','牢'),false);
  assert.ok(containsTerm('996是什么意思？','996'));assert.equal(containsTerm('1996年','996'),false);
  assert.equal(fuseKnowledge([{term:'地球ol',meaning:'人生游戏',score:9},{term:'地球online',meaning:'现实游戏',score:8}]).length,1);
});
test('final prompt audit distinguishes assembled, accepted and literal delivery, with per-group cooldown',async t=>{
  const f=await learned(t),query='上班任务太多了好累',st=f.state(A);st.unread=[{plain:query,isSelf:false}];
  const turn=f.app.delivery.begin(A,st),prompt=f.app.instruction(A,st,{turnId:turn}),d=f.app.styleResolver.diagnostics.get(A);
  assert.equal(d.contextualKnowledgeSelectedCount,1);assert.equal(d.globalStyleExpressionIds.length,0);
  f.app.styleResolver.auditPrompt(turn,prompt);assert.equal(d.finalPromptKnowledgeCount,1);assert.equal(d.injectedKnowledgeCount,0);
  f.app.styleResolver.injected(turn);assert.equal(d.injectedKnowledgeCount,1);
  f.app.sent(A,'先摸鱼一会',{turnId:turn,sendId:'first'});assert.equal(d.deliveredLiteralUseCount,1);
  assert.equal(f.app.styleResolver.resolve(A,st,{query}).contextualKnowledge.length,0);
  assert.equal(f.app.styleResolver.resolve(B,f.state(B),{query}).contextualKnowledge.length,1);
  st.bigfatfish.expressionUse.recent.forEach(r=>r.at=Date.now()-21*60000);
  assert.equal(f.app.styleResolver.resolve(A,st,{query}).contextualKnowledge.length,1);
});
test('missing final prompt knowledge and stale memory selections are never counted as injected',async t=>{
  const f=await learned(t),st=f.state(A);st.unread=[{plain:'摸鱼是什么意思',isSelf:false}];f.app.formatMemory(st);
  const turn=f.app.delivery.begin(A,st);f.app.instruction(A,st,{memory:'',turnId:turn});
  assert.equal(f.app.styleResolver.diagnostics.get(A).assembledKnowledgeCount,0);
  const fresh=f.app.delivery.begin(B,f.state(B)),other=f.app.states.get(B);other.unread=[{plain:'上班任务太多了好累',isSelf:false}];
  f.app.instruction(B,other,{turnId:fresh});f.app.styleResolver.auditPrompt(fresh,'dropped content');f.app.styleResolver.injected(fresh);
  const d=f.app.styleResolver.diagnostics.get(B);assert.equal(d.promptKnowledgeMismatch,true);assert.equal(d.injectedKnowledgeCount,0);
});
test('read-only chat store cannot mutate checkpoints; revoked SQL status overrides old JSON',async t=>{
  const f=await learned(t),db=f.app.community.store,k=db.list()[0];
  const reader=new CommunityStore(f.root,{readOnly:true});
  try {assert.throws(()=>reader.db.exec('DELETE FROM knowledge'),/readonly/i);
    db.revoke(k.id);assert.equal(reader.search('摸鱼是什么意思').length,0);
  }finally{reader.close();}
  assert.equal(f.app.community.applicationView(A).revokedCount,1);assert.equal(f.app.community.applicationView(A).reasonCode,'NO_PUBLISHED_KNOWLEDGE');
});
test('actual bridge request content carries contextual knowledge into the stubbed DSH API without QQ sending',async t=>{
  const h=await bridgeHarness({config:{bigfatfish:{expectedQQ:'123456789'},allow:{groups:['123456'],private:[]},socialV2:{sticker:{enabled:false}}}});t.after(()=>h.close());
  h.setMode('reserved2');const db=h.bff.community.open();
  const f=await learned(t),k=f.app.community.retrieve('摸鱼是什么意思',{key:A})[0];
  // Reuse a validated test database. No model or real QQ/gateway is contacted.
  h.bff.community.store=db;h.bff.community.retrieve=(query,options={})=>f.app.community.retrieve(query,{...options,key:A});
  const st=h.getSocialV2State(A);st.unread=[{messageId:'offline',plain:'上班任务太多了好累',isSelf:false}];
  await h.deliverPrompt(A,'',{wakeReason:'addressed'});
  const text=h.calls.prompts.at(-1).content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
  assert.ok(text.includes(JSON.stringify({id:k.id,term:k.term,meaning:k.meaning,usage:k.usage})));
  assert.equal(h.bff.styleResolver.diagnostics.get(A).injectedKnowledgeCount,1);
  assert.equal(h.calls.sent.length,0);assert.equal(h.calls.http.filter(c=>/send_.*_msg/.test(c.url)).length,0);
});
