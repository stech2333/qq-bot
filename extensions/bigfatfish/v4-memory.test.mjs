import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture as communityFixture, item, candidate } from './community-test-fixture.mjs';
import { fixture as styleFixture, A, B, P, DAY } from './style-test-fixture.mjs';
import { slangFixture } from './slang-test-fixture.mjs';
import { removeMemorySource } from './memory-sources.mjs';
import { memoryRoute, recallTrace } from './memory-recall.mjs';
import { participationDecision, participationSettings } from './participation.mjs';

test('public K is shared while group/private facts remain scoped before retrieval',async t=>{
  const f=communityFixture(t);f.setup();await f.run();
  for(const [key,text]of [[A,'只属于甲群的模型训练约定'],[B,'只属于乙群的模型训练约定'],[P,'只属于私聊的模型训练约定']]) {
    const st=f.state(key);st.bigfatfish.facts=[{id:key,text,kind:'stable',at:Date.now(),source:{userId:'111111'},confidence:1}];
    st.recentMessages=[{plain:'模型训练约定和摸鱼是什么',userId:'111111'}];
    const context=f.app.formatMemory(st);assert.match(context,new RegExp(text));assert.match(context,/工作间隙偷闲/);
    for(const other of f.app.states.keys())if(other!==key)assert.doesNotMatch(context,new RegExp(f.app.states.get(other).bigfatfish.facts[0].text));
  }
  const denied=f.state('group:999999');denied.recentMessages=[{plain:'摸鱼'}];assert.doesNotMatch(f.app.formatMemory(denied),/工作间隙偷闲/);
});
test('directed pending query selects relevant knowledge instead of injecting the entire library',async t=>{
  const f=communityFixture(t);f.setup();await f.run();const st=f.state(A);
  st.recentMessages=[{plain:'摸鱼是什么',userId:'111111'}];st.unread=[{messageId:'current',plain:'你好呀',userId:'222222',addressedToBot:true}];
  assert.doesNotMatch(f.app.formatMemory(st),/工作间隙偷闲/);
  st.unread[0].plain='工作时摸鱼是什么';assert.match(f.app.formatMemory(st),/工作间隙偷闲/);
  f.configure({applyKnowledge:false});assert.doesNotMatch(f.app.formatMemory(st),/工作间隙偷闲/);
});
test('multiple meanings choose the matching context and never force slang into technical questions',async t=>{
  const f=communityFixture(t);f.setup();await f.run();
  f.writeItems([item('post2',{title:'游戏文化：摸鱼的另一个词义',text:'摸鱼在河边指徒手捕鱼。轻松闲聊时使用。'})]);
  const original=f.model.run;
  f.model.run=async req=>req.stage==='extract'?{text:JSON.stringify({candidates:[candidate({meaning:'徒手捕鱼',contextTerms:['河边'],evidence:[{id:'post2',quote:'摸鱼在河边指徒手捕鱼。'}]})]}),usage:{input:80,output:60,cacheHit:0,reasoning:0}}:original(req);
  await f.run();assert.equal(f.app.community.store.list().length,2);
  assert.equal(f.app.community.retrieve('河边摸鱼是什么')[0].meaning,'徒手捕鱼');assert.equal(f.app.community.retrieve('工作摸鱼是什么')[0].meaning,'工作间隙偷闲');
  const st=f.state(A);st.unread=[{plain:'请解释SQL索引原理',userId:'111111'}];assert.doesNotMatch(f.app.instruction(A,st),/工作间隙偷闲|徒手捕鱼/);
});
test('event recall honors Shanghai relative dates and member ownership',t=>{
  const f=communityFixture(t),now=Date.parse('2026-10-28T02:00:00Z'),plan=memoryRoute('昨天模型训练约定',now);
  const facts=[{id:'yesterday',text:'模型训练约定',at:now-DAY,kind:'event',source:{userId:'111111',at:now-DAY}},
    {id:'today',text:'模型训练约定',at:now,kind:'event',source:{userId:'111111',at:now}},
    {id:'other',text:'模型训练约定',at:now-DAY,kind:'event',source:{userId:'222222',at:now-DAY}}];
  const trace=recallTrace(facts,'我之前的模型训练约定',f.app.settings.memory,f.app.privacy,now,{userId:'111111',timeRange:plan.timeRange});
  assert.deepEqual(trace.selected.map(r=>r.id),['yesterday']);assert.equal(memoryRoute('你好',now).history,false);
});
test('private journals persist independently without becoming global learning samples',t=>{
  const f=communityFixture(t),st=f.state(P),message={messageId:'private1',plain:'模型训练约定下周继续',userId:'111111',time:Date.now(),sourceScope:P,styleSourceVersion:0};
  st.recentMessages=[message];f.app.observeTopics(P,st);st.recentMessages=[];f.app.learningWindow.windows.clear();
  assert.equal(f.app.learningWindow.messages(P,st)[0].messageId,'private1');assert.deepEqual(f.app.learningSources.all(),[]);assert.deepEqual(f.app.research.jobs(),[]);
});
test('source removal deletes only dependent facts, thoughts and impressions; independent evidence survives',t=>{
  const f=communityFixture(t),st=f.state(A),s=st.bigfatfish;
  s.facts=[{id:'bad',text:'需要移除的模型训练记录',source:{messageId:'bad'},sourceIds:['bad']},
    {id:'good',text:'另一个模型训练记录',source:{messageId:'good'}},
    {id:'multiple',text:'多个来源支持的约定',source:{messageId:'bad',userId:'111111'},sourceIds:['bad','good']}];
  s.summary='来自别处的阶段摘要';s.summaryMeta={source:{messageId:'good'}};s.memoryArchive=[{fact:{id:'older',text:'其他版本',source:{messageId:'older'}}}];
  st.activeTopics=[{text:'相关话题',source:{messageId:'bad'}},{text:'无关话题',source:{messageId:'good'}}];st.pendingThoughts=[{text:'未完成事项',source:{messageId:'good'}}];
  st.memberImpressions={'111111':{traits:['应删','保留'],evidence:[{text:'应删',messageId:'bad'},{text:'保留',messageId:'good'}]},'222222':{traits:['旧版独立印象']}};
  removeMemorySource(f.app,A,st,'bad');assert.deepEqual(s.facts.map(f=>f.id),['good','multiple']);assert.equal(s.facts[1].source.messageId,'good');
  assert.equal(s.summary,'来自别处的阶段摘要');assert.equal(s.memoryArchive.length,1);assert.equal(st.activeTopics[0].text,'无关话题');assert.equal(st.pendingThoughts.length,1);
  assert.deepEqual(st.memberImpressions['111111'].traits,['保留']);assert.deepEqual(st.memberImpressions['222222'].traits,['旧版独立印象']);
});
test('published global style survives sample expiry but explicit source revocation still removes it',async t=>{
  const f=styleFixture(t);await f.mature();assert.equal(f.app.globalStyle.active().expressionExamples.length,1);
  assert.equal(f.app.globalStyle.active(Date.now()+31*DAY).expressionExamples.length,1);
  const ref=f.app.globalStyle.state.expressionExamples[0].evidence.sources[0],row=f.app.learningSources.all().find(r=>r.id===ref.id);f.app.learningWindow.forget(row.key,row.sourceId);
  assert.equal(f.app.globalStyle.active(Date.now()+31*DAY).expressionExamples.length,0);
});
test('confirmed slang survives sample journal expiry while source tombstones remain authoritative',async t=>{
  const f=slangFixture(t);f.entry.senses=await f.app.slang.applyResearch(f.entry,f.output,f.rows);f.entry.meaning=f.entry.senses[0].meaning;f.entry.usage=f.entry.senses[0].usage;f.entry.research={status:'approved'};f.app.slang.scan(f.store,{force:true});
  f.app.learningWindow.windows.clear();f.app.states.get(A).recentMessages=[];
  const load=f.app.learningWindow.load.bind(f.app.learningWindow);f.app.learningWindow.load=(key)=>load(key,Date.now()+31*DAY);
  assert.equal(f.app.slang.contextEntries(f.entries,B,'casual_chat','工作摸鱼').length,1);f.app.learningWindow.forget(A,'1');assert.equal(f.app.slang.contextEntries(f.entries,B,'casual_chat','工作摸鱼').length,0);
});
test('mentioning the bot in a message addressed to another person is not a mandatory bot invitation',()=>{
  const r=participationDecision({}, {self_id:'123456789',user_id:'111111',message:[{type:'at',data:{qq:'222222'}}]},
    {kind:'group',text:'你觉得肥鱼说得对吗',random:()=>1},participationSettings());assert.equal(r.direct,false);assert.equal(r.involved,false);
});
