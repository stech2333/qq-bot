import test from 'node:test';
import assert from 'node:assert/strict';
import {DeliveryLedger} from './delivery-ledger.mjs';
import {numberSetting} from './state-store.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
test('duplicate send/start/end events settle one generation once; overlapped turn IDs stay independent',()=>{
 const used=[],app={styleResolver:{pending:new Map(),sent:id=>used.push(id)}},l=new DeliveryLedger(app),st={agentToken:'token'};
 const a=l.begin('group:1',st);l.start('group:1',st,1);const b=l.begin('group:1',st);assert.equal(l.start('group:1',st,1),a);l.start('group:1',st,2);
 assert.ok(l.accepted('group:1',st,a,'send1').first);assert.equal(l.accepted('group:1',st,a,'send1'),null);l.accepted('group:1',st,b,'send2');
 l.batch(a,1);l.complete('group:1',1,true);l.complete('group:1',1,true);assert.equal(l.turns.get(a).status,'partial');assert.equal(l.running.get('group:1'),b);l.complete('group:1',2,true);assert.deepEqual(used,[a,b]);
});
test('cancelled/rotated generations cannot receive attribution; unknown transport stays unknown',()=>{
 const app={styleResolver:{pending:new Map(),sent(){}}},l=new DeliveryLedger(app),st={agentToken:'token'};const a=l.begin('x',st);l.start('x',st,1);l.batch(a,1,true);l.complete('x',1,true);assert.equal(l.turns.get(a).status,'unknown');assert.equal(l.accepted('x',st,a,'late'),null);
 const b=l.begin('x',st);st.agentToken='new';assert.equal(l.accepted('x',st,b,'stale'),null);l.cancel('x');assert.equal(l.turns.get(b).status,'cancelled');
});
test('valid zero numbers survive defaults; invalid numeric configuration fails closed',()=>{
 for(const n of [0,'0'])assert.equal(numberSetting(n,300000),0);assert.equal(numberSetting(undefined,300),300);for(const n of ['',NaN,Infinity,-1,'invalid',false])assert.throws(()=>numberSetting(n,300));
});
test('bridge fixed, length and automatic gap calculations preserve configured zero',()=>{
 const source=fs.readFileSync(new URL('../../integrations/qq-bridge/src/bridge.js',import.meta.url),'utf8'),a=source.indexOf('  function clampGapV2('),b=source.indexOf('  function sendMessagesV2(',a);
 const context={numberSetting,randInt:min=>min};vm.createContext(context);vm.runInContext(source.slice(a,b)+';globalThis.gaps=computeGapsV2',context);
 const cfg={burstIntervalMinMs:0,burstIntervalMaxMs:0,maxGapMs:10000,gapBaseMs:0,gapPerCharMs:0};for(const mode of ['fixed','auto','byLength'])assert.equal(context.gaps(['a','b'],mode,0,undefined,cfg)[0],0);
});
