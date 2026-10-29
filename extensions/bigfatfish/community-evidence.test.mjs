import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, item, candidate } from './community-test-fixture.mjs';
import { validateKnowledge, originalQuote, classifyCommunityError } from './community-learning.mjs';

const usage={input:80,output:60,reasoning:20,cacheHit:10};
function check(f,candidates,items=[item()]) {
  let report;const valid=validateKnowledge({candidates},items,f.app.privacy,{allowUncertain:true,onReport:r=>report=r});
  return {valid,report};
}
test('correct material ID and verbatim quote are accepted',t=>{
  const f=fixture(t),r=check(f,[candidate()]);assert.equal(r.valid.length,1);assert.equal(r.report.rejected,0);assert.deepEqual(r.valid[0].evidence,candidate().evidence);
});
for(const [name,patch,rule] of [
  ['wrong ID',{evidence:[{id:'unread',quote:'摸鱼在这里指工作间隙偷闲。'}]},'EVIDENCE_ID'],
  ['paraphrase',{evidence:[{id:'post1',quote:'摸鱼就是在上班间隙休息。'}]},'QUOTE_NOT_IN_READ'],
  ['changed punctuation',{evidence:[{id:'post1',quote:'摸鱼在这里指工作间隙偷闲!'}]},'QUOTE_NOT_IN_READ'],
  ['unread later subtitles',{evidence:[{id:'post1',quote:'后来出现的字幕没有输入给模型。'}]},'QUOTE_NOT_IN_READ'],
  ['invented slang name',{term:'自动编造的黑话'},'TERM_NOT_IN_EVIDENCE'],
  ['candidate schema',{unexpected:true},'CANDIDATE_SCHEMA'],
  ['private meaning',{meaning:'我家家庭住址'},'PRIVACY_FILTER'],
  ['missing evidence',{evidence:[]},'EVIDENCE_REQUIRED']
])test(name+' rejects only that candidate with a safe rule code',t=>{
  const f=fixture(t),r=check(f,[candidate(),candidate(patch)]);assert.equal(r.valid.length,1);assert.equal(r.report.rejected,1);assert.equal(r.report.rules[rule],1);assert.equal(r.report.rejections[0].index,1);assert.doesNotMatch(JSON.stringify(r.report),/工作间隙偷闲|家庭住址/);
});
test('only canonical Unicode and unambiguous whitespace recover the actual original span',()=>{
  const text='开头 cafe\u0301\r\n  文化内容。结尾';
  assert.equal(originalQuote(text,'café 文化内容。'),'cafe\u0301\r\n  文化内容。');
  assert.equal(originalQuote(text,'café 文化内容!'),null);
  assert.equal(originalQuote('甲\n乙丙丁 甲 乙丙丁','甲\t乙丙丁'),null);
  assert.equal(originalQuote('ａｂｃ文化','abc文化'),null);
});
test('normalization saves the existing source quote and literal slang still needs literal usage',t=>{
  const f=fixture(t),text='摸鱼在这里\r\n指工作间隙偷闲。';
  const r=check(f,[candidate({evidence:[{id:'post1',quote:'摸鱼在这里 指工作间隙偷闲。'}]})],[item('post1',{text})]);
  assert.equal(r.valid[0].evidence[0].quote,text);
});
test('invalid top-level schema still fails directly',t=>{
  const f=fixture(t);for(const raw of [null,{},[],{candidates:'bad'},{candidates:[],extra:1},{candidates:Array(11).fill(candidate())}])assert.throws(()=>validateKnowledge(raw,[item()],f.app.privacy),e=>e.origin==='validation'&&e.rule==='CANDIDATE_SCHEMA');
});
test('mixed batch offline end-to-end publishes valid knowledge and counts every rejection without retry',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;
  f.model.run=async r=>{if(r.stage!=='extract')return base(r);f.calls.push(r);return {text:JSON.stringify({candidates:[candidate(),candidate({evidence:[{id:'wrong',quote:'不存在的证据'}]}),candidate({extra:1}),candidate({meaning:'我家家庭住址'})]}),usage};};
  await f.run();const db=f.app.community.store;assert.equal(db.jobs()[0].status,'COMPLETED');assert.equal(db.stats().published,1);assert.equal(db.stats().completed,1);assert.equal(db.stats().unverified,0);
  const counts=db.logs().find(r=>r.code==='CANDIDATE_VALIDATION').data;assert.equal(counts.extracted,4);assert.equal(counts.valid,1);assert.equal(counts.evidenceMismatch,1);assert.equal(counts.schemaErrors,1);assert.equal(counts.privacyFiltered,1);
  assert.equal(db.logs().find(r=>r.code==='KNOWLEDGE_PUBLISHED').data.published,1);assert.equal(db.sourceState('synthetic').failures,0);assert.equal(db.sourceState('synthetic').status,'READY');
  const n=f.calls.length;await f.run();assert.equal(f.calls.length,n);assert.equal(db.logs().some(r=>r.code==='TASK_RETRY'),false);
  await f.app.community.admin('POST',{action:'stop'});assert.equal(f.app.community.statusView().status,'STOPPED');
});
test('all invalid candidates complete the read checkpoint with no verification, publication, retry or source circuit',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;
  f.model.run=async r=>{if(r.stage!=='extract')return base(r);f.calls.push(r);return {text:JSON.stringify({candidates:[candidate({evidence:[{id:'wrong',quote:'不在实际片段内'}]})]}),usage};};
  await f.run();const db=f.app.community.store;assert.equal(db.stats().published,0);assert.equal(db.stats().completed,1);assert.equal(f.calls.some(r=>r.stage==='verify'),false);
  assert.equal(db.logs().find(r=>r.code==='CANDIDATE_VALIDATION').message,'本次没有可验证知识');const n=f.calls.length;await f.run();assert.equal(f.calls.length,n);assert.equal(db.sourceState('synthetic').status,'READY');assert.equal(db.sourceState('synthetic').blocked,false);
});
test('general conceptual names require review and supported concepts can publish',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;
  f.model.run=async r=>{if(r.stage!=='extract')return base(r);f.calls.push(r);return {text:JSON.stringify({candidates:[candidate({kind:'knowledge',term:'工作休闲文化'})]}),usage};};
  await f.run();assert.equal(f.calls.filter(r=>r.stage==='verify').length,1);assert.equal(f.app.community.store.stats().published,1);assert.equal(f.app.community.retrieve('工作休闲文化')[0].term,'工作休闲文化');
});
test('keyword overlap never bypasses evidence review; unsupported semantics remain pending',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;
  f.model.run=async r=>{if(r.stage==='extract'){f.calls.push(r);return {text:JSON.stringify({candidates:[candidate({kind:'knowledge',term:'休闲概念',meaning:'工作间隙偷闲可以治愈全部疾病'})]}),usage};}if(r.stage==='verify'){f.calls.push(r);return {text:'{"approved":[]}',usage};}return base(r);};
  await f.run();assert.equal(f.calls.filter(r=>r.stage==='verify').length,1);assert.equal(f.app.community.store.stats().published,0);assert.equal(f.app.community.store.stats().unverified,1);assert.equal(f.app.community.store.stats().completed,1);assert.equal(f.app.community.store.logs().find(r=>r.code==='KNOWLEDGE_VALIDATED').data.pendingRules.EVIDENCE_REVIEW_UNAPPROVED,1);
});
for(const [name,stage,mode,expected] of [['invalid JSON','extract','json','DEEPSEEK_JSON'],['invalid schema','extract','schema','CANDIDATE_SCHEMA'],['model failure','select','model','DEEPSEEK_REQUEST'],['database failure','publish','database','DATABASE_WRITE']])test(name+' is isolated from source connection failures',async t=>{
  const f=fixture(t);f.setup();const base=f.model.run;
  if(mode==='database')f.app.community.store.db.exec("CREATE TRIGGER evidence_failure BEFORE INSERT ON evidence BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END");
  else f.model.run=async r=>{if(r.stage!==stage)return base(r);f.calls.push(r);if(mode==='model')throw Error('DeepSeek 请求失败');return {text:mode==='json'?'not json':'{"candidates":{}}',usage};};
  await f.run();const db=f.app.community.store,s=db.sourceState('synthetic');assert.equal(s.status,'READY');assert.equal(s.failures,0);assert.equal(s.blocked,false);assert.equal(db.logs().find(r=>r.code==='TASK_RETRY').data.errorClass,expected);assert.equal(db.stats().published,0);
});
test('actual source timeout, connection and platform restriction remain separately classified',async t=>{
  for(const [error,expected] of [[{origin:'source',kind:'UNAVAILABLE'},'SOURCE_CONNECTION'],[{origin:'source',message:'来源读取超时'},'SOURCE_TIMEOUT'],[{origin:'source',kind:'RATE_LIMITED'},'SOURCE_RESTRICTED'],[{origin:'source',kind:'AUTH'},'SOURCE_RESTRICTED']])assert.equal(classifyCommunityError(error,'READING'),expected);
  const f=fixture(t);f.setup();f.app.community.options.adapter=()=>({probe:async()=>{throw Object.assign(Error('来源读取超时'),{kind:'NETWORK'});}});await f.run();assert.equal(f.app.community.store.sourceState('synthetic').failures,1);assert.equal(f.app.community.store.logs().find(r=>r.code==='TASK_RETRY').data.errorClass,'SOURCE_TIMEOUT');
});
test('usage lifecycle recovery settles actual usage once, retains unknown reservations and leaves live requests alone',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,p=f.app.settings.communityLearning,rates={input:2,output:8};
  const reserve=(id)=>db.reserve({id},'extract',1000,1600,rates,p);
  const actual=reserve('actual'),unknown=reserve('unknown'),measured=reserve('measured'),live=reserve('live');
  db.progress(actual,{usage});db.progress(actual,{estimatedOutput:90});db.finishRequest(actual,'FAILED');
  db.progress(unknown,{estimatedOutput:100,estimatedReasoning:20});db.finishRequest(unknown,'FAILED');
  db.settle(measured,usage);db.finishRequest(measured,'COMPLETED');
  db.progress(live,{usage});const before=db.db.prepare('SELECT data FROM usage WHERE id=?').get(measured.id).data;
  assert.deepEqual(db.reconcileUsage(),{settled:1,unknown:1,recoveredRequests:0});
  db.settle(measured,{input:999,output:900,reasoning:0});assert.equal(db.db.prepare('SELECT data FROM usage WHERE id=?').get(measured.id).data,before);
  const rows=Object.fromEntries(db.db.prepare('SELECT data FROM usage').all().map(r=>{const v=JSON.parse(r.data);return [v.job,v];}));assert.equal(rows.actual.status,'measured');assert.equal(rows.actual.requestState,'FAILED');assert.equal(rows.actual.cost,.00064);assert.equal(rows.unknown.status,'reserved');assert.equal(rows.unknown.input,1000);assert.equal(rows.live.status,'reserved');assert.equal(rows.live.requestState,undefined);
  const total=db.usage();assert.equal(total.reserved,2);assert.equal(total.unknownCalls,1);assert.deepEqual(total.pending,{input:2000,output:3200});assert.equal(total.confirmed.output,180);assert.equal(total.confirmed.reasoning,60);
  assert.deepEqual(db.reconcileUsage(),{settled:0,unknown:1,recoveredRequests:0});
});
test('known usage on a failed provider response is measured without repeating reasoning tokens',async t=>{
  const f=fixture(t);f.setup();f.model.run=async()=>{throw Object.assign(Error('DeepSeek 返回非法 JSON'),{modelDiagnostics:{usage}});};await f.run();const db=f.app.community.store,u=db.usage();assert.equal(u.reserved,0);assert.equal(u.confirmed.output,60);assert.equal(u.reasoning,20);assert.equal(db.request().requestState,'FAILED');
});
test('recovery marks a dead owner request ended but does not infer termination for a living cancelled owner',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store,p=f.app.settings.communityLearning;
  for(const [id,ownerPid] of [['dead',2147483647],['still-exiting',process.pid]]){
    db.saveJob({id,status:'CANCELLED',version:1,at:Date.now(),deadline:0,ownerPid});const r=db.reserve({id},'extract',1000,1600,{input:2,output:8},p);db.progress(r,{usage});
  }
  assert.deepEqual(db.reconcileUsage(),{settled:1,unknown:0,recoveredRequests:1});const rows=Object.fromEntries(db.db.prepare('SELECT data FROM usage').all().map(r=>{const v=JSON.parse(r.data);return [v.job,v];}));assert.equal(rows.dead.requestState,'INTERRUPTED');assert.equal(rows.dead.status,'measured');assert.equal(rows['still-exiting'].status,'reserved');assert.equal(rows['still-exiting'].requestState,undefined);
});
test('both SQLite log API and JSONL omit nulls, subtitles and raw model responses',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store;db.log({code:'VALIDATION_TEST',message:'验证统计',data:{missing:null,nested:{absent:null,valid:0},content:'完整字幕不能写入',rawResponse:'模型原文不能写入',rules:{EVIDENCE_ID:1}}});
  const result=JSON.stringify(db.logs()[0]);assert.doesNotMatch(result,/null|完整字幕不能写入|模型原文不能写入/);const files=fs.readdirSync(db.archiveDir);const archived=files.map(file=>fs.readFileSync(path.join(db.archiveDir,file),'utf8')).join('');assert.doesNotMatch(archived,/null|完整字幕不能写入|模型原文不能写入/);assert.match(archived,/EVIDENCE_ID/);
});
