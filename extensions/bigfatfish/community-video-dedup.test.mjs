import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,item,candidate } from './community-test-fixture.mjs';
import { CommunityAdapter } from './community-adapters.mjs';
import { PlatformReader } from './community-platforms.mjs';
import { skipRepeatedRead } from './community-learning.mjs';

test('a later video failure cannot replay an earlier committed video or its paid extraction',async t=>{
  const f=fixture(t);f.setup();f.writeItems([item('post1'),item('second')]);const adapter=new CommunityAdapter(f.root,f.app.community.store.source('synthetic')),fetches=[];let fail=true;
  f.app.community.options.adapter=()=>({probe:o=>adapter.probe(o),discover:o=>adapter.discover(o),fetch:async(row,o)=>{fetches.push(row.id);if(fail&&row.id==='second')throw Object.assign(Error('来源读取超时'),{kind:'NETWORK'});return adapter.fetch(row,o);}});
  await f.run();const db=f.app.community.store,first=db.latestMaterial('synthetic','post1');assert.equal(db.jobs()[0].status,'RETRYABLE');assert.equal(db.jobs()[0].added,1);assert.equal(first.status,'COMPLETED');assert.equal(first.reading,undefined);assert.equal(first.segments.length,1);assert.equal(db.stats().published,1);assert.equal(db.logs().filter(l=>l.code==='KNOWLEDGE_PUBLISHED').length,1);
  fail=false;db.checkpoint(db.latestMaterial('synthetic','second'),'RETRYABLE',{},0);await f.run();assert.equal(db.stats().completed,2);assert.equal(fetches.filter(id=>id==='post1').length,1);assert.equal(f.calls.filter(r=>r.stage==='extract'&&JSON.parse(r.prompt).items[0].id==='post1').length,1);
});
test('a failed verification resumes the saved segment without refetching or extracting it again',async t=>{
  const f=fixture(t);f.setup();const adapter=new CommunityAdapter(f.root,f.app.community.store.source('synthetic'));let fetches=0,fail=true;const run=f.model.run;
  f.app.community.options.adapter=()=>({probe:o=>adapter.probe(o),discover:o=>adapter.discover(o),fetch:async(row,o)=>{fetches++;return adapter.fetch(row,o);}});
  f.model.run=async r=>{if(r.stage==='verify'&&fail)throw Error('DeepSeek 请求失败');return run(r);};await f.run();const db=f.app.community.store;assert.ok(db.latestMaterial('synthetic','post1').extracted);fail=false;db.checkpoint(db.latestMaterial('synthetic','post1'),'RETRYABLE',{},0);await f.run();
  assert.equal(db.stats().completed,1);assert.equal(fetches,1);assert.equal(f.calls.filter(r=>r.stage==='extract').length,1);assert.ok(db.logs().some(l=>l.code==='READ_CHECKPOINT_REUSED'));assert.equal(db.logs().filter(l=>l.code==='READ_STARTED').length,1);
});
test('segment commits preserve active job ownership and accumulate exact publication totals',async t=>{
  const f=fixture(t);f.setup();f.writeItems([item('post1'),item('second')]);const db=f.app.community.store,publish=db.publish.bind(db);let commits=0;
  db.publish=(...args)=>{const result=publish(...args);if(args[5]?.finalize===false){commits++;assert.equal(args[0].finished,false);assert.equal(args[0].status,'PUBLISHING');assert.equal(f.app.community.statusView().running,true);}return result;};
  await f.run();const job=db.jobs()[0];assert.equal(commits,2);assert.equal(job.status,'COMPLETED');assert.equal(job.added,1);assert.equal(job.updated,1);assert.equal(job.evidenceAdded,2);assert.equal(job.duplicates,0);assert.equal(job.publication.post1,1);assert.equal(job.publication.second,1);assert.equal(db.logs().filter(l=>l.code==='KNOWLEDGE_PUBLISHED').length,2);
});
test('completed videos ignore metadata/comment counts and rediscovery preserves retry cooldowns',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic'),m={...item(),stableVideo:true,fingerprint:'stable',commentVersion:'1'};
  db.enqueue(s,[m,{...m,title:'另一个搜索页的标题',fingerprint:'different-old-metadata'}],0);assert.equal(db.stats().discovered,1);let row=db.latestMaterial(s.id,m.id);db.checkpoint(row,'COMPLETED',{finished:true,offset:2400,readCursor:null});db.enqueue(s,[{...m,commentVersion:'999',title:'标题更新'}],1);row=db.latestMaterial(s.id,m.id);assert.equal(row.status,'COMPLETED');assert.equal(row.offset,2400);assert.equal(db.pending(s.id).length,0);
  const retryAt=Date.now()+60000;db.checkpoint(row,'RETRYABLE',{finished:false,extracted:[candidate()]},retryAt);db.enqueue(s,[{...m,commentVersion:'1000'}],2);row=db.latestMaterial(s.id,m.id);assert.equal(row.retryAt,retryAt);assert.equal(row.extracted.length,1);assert.equal(db.pending(s.id).length,0);
});
test('completion persists a null cursor rather than resurrecting the previous page',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic'),m={...item(),fingerprint:'cursor'};db.enqueue(s,[m],0);db.checkpoint(db.latestMaterial(s.id,m.id),'READING',{readCursor:{stage:'comments',cursor:'old'}});
  const job={id:'cursor-end',status:'PUBLISHING',version:1,at:Date.now(),source:s.id,sourceRevision:s.revision,generation:db.generation()};db.publish(job,s,[{...m,readCursor:null,complete:true}],[],()=>true);assert.equal(db.latestMaterial(s.id,m.id).readCursor,null);
});
const readerFor=t=>{const f=fixture(t),reader=new PlatformReader(f.root,{platform:'bilibili'});reader.config=()=>({driver:'polylens'});return reader;};
test('nonadvancing comment cursors stop after outstanding replies without refetching the comment page',async t=>{
  const reader=readerFor(t);reader.call=async name=>name==='get_comments'?{comments:JSON.stringify([{id:'p1',content:'一般公共评论',reply_count:1}]),has_more:true,next_cursor:'same'}:{results:[{replies:JSON.stringify([{id:'r1',parent_id:'p1',content:'一般公共回复'}]),has_more:false}]};
  const first=await reader.fetch(item(),{readCursor:{stage:'comments',cursor:'same'}});assert.equal(first.paginationStopped,'COMMENT_CURSOR_NOT_ADVANCING');assert.equal(first.readCursor.stage,'replies');assert.equal(first.readCursor.next,null);const last=await reader.fetch(item(),{readCursor:first.readCursor});assert.equal(last.complete,true);assert.equal(last.readCursor,null);
});
test('empty pages cannot keep an otherwise finished video alive forever',async t=>{
  const reader=readerFor(t);reader.call=async name=>name==='get_comments'?{comments:'[]',has_more:true,next_cursor:'another'}:{results:[{replies:'[]',has_more:true}]};
  const comments=await reader.fetch(item(),{readCursor:{stage:'comments',cursor:null}});assert.equal(comments.complete,true);assert.equal(comments.paginationStopped,'EMPTY_COMMENT_PAGE');
  const replies=await reader.fetch(item(),{readCursor:{stage:'replies',parents:['p1'],page:2,next:null}});assert.equal(replies.complete,true);assert.equal(replies.text,'');assert.equal(replies.paginationStopped,'EMPTY_REPLY_PAGE');
});
test('legacy subtitle offsets resume instead of silently starting from zero',async t=>{
  const reader=readerFor(t);reader.call=async(_name,args)=>{assert.match(args.jq,/\[4800:7200\]/);return {subtitles:'后续字幕片段'};};const r=await reader.fetch(item('post1',{offset:4800}));assert.equal(r.readCursor.stage,'comments');
});
function repeatedFixture(t,cursor) {
  const f=fixture(t);f.setup();const db=f.app.community.store,s=db.source('synthetic'),m={...item(),fingerprint:'repeat',stableVideo:true};db.enqueue(s,[m],0);db.checkpoint(db.latestMaterial(s.id,m.id),'QUEUED',{ranked:true,readCursor:cursor});let fetches=0;
  f.app.community.options.adapter=()=>({probe:async()=>({status:'READY'}),discover:async()=>({items:[m],cursor:0,hasMore:false}),fetch:async row=>{fetches++;return {...m,text:item().text,contentType:row.readCursor.stage,nextOffset:(row.offset||0)+item().text.length,readCursor:row.readCursor.stage==='replies'?{...row.readCursor,page:row.readCursor.page+1}:{stage:'comments',cursor:'different-'+fetches},complete:false};}});
  return {...f,fetches:()=>fetches};
}
test('identical comment pages skip the model and finish the existing video instead of looping',async t=>{
  const f=repeatedFixture(t,{stage:'comments',cursor:null});await f.run();assert.equal(f.calls.filter(r=>r.stage==='extract').length,1);await f.run();const db=f.app.community.store,row=db.latestMaterial('synthetic','post1');assert.equal(row.status,'COMPLETED');assert.equal(row.readCursor,null);assert.equal(f.calls.filter(r=>r.stage==='extract').length,1);await f.run();assert.equal(f.fetches(),2);assert.ok(db.logs().some(l=>l.code==='SEGMENT_DUPLICATE'&&l.data.paginationStopped==='REPEATED_COMMENT_PAGE'));
});
test('repeated reply pages finish only that thread and preserve other unread threads',async t=>{
  const f=repeatedFixture(t,{stage:'replies',parents:['p1','p2'],page:1,next:{stage:'comments',cursor:'next-comments'}});await f.run();await f.run();const row=f.app.community.store.latestMaterial('synthetic','post1');assert.equal(row.status,'QUEUED');assert.deepEqual(row.readCursor.parents,['p2']);assert.equal(row.readCursor.page,1);assert.equal(row.readCursor.next.cursor,'next-comments');assert.equal(f.calls.filter(r=>r.stage==='extract').length,1);
});
test('equal subtitle paragraphs skip repeated extraction without skipping unread subtitle offsets',()=>{
  const reading={text:'重复的字幕段落',complete:false,readCursor:{stage:'subtitles',offset:7200}};assert.equal(skipRepeatedRead(reading,{stage:'subtitles',offset:4800}),reading);
});
