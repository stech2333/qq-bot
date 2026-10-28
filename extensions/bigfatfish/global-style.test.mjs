import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GlobalStyle } from './global-style.mjs';
import { fixture, A, B, P } from './style-test-fixture.mjs';

test('legacy global data is backed up and never copied into a prompt as free text',t=>{
 const f=fixture(t),file=path.join(f.root,'state/global-style.json');fs.writeFileSync(file,JSON.stringify({version:5,profile:'旧群私人原文'}));fs.unlinkSync(f.app.globalStyle.file);const g=new GlobalStyle(f.app);assert.ok(fs.existsSync(file+'.pre-v3.bak'));assert.equal(g.state.version,0);assert.doesNotMatch(JSON.stringify(g.state),/旧群私人原文/);
});
test('only administrator-reviewed closed-vocabulary strategies can be global', t => {
  const f=fixture(t); const admin=body=>f.app.globalStyle.admin('POST',{revision:f.app.globalStyle.state.revision,...body});
  assert.throws(()=>admin({action:'publish',strategies:['某群某人的私人约定']}));
  admin({action:'publish',strategies:['follow_topic','explain']});
  assert.deepEqual(f.app.globalStyle.strategies('help'),['explain']); assert.deepEqual(f.app.globalStyle.strategies('casual_chat'),['follow_topic']);
  for(const key of [A,B,P]) { const text=f.app.instruction(key,f.app.states.get(key)); assert.match(text,/围绕对方实际内容接话/); assert.equal(text.split('【本轮表达参考】').length-1,1); }
  assert.equal(new GlobalStyle(f.app).state.version,1); assert.throws(()=>f.app.globalStyle.admin('POST',{action:'reset',revision:0}));
});
test('corrupt global experience is not overwritten; agent access is refused', async t => {
  const f=fixture(t); fs.writeFileSync(f.app.globalStyle.file,'broken'); const broken=new GlobalStyle(f.app); assert.ok(broken.error); assert.throws(()=>broken.save({}));
  let status; await f.app.handle({method:'POST',headers:{'x-agent-token':'test'}},new URL('http://localhost/api/bigfatfish/global-style'),async()=>({}),(_r,c)=>{status=c;},{}); assert.equal(status,403);
});
