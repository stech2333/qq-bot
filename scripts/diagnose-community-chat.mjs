// Read-only production snapshot; previews run in isolation, with no model or QQ traffic.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { BigFatFish } from '../extensions/bigfatfish/runtime.mjs';
import { CommunityStore, searchTerms } from '../extensions/bigfatfish/community-store.mjs';
import { knowledgeAllowed } from '../extensions/bigfatfish/community-adapters.mjs';
import { retrievalWords, conceptKey } from '../extensions/bigfatfish/community-retrieval.mjs';

const root=path.resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||'integrations/qq-bridge');
const output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'.tmp/community-application-verification');
fs.mkdirSync(output,{recursive:true});
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bff-community-application-'));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'state',name),'utf8'));
const protectedFiles=['bigfatfish-settings.json','slang.json','global-style-v3.json','current-role.json'];
const hashes=()=>Object.fromEntries(protectedFiles.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,'state',name))).digest('hex')]));
const before=hashes();let app;
try {
  fs.mkdirSync(path.join(temporary,'state'));
  const live=new DatabaseSync(path.join(root,'state/community.sqlite'),{readOnly:true});
  live.prepare('VACUUM INTO ?').run(path.join(temporary,'state/community.sqlite'));live.close();
  for(const name of ['bigfatfish-settings.json','global-style-v3.json','slang.json'])fs.copyFileSync(path.join(root,'state',name),path.join(temporary,'state',name));
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  const key='group:'+cfg.allow.groups.find(id=>!(cfg.deny?.groups||[]).map(String).includes(String(id)));
  if(!/^group:[1-9]\d{4,15}$/.test(key))throw Error('没有已授权真实群会话');
  app=new BigFatFish(temporary,{bigfatfish:{expectedQQ:cfg.bigfatfish.expectedQQ},allow:cfg.allow,deny:cfg.deny});
  app.community.options.autoSchedule=false;
  const native=read('slang.json');app.slang.entries=()=>native;
  const db=app.community.readStore();
  const published=db.db.prepare("SELECT * FROM knowledge WHERE status='published' ORDER BY at,id").all().map(r=>({...JSON.parse(r.data),status:r.status}));
  const usable=k=>(!k.validUntil||k.validUntil>Date.now())&&db.db.prepare('SELECT source,document,fingerprint FROM evidence WHERE knowledge=?').all(k.id).some(e=>knowledgeAllowed(db.source(e.source))&&db.evidenceLive(e));
  const sampleCounts={},samples=['knowledge','slang','meme','culture'].flatMap(kind=>{const rows=published.filter(k=>k.kind===kind&&usable(k));sampleCounts[kind]={available:rows.length,chosen:Math.min(2,rows.length)};return rows.slice(0,2);});
  const role=read('current-role.json').role;
  if(!/^[\w\u4e00-\u9fff-]+$/.test(role))throw Error('角色路径无效');
  const persona=fs.readFileSync(path.join(root,'roles',role+'.md'),'utf8');
  const preview=(query,expected=null)=>{
    const st={recentMessages:[],unread:[{plain:query,isSelf:false}],activeTopics:[],pendingThoughts:[]};app.bind(key,st);
    const prompt=app.instruction(key,st,{persona});const d=app.styleResolver.diagnostics.get(key);
    const selected=[...st.bffKnowledgeSelections,...app.styleResolver.resolve(key,st,{query,preview:true}).contextualKnowledge];
    const included=selected.filter(({id,term,meaning,usage})=>prompt.includes(JSON.stringify({id,term,meaning,usage})));
    return {query,expected:expected?.term||null,originalExists:expected?published.some(k=>k.id===expected.id):null,sourceValid:expected?usable(expected):null,
      retrieved:expected?app.community.retrieve(query,{key}).some(k=>conceptKey(k.term)===conceptKey(expected.term)):null,
      exactRecordRetrieved:expected?app.community.retrieve(query,{key}).some(k=>k.id===expected.id):null,
      selected:expected?selected.some(k=>conceptKey(k.term)===conceptKey(expected.term)):null,inPrompt:expected?included.some(k=>conceptKey(k.term)===conceptKey(expected.term)):null,
      memory:st.bffKnowledgeSelections.map(k=>k.term),contextual:app.styleResolver.resolve(key,st,{query,preview:true}).contextualKnowledge.map(k=>k.term),
      promptKnowledge:included.map(k=>k.term),globalStyleExpressionIds:d.globalStyleExpressionIds,
      modelUsed:null,semanticCorrect:null,inappropriateModelUse:null,verification:'offline-retrieval-and-prompt',diagnostics:d};
  };
  const explicit=samples.map(k=>preview(k.term+'是什么意思？',k));
  // Original FTS audit establishes real false negatives rather than relaxing filters speculatively.
  const oldFtsMisses=[];
  const allExact=published.filter(k=>k.kind!=='strategy'&&usable(k)).map(k=>{
    const query=k.term+'是什么意思？',terms=[...new Set([...searchTerms(query),...retrievalWords(query).flatMap(searchTerms)])].slice(0,100);
    const old=terms.length?db.db.prepare('SELECT id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts) LIMIT 40').all(terms.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ')):[];
    if(!old.some(r=>r.id===k.id))oldFtsMisses.push(k.term);
    const result=app.community.retrieve(query,{key});
    return {term:k.term,kind:k.kind,retrieved:result.some(r=>conceptKey(r.term)===conceptKey(k.term)),exactRecordRetrieved:result.some(r=>r.id===k.id)};
  });
  const activeCases=[['哈哈，现实生活的难度又升级了，像在打游戏副本','地球online'],['对面残血了，队友这波技能应该能直接秒杀，哈哈','斩杀线']];
  const active=activeCases.filter(([,term])=>published.some(k=>k.term===term)).map(([query,term])=>preview(query,published.find(k=>k.term===term)));
  const serious=preview('请帮我准确解释数据库事务失败时如何恢复数据，别玩梗');
  const status=app.community.diagnosticsView(key);
  const report={sampledAt:new Date().toISOString(),kind:'offline-retrieval-and-prompt',modelCalls:0,qqSends:0,status,
    sources:db.sources().map(s=>({id:s.id,platform:s.platform,enabled:s.enabled,allowUse:s.allowUse,licenseValidForChat:knowledgeAllowed(s)})),
    sampleCounts,explicit,active,serious,oldFtsMisses,allExact,
    exactRecall:{hit:allExact.filter(r=>r.retrieved).length,total:allExact.length},protectedFilesUnchanged:JSON.stringify(before)===JSON.stringify(hashes()),
    modelVerification:'未调用模型；实际回复使用、语义正确性和自然度未核验。未进行实际QQ发送。'};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
  const cell=x=>String(x??'未核验').replaceAll('|','\\|');
  const table=rows=>'|输入|期望词条|来源有效|检索命中|选入Prompt|contextual|\n|---|---|---|---|---|---|\n'+rows.map(r=>`|${cell(r.query)}|${cell(r.expected)}|${cell(r.sourceValid)}|${cell(r.retrieved)}|${cell(r.inPrompt)}|${r.contextual.map(cell).join('、')||'无'}|`).join('\n');
  fs.writeFileSync(path.join(output,'report.md'),`# 社区知识应用离线验收\n\n采样时间：${report.sampledAt}。真实会话：${key}。使用生产库只读一致性快照；未修改生产配置、知识、人格卡或学习启停状态。\n\n原生正式黑话 ${status.nativeSlangCount}；全局风格版本 ${status.globalStyleVersion}、已批准表达 ${status.globalStyleExpressionCount}。社区状态：\n\n\`\`\`json\n${JSON.stringify(status.community,null,2)}\n\`\`\`\n\n## 显式解释\n\n${table(explicit)}\n\n## 主动表达\n\n${table(active)}\n\n## 严肃问题\n\n${table([serious])}\n\n正式知识精确召回：${report.exactRecall.hit}/${report.exactRecall.total}（排除 strategy）。原 FTS 候选漏项：${oldFtsMisses.join('、')||'无'}。各类型真实样本数：${JSON.stringify(sampleCounts)}。\n\n模型调用0、QQ发送0。${report.modelVerification} 严肃问题 contextual ${serious.contextual.length} 条。受保护文件哈希不变：${report.protectedFilesUnchanged}。\n`);
  console.log(JSON.stringify({output,native:status.nativeSlangCount,community:status.community,exactRecall:report.exactRecall,oldFtsMisses,explicit:explicit.map(r=>({term:r.expected,inPrompt:r.inPrompt})),active:active.map(r=>({term:r.expected,inPrompt:r.inPrompt,contextual:r.contextual})),seriousContextual:serious.contextual,protectedFilesUnchanged:report.protectedFilesUnchanged}));
} finally {
  app?.community.close();app?.community.store?.close();
  // Delete only the exact temporary directory created by this script.
  const resolved=path.resolve(temporary),base=path.resolve(os.tmpdir())+path.sep;
  if(resolved.startsWith(base)&&path.basename(resolved).startsWith('bff-community-application-'))fs.rmSync(resolved,{recursive:true,force:true});
}
