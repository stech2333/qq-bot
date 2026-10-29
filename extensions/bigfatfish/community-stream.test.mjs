import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import {CommunityStream,completion,createCommunityModel} from './community-model.mjs';
import {poolCredential} from './api-pool.mjs';
import {fixture} from './community-test-fixture.mjs';
const frame=row=>'data: '+JSON.stringify(row)+'\n\n';
const content=text=>frame({choices:[{delta:{content:text}}]});
const usage={prompt_tokens:30,completion_tokens:20,completion_tokens_details:{reasoning_tokens:0}};
const ending=frame({choices:[{delta:{},finish_reason:'stop'}]})+frame({choices:[],usage})+'data: [DONE]\n\n';
test('campus community stages explicitly disable normalized effort; other providers keep native toggle',async()=>{
  for(const host of ['token.nuaa.edu.cn','api.deepseek.com','model.example.org']){
    const entry={id:'a'.repeat(32),enabled:true,keyStored:true,protocol:'openai-completions',model:'deepseek-flash',baseURL:'https://'+host+'/v1',deepseekCompat:true},pool={state:{activeId:entry.id,entries:[entry]}},before=JSON.stringify(pool);
    const model=createCommunityModel({pool,config:{},env:{[poolCredential(entry)]:'fixture'},request:async(_p,b)=>{
      assert.deepEqual(b.thinking,{type:'disabled'});assert.equal(b.reasoning_effort,host==='token.nuaa.edu.cn'?'none':undefined);assert.equal(b.max_tokens,1600);
      return {choices:[{finish_reason:'stop',message:{content:'{"candidates":[]}'}}],usage};
    }});
    for(const stage of ['select','extract','verify']){const result=await model.run({stage,prompt:'{}',maxOutputTokens:1600,signal:new AbortController().signal});assert.equal(result.diagnostics.providerHost,host);assert.equal(result.usage.reasoning,0);}
    assert.equal(JSON.stringify(pool),before);
  }
});
test('failed campus response retains usage, requested mode and safe route diagnostics',async()=>{
  const entry={id:'b'.repeat(32),enabled:true,keyStored:true,protocol:'openai-completions',model:'deepseek-flash',baseURL:'https://token.nuaa.edu.cn/v1',deepseekCompat:true};
  const model=createCommunityModel({pool:{state:{activeId:entry.id,entries:[entry]}},config:{},env:{[poolCredential(entry)]:'fixture-sensitive-key'},request:async()=>({choices:[{finish_reason:'length',message:{content:''}}],usage:{prompt_tokens:9,completion_tokens:1600,completion_tokens_details:{reasoning_tokens:1600}},diagnostics:{rawBytes:450000,contentBytes:0}})});
  await assert.rejects(model.run({stage:'extract',prompt:'private fixture prompt',maxOutputTokens:1600,signal:new AbortController().signal}),e=>{assert.equal(e.modelDiagnostics.requestedThinking,'disabled');assert.equal(e.modelDiagnostics.requestedReasoningEffort,'none');assert.equal(e.modelDiagnostics.usage.reasoning,1600);assert.equal(e.modelDiagnostics.rawBytes,450000);assert.doesNotMatch(JSON.stringify(e.modelDiagnostics),/fixture-sensitive-key|private fixture prompt/);return true;});
});
test('wire overhead above old 256KB limit does not count as content; UTF8 splits and usage survive',()=>{
  const updates=[],s=new CommunityStream(v=>updates.push(v));
  const text=content('{"candidates":[')+Array.from({length:1800},()=>frame({padding:'x'.repeat(150),choices:[{delta:{content:''}}]})).join('')+content('],"label":"中文"}')+ending;
  const bytes=Buffer.from(text);assert.ok(bytes.length>256000);
  for(let i=0;i<bytes.length;i+=3)s.push(bytes.subarray(i,i+3));
  const r=s.end();assert.equal(JSON.parse(r.choices[0].message.content).label,'中文');assert.equal(r.choices[0].finish_reason,'stop');assert.equal(r.usage.completion_tokens,20);assert.equal(r.diagnostics.rawBytes,bytes.length);assert.ok(r.diagnostics.frames>1800);assert.ok(r.diagnostics.contentBytes<100);assert.ok(updates.at(-1).usage);
});
for(const [type,limits,text] of [
  ['transportBytes',{transportBytes:10},content('{}')],
  ['frameBytes',{frameBytes:20},content('{}')],
  ['bufferBytes',{bufferBytes:10},'data: '+ 'x'.repeat(20)],
  ['contentChars',{contentChars:3},content('12345')]
])test('size diagnostic identifies '+type,()=>{
  const s=new CommunityStream(()=>{},{limits});assert.throws(()=>s.push(Buffer.from(text)),e=>e.modelDiagnostics.limitType===type&&e.modelDiagnostics.rawBytes>0);
  s.release();assert.equal(s.buffer,'');assert.equal(s.content,'');assert.deepEqual(s.data,[]);
});
test('multiple frames in one large HTTP chunk are consumed before checking pending buffer',()=>{
  const s=new CommunityStream();s.push(Buffer.from(content('{"candidates":[]}')+':keepalive\n'.repeat(30000)+ending));assert.deepEqual(JSON.parse(s.end().choices[0].message.content),{candidates:[]});
});
function transport(run){let req,res;return {deps:{resolveAddresses:async()=>['127.0.0.1'],request:(_opts,receive)=>{
  req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};req.end=()=>setImmediate(()=>{res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'text/event-stream'};res.destroy=()=>{res.destroyed=true;};receive(res);run(res,req);});return req;
}},state:()=>({req,res})};}
test('transport cancellation destroys request and response without later settlement',async()=>{
  const c=new AbortController(),fake=transport(res=>{res.emit('data',Buffer.from(content('{')));c.abort();res.emit('end');});
  await assert.rejects(completion({baseURL:'https://test.example',key:'fixture'},{max_tokens:1600},c.signal,()=>{},fake.deps),/已取消/);assert.ok(fake.state().req.destroyed);assert.ok(fake.state().res.destroyed);
});
test('transport failure retains safe size diagnostics and observed usage',async()=>{
  const observed=[],fake=transport(res=>{res.emit('data',Buffer.from(frame({choices:[],usage})));res.emit('data',Buffer.from('x'.repeat(66000)));res.emit('end');});
  await assert.rejects(completion({baseURL:'https://test.example',key:'fixture'},{max_tokens:1600},new AbortController().signal,v=>observed.push(v),fake.deps),e=>e.modelDiagnostics.limitType==='bufferBytes'&&e.modelDiagnostics.usage.output===20);assert.ok(fake.state().req.destroyed);assert.ok(observed.at(-1).usage);
});
test('extract parses SSE JSON and all stages disable thinking',async()=>{
  const fake=transport(res=>{res.emit('data',Buffer.from(content('{"candidates":[]}')+ending));res.emit('end');});
  const model=createCommunityModel({config:{},env:{DEEPSEEK_API_KEY:'fixture'},request:async(p,b,s,u)=>{assert.deepEqual(b.thinking,{type:'disabled'});assert.equal(b.reasoning_effort,undefined);return completion(p,b,s,u,fake.deps);}});
  for(const stage of ['select','extract','verify']){const r=await model.run({stage,prompt:'{}',maxOutputTokens:1600,signal:new AbortController().signal});assert.deepEqual(JSON.parse(r.text),{candidates:[]});assert.equal(r.usage.reasoning,0);}
});
for(const known of [true,false])test('size failure keeps '+(known?'measured usage without double settlement':'unknown reservation'),async t=>{
  const f=fixture(t);f.setup();const original=f.model.run;
  f.model.run=async req=>{if(req.stage!=='extract')return original(req);if(known)req.onUsage({usage:{input:30,output:20,reasoning:0,cacheHit:0}});const s=new CommunityStream();try{s.push(Buffer.from('x'.repeat(66000)));}catch(e){e.modelDiagnostics.stage='extract';throw e;}};
  await f.run();const db=f.app.community.store,u=db.usage();assert.equal(u.reserved,known?0:1);assert.equal(db.stats().published,0);assert.ok(db.pending('synthetic',32,Date.now()+600000).some(r=>r.reading));
  const log=db.logs().find(r=>r.code==='MODEL_FAILED');assert.equal(log.data.limitType,'bufferBytes');assert.equal(log.data.stage,'extract');assert.equal(u.confirmed.output,known?80:60);
});
test('log cleaning preserves false booleans and display omits absent values',t=>{
  const f=fixture(t);f.setup();const db=f.app.community.store;db.log({code:'FLAGS',message:'fixture',data:{validJson:false,complete:null,checkpointSaved:true}});assert.equal(db.logs()[0].data.validJson,false);assert.equal(db.logs()[0].data.checkpointSaved,true);
  assert.match(fs.readFileSync(new URL('./console-community.js',import.meta.url),'utf8'),/names\[k\]&&v!==null&&v!==undefined/);
});
test('log DOM omits null labels while retaining explicit false',()=>{
  class Node {constructor(){this.children=[];this.value='';}set textContent(v){this.value=v;}get textContent(){return this.value+this.children.map(n=>n.textContent).join('');}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}}
  const box=new Node(),source=fs.readFileSync(new URL('./console-community.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('  function renderLogs('),source.indexOf('  function fillSource('));
  const context=vm.createContext({logRows:[],states:{},el:()=>box,safeBiliUrl:()=>'',document:{createElement:()=>new Node()},line:(b,t)=>{const n=new Node();n.textContent=t;b.append(n);return n;}});
  vm.runInContext(fn+';renderLogs([{id:1,at:1,level:"warn",message:"fixture",data:{validJson:null,complete:false,checkpointSaved:null}}]);',context);
  assert.doesNotMatch(box.textContent,/JSON有效|检查点已保存|:null/);assert.match(box.textContent,/完整读取:false/);
});
