// Local lexical/scene helpers, shared by learning and chat. No model or network calls.
import { memoryTerms } from './memory-recall.mjs';
import { createHash } from 'node:crypto';
export const normalized = text => String(text||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function containsTerm(text,term) {const n=normalized(text),t=normalized(term);return /^[a-z0-9 ]+$/i.test(t)?new RegExp('(?:^|[^a-z0-9])'+t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(n):n.includes(t);}
const ALIASES=[['失传媒体','lost media'],['人设','persona'],['用户生成内容','ugc'],['专业生产内容','pgc'],['地球online','地球 online']];
const SYNONYMS=[['跨子网','其他子网','不同子网','跨网段','其他网段','不同网段'],['下方','底下'],['子网','网段']];
const SHORT_TERMS=['子网','网关','ip','mac','ugc','pgc','大v'];
export function termAliases(term) {const text=normalized(term),base=text.replace(/[（(][^()（）]*[)）]/g,'').trim(),inside=[...text.matchAll(/[（(]([^()（）]+)[)）]/g)].map(m=>m[1]);return [...new Set([text,base,...inside,...ALIASES.filter(g=>g.includes(text)||g.includes(base)||g.some(x=>inside.includes(x))).flat()])].filter(t=>t.length>=2);}
export const conceptKey=term=>{const a=termAliases(term);return ALIASES.find(g=>g.some(t=>a.includes(t)))?.[0]||a[1]||a[0]||'';};
export const senseKey=text=>normalized(text).replace(/[\s\p{P}\p{S}]/gu,'');
export const expressionKey=k=>createHash('sha256').update(conceptKey(k.term)+':'+senseKey(k.meaning)).digest('hex');
export function fuseKnowledge(rows,{limit=3,maxChars=1800,exclude=[]}={}) {
  if(limit<=0||maxChars<=0)return[];const out=[],seen=new Set(exclude.map(k=>conceptKey(k.term)));let chars=0;
  for(const k of [...rows].sort((a,b)=>(b.score||0)-(a.score||0))){const key=conceptKey(k.term),size=JSON.stringify(k).length;if(seen.has(key)||chars+size>maxChars)continue;seen.add(key);chars+=size;out.push(k);if(out.length>=limit)break;}return out;
}
const TOPICS={work:['工作','上班','加班','打工','职场','老板','任务','需求'],pressure:['压力','疲惫','好累','太累','任务太多','忙不过来','太多了'],rest:['休息','偷闲','摸鱼','放松','歇会','不想上班'],game:['游戏','队友','排位','副本','开黑','输赢','输了','赢了','秒杀','残血'],world:['现实','人生','生活','新手村','日常副本','游戏机制'],media:['媒体','视频','动画','影像','节目'],archive:['失传','下架','消失','存档','找回','旧视频','找不到'],internet:['网络','互联网','论坛','网友','热搜','流量'],food:['吃饭','干饭','白饭','白米饭','饿','晚饭'],study:['学习','作业','考试','复习','论文']};
const GENERIC=new Set(['使用','用于','描述','表示','一种','这个','那个','东西','意思','聊天','语境','闲聊','轻松','网络','互联网','文化','内容','相关','讨论','指称','通用']);
export const lexicalTerms=text=>[...new Set([...memoryTerms(normalized(text)),...SHORT_TERMS.filter(t=>containsTerm(text,t))])].filter(t=>t.length>=2&&!GENERIC.has(t));
export const facets=text=>Object.keys(TOPICS).filter(k=>TOPICS[k].some(w=>normalized(text).includes(w)));
export function retrievalWords(query) {
  const n=normalized(query),extra=[...ALIASES,...SYNONYMS].filter(g=>g.some(w=>containsTerm(n,w))).flat();
  const groups=facets(query),phrases=groups.includes('media')&&groups.includes('archive')?['失传媒体']:[];
  return [...new Set([...lexicalTerms(query),...extra,...phrases,...groups.flatMap(k=>TOPICS[k].filter(w=>w.length>=2))])].slice(0,64);
}
export function expressionScene(query,scene='') {
  if(/不聊了|到此为止|晚安|拜拜|先下了|别回了|不要回复/.test(query)||scene==='closing')return {allowed:false,reason:'CLOSING'};
  if(/不想活|活不下去|自杀|自伤|撑不住|抑郁|去世|失业|被裁员|家人.{0,5}住院|救命|很绝望|认真的|别开玩笑|别玩梗/.test(query))return {allowed:false,reason:'SUPPORT_OR_SERIOUS'};
  if(['help','technical'].includes(scene)||/解释|是什么|是啥|叫什么|叫啥|什么意思|啥意思|有啥用|如何|怎么做|帮我|求助|请.{0,8}(分析|说明|给出)|代码|报错|算法|函数|API|SQL|准确|认真|详细|为什么/i.test(query))return {allowed:false,reason:'EXPLANATION_OR_TECHNICAL'};
  return {allowed:true,reason:'CASUAL'};
}
export function safeExpression(k) {return ['slang','meme','culture'].includes(k.kind)&&k.confidence>=.85&&!k.conflict&&String(k.usage||'').length>=4;}
export function relevance(k,query,{mode='explain',recent=''}={}) {
  const n=normalized(query),aliases=termAliases(k.term),exact=aliases.some(t=>containsTerm(n,t)),qterms=lexicalTerms(query),expanded=retrievalWords(query);
  const context=(k.contextTerms||[]).filter(t=>{const x=normalized(t);return !GENERIC.has(x)&&x.length>=2&&(n.includes(x)||expanded.includes(x));});
  const qf=facets(query),kf=facets([k.meaning,k.usage,...k.contextTerms||[]].join(' '));
  const shared=qf.filter(t=>kf.includes(t));
  const relief=qf.includes('work')&&qf.includes('pressure')&&kf.includes('work')&&kf.includes('rest');
  const meaningMatches=qterms.filter(t=>normalized(k.meaning+' '+k.usage).includes(t));
  const aliasHint=expanded.some(t=>aliases.includes(t));
  const recentBoost=recent&&facets(recent).some(f=>qf.includes(f)&&kf.includes(f))?0.4:0;
  if(mode==='expression') {
    if(!safeExpression(k)||(!exact&&shared.length<2&&!relief&&!(context.length>=2&&meaningMatches.length)))return null;
  } else if(!exact&&!(context.length&&meaningMatches.length||shared.length>=2||aliasHint&&meaningMatches.length||meaningMatches.length>=3&&meaningMatches.length>=qterms.length*.45))return null;
  const score=(exact?8:0)+context.length*2+meaningMatches.length*.8+shared.length*1.2+(relief?2:0)+(aliasHint?1:0)+recentBoost+Math.min(1,(k.evidenceCount||1)/3)+(k.confidence||0);
  return {score,exact,contextScore:context.length+shared.length,mode};
}
