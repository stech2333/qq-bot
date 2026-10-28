import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture,item,source,candidate,legacySchema } from './community-test-fixture.mjs';
import { CommunityLearning,communitySettings } from './community-learning.mjs';
import { CommunityStore,termKey } from './community-store.mjs';
import { CommunityAdapter,normalizeSource,PLATFORMS } from './community-adapters.mjs';

test('continuous scheduler crosses twelve batches and ignores old daily eight-task and low-depth caps',async t=>{
  const f=fixture(t);f.setup();f.configure({batchSize:1,maxPerDay:1,dailyCostLimit:null,sessionCostLimit:null});f.writeItems(Array.from({length:12},(_,i)=>item('post'+i,{title:'摸鱼梗的另一种说法',summary:'标题没有配置主题原文'})));
  for(let i=0;i<12;i++)await f.run();assert.equal(f.app.community.store.stats().completed,12);assert.equal(f.calls.filter(c=>c.stage==='select').length,12);assert.equal(f.app.community.session.status,'WAITING');assert.equal(f.app.settings.communityLearning.enabled,true);
  assert.equal(f.app.community.store.stats().pending,0);assert.equal(f.app.community.retrieve('摸鱼')[0].version,12);
});
test('ranking a subset cannot mark unread candidates complete; every completed record was actually read',async t=>{
  const f=fixture(t);f.setup();const rows=Array.from({length:6},(_,i)=>item('p'+i));f.writeItems(rows);const read=[],base=new CommunityAdapter(f.root,source());
  f.app.community.options.adapter=()=>({probe:()=>base.probe(),discover:o=>base.discover(o),fetch:async(i,o)=>{read.push(i.id);return base.fetch(i,o);}});
  await f.run();const db=f.app.community.store;for(const row of db.db.prepare("SELECT id FROM material_queue WHERE status='COMPLETED'").all())assert.ok(read.includes(row.id));assert.equal(read.length,6);assert.equal(db.stats().completed,6);
});
test('long documents persist reading offsets and are not completed after the first truncated segment',async t=>{
  const f=fixture(t);f.setup();f.writeItems([item('long',{text:'这是一般公共材料。'.repeat(400)})]);const original=f.model.run;f.model.run=async r=>r.stage==='extract'?{text:'{"candidates":[]}',usage:{input:20,output:10,reasoning:0,cacheHit:0}}:original(r);
  await f.run();const db=f.app.community.store;assert.equal(db.stats().completed,0);assert.equal(db.stats().pending,1);assert.equal(db.pending('synthetic')[0].offset,2400);await f.run();assert.equal(db.stats().completed,1);assert.equal(f.calls.filter(r=>r.stage==='select').length,1);
});
test('only an explicit validated relevance skip can exclude material from reading',async t=>{const f=fixture(t);f.setup();f.writeItems([item('p1'),item('unrelated',{title:'完全无关的目录项'})]);const orig=f.model.run;f.model.run=async req=>req.stage==='select'?{text:'{"ids":["p1"],"skip":[{"id":"unrelated","reason":"unrelated"}]}',usage:{input:30,output:20,reasoning:0,cacheHit:0}}:orig(req);await f.run();assert.equal(f.app.community.store.stats().completed,1);assert.equal(f.app.community.store.stats().skipped,1);const row=f.app.community.store.db.prepare("SELECT data FROM material_queue WHERE id='unrelated'").get();assert.equal(JSON.parse(row.data).skipReason,'unrelated');});
test('no new content waits without model calls, then appended material continues in the same session',async t=>{
  const f=fixture(t);f.setup();const original=item();f.writeItems([original]);await f.run();const id=f.app.community.session.id,calls=f.calls.length;await f.run();assert.equal(f.calls.length,calls);assert.equal(f.app.community.session.status,'WAITING');f.writeItems([original,item('new')]);await f.run();assert.equal(f.app.community.session.id,id);assert.equal(f.app.community.store.stats().completed,2);
});
test('recovery retains extracted checkpoints and does not repeat paid extraction after cancelled verification',async t=>{
  const f=fixture(t);f.setup();const orig=f.model.run;let entered,release;const ready=new Promise(r=>entered=r);
  f.model.run=async req=>{if(req.stage==='verify'){entered();await new Promise(r=>release=r);}return orig(req);};const running=f.run();await ready;await f.app.community.admin('POST',{action:'stop'});release();await running;await new Promise(r=>setImmediate(r));
  assert.equal(f.app.community.store.stats().pending,1);assert.ok(f.app.community.store.pending('synthetic')[0].extracted);
  f.model.run=orig;f.configure({enabled:true});await f.run();assert.equal(f.calls.filter(c=>c.stage==='extract').length,1);assert.equal(f.app.community.store.stats().completed,1);
});
test('conflict lookup covers older than 100 knowledge records and normalized terms',async t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,insert=db.db.prepare('INSERT INTO knowledge(id,kind,term,status,version,at,data,term_key) VALUES(?,?,?,\'published\',1,?,?,?)');
  insert.run('old','knowledge','摸鱼',1,JSON.stringify({id:'old',term:'摸鱼',meaning:'另一旧语境',contextTerms:['鱼']}),termKey('摸鱼'));
  for(let i=0;i<110;i++)insert.run('new'+i,'knowledge','其他'+i,Date.now()+i,JSON.stringify({id:'new'+i,term:'其他'+i,meaning:'一般概念',contextTerms:[]}),termKey('其他'+i));
  assert.equal(db.list().some(k=>k.id==='old'),false);assert.equal(db.conflicts('  摸鱼  ').published[0].id,'old');let reviewed=false;const orig=f.model.run;
  f.model.run=async req=>{if(req.stage==='verify'){reviewed=true;assert.equal(JSON.parse(req.prompt).existing[0].published[0].id,'old');}return orig(req);};await f.run();assert.equal(reviewed,true);
});
test('uncertain candidates stay pending with exploration goals instead of forced publication',async t=>{
  const f=fixture(t);f.setup();const orig=f.model.run;f.model.run=async r=>r.stage==='extract'?{text:JSON.stringify({candidates:[candidate({confidence:.6})]}),usage:{input:20,output:20,reasoning:0,cacheHit:0}}:orig(r);
  await f.run();assert.equal(f.app.community.store.stats().published,0);assert.equal(f.app.community.store.stats().unverified,1);assert.equal(f.app.community.store.goals()[0].term,'摸鱼');assert.equal(f.app.community.store.stats().completed,1);
});
test('v2 migration preserves knowledge, backs up and resets unreliable V4 completed markers',async t=>{
  const f=fixture(t);f.setup();await f.run();const id=f.app.community.retrieve('摸鱼')[0].id,db=f.app.community.store;assert.equal(db.db.prepare('SELECT count(*) n FROM documents').get().n,1);legacySchema(db.db,2);db.close();f.app.community.store=null;
  const migrated=f.app.community.open();assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(migrated.search('摸鱼')[0].id,id);assert.equal(migrated.db.prepare('SELECT count(*) n FROM documents').get().n,0);assert.equal(migrated.source('synthetic').cursor,0);assert.ok(fs.readdirSync(path.dirname(migrated.file)).some(x=>x.includes('backup-')));
});
test('lightweight status and independently paginated knowledge never return the entire snapshot',async t=>{
  const f=fixture(t);f.setup();await f.run();const status=await f.app.community.admin('GET',{view:'status'});for(const k of ['sources','jobs','knowledge','logs','usage'])assert.equal(Object.hasOwn(status,k),false);
  assert.equal((await f.app.community.admin('GET',{view:'knowledge',limit:1})).knowledge.length,1);assert.equal((await f.app.community.admin('GET',{view:'knowledge',offset:1,limit:1})).knowledge.length,0);await assert.rejects(f.app.community.admin('GET',{view:'logs',since_id:-1}));
});
test('incremental logs have stable cursor ordering, session/platform context and retention reset detection',async t=>{
  const f=fixture(t);f.setup();await f.run();const db=f.app.community.store;let a=await f.app.community.admin('GET',{view:'logs'});assert.ok(a.rows.some(l=>l.session_id&&l.platform==='bilibili'&&l.job));const cursor=a.cursor;assert.equal((await f.app.community.admin('GET',{view:'logs',since_id:cursor})).rows.length,0);
  db.log({code:'AFTER',message:'合成增量'});a=await f.app.community.admin('GET',{view:'logs',since_id:cursor});assert.equal(a.rows.length,1);assert.ok(a.cursor>cursor);
  db.tx(()=>{const stmt=db.db.prepare("INSERT INTO community_logs(at,level,code,message,data) VALUES(1,'info','TEST','合成','{}')");for(let i=0;i<2100;i++)stmt.run();});db.log({code:'LAST',message:'合成'});assert.equal(db.logPage(1).reset,true);assert.equal(db.logPage(1).hasMore,true);
});
test('session cost protection pauses with unfinished material, and increasing threshold permits continuation',async t=>{
  const f=fixture(t);f.setup();f.configure({sessionCostLimit:0});await f.run();assert.equal(f.calls.length,0);assert.equal(f.app.community.session.status,'PAUSED');assert.equal(f.app.community.store.stats().completed,0);f.configure({sessionCostLimit:1});await f.run();assert.equal(f.app.community.store.stats().completed,1);
});
test('repeated model failures trigger a session circuit and preserve unknown usage reservations',async t=>{
  const f=fixture(t);f.setup();f.model.run=async()=>{throw Error('模型请求失败');};for(let i=0;i<3;i++)await f.run();assert.equal(f.app.community.session.status,'PAUSED');assert.equal(f.app.community.store.usage().reserved,3);const req=f.app.community.store.request();assert.equal(req.complete,true);assert.equal(req.requestState,'FAILED');assert.equal(req.actual,null);
});
test('stale session ownership and interrupted queue phases are recovered without discarding checkpoints',async t=>{
  const f=fixture(t);f.setup();await f.run();const db=f.app.community.store,s=db.source('synthetic');db.enqueue(s,[{...item('interrupted'),fingerprint:'checkpoint'}],0);const m=db.pending(s.id)[0];db.checkpoint(m,'EXTRACTING',{ranked:true,extracted:[]});const j=db.latestJob();db.saveJob({...j,id:'dead-owner',ownerPid:2147483647,status:'EXTRACTING',deadline:0});db.close();f.app.community.store=null;f.app.community.open();assert.equal(f.app.community.store.job('dead-owner').status,'RETRYABLE');assert.deepEqual(f.app.community.store.pending(s.id)[0].extracted,[]);
});
test('knowledge remains available when reading is switched off, separate history-use and license revocation take effect',async t=>{
  const f=fixture(t);f.setup();await f.run();const db=f.app.community.store;let s=db.source('synthetic');await f.app.community.admin('POST',{action:'source',source:{...s,enabled:false},revision:s.revision});assert.equal(f.app.community.retrieve('摸鱼').length,1);s=db.source(s.id);await f.app.community.admin('POST',{action:'source',source:{...s,allowUse:false},revision:s.revision});assert.equal(f.app.community.retrieve('摸鱼').length,0);assert.equal(db.list()[0].status,'published');s=db.source(s.id);db.saveSource({...s,license:{...s.license,allowStore:false}},s.revision);assert.equal(db.list()[0].status,'revoked');assert.equal(db.stats().discovered,0);
});
test('verified expression evidence consolidates through the existing GlobalStyle and immediately honors revocation',async t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic');
  for(let i=0;i<3;i++){const doc={...item('e'+i),fingerprint:'e'+i},j={id:'style'+i,source:s.id,generation:db.generation(),version:1,at:Date.now()+i};db.publish(j,s,[doc],[candidate({kind:'strategy',strategy:'clarify',evidence:[{id:doc.id,quote:'摸鱼在这里指工作间隙偷闲。'}]})],()=>true);}
  db.db.prepare('UPDATE evidence SET at=? WHERE document=?').run(Date.now()-86400000,'e0');assert.ok(f.app.globalStyle.strategies('help').includes('clarify'));assert.equal(f.app.globalStyle.state.published.includes('clarify'),false);
  db.saveSource({...s,allowUse:false},s.revision);assert.equal(f.app.globalStyle.strategies('help').includes('clarify'),false);
});
const urls={bilibili:'https://www.bilibili.com/video/BVtest',tieba:'https://tieba.baidu.com/p/123',zhihu:'https://www.zhihu.com/answer/123',xiaoheihe:'https://www.xiaoheihe.cn/app/123',hupu:'https://bbs.hupu.com/123.html'};
function multi(f) {f.setup();for(const platform of Object.keys(PLATFORMS).filter(x=>x!=='bilibili'))f.app.community.store.saveSource(normalizeSource({...source(),id:platform,platform,file:platform+'.json'}),0);f.configure({platforms:Object.fromEntries(Object.keys(PLATFORMS).map(k=>[k,true]))});f.app.community.options.adapter=s=>({probe:async()=>({status:'READY'}),discover:async()=>({items:[{...item(s.id),url:urls[s.platform],fingerprint:'fp-'+s.id}],cursor:0,hasMore:false}),fetch:async i=>({...i,text:item().text,complete:true})});}
test('start automatically schedules subsequent short tasks until stopped without manual ticks',async t=>{const f=fixture(t);f.setup();f.configure({enabled:false,batchSize:1,minRequestMs:1000});f.writeItems([item('auto1'),item('auto2'),item('auto3')]);f.app.community.options.autoSchedule=true;await f.app.community.admin('POST',{action:'start'});const deadline=Date.now()+7000;while(f.app.community.store.stats().completed<3&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert.equal(f.app.community.store.stats().completed,3);await f.app.community.admin('POST',{action:'stop'});const count=f.calls.length;await new Promise(r=>setTimeout(r,1100));assert.equal(f.calls.length,count);assert.equal(f.app.community.timer,null);});
for(const platform of Object.keys(PLATFORMS))test(platform+' has independent scheduling and preserves published knowledge when toggled off',async t=>{const f=fixture(t);multi(f);for(let i=0;i<5;i++)await f.run();const db=f.app.community.store,sourceId=platform==='bilibili'?'synthetic':platform;assert.equal(db.stats(sourceId).completed,1);f.configure({platforms:{...f.app.settings.communityLearning.platforms,[platform]:false}});assert.equal(f.app.community.platforms().find(p=>p.id===platform).status,'DISABLED');assert.ok(f.app.community.retrieve('摸鱼').length);const before=db.jobs().length;await f.run();assert.ok(db.jobs().length>=before);});
test('one unavailable platform does not prevent another authorized platform from starting and learning',async t=>{const f=fixture(t);multi(f);const original=f.app.community.options.adapter;f.app.community.options.adapter=s=>s.platform==='bilibili'?{probe:async()=>{throw Object.assign(Error('来源授权失效'),{kind:'AUTH'});}}:original(s);f.configure({enabled:false});const r=await f.app.community.admin('POST',{action:'start'});assert.equal(r.accepted,true);await f.app.community.done;for(let i=0;i<5;i++)await f.run();assert.ok(f.app.community.store.stats('tieba').completed);assert.notEqual(f.app.community.platforms().find(p=>p.id==='bilibili').status,'READY');});
test('disabling an unrelated platform cannot cancel an active source request',async t=>{const f=fixture(t);multi(f);let entered,release;const ready=new Promise(r=>entered=r),orig=f.model.run;f.model.run=async r=>{if(r.stage==='select'){entered();await new Promise(r=>release=r);}return orig(r);};const work=f.run();await ready;const platform=f.app.community.store.source(f.app.community.running.source).platform,other=Object.keys(PLATFORMS).find(p=>p!==platform);f.configure({platforms:{...f.app.settings.communityLearning.platforms,[other]:false}});assert.equal(f.app.community.controller.signal.aborted,false);release();await work;assert.ok(f.app.community.store.stats().completed);});
test('public shared knowledge does not inject another QQ conversation private facts',async t=>{const f=fixture(t);f.setup();await f.run();const a=f.state('group:123456'),b=f.state('group:123457');a.bigfatfish.facts.push({id:'privatefact',kind:'stable',content:'甲群独有项目',text:'甲群独有项目',at:Date.now(),source:{messageId:'123'}});assert.doesNotMatch(f.app.instruction('group:123457',b),/甲群独有项目/);assert.ok(f.app.community.retrieve('摸鱼').length);});
test('disabled optional guards accept null while output/context/timeouts still validate',()=>{const p=communitySettings({maxPerDay:0,intervalMinutes:99999,dailyCostLimit:null,sessionCostLimit:null,batchSize:1});assert.equal(p.dailyCostLimit,null);assert.equal(Object.hasOwn(p,'maxPerDay'),false);assert.throws(()=>communitySettings({requestTimeoutSeconds:0}));assert.throws(()=>communitySettings({requestContextBytes:1}));});
