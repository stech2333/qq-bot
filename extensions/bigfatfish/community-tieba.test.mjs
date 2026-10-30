import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fixture, source, item, candidate } from './community-test-fixture.mjs';
import { CommunityStore } from './community-store.mjs';
import { hash, normalizeSource, sourceURL } from './community-adapters.mjs';
import { PlatformReader, processExchange, forumMatches } from './community-platforms.mjs';
import { freshTiebaRead, tiebaCheckpoint, tiebaItemKey } from './community-tieba-state.mjs';
import { fuseKnowledge } from './community-retrieval.mjs';
import { validateKnowledge } from './community-learning.mjs';

const forum={id:'1',name:'Minecraft'},quote='摸鱼在这里指工作间隙偷闲。';
const tieba=(id='tieba_minecraft',target='Minecraft')=>normalizeSource({...source(),id,platform:'tieba',adapter:'platform-reader',connector:'tieba',target});
function thread(s,patch={}) {return new PlatformReader('',s).normalizeDiscovery({items:[{id:'123',title:'合成测试：摸鱼',summary:'工作与休息文化',url:'https://tieba.baidu.com/p/123',forum,stableThread:true,replyCount:1,...patch}]}).items[0];}
function record(pid='8',replyId=null,text=quote,offset=0,end=text.length,itemHash=hash(text)) {return {tid:'123',pid,replyId,parentPid:replyId?pid:null,floorNumber:1,contentType:replyId?'replies':'floors',text,offset,end,itemHash,contentHash:hash(text),itemComplete:true};}
function read(m,r=record(),next=null) {return {...m,text:`帖子123/楼层${r.pid}${r.replyId?'/回复'+r.replyId:''}: `+r.text,records:[r],forum,contentType:r.contentType,complete:next===null,readCursor:next,nextOffset:2400};}
function setup(t) {const f=fixture(t);f.setup();const s=tieba();f.app.community.store.saveSource(s,0);f.configure({platforms:{tieba:true,bilibili:false}});return {...f,s:f.app.community.store.source(s.id)};}
function commit(db,s,m,reading,candidates=[]) {const j={id:'test-'+crypto.randomUUID(),status:'PUBLISHING',version:1,at:Date.now(),source:s.id,sourceRevision:s.revision,generation:db.generation()};db.publish(j,s,[reading],candidates,()=>true);return db.latestMaterial(s.id,m.id);}

test('specific names are preserved; empty and URL input are rejected',()=>{
  assert.equal(tieba('a','真吧').target,'真吧');assert.equal(tieba('a',' Minecraft ').target,'Minecraft');
  for(const name of ['', 'a/b','a\nb','https://tieba.baidu.com'])assert.throws(()=>tieba('a',name));
  assert.ok(forumMatches('弱智吧','弱智'));assert.ok(forumMatches('真吧','真吧'));assert.equal(forumMatches('弱智','抓虾'),false);
});
test('stable tid ignores titles, reply counts and last-reply times',t=>{
  const {app,s}=setup(t),db=app.community.store,a=thread(s),b=thread(s,{title:'标题编辑',replyCount:999,lastReplyAt:888});
  assert.equal(a.fingerprint,b.fingerprint);db.enqueue(s,[a,b],0);assert.equal(db.stats(s.id).discovered,1);
  let row=db.latestMaterial(s.id,'123');db.checkpoint(row,'READING',{readCursor:{stage:'floors',page:2},extracted:[]});db.enqueue(s,[b],1);
  row=db.latestMaterial(s.id,'123');assert.equal(row.readCursor.page,2);assert.deepEqual(row.extracted,[]);
});
test('completed threads revisit on refresh while retaining paid item identities',t=>{
  const {app,s}=setup(t),db=app.community.store,m=thread(s);db.enqueue(s,[m],0);let row=commit(db,s,m,read(m));
  db.enqueue(s,[thread(s,{replyCount:99})],0);assert.equal(db.latestMaterial(s.id,'123').status,'COMPLETED');
  db.checkpoint(row,'COMPLETED',{completedAt:Date.now()-61000});db.enqueue(s,[thread(s,{replyCount:100})],0);row=db.latestMaterial(s.id,'123');
  assert.equal(row.status,'QUEUED');assert.equal(row.readCursor,null);assert.ok(row.tiebaItems['8']);assert.equal(freshTiebaRead(row,read(m)).text,'');
  assert.ok(freshTiebaRead(row,read(m,record('9'))).text);assert.ok(freshTiebaRead(row,read(m,record('8','81'))).text);
});
test('partial item offsets and hashes prevent replay while preserving remaining text',()=>{
  const m={stableThread:true},r={...record('8',null,'首段实际正文',0,6,hash('首段实际正文尾段实际正文')),itemComplete:false};
  let row=tiebaCheckpoint({},read(m,r,{stage:'floors',page:1,itemIndex:0,offset:6}));assert.equal(freshTiebaRead(row,read(m,r)).text,'');
  const second={...record('8',null,'尾段实际正文',6,12,r.itemHash),itemComplete:true};assert.ok(freshTiebaRead(row,read(m,second)).text);
  row=tiebaCheckpoint(row,read(m,second));assert.equal(row.tiebaItems['8'].complete,true);
});
test('item identity does not depend on listing/page order or neighboring users',()=>{
  const a=record('8','81'),b=record('8','82');const state=tiebaCheckpoint({},read({stableThread:true},a,{stage:'replies'}));
  assert.equal(tiebaItemKey(a),'8/81');assert.equal(freshTiebaRead(state,read({},a)).text,'');assert.ok(freshTiebaRead(state,read({},b)).text);
});
test('new content versions are learned while old evidence stays traceable and inactive',t=>{
  const {app,s}=setup(t),db=app.community.store,m=thread(s);db.enqueue(s,[m],0);
  const first=read(m),c=candidate({evidence:[{id:'123',quote}]});commit(db,s,m,first,[c]);
  assert.equal(app.community.retrieve('摸鱼').length,1);
  const changed=read(m,record('8',null,'该楼层已改为另一段真实正文。'));assert.ok(freshTiebaRead(db.latestMaterial(s.id,'123'),changed).text);
  commit(db,s,m,changed);assert.equal(app.community.retrieve('摸鱼').length,0);
  assert.equal(db.db.prepare('SELECT count(*) n FROM evidence').get().n,1);assert.equal(db.list()[0].status,'published');
});
test('only a complete authoritative scan marks missing replies deleted',()=>{
  const row={tiebaItems:{'8':{hash:'a',complete:true},'8/81':{hash:'b',complete:true}},scanSeen:{}};
  const incomplete=tiebaCheckpoint(row,{stableThread:true,complete:true,records:[],paginationStopped:'EMPTY_PAGE'});assert.equal(incomplete.tiebaItems['8/81'].deleted,undefined);
  const full=tiebaCheckpoint({...row,scanSeen:{'8':true}},{stableThread:true,complete:true,records:[]});assert.equal(full.tiebaItems['8/81'].deleted,true);
});
test('lightweight filtering skips low-value content without losing cursor advancement',()=>{
  for(const text of ['顶帖','打卡','😂😂😂','扫码领取红包','哈哈哈哈']){
    const reading=read({},record('8',null,text),{stage:'floors',page:2});const r=freshTiebaRead({},reading);assert.equal(r.text,'');assert.equal(r.filteredItems,1);assert.equal(r.readCursor.page,2);
  }
});
test('source identity is immutable and independent forums retain cursors and counts',t=>{
  const {app,s}=setup(t),db=app.community.store,b=tieba('tieba_python','Python');db.saveSource(b,0);db.enqueue(s,[thread(s)],{page:3});
  assert.throws(()=>db.saveSource({...s,target:'Python'},s.revision),/身份/);
  db.saveSource({...s,enabled:false},s.revision);assert.equal(JSON.parse(db.source(s.id).cursor).page,3);assert.equal(db.source(b.id).cursor,0);
  const views=app.community.snapshot().sources;assert.equal(views.find(x=>x.id===s.id).stats.pending,1);assert.equal(views.find(x=>x.id===b.id).stats.pending,0);
});
test('queue, item hashes, extraction and cursor survive a real database reopen',t=>{
  const {app,s,root}=setup(t);let db=app.community.store;const m=thread(s);db.enqueue(s,[m],{page:2});let row=commit(db,s,m,read(m,record(),{stage:'replies',floorPid:'8',replyPage:2,page:1}));
  db.checkpoint(row,'EXTRACTING',{reading:read(m),extracted:[candidate()],validation:{valid:1}});db.close();app.community.store=new CommunityStore(root);db=app.community.store;row=db.latestMaterial(s.id,'123');
  assert.equal(row.readCursor.replyPage,2);assert.ok(row.tiebaItems['8']);assert.equal(row.extracted.length,1);assert.equal(JSON.parse(db.source(s.id).cursor).page,2);
});
test('legacy duplicate queues back up then merge without touching knowledge, evidence or Bilibili',t=>{
  const {app,s,root}=setup(t);let db=app.community.store;const m=thread(s),b=db.source('synthetic');db.enqueue(b,[{...item(),fingerprint:'bilibili-retained'}],0);
  const old={...m,stableThread:false,fingerprint:'legacy-a',source:s.id,offset:2000,readCursor:{page:2},segments:['a'],extracted:[candidate()]};
  for(const [fingerprint,status,offset]of [['legacy-a','EXTRACTING',2000],['legacy-b','COMPLETED',4000]])db.db.prepare('INSERT INTO material_queue VALUES(?,?,?,?,?,?,?)').run(s.id,'123',fingerprint,status,Date.now(),0,JSON.stringify({...old,fingerprint,offset}));
  const before=db.stats(b.id).discovered;db.close();app.community.store=new CommunityStore(root);db=app.community.store;
  assert.equal(db.stats(s.id).discovered,1);assert.equal(db.stats(b.id).discovered,before);assert.equal(db.latestMaterial(s.id,'123').offset,4000);assert.ok(fs.readdirSync(path.join(root,'state')).some(n=>n.includes('community.sqlite.backup')));
});
test('cross-platform publication reinforces one sense and retains different senses',async t=>{
  const f=setup(t);f.configure({platforms:{bilibili:true,tieba:false}});await f.run();const db=f.app.community.store,m=thread(f.s);db.enqueue(f.s,[m],0);const r=read(m);
  commit(db,f.s,m,r,[candidate({evidence:[{id:'123',quote}]})]);assert.equal(db.stats().published,1);assert.equal(db.db.prepare('SELECT count(DISTINCT source) n FROM evidence').get().n,2);
  commit(db,f.s,m,r,[candidate({meaning:'游戏中以轻松方式完成非核心任务',contextTerms:['游戏','任务'],evidence:[{id:'123',quote}]})]);assert.equal(db.stats().published,2);
});
test('Tieba worker → platform reader → shared learning → QQ context and proactive expression is offline end-to-end',async t=>{
  const f=setup(t),python=spawnSync(process.env.BFF_TEST_PYTHON||'python',['-c','import sys; print(sys.executable)'],{encoding:'utf8',windowsHide:true}).stdout.trim();
  const config={command:python,args:['-I',path.resolve('extensions/bigfatfish/community-tieba.test.py'),'--worker']};
  f.app.community.options.adapter=s=>{
    const reader=new PlatformReader(f.root,s);reader.config=()=>({driver:'readonly-json'});reader.capability=()=>({configured:true,status:'NEEDS_AUTH'});
    reader.call=(action,args,opts)=>processExchange(config,{action,...args,target:s.target},opts);return reader;
  };
  for(let i=0;i<4;i++)await f.run();const db=f.app.community.store;
  assert.equal(db.latestMaterial(f.s.id,'123').status,'COMPLETED');assert.equal(db.stats().published,1);assert.equal(db.stats(f.s.id).published,1);assert.ok(db.latestMaterial(f.s.id,'123').tiebaItems['8/81']);
  const st=f.state('group:123456');st.unread=[{plain:'摸鱼是什么意思？',isSelf:false}];assert.match(f.app.instruction('group:123456',st),/摸鱼/);
  const casual=f.state('group:123456');
  assert.equal(f.app.styleResolver.resolve('group:123456',casual,{query:'上班任务太多了，好累'}).contextualKnowledge[0].term,'摸鱼');
  assert.equal(f.app.styleResolver.resolve('group:123456',casual,{query:'别玩梗，认真回答'}).contextualKnowledge.length,0);
  const other=f.state('group:123457');assert.equal(f.app.styleResolver.resolve('group:123457',other,{query:'上班任务太多了，好累'}).contextualKnowledge.length,1);
  const calls=f.calls.length,row=db.latestMaterial(f.s.id,'123');db.checkpoint(row,'COMPLETED',{completedAt:Date.now()-61000});for(let i=0;i<3;i++)await f.run();assert.equal(f.calls.length,calls);
  f.configure({applyKnowledge:false});assert.equal(f.app.community.retrieve('摸鱼').length,0);f.configure({applyKnowledge:true});assert.equal(f.app.community.retrieve('摸鱼').length,1);
  const s=db.source(f.s.id);db.saveSource({...s,allowUse:false},s.revision);assert.equal(f.app.community.retrieve('摸鱼').length,0);
  const logs=db.logs();assert.ok(logs.some(x=>x.data.pid==='8'&&x.data.replyId==='81'));assert.ok(logs.some(x=>x.code==='SEGMENT_DUPLICATE'));assert.ok(logs.some(x=>x.code==='THREAD_DISCOVERED'));
  const files=fs.readdirSync(db.archiveDir).filter(x=>x.endsWith('.jsonl'));assert.ok(files.length);const archived=files.map(x=>fs.readFileSync(path.join(db.archiveDir,x),'utf8')).join('');assert.doesNotMatch(archived,/QQ_COMMUNITY_CREDENTIAL|摸鱼在这里指工作间隙偷闲/);
  await f.app.community.admin('POST',{action:'stop'});await f.run();assert.equal(f.calls.length,calls);assert.equal(f.app.community.statusView().status,'STOPPED');
});
test('verification failure reuses extraction and the exact saved Tieba item',async t=>{
  const f=setup(t),m=thread(f.s);let fetches=0,fail=true;const base=f.model.run;
  f.app.community.options.adapter=()=>({capability:()=>({configured:true}),probe:async()=>({status:'READY',forum}),discover:async()=>({items:[m],cursor:0}),fetch:async()=>{fetches++;return read(m);}});
  f.model.run=async req=>{if(req.stage==='verify'&&fail)throw Error('DeepSeek 请求失败');return base(req);};
  await f.run();let db=f.app.community.store,row=db.latestMaterial(f.s.id,'123');assert.ok(row.extracted);fail=false;db.checkpoint(row,'RETRYABLE',{},0);await f.run();
  assert.equal(fetches,1);assert.equal(f.calls.filter(x=>x.stage==='extract').length,1);assert.equal(db.stats().published,1);
});
test('pending candidates can accumulate independent cross-platform evidence without auto-approval',async t=>{
  const f=setup(t);f.configure({platforms:{bilibili:true,tieba:false}});const base=f.model.run;
  f.model.run=async req=>req.stage==='verify'?{text:'{"approved":[]}',usage:{input:80,output:60,reasoning:0,cacheHit:0}}:base(req);
  await f.run();const db=f.app.community.store,m=thread(f.s),prepared=db.prepareCandidates({id:'cross'},f.s,read(m),[candidate({evidence:[{id:'123',quote}]})]);
  assert.ok(prepared.candidates.some(c=>c.refs.length===2&&c.independentSources===2));assert.equal(db.stats().published,0);
});
test('URL rendering accepts real Tieba thread paths and rejects arbitrary hosts',()=>{
  const ui=fs.readFileSync(new URL('./console-community.js',import.meta.url),'utf8'),definition=ui.match(/const safeCommunityUrl=value=>[^\n]+/)[0];
  const safe=vm.runInNewContext(definition+';safeCommunityUrl',{URL});
  assert.equal(safe('https://tieba.baidu.com/p/123'),'https://tieba.baidu.com/p/123');
  for(const u of ['http://tieba.baidu.com/p/123','https://evil.tieba.baidu.com/p/123','https://tieba.baidu.com.evil/p/123','https://tieba.baidu.com/f?kw=x','https://u:p@tieba.baidu.com/p/123','https://tieba.baidu.com/p/123?x=1']){assert.equal(safe(u),'');assert.equal(sourceURL(u,'tieba'),'');}
  assert.match(ui,/a\.rel='noopener noreferrer'/);assert.match(ui,/a\.textContent=/);assert.match(ui,/bfCommunityTiebaAdd/);
});
test('native, Bilibili and Tieba variants fuse into one chat injection',()=>{
  const c=candidate();assert.equal(fuseKnowledge([{...c,origin:'community'},{...c,origin:'community'},{...c,origin:'native'}]).length,1);
});
test('normalization rejects unbound forums, fake tids and malformed read records',()=>{
  const s=tieba(),reader=new PlatformReader('',s),m=thread(s);
  for(const patch of [{forum:{id:'2',name:'Python'}},{id:'fake'},{url:'https://tieba.baidu.com/p/999'}])assert.throws(()=>thread(s,patch));
  assert.throws(()=>reader.normalizeRead(m,{text:'正文',complete:true}));
  const r=read(m);assert.equal(reader.normalizeRead(m,r).records[0].pid,'8');assert.throws(()=>reader.normalizeRead(m,{...r,records:[{...r.records[0],contentHash:'bad'}]}));
});
test('worker timeout is bounded and classified separately from account errors',async()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const alive=setTimeout(()=>{},1000);
  try{await assert.rejects(processExchange({command:'offline-fixture',args:[]},{action:'read'},{timeoutMs:15,spawnProcess:()=>child}),e=>e.kind==='TIMEOUT');}finally{clearTimeout(alive);}
});
test('generated hierarchy labels cannot be used as original source quotations',t=>{
  const {app,s}=setup(t),reading=read(thread(s));let report;
  const c=candidate({kind:'knowledge',term:'楼层标记',evidence:[{id:'123',quote:'帖子123/楼层8'}]});
  assert.equal(validateKnowledge({candidates:[c]},[reading],app.privacy,{onReport:r=>report=r}).length,0);assert.equal(report.rules.QUOTE_NOT_IN_READ,1);
});
test('different reply IDs keep distinct evidence locations even with identical quotes',t=>{
  const {app,s}=setup(t),db=app.community.store,m=thread(s),c=candidate({evidence:[{id:'123',quote}]});
  const a=db.evidenceRefs(c,s,[read(m,record('8','81'))])[0],b=db.evidenceRefs(c,s,[read(m,record('8','82'))])[0];
  assert.notEqual(a.id,b.id);assert.equal(a.location.parentPid,'8');assert.equal(b.location.replyId,'82');
});
