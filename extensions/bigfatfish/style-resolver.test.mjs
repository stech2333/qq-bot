import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyScene} from './style-resolver.mjs';
import {fixture,A,B} from './style-test-fixture.mjs';
test('ordinary question marks preserve casual scenes; explicit help, technical and closing cues still work',()=>{
 for(const q of ['真的假的？','你又摸鱼了？','今天吃什么?'])assert.equal(classifyScene(q,'ASSISTANT').scene,'casual_chat');
 assert.equal(classifyScene('怎么解决这个报错').scene,'help');assert.equal(classifyScene('请详细解释API').scene,'help');assert.equal(classifyScene('SQL算法').scene,'technical');assert.equal(classifyScene('晚安，先下了').scene,'closing');
});
test('current directed target wins over stale or unrelated technical history',t=>{const f=fixture(t),st=f.app.states.get(A);st.recentMessages=[{plain:'请帮我详细调试代码',isSelf:false}];st.unread=[{messageId:'1',plain:'怎么解决报错',isSelf:false},{messageId:'2',plain:'真的假的？',addressedToBot:true,isSelf:false}];assert.equal(f.app.styleResolver.resolve(A,st).scene,'casual_chat');});
test('generation IDs isolate pending expression usage across replies and cancellation',async t=>{const f=fixture(t);await f.mature();const st=f.app.states.get(A);const r1=f.app.styleResolver.assemble(A,st,{turnId:'turn1',query:'继续聊聊'}),r2=f.app.styleResolver.assemble(A,st,{turnId:'turn2',query:'继续聊聊'});assert.equal(r1.diagnostics.expressionIds.length,1);assert.equal(f.app.styleResolver.pending.size,2);f.app.styleResolver.sent('turn1');assert.ok(f.app.styleResolver.pending.has('turn2'));assert.equal(r2.instruction.split('【本轮表达参考】').length-1,1);assert.equal(f.app.styleResolver.resolve(B,f.app.states.get(B),{query:'请帮我解释代码'}).selectedExpressions.length,0);});
