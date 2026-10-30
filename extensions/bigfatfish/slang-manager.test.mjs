import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,A,B,P} from './style-test-fixture.mjs';
import {createSlangEntry,upsertSlangEntry,saveSlang,loadSlang} from '../../integrations/qq-bridge/src/slang-learner.js';
import {senseId} from './slang-schema.mjs';
import {slangFixture} from './slang-test-fixture.mjs';
test('verified public sense is automatically confirmed from genuine multi-speaker evidence and is globally retrieved in help/private contexts',async t=>{
 const f=slangFixture(t);f.entry.senses=await f.app.slang.applyResearch(f.entry,f.output,f.rows);f.entry.meaning=f.entry.senses[0].meaning;f.entry.usage=f.entry.senses[0].usage;f.entry.research={status:'approved'};f.entry.lastInferenceCount=6;
 assert.equal(f.app.slang.score(f.entry).eligible,true);f.app.slang.scan(f.store,{force:true});assert.equal(f.entry.status,'confirmed');
 for(const key of [A,B,P])assert.equal(f.app.slang.contextEntries(f.entries,key,'help','请解释工作摸鱼是什么')[0].meaning,'工作间隙偷闲');
 assert.deepEqual(f.app.slang.contextEntries(f.entries,B,'casual_chat','今天吃饭'),[]);assert.equal(loadSlang(f.file)[0].senses.length,1);
 f.app.learningWindow.forget(A,'1');assert.equal(f.app.slang.contextEntries(f.entries,B,'help','摸鱼').length,0);
});
test('one normalized term supports multiple contextual senses; unverified/private research never enters prompts',async t=>{
 const f=slangFixture(t);upsertSlangEntry(f.entries,'摸鱼',{scope:B});assert.equal(f.entries.length,2);assert.equal(f.entries[1].scope,B);
 f.entry=f.entries[0];f.entry.status='confirmed';f.entry.senses=[{id:senseId('偷闲'),meaning:'偷闲',usage:'',contextTerms:['工作'],status:'confirmed',verified:true,generalizable:true,manual:true},{id:senseId('捕鱼动作'),meaning:'捕鱼动作',usage:'',contextTerms:['河边'],status:'confirmed',verified:true,generalizable:true,manual:true}];
 assert.equal(f.app.slang.contextEntries(f.entries,P,'help','河边摸鱼是什么意思')[0].meaning,'捕鱼动作');
 f.output.senses[0].meaning='张三在本群的私人称呼';await assert.rejects(()=>f.app.slang.applyResearch(f.entry,f.output,f.rows));
});
test('delete ledger survives old snapshots/restart; corrupt migration never overwrites source',t=>{
 const f=slangFixture(t);f.store.save();saveSlang(f.file,[]);assert.equal(loadSlang(f.file).length,0);saveSlang(f.file,[f.entry]);assert.equal(loadSlang(f.file).length,0);assert.equal(f.app.slang.candidateAdmission('摸鱼').eligible,false);
 fs.writeFileSync(f.file,'broken');assert.throws(()=>loadSlang(f.file));assert.equal(fs.readFileSync(f.file,'utf8'),'broken');
});
test('background research verifies and automatically confirms a public sense; stale source invalidates commits',async t=>{
 for(const revoke of [false,true]){const f=slangFixture(t);f.app.research.connect(async()=>{if(revoke)f.app.learningWindow.forget(A,'1');return f.output;},()=>true);await f.app.research.tick(f.store);assert.equal(f.entry.status,revoke?'candidate':'confirmed');}
});
