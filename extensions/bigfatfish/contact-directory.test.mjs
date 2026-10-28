import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './style-test-fixture.mjs';
import {ContactDirectory} from './contact-directory.mjs';

test('directory fetches the joined groups and friends, preserves IDs/names, and caches duplicate reads',async t=>{
  const f=fixture(t),directory=new ContactDirectory(f.app),calls=[];
  const hooks={gatewayQQ:()=>f.config.bigfatfish.expectedQQ,request:async action=>{calls.push(action);return{retcode:0,data:action==='get_group_list'?[{group_id:123456,group_name:'测试群'},{group_id:'bad',group_name:'无效'}]:[{user_id:333333,nickname:'昵称',remark:'好友备注'}]};}};
  const [a,b]=await Promise.all([directory.view(hooks),directory.view(hooks)]);
  assert.deepEqual(calls.sort(),['get_friend_list','get_group_list']);assert.equal(a.groups[0].id,'123456');assert.equal(a.groups[0].name,'测试群');assert.equal(a.groups[0].enabled,true);assert.equal(a.friends[0].name,'好友备注');assert.deepEqual(a,b);
});
test('unverified QQ never fetches directories; unavailable lists retain configured choices without inventing contacts',async t=>{
  const f=fixture(t),directory=new ContactDirectory(f.app);let calls=0;
  const a=await directory.view({gatewayQQ:()=>'',request:async()=>{calls++;}});assert.equal(calls,0);assert.equal(a.verified,false);assert.ok(a.groups.some(r=>r.id==='123456'&&!r.available));
  const b=await directory.view({gatewayQQ:()=>f.config.bigfatfish.expectedQQ,request:async()=>{throw Error('unavailable');}});assert.equal(b.errors.length,2);assert.ok(b.groups.some(r=>r.id==='123456'));
});
test('agent credentials cannot read contacts or trigger account directory requests',async t=>{
  const f=fixture(t);let status,calls=0;
  for(const headers of [{'x-agent-token':'agent'},{'x-agent-call':'1'}]){await f.app.handle({method:'GET',headers},new URL('http://localhost/api/bigfatfish/contacts'),async()=>({}),(_r,c)=>{status=c;},{gatewayQQ:()=>f.config.bigfatfish.expectedQQ,request:()=>{calls++;}});assert.equal(status,403);}
  assert.equal(calls,0);
});
