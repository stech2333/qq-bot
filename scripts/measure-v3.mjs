// Synthetic, offline measurements. No model requests, QQ delivery or production state.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'logs/audit');
fs.mkdirSync(path.join(out,'temp'),{recursive:true});process.env.TEMP=process.env.TMP=path.join(out,'temp');
const require=createRequire(new URL('../integrations/qq-bridge/package.json',import.meta.url)),yaml=require('js-yaml');
const rel='integrations/qq-bridge/dsh/agent-presets/qq-chat-v2/agent.cordis.yml';
const prefix=text=>yaml.load(text).find(r=>r.id==='persona').config.prefix;
const before=prefix(execFileSync('git',['show','2a7a89b:'+rel],{cwd:root,encoding:'utf8'})),after=prefix(fs.readFileSync(path.join(root,rel),'utf8'));
const {fixture,A}=await import('../extensions/bigfatfish/style-test-fixture.mjs'),{classifyScene}=await import('../extensions/bigfatfish/style-resolver.mjs');
const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)});
try{
 await f.mature();const st=f.app.states.get(A),cases=[['真的假的？','casual_chat'],['你又摸鱼了？','casual_chat'],['哈哈哈笑死','casual_banter'],['怎么解决这个报错','help'],['请解释代码原因','help'],['SQL算法','technical'],['晚安，先下了','closing']];
 const timings=[];for(let i=0;i<300;i++){const start=performance.now();f.app.styleResolver.assemble(A,st,{preview:true,query:cases[i%cases.length][0]});timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
 const result={fixture:'synthetic; not a real QQ/DSH/model evaluation',at:new Date().toISOString(),presetPrefixChars:{before:before.length,after:after.length,reductionPercent:+((1-after.length/before.length)*100).toFixed(1)},sceneCases:cases.map(([query,expected])=>({query,expected,actual:classifyScene(query).scene})),assembly:{runs:timings.length,medianMs:+timings[Math.floor(timings.length/2)].toFixed(3),p95Ms:+timings[Math.floor(timings.length*.95)].toFixed(3),evidenceMessages:f.app.learningSources.sample().messages},liveModelCalls:0,tokens:null,limitations:['No tokenizer measurement','No live first-response latency or paid API cost','No claim of improved chat naturalness from synthetic cases']};
 fs.writeFileSync(path.join(out,'v3-measurements.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{for(const fn of cleanup)fn();}
