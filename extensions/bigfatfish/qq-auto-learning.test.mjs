import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './community-test-fixture.mjs';
import { createSlangEntry } from '../../integrations/qq-bridge/src/slang-learner.js';
const A='group:123456',B='group:123457';

function automatic(t){
  const f=fixture(t),st=f.state(A),now=Date.now();
  st.recentMessages=Array.from({length:4},(_,i)=>({messageId:String(i+1),userId:i%2?'111111':'222222',plain:'今天上班又想摸鱼'+i,time:now-10000-i*1000,isSelf:false,styleSourceVersion:2,sourceScope:A}));
  f.app.settings.slangPolicy.autoConfirm=false; // No manual or score-based confirmation dependency.
  f.app.settings.slangPolicy.minSpanMinutes=10080;
  f.app.settings.learningResearch.minConfidence=.99;
  const entries=f.app.slang.connectUnified();entries.push(createSlangEntry({content:'摸鱼',scope:A}));f.app.slang.unified.save(entries);
  const store={entries:()=>entries,writable:()=>true,save:()=>f.app.slang.unified.save(entries)};
  let externalChecks=0;f.app.slang.verifyPublicSources=async()=>{externalChecks++;throw Error('extra review should not run');};
  const result=job=>{const rows=JSON.parse(job.prompt.split('\n').at(-1)),ids=rows.map(r=>r.id);return {approved:true,confidence:.9,sourceMessageIds:ids,senses:[{meaning:'工作间隙暂时偷闲',usage:'工作疲惫时轻松自嘲',contextTerms:['工作'],generalizable:true,privateReferences:false,sourceMessageIds:ids,publicSources:[]}]};};
  return {...f,entries,store,result,checks:()=>externalChecks};
}
test('automatic research writes shared QQ slang directly, without score, manual approval or external-URL review',async t=>{
  const f=automatic(t);f.app.research.connect(async job=>f.result(job),()=>true);await f.app.research.tick(f.store);
  const own=f.app.community.retrieve('摸鱼是什么意思',{key:A}),other=f.app.community.retrieve('摸鱼是什么意思',{key:B});
  assert.equal(own.length,1);assert.equal(other[0].id,own[0].id);assert.equal(other[0].scope,'public');assert.equal(other[0].confidence,.9);
  assert.equal(f.entries[0].status,'confirmed');assert.equal(f.entries[0].research.publication,'published');assert.equal(f.checks(),0);
  assert.equal(fs.existsSync(path.join(f.root,'state/slang.json')),false);
});
test('private facts returned by research are not stored as shared slang',async t=>{
  const f=automatic(t);f.app.research.connect(async job=>{const r=f.result(job);r.senses[0].meaning='张三在本群的私人称呼';return r;},()=>true);
  await f.app.research.tick(f.store);assert.equal(f.app.community.store.list({status:'published'}).length,0);assert.equal(f.entries[0].status,'candidate');
});
