// Local lexical/scene helpers, shared by learning and chat. No model or network calls.
import { memoryTerms } from './memory-recall.mjs';
import { createHash } from 'node:crypto';
export const normalized = text => String(text||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function containsTerm(text,term) {
  const n=normalized(text),t=normalized(term);if(!t)return false;
  if(/^[\u4e00-\u9fff]$/.test(t))return new RegExp('(?:^|[^\\p{L}\\p{N}])'+t+'(?=$|[^\\p{L}\\p{N}]|是什么意思|是啥|什么意思|啥意思|这个词|这个梗)','u').test(n);
  return /^[a-z0-9 ]+$/i.test(t)?new RegExp('(?:^|[^a-z0-9])'+t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(n):n.includes(t);
}
const ALIASES=[['失传媒体','lost media'],['人设','persona'],['用户生成内容','ugc'],['专业生产内容','pgc'],['地球online','地球 online','地球ol','地球 ol']];
const SYNONYMS=[['跨子网','其他子网','不同子网','跨网段','其他网段','不同网段'],['下方','底下'],['子网','网段']];
const SHORT_TERMS=['子网','网关','ip','mac','ugc','pgc','大v'];
export function termAliases(term) {const text=normalized(term),base=text.replace(/[（(][^()（）]*[)）]/g,'').trim(),inside=[...text.matchAll(/[（(]([^()（）]+)[)）]/g)].map(m=>m[1]);return [...new Set([text,base,...inside,...ALIASES.filter(g=>g.includes(text)||g.includes(base)||g.some(x=>inside.includes(x))).flat()])].filter(t=>t.length>=2||/^[\u4e00-\u9fff]$/.test(t));}
export const conceptKey=term=>{const a=termAliases(term);return ALIASES.find(g=>g.some(t=>a.includes(t)))?.[0]||a[1]||a[0]||'';};
export const senseKey=text=>normalized(text).replace(/[\s\p{P}\p{S}]/gu,'');
export const expressionKey=k=>createHash('sha256').update(conceptKey(k.term)+':'+senseKey(k.meaning)).digest('hex');
export const expressionConceptKey=k=>createHash('sha256').update('concept:'+conceptKey(k.term)).digest('hex');
export function fuseKnowledge(rows,{limit=3,maxChars=1800,exclude=[]}={}) {
  if(limit<=0||maxChars<=0)return[];const out=[],seen=new Set(exclude.map(k=>conceptKey(k.term)));let chars=0;
  for(const k of [...rows].sort((a,b)=>(b.score||0)-(a.score||0))){const key=conceptKey(k.term),size=JSON.stringify(k).length;if(seen.has(key)||chars+size>maxChars)continue;seen.add(key);chars+=size;out.push(k);if(out.length>=limit)break;}return out;
}
const TOPICS={work:['工作','上班','加班','打工','职场','老板','任务','需求'],pressure:['压力','疲惫','好累','太累','任务太多','忙不过来','太多了'],rest:['休息','偷闲','摸鱼','放松','歇会','不想上班'],game:['游戏','队友','排位','副本','开黑','输赢','输了','赢了','秒杀','残血'],world:['现实','人生','生活','新手村','日常副本','游戏机制'],media:['媒体','视频','动画','影像','节目'],archive:['失传','下架','消失','存档','找回','旧视频','找不到'],internet:['网络','互联网','论坛','网友','热搜','流量'],food:['吃饭','干饭','白饭','白米饭','饿','晚饭'],study:['学习','作业','考试','复习','论文']};
TOPICS.work.push('工资');TOPICS.game.push('网游','淘汰');TOPICS.study.push('听不懂','没听懂','看不懂','讲解');TOPICS.internet.push('评论区','帖子','贴吧','b站','微博');TOPICS.media.push('剪辑','投稿');
Object.assign(TOPICS,{entertainment:['娱乐','吃瓜','搞笑','表情包','猫猫','小猫','猫咪','猫文化'],pet:['猫猫','小猫','猫咪','猫文化','猫爹','爱猫'],failure:['失败','输了','翻车','倒霉','听不懂','没听懂','搞砸','淘汰'],banter:['吐槽','调侃','自嘲','哈哈','笑死','玩笑','轻松']});
Object.assign(TOPICS,{politics:['政治','时政','意识形态','键政','建政'],spectating:['吃瓜','围观','看热闹','网络事件','普通观众']});
const GENERIC=new Set(['使用','用于','描述','表示','一种','这个','那个','东西','意思','聊天','语境','闲聊','轻松','网络','互联网','文化','内容','相关','讨论','指称','通用']);
export const lexicalTerms=text=>[...new Set([...memoryTerms(normalized(text)),...SHORT_TERMS.filter(t=>containsTerm(text,t))])].filter(t=>t.length>=2&&!GENERIC.has(t));
export const facets=text=>Object.keys(TOPICS).filter(k=>TOPICS[k].some(w=>normalized(text).includes(w)));
export function expressionTags(k) {
  // Restriction clauses are never treated as evidence for a positive usage scene.
  const positive=String(k.usage||'').split(/禁用于|禁用场景|不适用于|不适合|不宜用于|不宜|避免在/)[0];
  const text=[k.meaning,positive,...k.contextTerms||[]].join(' ');
  return [...new Set(facets(text))];
}
export function expressionOpportunity(query,recent='') {
  const current=facets(query),previous=facets(recent),continuation=query.length<30&&/^(?:对啊|确实|就是|可不|笑死|哈哈|然后|又|真是|我也|太|这|那|还|没听懂|完全)/.test(query);
  const relevantRecent=continuation||current.some(t=>!['banter','failure','pressure'].includes(t)&&previous.includes(t))?recent:'';
  return {tags:facets(query+' '+relevantRecent),text:query+' '+relevantRecent,continuation};
}
export const glossaryRequest=query=>/什么意思|啥意思|是什么|是啥|叫什么|叫啥|有啥用|指什么|含义|解释.{0,12}(?:这个词|这个梗)|(?:这个词|这个梗).{0,6}解释/.test(query);
export function retrievalWords(query) {
  const n=normalized(query),extra=[...ALIASES,...SYNONYMS].filter(g=>g.some(w=>containsTerm(n,w))).flat();
  const groups=facets(query),phrases=groups.includes('media')&&groups.includes('archive')?['失传媒体']:[];
  return [...new Set([...lexicalTerms(query),...extra,...phrases,...groups.flatMap(k=>TOPICS[k].filter(w=>w.length>=2))])].slice(0,64);
}
export function expressionScene(query,scene='') {
  if(/不聊了|到此为止|晚安|拜拜|先下了|别回了|不要回复/.test(query)||scene==='closing')return {allowed:false,reason:'CLOSING'};
  if(/不想活|活不下去|自杀|自伤|撑不住|抑郁|去世|失业|被裁员|家人.{0,5}住院|救命|很绝望|认真的|别开玩笑|别玩梗|交通事故|车祸|病危|葬礼|死亡|逝者|维权|房租交不上/.test(query))return {allowed:false,reason:'SUPPORT_OR_SERIOUS'};
  if(['help','technical'].includes(scene)||/解释|是什么|是啥|叫什么|叫啥|什么意思|啥意思|有啥用|如何|怎么做|帮我|求助|请.{0,8}(分析|说明|给出)|代码|报错|算法|函数|API|SQL|准确|认真|详细|为什么/i.test(query))return {allowed:false,reason:'EXPLANATION_OR_TECHNICAL'};
  return {allowed:true,reason:'CASUAL'};
}
export function safeExpression(k) {return ['slang','meme','culture'].includes(k.kind)&&k.confidence>=.85&&!k.conflict&&String(k.usage||'').length>=4;}
export function relevance(k,query,{mode='explain',recent=''}={}) {
  const n=normalized(query),aliases=termAliases(k.term),exact=aliases.some(t=>containsTerm(n,t)),qterms=lexicalTerms(query),expanded=retrievalWords(query);
  const context=(k.contextTerms||[]).filter(t=>{const x=normalized(t);return !GENERIC.has(x)&&x.length>=2&&(n.includes(x)||expanded.includes(x));});
  const opportunity=expressionOpportunity(query,recent),qf=mode==='expression'?opportunity.tags:facets(query),kf=expressionTags(k);
  const shared=qf.filter(t=>kf.includes(t));
  const relief=qf.includes('work')&&qf.includes('pressure')&&kf.includes('work')&&kf.includes('rest');
  const meaningMatches=qterms.filter(t=>normalized(k.meaning+' '+k.usage).includes(t));
  const aliasHint=expanded.some(t=>aliases.includes(t));
  const recentBoost=recent&&facets(recent).some(f=>qf.includes(f)&&kf.includes(f))?0.4:0;
  if(mode==='expression') {
    const domain=shared.filter(t=>!['banter','failure','pressure','internet'].includes(t));
    const groundedContext=(k.contextTerms||[]).filter(t=>String(t).length>=2&&containsTerm(opportunity.text,t)).length;
    const contextualMatches=lexicalTerms(opportunity.text).filter(t=>!['游戏','工作','学习','视频','网络'].includes(t)&&normalized(k.meaning+' '+k.usage).includes(t)).length;
    const supportedScene=domain.length>0&&(groundedContext>0||contextualMatches>0||shared.includes('failure')||shared.includes('banter'))&&(!qf.includes('failure')||kf.includes('failure')||groundedContext>0);
    if((k.avoidContexts||[]).some(t=>String(t).length>=2&&containsTerm(query,t)))return null;
    const strongScene=shared.length>=2&&(domain.some(t=>!['media','entertainment'].includes(t))||groundedContext>0||contextualMatches>=2);
    if(!safeExpression(k)||(!exact&&!strongScene&&!relief&&!supportedScene&&!(groundedContext>=1&&contextualMatches>=2)))return null;
  } else if(!exact&&!(context.length&&meaningMatches.length||shared.length>=2||aliasHint&&meaningMatches.length||meaningMatches.length>=3&&meaningMatches.length>=qterms.length*.45))return null;
  const score=(exact?8:0)+context.length*2+meaningMatches.length*.8+shared.length*1.2+(relief?2:0)+(aliasHint?1:0)+recentBoost+Math.min(1,(k.evidenceCount||1)/3)+(k.confidence||0);
  return {score,exact,contextScore:context.length+shared.length,mode};
}
