import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GlobalStyle } from './global-style.mjs';
import { fixture,A,B,P } from './style-test-fixture.mjs';
test('three independent observations automatically publish one global profile used in other groups and private chats',async t=>{
 const f=fixture(t);f.enough();await f.learn();assert.equal(f.app.globalStyle.state.version,0);assert.equal(f.app.globalStyle.state.candidates[0].observations,1);
 for(let r=1;r<3;r++){for(let i=r*24;i<(r+1)*24;i++)f.feed(A,i);await f.learn();}
 assert.equal(f.app.globalStyle.state.version,1);assert.equal(f.app.globalStyle.active().expressionExamples.length,1);
 for(const key of [A,B,P]){const r=f.app.styleResolver.resolve(key,f.app.states.get(key),{query:'聊个普通话题'});assert.equal(r.globalVersion,1);assert.equal(r.selectedExpressions.length,1);}
 const C='group:345678';f.config.allow.groups.push('345678');f.app.bind(C,{recentMessages:[],unread:[]});assert.equal(f.app.styleResolver.resolve(C,f.app.states.get(C),{query:'继续聊聊'}).selectedExpressions.length,1);
 const saved=fs.readFileSync(f.app.globalStyle.file,'utf8');assert.doesNotMatch(saved,/这段讨论|111111|222222/);assert.equal(new GlobalStyle(f.app).state.version,1);assert.equal(f.app.groupStyle,undefined);
});
test('source revocation and permission withdrawal immediately remove derived style; restart respects tombstones',async t=>{
 const f=fixture(t);await f.mature();const e=f.app.globalStyle.active().expressionExamples[0],source=e.evidence.sources[0],row=f.app.learningSources.all().find(r=>r.id===source.id);
 f.app.learningWindow.forget(row.key,row.sourceId);assert.equal(f.app.globalStyle.active().expressionExamples.length,0);
 f.app.learningWindow.windows.clear();assert.ok(!f.app.learningWindow.messages(A,f.app.states.get(A)).some(m=>String(m.messageId)===row.sourceId));
 f.config.deny.groups.push('123456');assert.equal(f.app.learningSources.all().length,0);
});
