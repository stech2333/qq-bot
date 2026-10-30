import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fixture,item,candidate,source } from './community-test-fixture.mjs';
import { PlatformReader,explorationQueries } from './community-platforms.mjs';
import { hash,normalizeSource } from './community-adapters.mjs';
import { normalizeState } from './runtime.mjs';
import { communityModelProfile } from './community-model.mjs';
import { literalUse } from './expression-retrieval.mjs';
import { expressionKey,safeExpression } from './community-retrieval.mjs';
import { relevance } from './community-retrieval.mjs';
import { SCENARIOS,evaluateOffline } from '../../scripts/evaluate-community-chat.mjs';

const usage={input:80,output:60,reasoning:0,cacheHit:0},A='group:123456',B='group:123457';
const records=db=>db.db.prepare('SELECT id,status,data FROM candidates').all().map(r=>({...JSON.parse(r.data),id:r.id,status:r.status}));
test('video identity survives metadata/comment changes; only known changed subtitles reset subtitle checkpoints',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic'),reader=new PlatformReader(f.root,{...s,platform:'bilibili'});
  const video=(patch={})=>reader.normalizeDiscovery({items:[{...item('BVstable'),stableVideo:true,commentVersion:'1',...patch}]}).items[0];
  const first=video();db.enqueue(s,[first],0);let row=db.latestMaterial(s.id,first.id);db.checkpoint(row,'COMPLETED',{offset:2400,readCursor:null,finished:true,subtitleVersion:'v1',subtitleCheckedAt:Date.now(),segments:['retained']});
  db.enqueue(s,[video({title:'仅标题变更',commentVersion:'2'})],1);row=db.latestMaterial(s.id,first.id);assert.equal(row.fingerprint,first.fingerprint);assert.equal(row.readCursor,null);assert.equal(row.status,'COMPLETED');assert.equal(row.offset,2400);assert.equal(row.subtitleVersion,'v1');assert.deepEqual(row.segments,['retained']);
  db.checkpoint(row,'COMPLETED',{finished:true});db.enqueue(s,[video({subtitleVersion:'v2',commentVersion:'2'})],2);row=db.latestMaterial(s.id,first.id);assert.equal(row.offset,0);assert.equal(row.readCursor.stage,'subtitles');assert.equal(db.stats().discovered,1);
});
test('scoped discovery rotates keywords and keeps per-keyword cursors without expanding authorization',async t=>{
  const f=fixture(t),s=normalizeSource({...source(),adapter:'platform-reader',connector:'bilibili',target:'互联网文化'}),reader=new PlatformReader(f.root,s),calls=[];
  reader.config=()=>({driver:'polylens'});reader.call=async(_name,args)=>{calls.push(args);return {results:'[]',has_more:true,next_cursor:'next-'+calls.length};};
  const queries=explorationQueries(s,['游戏文化'],[{term:'失传媒体'}]);assert.ok(queries.length>=3);assert.ok(queries.every(q=>q.includes('互联网文化')));
  let cursor=0;for(let i=0;i<4;i++){const r=await reader.discover({cursor,topics:['游戏文化'],goals:[{term:'失传媒体'}]});cursor=r.cursor;}
  assert.equal(new Set(calls.map(r=>r.keyword)).size,3);assert.equal(calls[3].cursor,'next-1');
});
test('legacy stable video adoption preserves the existing ID, offset, job checkpoint and logs',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic');db.enqueue(s,[{...item('old'),fingerprint:'legacy-fingerprint'}],0);
  let row=db.latestMaterial(s.id,'old');db.checkpoint(row,'EXTRACTING',{offset:1200,reading:{text:'检查点'},extracted:[],ranked:true});db.enqueue(s,[{...item('old'),fingerprint:'new-stable',stableVideo:true,commentVersion:'6'}],1);
  row=db.latestMaterial(s.id,'old');assert.equal(row.fingerprint,'legacy-fingerprint');assert.equal(row.offset,1200);assert.deepEqual(row.extracted,[]);assert.equal(row.reading.text,'检查点');assert.equal(row.status,'EXTRACTING');
});
test('new independent evidence can promote a pending candidate through bounded model review, never by source count alone',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;
  f.model.run=async r=>{if(r.stage==='extract'){f.calls.push(r);return {text:JSON.stringify({candidates:[candidate({confidence:.6,evidence:[{id:JSON.parse(r.prompt).items[0].id,quote:candidate().evidence[0].quote}]})]}),usage};}if(r.stage==='verify'){f.calls.push(r);const p=JSON.parse(r.prompt);assert.equal(new Set(p.items.map(i=>i.id)).size,2);return {text:'{"approved":[0],"confidence":[{"index":0,"value":0.95}]}',usage};}return base(r);};
  const initial=item();f.writeItems([initial]);await f.run();assert.equal(f.app.community.store.stats().unverified,1);assert.equal(f.calls.filter(r=>r.stage==='verify').length,0);
  f.writeItems([initial,item('second')]);await f.run();const db=f.app.community.store;assert.equal(db.stats().published,1);assert.equal(db.stats().unverified,0);assert.equal(f.calls.filter(r=>r.stage==='verify').length,1);assert.equal(db.db.prepare('SELECT count(DISTINCT document) n FROM evidence').get().n,2);assert.equal(records(db).find(c=>c.status==='published').independentSources,2);assert.equal(db.logs().find(l=>l.code==='CANDIDATE_LIFECYCLE'&&l.data.enriched)?.data.approved,1);
});
test('same-video evidence cannot inflate independent support or repeatedly trigger pending verification',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic'),j={id:'pending-fixture',at:Date.now()};db.saveJob({...j,status:'COMPLETED',version:1});
  const text=item('post1',{fingerprint:'video'}),p=db.prepareCandidates(j,s,text,[candidate({confidence:.6})]);db.hold(j,p.candidates);
  const again=db.prepareCandidates(j,s,text,[candidate({confidence:.6})]);assert.equal(again.candidates.length,1);assert.equal(again.candidates[0].independentSources,1);assert.equal(again.candidates[0].reviewEligible,false);
  db.hold(j,again.candidates);assert.equal(db.stats().unverified,1);
});
test('only explicit full-meaning equivalence from verification can merge paraphrased candidates in a batch',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;f.model.run=async r=>r.stage==='extract'?{text:JSON.stringify({candidates:[candidate(),candidate({meaning:'在工作间隙暂时偷闲'})]}),usage}:r.stage==='verify'?{text:'{"approved":[0,1],"equivalent":[{"index":1,"to":0}]}',usage}:base(r);
  await f.run();const db=f.app.community.store;assert.equal(db.stats().published,1);assert.equal(db.stats().unverified,0);assert.equal(db.jobs()[0].added,1);assert.equal(db.jobs()[0].duplicates,1);assert.equal(records(db).filter(c=>c.status==='merged').length,1);
});
test('new evidence does not bypass an unsuccessful semantic review or cooldown',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;f.model.run=async r=>r.stage==='verify'?(f.calls.push(r),{text:'{"approved":[]}',usage}):base(r);
  const first=item();f.writeItems([first]);await f.run();const db=f.app.community.store,c=records(db).find(r=>r.status==='pending');assert.equal(c.reviewAttempts,1);assert.ok(c.nextReviewAt>Date.now());
  f.writeItems([first,item('second')]);await f.run();assert.equal(db.stats().published,0);assert.equal(f.calls.filter(r=>r.stage==='verify').length,1);assert.equal(records(db).filter(r=>r.status==='pending').length,1);
});
test('explicitly contradicted candidates terminate; obsolete pending rows expire without paid review',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;f.model.run=async r=>r.stage==='verify'?{text:'{"approved":[],"rejected":[{"index":0,"rule":"contradicted"}]}',usage}:base(r);await f.run();const db=f.app.community.store;assert.equal(db.stats().unverified,0);assert.equal(records(db)[0].status,'rejected');
  const s=db.source('synthetic');db.saveJob({id:'ancient',status:'COMPLETED',version:1,at:Date.now()-100*86400000});db.db.prepare("INSERT INTO candidates VALUES('ancient','ancient','pending',?,'旧词')").run(JSON.stringify(candidate({term:'旧词'})));
  db.prepareCandidates({id:'now'},s,{...item(),fingerprint:'now'},[]);assert.equal(records(db).find(c=>c.id==='ancient').status,'expired');
});
test('exact duplicate evidence changes neither version nor publication count; genuinely new evidence reinforces atomically',async t=>{
  const f=fixture(t);f.setup();const first=item();f.writeItems([first]);await f.run();const db=f.app.community.store,k=db.list()[0],s=db.source('synthetic');
  const job=id=>({id,status:'PUBLISHING',version:1,at:Date.now(),source:s.id,sourceRevision:s.revision,generation:db.generation()});
  const same=job('same');db.publish(same,s,[{...first,fingerprint:'metadata-only'}],[candidate()],()=>true);assert.equal(same.added,0);assert.equal(same.updated,0);assert.equal(same.duplicates,1);assert.equal(same.publication.post1,undefined);assert.equal(db.list()[0].version,k.version);
  const newer=job('newer');db.publish(newer,s,[{...item('second'),fingerprint:'new'}],[candidate({evidence:[{id:'second',quote:candidate().evidence[0].quote}]})],()=>true);assert.equal(newer.added,0);assert.equal(newer.updated,1);assert.equal(newer.evidenceAdded,1);assert.equal(db.list()[0].version,k.version+1);
  db.db.exec("CREATE TRIGGER abort_publication BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");const failed=job('failed');assert.throws(()=>db.publish(failed,s,[{...item('third'),fingerprint:'third'}],[candidate({evidence:[{id:'third',quote:candidate().evidence[0].quote}]})],()=>true));assert.equal(db.list()[0].version,k.version+1);assert.equal(failed.updated,undefined);
});
test('Chinese contextual retrieval and proactive selection work without literal term or new chat model calls',async t=>{
  const f=fixture(t);f.setup();await f.run();const n=f.calls.length,st=f.state(A);st.unread=[{plain:'上班任务太多了，好累',isSelf:false}];
  assert.equal(f.app.community.retrieve('上班任务太多了，好累',{mode:'expression'})[0].term,'摸鱼');const prompt=f.app.instruction(A,st);assert.match(prompt,/摸鱼/);assert.equal(f.app.styleResolver.resolve(A,st).contextualKnowledge.length,1);assert.equal(f.calls.length,n);
  for(const query of ['请帮我准确解释工作安排','朋友去世了，我很难受','不聊了，晚安','别玩梗，认真回答'])assert.equal(f.app.styleResolver.resolve(A,st,{query}).contextualKnowledge.length,0);
});
test('verified terms have no added controversial-category blacklist',()=>{
  assert.equal(safeExpression(candidate({term:'争议梗',meaning:'带有争议的说法',usage:'讨论政治梗时使用'})),true);assert.equal(safeExpression(candidate({conflict:true})),false);assert.equal(safeExpression(candidate({confidence:.6})),false);
});
test('short technical terms and contextual concept questions do not depend on a literal name',t=>{
  const gateway={kind:'knowledge',term:'默认网关',meaning:'配置在电脑上的IP地址，遇到不在同一子网的目的地址时先把包发给它',usage:'跨子网通信时确定下一跳设备',contextTerms:['路由器','IP地址','跨子网'],confidence:.9};assert.ok(relevance(gateway,'访问其他子网时，数据包应该交给谁转发？'));
  const f=fixture(t),st=f.state(A);f.app.community.retrieve=()=>[{id:'signature',kind:'culture',term:'签名档',meaning:'早年论坛回复下方的个性图片',usage:'展示个性',contextTerms:['论坛'],confidence:.9,score:5}];st.unread=[{plain:'论坛回复底下的个性图片叫啥？',isSelf:false}];assert.match(f.app.formatMemory(st),/签名档/);assert.equal(relevance({term:'UGC',kind:'knowledge',meaning:'用户生成内容',usage:'用户投稿',contextTerms:[],confidence:.9},'AUGCfoo'),null);
});
test('native/community glossary fusion retains gates and avoids duplicate injection',async t=>{
  const f=fixture(t);f.setup();await f.run();const st=f.state(A),sense={id:'native-sense',status:'confirmed',verified:true,generalizable:true,manual:true,meaning:'工作间隙偷闲',usage:'轻松闲聊时使用',contextTerms:['工作']};
  f.app.slang.entries=()=>[{id:'native',content:'摸鱼',status:'confirmed',senses:[sense]}];st.unread=[{plain:'工作摸鱼是什么意思',isSelf:false}];const prompt=f.app.instruction(A,st);assert.equal(st.bffKnowledgeSelections.length,1);assert.equal(prompt.match(/"term":"摸鱼"/g).length,1);
  f.app.slang.entries=()=>[{id:'unverified',content:'私有词',status:'candidate',senses:[{...sense,status:'candidate'}]}];assert.deepEqual(f.app.slang.contextEntries(f.app.slang.entries(),A,'casual_chat','上班好累',{mode:'expression'}),[]);
  f.app.slang.entries=()=>[];f.app.community.store.revoke(f.app.community.store.list()[0].id);assert.equal(f.app.styleResolver.resolve(A,st,{query:'上班任务太多了好累'}).contextualKnowledge.length,0);
});
test('persisted per-group offers suppress repeats after restart and actual sends alone record literal observation',async t=>{
  const f=fixture(t);f.setup();await f.run();const st=f.state(A),other=f.state(B),query='上班任务太多了，好累';st.unread=[{plain:query,isSelf:false}];f.app.formatMemory(st);
  const id=f.app.delivery.begin(A,st);const assembled=f.app.styleResolver.assemble(A,st,{query,turnId:id});assert.equal(assembled.resolved.contextualKnowledge.length,1);assert.equal(st.bigfatfish.expressionUse.counts.injected,0);assert.equal(st.bigfatfish.expressionUse.counts.sentTurns,0);
  f.app.styleResolver.injected(id);assert.equal(st.bigfatfish.expressionUse.counts.injected,1);assert.equal(f.app.styleResolver.resolve(A,st,{query}).contextualKnowledge.length,0);assert.equal(f.app.styleResolver.resolve(B,other,{query}).contextualKnowledge.length,1);
  const saved=normalizeState(JSON.parse(JSON.stringify(st.bigfatfish)));assert.equal(saved.expressionUse.recent.length,2);assert.equal(new Set(saved.expressionUse.recent.map(r=>r.id)).size,2);const restarted={...st,bigfatfish:saved};f.app.bind(A,restarted);assert.equal(f.app.styleResolver.resolve(A,restarted,{query}).contextualKnowledge.length,0);
  f.app.sent(A,'这轮先歇一下',{turnId:id,sendId:'one'});assert.equal(restarted.bigfatfish.expressionUse.counts.literalUses,0);assert.equal(restarted.bigfatfish.expressionUse.counts.semanticUnknown,1);
  f.app.sent(A,'先摸鱼一小会',{turnId:id,sendId:'two'});f.app.sent(A,'摸鱼',{turnId:id,sendId:'two'});assert.equal(restarted.bigfatfish.expressionUse.counts.literalUses,1);assert.equal(restarted.bigfatfish.expressionUse.counts.sentTurns,1);assert.equal(restarted.bigfatfish.expressionUse.counts.semanticUnknown,1);
  const text=fs.readdirSync(f.app.learningLog.directory).filter(n=>n.endsWith('.jsonl')).map(n=>fs.readFileSync(f.app.learningLog.directory+'/'+n,'utf8')).join('');assert.match(text,/KNOWLEDGE_INJECTED/);assert.match(text,/literalUses/);assert.doesNotMatch(text,/这轮先歇一下|先摸鱼一小会|上班任务太多/);
});
test('literal observation handles Latin boundaries without claiming semantic correctness',()=>{
  assert.equal(literalUse('地球Online又更新难度了',{term:'地球online'}),true);assert.equal(literalUse('AUGCfoo',{term:'UGC'}),false);assert.equal(literalUse('这是UGC内容',{term:'UGC'}),true);assert.equal(expressionKey(candidate()),hash('摸鱼:工作间隙偷闲'));
});
test('builtin and explicit model routes ignore unrelated pool errors while follow-chat fails closed',()=>{
  const entry={id:'c'.repeat(32),model:'deepseek-flash',enabled:true,keyStored:true,protocol:'openai-completions',baseURL:'https://api.deepseek.com',deepseekCompat:true},pool={error:'unrelated',state:{activeId:entry.id,entries:[entry]}};
  assert.equal(communityModelProfile(pool,{}, {DEEPSEEK_API_KEY:'fixture'},()=>'', 'builtin').key,'fixture');assert.equal(communityModelProfile(pool,{}, {},()=> 'fixture',entry.id).model,'deepseek-flash');assert.throws(()=>communityModelProfile(pool,{}, {},()=> 'fixture','follow-chat'),/API池/);assert.equal(pool.state.activeId,entry.id);
});
test('26-case A/B entry runs offline with explicit denominators and no fabricated reply metrics',async t=>{
  const f=fixture(t);f.setup();await f.run();const n=f.calls.length,report=evaluateOffline(f.app,'测试人格');assert.equal(SCENARIOS.length,26);assert.equal(report.scenarios,26);assert.equal(report.modelCalls,0);assert.equal(f.calls.length,n);assert.equal(report.metrics.correctUse,null);assert.equal(report.metrics.taskCompletion,null);assert.equal(report.metrics.actualTokens,null);assert.ok(report.rows.every(r=>r.baseline.active.length===0&&r.baseline.knowledge.length===0));assert.equal(report.metrics.inappropriateSelection.numerator,0);
});
test('knowledge application bridge patch reproduces the deployed bridge from its exact previous seam',()=>{
  const require=createRequire(import.meta.url),patch=require('../../scripts/v4-bridge-patch.cjs'),current=fs.readFileSync(new URL('../../integrations/qq-bridge/src/bridge.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const prior=current.replace('// BigFatFish V4.1 knowledge application\n','').replace('    bff.slang.entries = () => cfg.slang?.enabled === false ? [] : slangEntries;\n','').replace("cfg.slang?.enabled !== false && !promptText.includes('【本轮表达参考】')","cfg.slang?.enabled !== false").replace('    if (generationId) { bff.styleResolver.injected(generationId); saveSocialV2State(); }\n','');
  const once=(s,a,b)=>{assert.equal(s.split(a).length,2);return s.replace(a,b);};assert.equal(patch.knowledgeApplication(prior,once),current);
});
