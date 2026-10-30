// A/B evaluation uses a consistent production snapshot. No model or QQ messages are sent.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { BigFatFish } from '../extensions/bigfatfish/runtime.mjs';
import { expressionKey, expressionConceptKey } from '../extensions/bigfatfish/community-retrieval.mjs';

const root=path.resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||'integrations/qq-bridge');
const output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'.tmp/unified-expression-evaluation');
fs.mkdirSync(output,{recursive:true});const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bff-unified-preview-'));let app;
const scenarios=[
  {id:'game-failure',query:'排位又输了，刚被淘汰评论区就开始集火选手，笑死'},
  {id:'daily-complaint',query:'今天上班又加班到半夜，吐槽一下，这点工资真遭不住'},
  {id:'study-pressure',query:'复习视频看了三遍还是没听懂，笑死，脑子跟不上'},
  {id:'entertainment',query:'刷到一只猫咪的搞笑表情包，猫猫也太可爱了哈哈'},
  {id:'internet-culture',query:'有人在贴吧整天灌水刷帖，论坛升级也太拼了哈哈'},
  {id:'light-banter',query:'这期视频封面画得特别刺激，点进去内容却完全不符，笑死'},
  {id:'multi-turn',history:['我在看这段课程的讲解视频，符号怎么越学越多'],query:'哈哈我还是完全没听懂，脑子要放弃了'},
  {id:'serious-technical',query:'请帮我准确定位SQL事务回滚时的报错，给出清晰步骤',suppress:true},
  {id:'no-memes',query:'今天上班任务很多，但别玩梗，请认真帮我分析安排',suppress:true},
  {id:'closing',query:'晚安，不聊了，先下了',suppress:true},
  {id:'unrelated-history',history:['今天上班任务好多，笑死'],query:'窗外那棵树今年长得真高'},
];
try{
  fs.mkdirSync(path.join(temporary,'state'));const live=new DatabaseSync(path.join(root,'state/community.sqlite'),{readOnly:true});live.prepare('VACUUM INTO ?').run(path.join(temporary,'state/community.sqlite'));live.close();
  for(const name of ['bigfatfish-settings.json','global-style-v3.json','slang.json','slang.json.deleted.json'])if(fs.existsSync(path.join(root,'state',name)))fs.copyFileSync(path.join(root,'state',name),path.join(temporary,'state',name));
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')),key='group:'+config.allow.groups.find(id=>!config.deny.groups.map(String).includes(String(id)));
  const role=JSON.parse(fs.readFileSync(path.join(root,'state/current-role.json'),'utf8')).role;if(!/^[\w\u4e00-\u9fff-]+$/.test(role))throw Error('角色路径无效');
  const persona=fs.readFileSync(path.join(root,'roles',role+'.md'),'utf8');
  app=new BigFatFish(temporary,{bigfatfish:{expectedQQ:config.bigfatfish.expectedQQ},allow:config.allow,deny:config.deny});app.community.options.autoSchedule=false;app.slang.connectUnified();
  function variant(s,enhanced,recent=[]){
    const st={recentMessages:(s.history||[]).map(plain=>({plain,isSelf:false})),unread:[{plain:s.query,isSelf:false}],activeTopics:[],pendingThoughts:[]};app.bind(key,st);st.bigfatfish.expressionUse.recent=recent;
    const prompt=app.instruction(key,st,{persona,expressionEnabled:enhanced}),d=app.styleResolver.diagnostics.get(key),r=app.styleResolver.resolve(key,st,{preview:true,expressionEnabled:enhanced});
    const candidates=r.contextualKnowledge;
    return {candidates:candidates.map(k=>({id:k.id,term:k.term,meaning:k.meaning,usage:k.usage,usageScenes:k.usageScenes,sourceValid:true})),
      promptContains:candidates.map(({id,term,meaning,usage})=>({term,inPrompt:prompt.includes(JSON.stringify({id,term,meaning,usage}))})),
      chars:prompt.length,bytes:Buffer.byteLength(prompt),tokens:null,reply:null,semanticCorrect:null,taskCompleted:null,
      globalStyleVersion:d.globalStyleVersion,diagnostics:d};
  }
  const rows=scenarios.map(s=>({id:s.id,query:s.query,history:s.history||[],suppress:!!s.suppress,baseline:variant(s,false),enhanced:variant(s,true)}));
  const original=rows.find(r=>r.id==='daily-complaint'),last=original.enhanced.candidates.flatMap(k=>[{id:expressionKey(k),at:Date.now()},{id:expressionConceptKey(k),at:Date.now()}]);
  const repeated={id:'cooldown-repeated',query:original.query,simulatedRecentSelection:true,baseline:variant({query:original.query},false,last),enhanced:variant({query:original.query},true,last)};rows.push(repeated);
  const casual=rows.filter(r=>!r.suppress&&!r.simulatedRecentSelection&&r.id!=='unrelated-history'),serious=rows.filter(r=>r.suppress);
  const report={at:new Date().toISOString(),verification:'offline-retrieval-and-final-instruction',modelCalls:0,qqSends:0,persona:role,migration:app.slang.unified.migration,
    application:app.community.applicationView(key),rows,metrics:{activeSelectionCoverage:{selected:casual.filter(r=>r.enhanced.candidates.length).length,total:casual.length},
      inappropriateCandidateSelection:{selected:serious.filter(r=>r.enhanced.candidates.length).length,total:serious.length},repeatSelection:repeated.enhanced.candidates.length,
      semanticCorrectRate:null,inappropriateModelUseRate:null,modelRepetitionRate:null,taskCompletionRate:null,extraTokens:null,
      extraPromptChars:rows.reduce((n,r)=>n+r.enhanced.chars-r.baseline.chars,0),extraPromptBytes:rows.reduce((n,r)=>n+r.enhanced.bytes-r.baseline.bytes,0)},
    limitations:'模型回复、语义正确率、实际不恰当玩梗比例、任务完成率与实际Token均未测量。候选选择不等于模型采用，增加用梗数量不代表质量更高。'};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
  const table='|场景|输入|Baseline候选|Enhanced候选|均进入Prompt|额外字符|\n|---|---|---|---|---|---|\n'+rows.map(r=>`|${r.id}|${r.query}|${r.baseline.candidates.map(k=>k.term).join('、')||'无'}|${r.enhanced.candidates.map(k=>k.term).join('、')||'无'}|${r.enhanced.promptContains.every(k=>k.inPrompt)}|${r.enhanced.chars-r.baseline.chars}|`).join('\n');
  fs.writeFileSync(path.join(output,'report.md'),`# 统一知识日常表达 A/B 离线验收\n\n${report.at}。当前人格：${role}，两组使用相同人格和历史。Baseline仅关闭主动表达候选，Enhanced开启；临时一致性快照，生产数据不变。\n\n${table}\n\n\`\`\`json\n${JSON.stringify(report.metrics,null,2)}\n\`\`\`\n\n${report.limitations}\n\n冷却案例仅模拟此前已选择素材的时间记录，不是实际QQ投递。没有在真实QQ群发送测试消息。\n`);
  console.log(JSON.stringify({output,migration:report.migration,application:report.application,metrics:report.metrics,cases:rows.map(r=>({id:r.id,terms:r.enhanced.candidates.map(k=>k.term)}))}));
}finally{app?.community.close();app?.community.store?.close();const resolved=path.resolve(temporary);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('bff-unified-preview-'))fs.rmSync(resolved,{recursive:true,force:true});}
