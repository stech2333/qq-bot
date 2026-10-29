import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bridgeHarness } from '../../integrations/qq-bridge/scripts/audit-bridge-harness.mjs';

test('real console handler restricts community APIs to admin; ordinary QQ tools have no learning authority',async t=>{
  let handler;const server={address:()=>({port:3106}),listen(_p,_h,ready){ready();},on(){}};
  const h=await bridgeHarness({config:{consolePort:3106,allow:{groups:['123456'],private:[]},bigfatfish:{expectedQQ:'123456789'}},globals:{http:{createServer(fn){handler=fn;return server;}}}});
  t.after(()=>h.close());h.setMode('reserved2');h.startConsoleServer();const st=h.getSocialV2State('group:123456');
  const call=async({token='fixture-console-token',agent=false,method='GET',body}={})=>{const req=Readable.from(body?[JSON.stringify(body)]:[]);Object.assign(req,{url:'/api/bigfatfish/community',method,headers:{host:'127.0.0.1:3106','x-console-token':token,...(agent?{'x-agent-call':'1','x-agent-token':st.agentToken}:{}),...(body?{'content-type':'application/json'}:{})}});let status,result;await handler(req,{writeHead(n){status=n;},end(text){result=JSON.parse(text);}});return {status,result};};
  assert.equal((await call({token:'wrong'})).status,401);assert.equal((await call({agent:true})).status,403);assert.equal((await call()).result.status,'STOPPED');
  const stopped=await call({method:'POST',body:{action:'run'}});assert.equal(stopped.result.ok,false);assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.http.filter(c=>/send_.*_msg/.test(c.url)).length,0);
  assert.equal((await call({agent:true,method:'POST',body:{action:'start'}})).status,403);
  const blocked=await call({method:'POST',body:{action:'start'}});assert.equal(blocked.result.ok,false);assert.equal(blocked.result.code,'NOT_READY');assert.ok(blocked.result.blockers.some(c=>c.id==='sources'));assert.equal(blocked.result.running,false);
  const stop=await call({method:'POST',body:{action:'stop'}});assert.equal(stop.result.accepted,true);assert.equal(stop.result.policy.enabled,false);
});
test('V4 integration patch is reproducible against the prior bridge and console remains six-entry',()=>{
  const require=createRequire(import.meta.url),patch=require('../../scripts/v4-bridge-patch.cjs'),file=new URL('../../integrations/qq-bridge/src/bridge.js',import.meta.url),current=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
  const prior=current.replace('// BigFatFish V4 community learning\n','').replace("\nimport { createCommunityModel } from '../../../extensions/bigfatfish/community-model.mjs';",'').replace('\n    void bff.community.tick();','').replace('    probe: job => requestBffLearning(job),\n    communityRoute: () => bff.settings.communityLearning.modelRoute','    probe: job => requestBffLearning(job)').replace('\n  bff.community.connect(createCommunityModel({ pool: apiPool, config: cfg, route: () => bff.settings.communityLearning.modelRoute }),\n    () => [...socialV2.conversations].some(([key, st]) => pendingWakeKeys.has(key) || isConversationBusyV2(key, st)));','');
  const once=(s,a,b)=>{assert.equal(s.split(a).length,2);return s.replace(a,b);};assert.equal(patch.patchBridge(prior,once),current);
  const html=fs.readFileSync(new URL('./console-v3.html',import.meta.url),'utf8'),start=html.indexOf('id="mainNav"');const nav=html.slice(start,html.indexOf('</nav>',start));assert.equal((nav.match(/data-view=/g)||[]).length,6);
  const community=fs.readFileSync(new URL('./console-community.js',import.meta.url),'utf8');assert.match(community,/section-bff-community/);assert.doesNotMatch(community,/el\('section-bff-memory'\)\.append/);
});
