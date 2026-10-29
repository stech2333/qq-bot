import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {LearningJournal} from './learning-journal.mjs';
import {fixture,A} from './style-test-fixture.mjs';
const records=directory=>fs.readdirSync(directory).filter(n=>n.endsWith('.jsonl')).flatMap(n=>fs.readFileSync(path.join(directory,n),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));

test('strict event schema persists safe metadata only; scope is hashed and nulls are absent',t=>{
  const f=fixture(t),j=new LearningJournal(f.root);
  j.write('memory','SAVED',{key:A,status:'PERSISTED',reasonCode:'COMMITTED',counts:{facts:2,none:null,text:'不得记录的内容',infinite:Infinity,negative:-1,password:1234567},prompt:'不能记录模型提示',rawResponse:'不能记录模型响应',quote:'不能记录引文',cookie:'不能记录凭据'});
  const row=records(j.directory).at(-1),text=JSON.stringify(row);assert.equal(row.event,'SAVED');assert.equal(row.scopeType,'group');assert.match(row.scope,/^[a-f0-9]{24}$/);assert.deepEqual(row.counts,{facts:2});assert.doesNotMatch(text,/123456|不能记录|不得记录|null|Infinity/);assert.equal(j.snapshot().ok,true);
});
test('daily log survives restart and rotates without discarding earlier events',t=>{
  const f=fixture(t),j=new LearningJournal(f.root);j.maxBytes=200;
  const ids=[];for(let i=0;i<8;i++)ids.push(j.write('research','TOPIC_COMPLETED',{status:'PERSISTED',counts:{samples:i}}));
  assert.ok(fs.readdirSync(j.directory).filter(n=>n.endsWith('.jsonl')).length>1);const again=new LearningJournal(f.root);again.write('system','STARTED',{status:'READY'});const all=records(j.directory);for(const id of ids)assert.ok(all.some(r=>r.id===id));assert.equal(new Set(all.map(r=>r.id)).size,all.length);
});
test('log write failures are visible without claiming data was logged',t=>{
  const f=fixture(t),j=new LearningJournal(f.root);j.directory=path.join(f.root,'not-a-directory');fs.writeFileSync(j.directory,'fixture');assert.equal(j.write('memory','SAVED'), '');assert.equal(j.snapshot().ok,false);assert.equal(j.snapshot().writtenThisProcess,0);assert.match(j.snapshot().error,/保存失败/);
});
test('committed memory is logged; failed memory storage is rolled back and is never logged as saved',t=>{
  const f=fixture(t),st=f.app.states.get(A),file=path.join(f.root,'memory-test.json');
  const tx=f.app.memory.begin(A,st,{save:()=>{fs.writeFileSync(file,JSON.stringify(st.bigfatfish));return true;}});st.bigfatfish.facts.push({id:'f',text:'不得复制的私人事实'});f.app.memory.finish(tx);
  assert.equal(JSON.parse(fs.readFileSync(file)).facts.length,1);let all=records(f.app.learningLog.directory);assert.equal(all.filter(r=>r.event==='SAVED').length,1);assert.doesNotMatch(JSON.stringify(all),/不得复制的私人事实/);
  const bad=f.app.memory.begin(A,st,{save:()=>false});st.bigfatfish.facts.push({id:'g',text:'必须回滚'});assert.throws(()=>f.app.memory.finish(bad),/保存失败/);assert.equal(st.bigfatfish.facts.length,1);all=records(f.app.learningLog.directory);assert.equal(all.filter(r=>r.event==='SAVED').length,1);assert.equal(all.at(-1).event,'SAVE_FAILED');
});
test('actual sample storage and global style publication produce separate durable events',async t=>{
  const f=fixture(t);await f.mature();const all=records(f.app.learningLog.directory);assert.ok(all.some(r=>r.module==='window'&&r.event==='SAMPLES_SAVED'));assert.ok(all.some(r=>r.module==='research'&&r.event==='GLOBAL_STYLE_RESERVED'));assert.ok(all.some(r=>r.module==='style'&&r.event==='PUBLISHED'&&r.counts.changes>0));assert.equal(f.app.globalStyle.active().expressionExamples.length,1);assert.doesNotMatch(JSON.stringify(all),/这段讨论先说具体想法和理由/);
});
test('failed style validation and quota exhaustion remain auditable without model output',async t=>{
  const f=fixture(t);f.enough();await f.learn(async()=>'{invalid');let all=records(f.app.learningLog.directory);assert.ok(all.some(r=>r.module==='style'&&r.event==='FAILED'));f.app.settings.learningResearch.maxPerDay=0;assert.equal(f.app.research.reserve({kind:'topic',key:A},Date.now()),false);all=records(f.app.learningLog.directory);assert.ok(all.some(r=>r.reasonCode==='DAILY_RESEARCH_QUOTA'));assert.equal(f.app.research.snapshot().budgetExhausted,true);
});
test('bridge patch regenerates the slang persistence log hook without touching live files',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),script=path.join(root,'scripts/apply-bridge-extension.cjs'),localRequire=createRequire(script),writes=new Map(),bridge=path.join(root,'integrations/qq-bridge/src/bridge.js');
  const original=fs.readFileSync(bridge,'utf8').replace(/^.*bff\.learningLog\.write\('slang','STORE_SAVED'.*\r?\n/m,'');
  assert.doesNotMatch(original,/bff\.learningLog\.write\('slang','STORE_SAVED'/);
  const virtualFs={...fs,readFileSync(file,...args){return writes.has(String(file))?writes.get(String(file)):String(file)===bridge?original:fs.readFileSync(file,...args);},writeFileSync(file,data){assert.ok(String(file).startsWith(path.join(root,'integrations/qq-bridge')+path.sep));assert.ok(!String(file).includes(path.sep+'state'+path.sep));writes.set(String(file),data);}};
  const run=()=>vm.runInNewContext(fs.readFileSync(script,'utf8'),{__dirname:path.dirname(script),console:{log(){}},require(name){return name==='node:fs'?virtualFs:localRequire(name);}});
  run();assert.equal(writes.get(bridge).split("bff.learningLog.write('slang','STORE_SAVED'").length-1,1);const snapshot=new Map(writes);run();assert.deepEqual(writes,snapshot);
});
