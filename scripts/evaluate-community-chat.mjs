// Offline first. --real opts into at most three pairs, charged to existing community budgets.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { BigFatFish } from '../extensions/bigfatfish/runtime.mjs';
import { CommunityStore } from '../extensions/bigfatfish/community-store.mjs';
import { ApiPool } from '../extensions/bigfatfish/api-pool.mjs';
import { communityModelProfile, completion, providerUsage } from '../extensions/bigfatfish/community-model.mjs';
import { conceptKey, expressionKey } from '../extensions/bigfatfish/community-retrieval.mjs';
import { literalUse } from '../extensions/bigfatfish/expression-retrieval.mjs';

export const SCENARIOS=[
  ['explicit-lost','失传媒体是什么意思？',['失传媒体']],
  ['explicit-ugc','UGC是什么意思？',['UGC']],
  ['explicit-pgc','PGC和普通投稿有什么区别？',['PGC']],
  ['explicit-gateway','默认网关有什么用？',['默认网关']],
  ['explicit-bubble','信息茧房是什么？',['信息茧房']],
  ['explicit-office','人员优化是什么意思？',['人员优化']],
  ['explicit-world','地球online这个梗什么意思？',['地球online']],
  ['explicit-signature','签名档是啥？',['签名档']],
  ['natural-archive','找不到的旧动画和下架视频，还有人一起找回吗？',['失传媒体','失传媒体社区']],
  ['natural-ugc','用户自己上传和创作的视频投稿叫什么？',['UGC']],
  ['natural-gateway','访问其他子网时，数据包应该交给谁转发？',['默认网关']],
  ['natural-subnet','两台电脑是否在同一子网，该如何判断？',['子网掩码判断同一子网']],
  ['alias-lost','Lost Media有人专门搜集吗？',['失传媒体']],
  ['alias-persona','persona在陪聊行业中是什么意思？',['人设（persona）']],
  ['context-signature','早年论坛回复底下自动带的个性图片叫啥？',['签名档']],
  ['active-world','哈哈，现实生活的难度又升级了，像在打游戏副本',[],['地球online']],
  ['active-work','上班刷完日常副本，回家还有一堆生活任务，笑死',[],['地球online']],
  ['active-life','人生这游戏的新手村任务也太多了吧',[],['地球online']],
  ['casual-food','今天晚饭吃面还是米饭？',[]],
  ['serious-job','我被裁员了，房租交不上，认真帮我想想办法',[],[],true],
  ['support','朋友去世了，我现在很难受',[],[],true],
  ['closing','晚安，不聊了，先下了',[],[],true],
  ['technical','请帮我定位这个SQL报错，准确解释原因',[],[],true],
  ['polysemy','河里捞鱼需要多大的网？',[]],
  ['explicit-no-memes','这次别玩梗，请认真回答工作安排',[],[],true],
  ['repeat-world','哈哈，现实生活的难度又升级了，像在打游戏副本',[],[],false,true]
].map(([id,query,expected=[],activeExpected=[],suppress=false,repeat=false])=>({id,query,expected,activeExpected,suppress,repeat}));
const KEY='group:999991';
const canonical=k=>conceptKey(typeof k==='string'?k:k.term);
const matches=(rows,terms)=>rows.some(k=>terms.some(t=>canonical(k)===canonical(t)));
export function buildVariant(app,scenario,persona,{enhanced=true,repeat=[]}={}) {
  const st={agentToken:randomUUID(),recentMessages:[{messageId:'synthetic-history',plain:'今天随便聊聊，有事直接说。',isSelf:false}],unread:[{messageId:'synthetic-current',plain:scenario.query,isSelf:false}],activeTopics:[],pendingThoughts:[]};
  app.bind(KEY,st);if(scenario.repeat)st.bigfatfish.expressionUse.recent=repeat;
  const previous=app.settings.communityLearning.applyKnowledge;app.settings.communityLearning.applyKnowledge=enhanced;
  try {const memory=app.formatMemory(st),r=app.styleResolver.assemble(KEY,st,{persona,query:scenario.query,memory,behavior:'你正在QQ聊天。只回答当前消息，不调用工具；是否使用表达参考由当前语境和角色决定。',preview:true});
    const knowledge=st.bffKnowledgeSelections||[],active=r.resolved.contextualKnowledge;
    return {instruction:r.instruction,knowledge,active,hits:st.bffKnowledgeHits+r.resolved.knowledgeHits,promptBytes:Buffer.byteLength(r.instruction),promptChars:r.instruction.length};
  }finally{app.settings.communityLearning.applyKnowledge=previous;}
}
export function evaluateOffline(app,persona,scenarios=SCENARIOS) {
  let repeat=[];const rows=scenarios.map(s=>{const baseline=buildVariant(app,s,persona,{enhanced:false,repeat}),enhanced=buildVariant(app,s,persona,{repeat});
    if(s.id==='active-world')repeat=enhanced.active.map(k=>({id:expressionKey(k),at:Date.now()}));
    return {id:s.id,query:s.query,expected:s.expected,activeExpected:s.activeExpected,suppress:s.suppress,repeat:s.repeat,
      baseline:{knowledge:baseline.knowledge.map(k=>k.term),active:baseline.active.map(k=>k.term),promptChars:baseline.promptChars,promptBytes:baseline.promptBytes},
      enhanced:{knowledge:enhanced.knowledge.map(k=>k.term),active:enhanced.active.map(k=>k.term),promptChars:enhanced.promptChars,promptBytes:enhanced.promptBytes},
      recalled:matches([...enhanced.knowledge,...enhanced.active],s.expected),activeSelected:matches(enhanced.active,s.activeExpected),unexpectedActive:s.suppress&&enhanced.active.length>0};});
  const count=pred=>rows.filter(pred).length;
  return {kind:'offline-retrieval-and-prompt-only',scenarios:rows.length,modelCalls:0,
    metrics:{recall:{numerator:count(r=>r.expected.length&&r.recalled),denominator:count(r=>r.expected.length)},activeSelection:{numerator:count(r=>r.activeExpected.length&&r.activeSelected),denominator:count(r=>r.activeExpected.length)},inappropriateSelection:{numerator:count(r=>r.unexpectedActive),denominator:count(r=>r.suppress)},repeatSelection:{numerator:count(r=>r.repeat&&r.enhanced.active.length>0),denominator:count(r=>r.repeat)},correctUse:null,actualActiveUse:null,taskCompletion:null,actualTokens:null,judgment:'离线只检查真实检索与提示，未生成回复；语义正确性、自然度和任务完成率待人工评价'},rows};
}
export async function evaluateReal({app,persona,liveRoot,config,scenarios=SCENARIOS,output}) {
  const policy=app.settings.communityLearning,pool=new ApiPool(liveRoot),profile=communityModelProfile(pool,config,process.env,undefined,'follow-chat');
  const store=new CommunityStore(liveRoot),job={id:randomUUID(),session:randomUUID(),model:profile.model,status:'EXTRACTING',version:1,at:Date.now(),ownerPid:process.pid,deadline:Date.now()+6*65000};
  const rows=[];let cost=0;
  try {
    store.saveJob(job);
    for(const id of ['explicit-signature','active-world','serious-job']){
      const scenario=scenarios.find(s=>s.id===id);if(!scenario)continue;
      for(const enhanced of [false,true]){
        const variant=buildVariant(app,scenario,persona,{enhanced}),messages=[{role:'system',content:variant.instruction},{role:'user',content:scenario.query}];
        const input=Buffer.byteLength(JSON.stringify(messages))+512,maxOutput=256,rates={input:policy.inputPriceCeiling,output:policy.outputPriceCeiling};
        if(!rates.input||!rates.output)throw Error('缺少现有费率上界，未执行真实对照');
        const upper=(input*rates.input+maxOutput*rates.output)/1e6;if(cost+upper>.05)throw Error('对照额外费用上限0.05已触发');
        const reservation=store.reserve(job,'chat-ab',input,maxOutput,rates,{...policy,sessionCostLimit:policy.sessionCostLimit===null ? .05 : Math.min(.05,policy.sessionCostLimit)});cost+=upper;
        const row={id,variant:enhanced?'enhanced':'baseline',query:scenario.query,knowledge:variant.knowledge.map(k=>k.term),active:variant.active.map(k=>k.term),model:profile.model};
        try {
          const body={model:profile.model,messages,max_tokens:maxOutput,temperature:.3,stream:true,stream_options:{include_usage:true},...(profile.deepseekCompat?{thinking:{type:'disabled'}}:{})};
          if(profile.deepseekCompat&&new URL(profile.baseURL).hostname==='token.nuaa.edu.cn')body.reasoning_effort='none';
          const result=await completion(profile,body,AbortSignal.timeout(60000),v=>store.progress(reservation,v)),usage=providerUsage(result.usage);
          if(usage)store.progress(reservation,{usage});
          const choice=result.choices?.[0];store.settle(reservation,usage);store.finishRequest(reservation,'COMPLETED');
          row.text=choice?.message?.content||'';row.finishReason=choice?.finish_reason;row.usage=usage;row.literalObserved=variant.active.filter(k=>literalUse(row.text,k)).map(k=>k.term);row.semanticJudgment='待人工复核';
          if(choice?.finish_reason!=='stop'||choice?.message?.tool_calls?.length)row.error='非正常结束，不计任务完成';
        }catch(e){if(e.modelDiagnostics?.usage)store.progress(reservation,{usage:e.modelDiagnostics.usage});const saved=JSON.parse(store.db.prepare('SELECT data FROM usage WHERE id=?').get(reservation.id).data);if(saved.status==='reserved'&&saved.observed?.usage)store.settle(reservation,saved.observed.usage);store.finishRequest(reservation,'FAILED');row.error=String(e.message).slice(0,150);rows.push(row);throw e;}
        rows.push(row);if(output)fs.writeFileSync(output,JSON.stringify({rows,costReservedUpperBound:cost},null,2));
      }
    }
    job.status='COMPLETED';return {kind:'real-model-with-synthetic-chat-no-qq-send',model:profile.model,calls:rows.length,costReservedUpperBound:cost,rows,correctUse:null,taskCompletion:null,judgment:'字面出现不等于语义正确；正确性与自然度待人工复核'};
  } catch(e){job.status='PAUSED';return {kind:'partial-real-model-evaluation',calls:rows.length,error:String(e.message).slice(0,160),rows};}
  finally{job.version++;job.completedAt=Date.now();job.finished=true;store.saveJob(job);store.close();}
}
export async function main(args=process.argv.slice(2)) {
  const root=path.resolve(args.find(a=>a.startsWith('--root='))?.slice(7)||'integrations/qq-bridge'),output=path.resolve(args.find(a=>a.startsWith('--output='))?.slice(9)||'.tmp/community-chat-evaluation');
  fs.mkdirSync(output,{recursive:true});const snapshot=path.join(output,'community-baseline.sqlite');if(fs.existsSync(snapshot))throw Error('输出目录已有快照，请选择新目录以保存前次结果');
  const db=new DatabaseSync(path.join(root,'state/community.sqlite'),{readOnly:true});
  const production={materials:db.prepare('SELECT count(*) n FROM material_queue').get().n,published:db.prepare("SELECT count(*) n FROM knowledge WHERE status='published'").get().n,pending:db.prepare("SELECT count(*) n FROM candidates WHERE status='pending'").get().n};
  db.prepare('VACUUM INTO ?').run(snapshot);db.close();
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bff-community-ab-'));let app;
  try {
    fs.mkdirSync(path.join(temporary,'state'));fs.copyFileSync(snapshot,path.join(temporary,'state/community.sqlite'));
    const settings=JSON.parse(fs.readFileSync(path.join(root,'state/bigfatfish-settings.json'),'utf8'));settings.communityLearning.enabled=false;fs.writeFileSync(path.join(temporary,'state/bigfatfish-settings.json'),JSON.stringify(settings));
    const role=JSON.parse(fs.readFileSync(path.join(root,'state/current-role.json'),'utf8')).role;if(!/^[\w\u4e00-\u9fff-]+$/.test(role))throw Error('当前角色路径无效');
    const persona=fs.readFileSync(path.join(root,'roles',role+'.md'),'utf8'),config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
    app=new BigFatFish(temporary,{bigfatfish:{expectedQQ:'987654321'},allow:{groups:['999991'],private:[]},deny:{groups:[],private:[]}});app.community.options.autoSchedule=false;
    const report={at:new Date().toISOString(),productionBaseline:production,persona:role,offline:evaluateOffline(app,persona)};
    if(args.includes('--real')){try{report.real=await evaluateReal({app,persona,liveRoot:root,config,output:path.join(output,'real-progress.json')});}catch(e){report.real={calls:0,error:String(e.message).slice(0,160),rows:[]};}}
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
    const metric=(n,d)=>`${n}/${d}`;const o=report.offline;
    const md=`# 社区聊天对照评估\n\n生产存量：${production.published} 条知识、${production.pending} 条待验证、${production.materials} 条材料。测试使用 SQLite 一致性快照及合成对话，不写入生产知识，不发送 QQ 消息。\n\n角色：${role}。两组使用相同角色、历史和输入，Baseline 关闭社区资料，Enhanced 使用真实本地检索。\n\n离线知识召回：${metric(o.metrics.recall.numerator,o.metrics.recall.denominator)}；主动表达选择覆盖：${metric(o.metrics.activeSelection.numerator,o.metrics.activeSelection.denominator)}；不适当场景选择：${metric(o.metrics.inappropriateSelection.numerator,o.metrics.inappropriateSelection.denominator)}；短时重复推荐：${metric(o.metrics.repeatSelection.numerator,o.metrics.repeatSelection.denominator)}。离线模型调用 0，语义正确使用率、实际主动使用率、任务完成率和实际 Token 均不可由离线检索推断。\n\n|案例|输入|Baseline资料|Enhanced知识|Enhanced主动表达|提示字符差|\n|---|---|---|---|---|---|\n`+o.rows.map(r=>`|${r.id}|${r.query}|${r.baseline.knowledge.join('、')||'无'}|${r.enhanced.knowledge.join('、')||'无'}|${r.enhanced.active.join('、')||'无'}|${r.enhanced.promptChars-r.baseline.promptChars}|`).join('\n')+'\n\n## 真实模型对照\n\n'+(report.real?`调用 ${report.real.calls} 次。${report.real.error||report.real.judgment||''}\n\n`+report.real.rows.map(r=>`### ${r.id} / ${r.variant}\n\n输入：${r.query}\n\n回复：${r.text||r.error}\n\n实际 usage：${r.usage?JSON.stringify(r.usage):'未知，保留费用预留'}；主动表达字面出现：${r.literalObserved?.join('、')||'无'}。语义与自然度：待人工复核。\n`).join('\n'):'未执行真实模型调用。\n');
    fs.writeFileSync(path.join(output,'report.md'),md);console.log(JSON.stringify({output,production,offline:o.metrics,real:report.real?{calls:report.real.calls,error:report.real.error}:undefined}));return report;
  }finally{app?.community.close();app?.community.store?.close();fs.rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
