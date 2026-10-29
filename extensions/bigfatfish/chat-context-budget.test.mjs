import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import {contextHead,contextPolicy,needsContextRenewal} from './chat-context-budget.mjs';
import {bridgeHarness} from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

const A='group:123456',B='group:123457';
const event=(seq,input=3709,cache=142592,output=1)=>({type:'assistant/message',seq,time:Date.now(),data:{usage:{inputTokens:input,cacheReadTokens:cache,outputTokens:output,totalTokens:input+cache+output,reasoningTokens:output}}});
async function fixture(t,extra={}) {const h=await bridgeHarness({config:{consolePort:3106,bigfatfish:{expectedQQ:'123456789'},allow:{groups:['123456','123457'],private:[]}},...extra});t.after(()=>h.close());h.setMode('reserved2');h.setReady(true);h.setSelfIdentity('大肥鱼','123456789');return h;}
test('actual usage includes cached input and counts reasoning in output once, not cumulative billing',()=>{
  const first=contextHead(event(1));assert.equal(first.tokens,146302);assert.equal(contextHead(event(1,999999),first),first);assert.equal(contextHead(event(0),first),first);
  const compacted=contextHead(event(2,1000,0,30),first);assert.equal(compacted.tokens,1030);assert.equal(needsContextRenewal(first,contextPolicy()),true);assert.equal(needsContextRenewal(compacted,contextPolicy()),false);
});
test('unknown, malformed or negative usage never becomes an assumed zero context',()=>{
  const head=contextHead(event(1));for(const e of [{type:'assistant/message',seq:2,data:{}},event(2,-1),event(2,NaN),{...event(2),data:{usage:{inputTokens:20,outputTokens:1,cacheReadTokens:-1}}}])assert.equal(contextHead(e,head),head);assert.equal(needsContextRenewal(undefined,contextPolicy()),false);
});
test('renewal uses the selected context window and reserves room for the next prompt and tool results',()=>{
  const head={tokens:52000},normal=contextPolicy({contextWindow:65536,maxTokens:4096});assert.equal(normal.threshold,49152);assert.equal(needsContextRenewal(head,normal),true);assert.equal(needsContextRenewal(head,contextPolicy({contextWindow:262144,maxTokens:4096})),false);
});
test('an exhausted group gets a new restricted session while its memory, unread messages and another group survive',async t=>{
  const h=await fixture(t),st=h.getSocialV2State(A);h.appendSocialV2Message(A,'测试者','待答消息','待答消息',false,false,'101',[],'987654321');st.bigfatfish.summary='保留的群摘要';st.bigfatfish.facts=[{id:'retained-fact',text:'保留的长期约定'}];const old=await h.ensureSession(A),other=await h.ensureSession(B),token=st.agentToken;
  h.recordSessionUsage(old,event(100));assert.equal(h.chatContextState(old).needsRenewal,true);const next=await h.ensureSession(A);await new Promise(r=>setTimeout(r,20));
  assert.notEqual(next,old);assert.equal(h.state.sessions[B],other);assert.equal(h.getSocialV2State(A),st);assert.equal(st.bigfatfish.summary,'保留的群摘要');assert.equal(st.bigfatfish.facts[0].id,'retained-fact');assert.equal(st.unread.length,1);assert.notEqual(st.agentToken,token);assert.ok(h.calls.archived.includes(old));assert.ok(h.calls.cancelled.includes(old));assert.equal(h.calls.created.at(-1).agentPreset,'qq-chat-v2');assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);assert.equal(h.state.contextHeads[old],undefined);
});
test('safe contexts and in-flight turns are not discarded or silently retried',async t=>{
  const h=await fixture(t),old=await h.ensureSession(A);h.recordSessionUsage(old,event(100,1000,0,20));assert.equal(await h.ensureSession(A),old);
  h.recordSessionUsage(old,event(101));h.v2TurnStartAt.set(old,Date.now());assert.equal(await h.ensureSession(A),old);assert.equal(h.calls.created.length,1);assert.equal(h.calls.prompts.length,0);
});
test('switching to a smaller API window renews that conversation without changing the chosen provider',async t=>{
  const h=await fixture(t),entry={id:'a'.repeat(32),name:'fixture',model:'fixture-model',baseURL:'https://fixture.invalid/v1',enabled:true,keyStored:true,protocol:'openai-completions',contextWindow:262144,maxTokens:4096};h.apiPool.state.entries=[entry];h.apiPool.state.activeId=entry.id;
  const old=await h.ensureSession(A);h.recordSessionUsage(old,event(100,52000,0,20));assert.equal(h.chatContextState(old).needsRenewal,false);assert.equal(await h.ensureSession(A),old);
  entry.contextWindow=65536;assert.equal(h.chatContextState(old).needsRenewal,true);assert.notEqual(await h.ensureSession(A),old);assert.equal(h.apiPool.state.activeId,entry.id);assert.equal(h.calls.prompts.length,0);
});
test('persisted footprints still protect a long conversation after a bridge restart',async t=>{
  const h=await fixture(t),old=await h.ensureSession(A);h.recordSessionUsage(old,event(100));const savedState=JSON.parse(fs.readFileSync(h.temp+'/state/sessions.json','utf8')),restarted=await fixture(t,{savedState});restarted.api.sessions.create=async()=>({result:{ok:true,value:{sessionId:'after-restart'}}});
  assert.equal(restarted.chatContextState(old).needsRenewal,true);assert.equal(await restarted.ensureSession(A),'after-restart');assert.equal(restarted.calls.prompts.length,0);
});
test('restart snapshots rebuild the latest footprint without replaying old turns or multiplying it',async t=>{
  const h=await fixture(t),old=await h.ensureSession(A);h.recordSessionSnapshot(old,{records:[{type:'event',event:event(20)},{type:'event',event:event(21,2000,0,10)}]});assert.equal(h.chatContextState(old).tokens,2010);h.recordSessionSnapshot(old,{records:[{type:'event',event:event(20)}]});assert.equal(h.chatContextState(old).tokens,2010);assert.equal(h.calls.prompts.length,0);
  const saved=JSON.parse(fs.readFileSync(h.temp+'/state/sessions.json','utf8'));assert.equal(saved.contextHeads[old].tokens,2010);
});
test('administrator context renewal preserves state and emits no model prompt; agent calls are rejected',async t=>{
  let handler;const server={address:()=>({port:3106}),listen(_p,_h,fn){fn();},on(){}};const h=await fixture(t,{globals:{http:{createServer(fn){handler=fn;return server;}}}});h.startConsoleServer();const st=h.getSocialV2State(A);st.bigfatfish.summary='需要保留';const old=await h.ensureSession(A);
  const call=async(body,agent=false)=>{const req=Readable.from([JSON.stringify(body)]);Object.assign(req,{method:'POST',url:'/api/session/reset',headers:{host:'127.0.0.1:3106','x-console-token':'fixture-console-token','content-type':'application/json',...(agent?{'x-agent-call':'1','x-agent-token':st.agentToken}:{})}});let status,result;await handler(req,{writeHead(n){status=n;},end(text){result=JSON.parse(text);}});return {status,result};};
  assert.equal((await call({key:A,preserveConversation:true},true)).status,403);assert.equal(h.state.sessions[A],old);h.setReady(false);assert.equal((await call({key:A,preserveConversation:true})).status,409);assert.equal(h.state.sessions[A],old);h.setReady(true);assert.equal((await call({key:A,expectedSessionId:'stale',preserveConversation:true})).status,409);
  const renewed=await call({key:A,expectedSessionId:old,preserveConversation:true});assert.equal(renewed.result.ok,true);assert.notEqual(renewed.result.sessionId,old);assert.equal(st.bigfatfish.summary,'需要保留');assert.equal(h.getSocialV2State(A),st);assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);
});
test('context renewal integration can be regenerated from the previous bridge',()=>{
  const require=createRequire(import.meta.url),patch=require('../../scripts/chat-context-bridge-patch.cjs'),current=fs.readFileSync(new URL('../../integrations/qq-bridge/src/bridge.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),prior=patch.unpatchBridge(current);
  assert.equal(patch.patchBridge(prior,(s,a,b)=>{assert.equal(s.split(a).length,2);return s.replace(a,b);}),current);
  assert.match(current,/if\(ended.reason.kind!=='completed'\)[\s\S]*?pendingWakeKeys.delete\(key\)[\s\S]*?if \(!deliveryRecoveryHandled && pendingWakeKeys.has\(key\)\)/);
});
