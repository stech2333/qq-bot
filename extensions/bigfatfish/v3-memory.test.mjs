import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,A} from './style-test-fixture.mjs';
import {recallTrace} from './memory-recall.mjs';
import {normalizeMood,moodAt} from './mood.mjs';
test('first person preference recall identifies the current member even when no literal programming language appears',t=>{
 const f=fixture(t),facts=[{id:'a',text:'我喜欢Python',source:{userId:'111111'}},{id:'b',text:'我喜欢Java',source:{userId:'222222'}}];
 const r=recallTrace(facts,'我之前说过喜欢什么',f.app.settings.memory,f.app.privacy,Date.now(),{userId:'222222'});assert.deepEqual(r.selected.map(f=>f.id),['b']);
});
test('deleted source cannot recreate facts and invalidates summaries after reload',async t=>{
 const f=fixture(t),st=f.app.states.get(A);f.feed(A,0);st.bigfatfish.facts=[{id:'f',text:'喜欢Python',source:{messageId:'1',userId:'222222'}}];st.bigfatfish.summary='基于旧来源的摘要';st.bigfatfish.summaryMeta={source:{messageId:'1'}};f.app.learningWindow.forget(A,'1');f.app.cleanMemory(st);assert.equal(st.bigfatfish.facts.length,0);assert.equal(st.bigfatfish.summary,'');assert.equal(f.app.sourceMessage(st,'1'),undefined);
});
test('mood enables new sessions but preserves explicit/ambiguous legacy off; decay is local',()=>{
 const fresh=normalizeMood();assert.equal(fresh.config.enabled,true);assert.equal(fresh.config.autoJudge,true);assert.equal(fresh.config.injectMode,'event');
 const old=normalizeMood({config:{enabled:false}});assert.equal(old.config.enabled,false);assert.match(old.migration.enabledSource,/legacy/);
 assert.ok(Number.isFinite(moodAt(fresh,Date.now()+86400000).value));
});
