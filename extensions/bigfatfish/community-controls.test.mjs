import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, legacySchema } from './community-test-fixture.mjs';
import { CommunityStream, createCommunityModel, communityModelProfile, providerUsage } from './community-model.mjs';
import { poolCredential } from './api-pool.mjs';

test('start reports every missing prerequisite, creates an audit log and never claims it is running',async t=>{
  const f=fixture(t);const result=await f.app.community.admin('POST',{action:'start'});
  assert.equal(result.ok,false);assert.equal(result.code,'NOT_READY');assert.equal(result.running,false);assert.equal(result.policy.enabled,false);
  for(const id of ['platforms','sources','rates'])assert.ok(result.blockers.some(c=>c.id===id));
  assert.equal(f.calls.length,0);assert.equal(result.jobs.length,0);assert.equal(result.logs[0].code,'START_BLOCKED');
  f.app.community.store.close();f.app.community.store=null;assert.equal(f.app.community.open().logs()[0].code,'START_BLOCKED');
});
test('start/stop persist scheduling independently of knowledge application and a completed task',async t=>{
  const f=fixture(t);f.setup();f.configure({enabled:false});const start=await f.app.community.admin('POST',{action:'start'});
  assert.equal(start.accepted,true);assert.equal(start.policy.enabled,true);await f.app.community.done;assert.equal(f.app.community.retrieve('摸鱼').length,1);
  assert.equal(JSON.parse(fs.readFileSync(f.app.file)).communityLearning.enabled,true);
  const stop=await f.app.community.admin('POST',{action:'stop'});assert.equal(stop.accepted,true);assert.equal(stop.policy.enabled,false);assert.equal(stop.policy.applyKnowledge,true);
  assert.equal(JSON.parse(fs.readFileSync(f.app.file)).communityLearning.enabled,false);const calls=f.calls.length;await f.run();assert.equal(f.calls.length,calls);assert.equal(f.app.community.retrieve('摸鱼').length,1);
  const ended=f.app.community.snapshot();assert.equal(ended.status,'STOPPED');assert.equal(ended.currentJob,null);assert.ok(Number.isSafeInteger(ended.session.stoppedAt));
  const stoppedAt=ended.session.stoppedAt;await new Promise(r=>setTimeout(r,5));assert.equal(f.app.community.snapshot().session.stoppedAt,stoppedAt);
  for(const code of ['LEARNING_ENABLED','TASK_STARTED','MODEL_REQUEST','MODEL_USAGE','TASK_COMPLETED','STOP_REQUESTED'])assert.ok(f.app.community.store.logs().some(l=>l.code===code),code);
});
test('legacy stopped sessions get a fixed stoppedAt when reopened',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,at=Date.now()-5000,updatedAt=at+1200;
  db.db.exec('DELETE FROM learning_sessions');
  db.saveSession({id:'legacy-stopped',at,status:'STOPPED',ownerPid:0,updatedAt});
  db.db.prepare('UPDATE learning_sessions SET data=? WHERE id=?').run(JSON.stringify({id:'legacy-stopped',at,status:'STOPPED',ownerPid:0,updatedAt}),'legacy-stopped');
  db.close();f.app.community.store=null;f.app.community.session=null;
  f.app.community.open();assert.equal(f.app.community.session.stoppedAt,updatedAt);assert.equal(f.app.community.snapshot().currentJob,null);
});
test('streaming progress separates actual counters, estimates and unchanged reserved budget',async t=>{
  const f=fixture(t);f.setup();const original=f.model.run;let release,started;const ready=new Promise(r=>started=r);
  f.model.run=async req=>{if(req.stage==='select'){req.onUsage({estimatedOutput:12,estimatedReasoning:4});started();await new Promise(r=>release=r);req.onUsage({usage:{input:50,output:20,reasoning:5,cacheHit:10}});}return original(req);};
  const work=f.run();await ready;const live=f.app.community.snapshot();assert.equal(live.running,true);assert.equal(live.usage.confirmed.input,0);assert.equal(live.usage.estimatedOutput,12);assert.ok(live.usage.pending.input>50);assert.equal(live.taskUsage.estimatedReasoning,4);
  release();await work;const end=f.app.community.snapshot();assert.equal(end.usage.confirmed.input,240);assert.equal(end.usage.confirmed.output,180);assert.equal(end.usage.pending.input,0);assert.equal(end.usage.estimatedOutput,0);assert.equal(end.running,false);
});
test('ending an in-flight task disables future scheduling and cannot publish a late answer',async t=>{
  const f=fixture(t);f.setup();const original=f.model.run;let release,started;const ready=new Promise(r=>started=r);
  f.model.run=async req=>{started();await new Promise(r=>release=r);return original(req);};const work=f.run();await ready;
  const stopped=await f.app.community.admin('POST',{action:'stop'});assert.equal(stopped.policy.enabled,false);assert.equal(f.app.community.controller.signal.aborted,true);release();await work;await new Promise(r=>setImmediate(r));
  assert.equal(f.app.community.store.list().length,0);assert.equal(f.app.community.store.jobs()[0].status,'CANCELLED');assert.ok(f.app.community.snapshot().logs.some(l=>l.code==='TASK_CANCELLED'));assert.equal(f.app.community.snapshot().usage.confirmed.input,80);
  assert.equal(f.app.community.snapshot().currentJob,null);assert.equal(f.app.community.snapshot().status,'STOPPED');assert.ok(f.app.community.snapshot().session.stoppedAt);
  const before=f.calls.length;await f.run();assert.equal(f.calls.length,before);
});
test('QQ priority is an explicit logged wait, not a silent or fake successful task',async t=>{
  const f=fixture(t);f.setup();f.configure({enabled:false});f.app.community.busy=()=>true;
  const result=await f.app.community.admin('POST',{action:'start'});assert.equal(result.accepted,true);assert.equal(result.running,false);assert.equal(result.status,'WAITING');assert.equal(f.app.community.store.jobs().length,0);
  await f.run();assert.equal(f.app.community.store.logs().filter(l=>l.code==='CHAT_PRIORITY').length,1);
  f.app.community.busy=()=>false;await f.run();assert.equal(f.app.community.retrieve('摸鱼').length,1);
});
test('missing credentials appear in readiness without exposing raw model or credential errors',async t=>{
  const f=fixture(t);f.setup();f.model.ready=()=>{throw Error('secret fixture-api-credential');};const r=await f.app.community.admin('POST',{action:'start'});
  assert.equal(r.ok,false);assert.ok(r.blockers.some(c=>c.id==='model'));assert.doesNotMatch(JSON.stringify(r),/fixture-api-credential/);assert.equal(f.calls.length,0);
});
test('usage progress never releases reservations or persists unknown provider fields',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,p=f.app.settings.communityLearning,r=db.reserve({id:'progress-test'},'select',200,100,{input:2,output:8},p);
  db.progress(r,{estimatedOutput:10,estimatedReasoning:3,usage:{input:50,output:8,reasoning:3,cacheHit:2,secret:'untrusted-provider-field'}});
  const u=db.usage();assert.equal(u.confirmed.input,50);assert.equal(u.confirmed.output,8);assert.equal(u.pending.input,200);assert.equal(u.input,200);
  assert.doesNotMatch(db.db.prepare('SELECT data FROM usage WHERE id=?').get(r.id).data,/untrusted-provider-field/);
  db.settle(r,{input:60,output:12,reasoning:4,cacheHit:3});assert.equal(db.usage().confirmed.input,60);assert.equal(db.usage().pending.input,0);
});
test('v1 databases are backed up and migrated to log schema without changing knowledge',async t=>{
  const f=fixture(t);f.setup();await f.run();const id=f.app.community.retrieve('摸鱼')[0].id;
  legacySchema(f.app.community.store.db,1);f.app.community.store.close();f.app.community.store=null;
  const db=f.app.community.open();assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(db.search('摸鱼')[0].id,id);assert.ok(fs.readdirSync(path.dirname(db.file)).some(n=>n.startsWith('community.sqlite.backup-')));
  db.log({code:'MIGRATED',message:'合成迁移日志'});assert.equal(db.logs()[0].code,'MIGRATED');
});
test('learning logs are bounded to 2000 persistent entries and snapshots show the newest 100',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store;
  db.tx(()=>{const insert=db.db.prepare("INSERT INTO community_logs(at,level,code,message,data) VALUES(1,'info','SYNTHETIC','合成日志','{}')");for(let i=0;i<2005;i++)insert.run();});
  db.log({code:'LATEST',message:'最新合成日志'});assert.equal(db.db.prepare('SELECT count(*) n FROM community_logs').get().n,2000);assert.equal(db.logs().length,100);assert.equal(db.logs()[0].code,'LATEST');
});
test('community logs are appended to dated JSONL archives and rotate without affecting SQLite',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store;db.archiveMaxBytes=420;
  db.log({code:'ARCHIVE_ONE',message:'第一条归档日志',data:{title:'合成标题',url:'https://www.bilibili.com/video/BV1fixture',cookie:'must-not-archive'}});
  for(let i=0;i<8;i++)db.log({code:'ARCHIVE_ROTATE',message:'用于触发分卷的合成日志 '+i,data:{durationMs:i,content:'不得归档正文'}});
  const dir=path.join(f.root,'logs','bridge','community-learning'),files=fs.readdirSync(dir).filter(n=>n.endsWith('.jsonl'));assert.ok(files.length>1);
  const lines=files.flatMap(n=>fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
  assert.ok(lines.some(r=>r.code==='ARCHIVE_ONE'));assert.equal(new Set(lines.map(r=>r.archiveId)).size,lines.length);
  assert.doesNotMatch(JSON.stringify(lines),/must-not-archive|不得归档正文/);assert.ok(db.logs().some(r=>r.code==='ARCHIVE_ONE'));
});
test('SSE parsing handles split UTF-8, usage-only frames and never retains raw reasoning',()=>{
  const samples=[],stream=new CommunityStream(p=>samples.push(p));const frames=[
    {choices:[{delta:{reasoning_content:'不可持久化的原始推理'}}]},
    {choices:[{delta:{content:'{"ids":['}}]},
    {choices:[{delta:{content:'"合成材料"]}'},finish_reason:'stop'}]},
    {choices:[],usage:{prompt_tokens:90,completion_tokens:40,prompt_cache_hit_tokens:12,completion_tokens_details:{reasoning_tokens:20}}},
  ];const bytes=Buffer.from(': keepalive\r\n\r\n'+frames.map(r=>'data: '+JSON.stringify(r)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n');
  for(let i=0;i<bytes.length;i+=3)stream.push(bytes.subarray(i,i+3));const result=stream.end();assert.equal(result.choices[0].message.content,'{"ids":["合成材料"]}');assert.equal(result.choices[0].finish_reason,'stop');
  assert.ok(samples.some(s=>s.estimatedOutput>0));assert.equal(samples.at(-1).usage.input,90);assert.equal(samples.at(-1).usage.reasoning,20);assert.doesNotMatch(JSON.stringify(stream),/不可持久化/);
});
test('malformed streams and invalid provider usage cannot become measured knowledge',()=>{
  assert.throws(()=>new CommunityStream().push(Buffer.from('data: broken\n\n')),/无效/);
  assert.equal(providerUsage({prompt_tokens:-1,completion_tokens:2}),undefined);assert.equal(providerUsage({prompt_tokens:1,completion_tokens:2,completion_tokens_details:{reasoning_tokens:3}}),undefined);
  const stream=new CommunityStream();stream.push(Buffer.from('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{name:'qq_send_message'}]},finish_reason:'tool_calls'}]})+'\n\n'));assert.equal(stream.end().choices[0].message.tool_calls.length,1);
});
test('learning reuses only the selected credential reference from DSH and preserves model isolation',async()=>{
  const entry={id:'b'.repeat(32),enabled:true,keyStored:true,protocol:'openai-completions',model:'deepseek-flash',baseURL:'https://model.example.org/v1',deepseekCompat:true},pool={state:{activeId:entry.id,entries:[entry]}},refs=[],updates=[];
  const readCredential=ref=>{refs.push(ref);return 'synthetic-dsh-key';};const model=createCommunityModel({pool,config:{},env:{},readCredential,request:async(p,body,_signal,onUsage)=>{
    assert.equal(p.key,'synthetic-dsh-key');assert.equal(body.stream,true);assert.equal(body.stream_options.include_usage,true);assert.equal(body.tools,undefined);assert.equal(body.messages.length,2);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.reasoning_effort,undefined);onUsage({estimatedOutput:3,estimatedReasoning:1});
    return {choices:[{finish_reason:'stop',message:{content:'{"ids":[]}',reasoning_content:'不得返回的推理'}}],usage:{prompt_tokens:40,completion_tokens:20}};
  }});model.ready();const result=await model.run({prompt:'{}',stage:'select',signal:new AbortController().signal,maxOutputTokens:256,onUsage:p=>updates.push(p)});
  assert.ok(refs.every(r=>r===poolCredential(entry)));assert.equal(updates[0].estimatedOutput,3);assert.equal(updates.at(-1).usage.input,40);assert.doesNotMatch(JSON.stringify(result),/不得返回|synthetic-dsh-key/);
  const profile=communityModelProfile(pool,{}, {[poolCredential(entry)]:'env-key'},()=>{throw Error('不应读取其他凭据');});assert.equal(profile.key,'env-key');
});
test('select, extract and verify disable thinking and reject empty, truncated or invalid JSON',async()=>{
  const entry={id:'c'.repeat(32),enabled:true,keyStored:true,protocol:'openai-completions',model:'deepseek-flash',baseURL:'https://model.example.org/v1',deepseekCompat:true},pool={state:{activeId:entry.id,entries:[entry]}},env={[poolCredential(entry)]:'fixture-key'},seen=[];
  const ok=createCommunityModel({pool,config:{},env,request:async(_p,body)=>{seen.push(body);return {choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{prompt_tokens:4,completion_tokens:2,completion_tokens_details:{reasoning_tokens:0}}};}});
  for(const stage of ['select','extract','verify'])await ok.run({prompt:'{}',stage,signal:new AbortController().signal,maxOutputTokens:1600});
  assert.equal(seen.length,3);for(const body of seen){assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.reasoning_effort,undefined);assert.equal(body.max_tokens,1600);}
  const failing=response=>createCommunityModel({pool,config:{},env,request:async()=>response}).run({prompt:'{}',stage:'extract',signal:new AbortController().signal,maxOutputTokens:1600});
  await assert.rejects(failing({choices:[{finish_reason:'stop',message:{content:''}}],usage:{prompt_tokens:4,completion_tokens:10}}),/空 content/);
  await assert.rejects(failing({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:4,completion_tokens:1600,completion_tokens_details:{reasoning_tokens:1599}}}),/finish_reason=length.*reasoning_tokens=1599/);
  await assert.rejects(failing({choices:[{finish_reason:'stop',message:{content:'not-json'}}],usage:{prompt_tokens:4,completion_tokens:2}}),/非法 JSON/);
});
