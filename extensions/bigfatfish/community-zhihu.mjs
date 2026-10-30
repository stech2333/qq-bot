// Verified official API subset and licensed export/readonly-json adapter. No website scraping.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readDshCredential } from '../../integrations/qq-bridge/src/web-search.js';
import { sourceAllowed } from './community-adapters.mjs';
import { safeGeneralText } from './slang-schema.mjs';
import { processExchange, connectorConfig } from './community-platforms.mjs';

export const zhihuHash=value=>createHash('sha256').update(String(value)).digest('hex');
export const zhihuError=(kind,message)=>Object.assign(Error('知乎：'+message),{kind,origin:'source'});
const numeric=value=>typeof value==='string'&&/^[1-9]\d{0,24}$/.test(value);
function searchContentId(value) {
  if(typeof value!=='string'||!value.trim()||value.length>256||/[\u0000-\u001f\u007f]/.test(value))throw zhihuError('UNAVAILABLE','官方搜索标识结构无效');
  return value;
}
const types=['keyword','topic','question','answer','article','column'];
export function zhihuURL(value,{tracking=false,target=false}={}) {
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return '';
    if(u.search&&(!tracking||[...u.searchParams.keys()].some(k=>!/^utm_(?:source|medium|campaign|term|content)$/.test(k))))return '';
    u.search='';
    if(['www.zhihu.com','zhihu.com'].includes(u.hostname)){
      if(!/^\/(?:question\/[1-9]\d{0,24}(?:\/answer\/[1-9]\d{0,24})?|answer\/[1-9]\d{0,24})$/.test(u.pathname)&&!(target&&/^\/topic\/[1-9]\d{0,24}$/.test(u.pathname)))return '';
      u.hostname='www.zhihu.com';
    }else if(u.hostname==='zhuanlan.zhihu.com'){
      if(!/^\/p\/[1-9]\d{0,24}$/.test(u.pathname)&&!(target&&/^\/[a-zA-Z][\w-]{0,99}$/.test(u.pathname)))return '';
    }else return '';
    return u.href;
  }catch{return '';}
}
export function zhihuIdentity(url) {
  const canonical=zhihuURL(url,{tracking:true});if(!canonical)throw zhihuError('INVALID_TARGET','内容链接不在允许的知乎 HTTPS 白名单');
  const p=new URL(canonical).pathname;let m;
  if(new URL(canonical).hostname==='zhuanlan.zhihu.com')return {id:'article:'+p.split('/')[2],contentType:'article',articleId:p.split('/')[2],url:canonical};
  if((m=p.match(/^\/question\/(\d+)\/answer\/(\d+)$/)))return {id:'answer:'+m[2],contentType:'answer',questionId:m[1],answerId:m[2],url:canonical};
  if((m=p.match(/^\/answer\/(\d+)$/)))return {id:'answer:'+m[1],contentType:'answer',answerId:m[1],url:canonical};
  m=p.match(/^\/question\/(\d+)$/);return {id:'question:'+m[1],contentType:'question',questionId:m[1],url:canonical};
}
export function zhihuTarget(raw) {
  const targetType=raw.targetType||'keyword',input=String(raw.target||'').trim().normalize('NFC');
  if(!types.includes(targetType)||!input||input.length>300||/[\u0000-\u001f\u007f<>]/.test(input))throw zhihuError('INVALID_TARGET','请选择有效入口类型并填写具体目标');
  if(raw.readComments!==undefined&&typeof raw.readComments!=='boolean')throw zhihuError('INVALID_TARGET','评论读取开关无效');
  let target=input,questionId;
  if(['question','answer','article'].includes(targetType)){
    if(numeric(input))target=input;
    else {const identity=zhihuIdentity(input);if(identity.contentType!==targetType)throw zhihuError('INVALID_TARGET','URL 与所选入口类型不符');target=identity[targetType+'Id'];questionId=identity.questionId;}
    if(targetType==='answer'&&raw.questionId!==undefined){if(!numeric(raw.questionId)||questionId&&questionId!==raw.questionId)throw zhihuError('INVALID_TARGET','回答与问题 ID 不匹配');questionId=raw.questionId;}
  }else if(targetType==='topic'&&input.startsWith('https:')){
    const u=zhihuURL(input,{target:true});if(!u||!new URL(u).pathname.startsWith('/topic/'))throw zhihuError('INVALID_TARGET','话题 URL 无效');target=new URL(u).pathname.split('/')[2];
  }else if(targetType==='column'&&input.startsWith('https:')){
    const u=zhihuURL(input,{target:true});if(!u||new URL(u).hostname!=='zhuanlan.zhihu.com'||!/^\/[a-zA-Z][\w-]{0,99}$/.test(new URL(u).pathname))throw zhihuError('INVALID_TARGET','专栏集合 URL 无效');target=new URL(u).pathname.slice(1);
  }else if(input.includes('://')||targetType==='column'&&!/^[a-zA-Z][\w-]{0,99}$/.test(input))throw zhihuError('INVALID_TARGET','入口格式无效');
  const topicMode=raw.topicMode||'exact';if(!['exact','keyword'].includes(topicMode))throw zhihuError('INVALID_TARGET','话题模式无效');
  if((targetType==='keyword'||targetType==='topic'&&!numeric(target))&&!safeGeneralText(target))throw zhihuError('INVALID_TARGET','学习关键词或话题名称包含不适合保存的内容');
  if(targetType==='topic'&&topicMode==='keyword'&&numeric(target))throw zhihuError('INVALID_TARGET','话题关键词搜索应填写名称，不能把数字 ID 当作关键词');
  return {targetType,target,...(questionId&&targetType==='answer'?{questionId}:{}),...(targetType==='topic'?{topicMode}:{}),readComments:raw.readComments===true};
}
export function zhihuPlain(value) {
  if(typeof value!=='string')throw zhihuError('UNAVAILABLE','正文不是文本');
  return value.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:br|\/p|\/div|\/li|\/blockquote|\/h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&(?:#(x[\da-f]+|\d+)|(amp|lt|gt|quot|apos|nbsp));/gi,(_m,n,name)=>{if(n){const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>0&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):'�';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[name.toLowerCase()];}).replace(/\r\n?/g,'\n').trim();
}
function time(value) {if(value===undefined||value===null||value===0)return 0;if(!Number.isSafeInteger(value)||value<0||value>Date.now())throw zhihuError('UNAVAILABLE','时间戳无效，使用 Unix 毫秒或 0 表示缺失');return value;}
export function zhihuMetadata(raw) {
  const identity=zhihuIdentity(raw.url);
  if(raw.id!==identity.id||raw.contentType!==identity.contentType||['questionId','answerId','articleId'].some(k=>raw[k]!==undefined&&raw[k]!==identity[k]))throw zhihuError('INVALID_TARGET','内容 ID、父级关系、类型或链接不一致');
  if(raw.searchContentId!==undefined)searchContentId(raw.searchContentId);
  if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200||typeof raw.summary!=='string'||raw.summary.length>400)throw zhihuError('UNAVAILABLE','缺少真实标题或摘要结构无效');
  if(raw.bindings!==undefined&&(!Array.isArray(raw.bindings)||raw.bindings.length>16||raw.bindings.some(b=>!b||!types.includes(b.type)||typeof b.value!=='string'||!b.value||b.value.length>300||b.mode!==undefined&&!['keyword','exact'].includes(b.mode))))throw zhihuError('INVALID_TARGET','目标关联 bindings 无效');
  return {...identity,title:zhihuPlain(raw.title),summary:zhihuPlain(raw.summary),publishedAt:time(raw.publishedAt),...(raw.updatedAt?{updatedAt:time(raw.updatedAt)}:{}),...(raw.searchContentId!==undefined?{searchContentId:raw.searchContentId}:{}),stableContent:true,fingerprint:zhihuHash('zhihu:'+identity.id),metadataVersion:zhihuHash(JSON.stringify([raw.title,raw.summary])),...(typeof raw.bodyVersion==='string'?{bodyVersion:raw.bodyVersion}:{}),bindings:raw.bindings||[]};
}
export function zhihuMatches(source,row) {
  if(source.targetType==='answer')return row.id==='answer:'+source.target&&(!source.questionId||source.questionId===row.questionId);
  if(source.targetType==='article')return row.id==='article:'+source.target;
  if(source.targetType==='question')return row.questionId===source.target;
  return row.bindings?.some(b=>b.type===source.targetType&&b.value===source.target&&!(source.targetType==='topic'&&source.topicMode!=='keyword'&&b.mode==='keyword'))===true;
}
const access=new Map();
async function pause(ms,signal){if(signal?.aborted)throw zhihuError('CANCELLED','读取已取消');await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(done,Math.max(0,ms)),cancel=()=>{clearTimeout(timer);reject(zhihuError('CANCELLED','读取已取消'));};signal?.addEventListener('abort',cancel,{once:true});});}
const officialPaths={search:'/api/v1/content/zhihu_search',answers:'/api/v1/content/question_answers',body:'/api/v1/user/content_detail',comments:'/api/v1/user/content_comments'};
export class OfficialZhihu {
  constructor(config,{fetcher=fetch,credential=ref=>process.env[ref]||readDshCredential(ref)}={}) {this.config=config;this.fetcher=fetcher;this.credential=credential;}
  async call(operation,params,{signal}={}) {
    if(!Object.hasOwn(officialPaths,operation))throw zhihuError('UNSUPPORTED_CAPABILITY','官方操作不在只读白名单');
    const ref=this.config.credentialRef||'QQ_COMMUNITY_ZHIHU_ACCESS_SECRET';if(!/^QQ_COMMUNITY_[A-Z0-9_]{1,80}$/.test(ref))throw zhihuError('AUTH','凭据引用格式无效');
    const secret=this.credential(ref);if(!secret)throw zhihuError('AUTH','未配置知乎开放平台 Access Secret 引用');
    const url=new URL(officialPaths[operation],'https://developer.zhihu.com');for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
    const combined=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]);let response,raw='';
    try{
      response=await this.fetcher(url.href,{method:'GET',headers:{Authorization:'Bearer '+secret,'X-Request-Timestamp':String(Math.floor(Date.now()/1000)),'Content-Type':'application/json'},redirect:'error',signal:combined});
      if([401,403].includes(response.status))throw zhihuError('AUTH','官方接口拒绝访问，请检查凭据、本人内容归属和权限');
      if(response.status===429)throw zhihuError('RATE_LIMITED','官方调用频率或额度受限');
      if(response.status!==200)throw zhihuError('NETWORK','官方 HTTP 请求失败');
      let bytes=0;const decoder=new TextDecoder();for await(const part of response.body){bytes+=part.length;if(bytes>512000)throw zhihuError('UNAVAILABLE','官方正文超过单次响应大小保护');raw+=decoder.decode(part,{stream:true});}raw+=decoder.decode();
      const json=JSON.parse(raw,(_k,v,context)=>typeof v==='number'&&!Number.isSafeInteger(v)&&Number.isInteger(v)?context?.source||(()=>{throw zhihuError('UNAVAILABLE','无法保持内容 ID 精度');})():v);
      if(json.Code!==0)throw zhihuError(json.Code===20001||json.Code===30003?'AUTH':[30001,30002].includes(json.Code)?'RATE_LIMITED':json.Code===10001?'INVALID_TARGET':'NETWORK',json.Code===10001?'内容不存在、不可用或不属于当前账号；未获取正文':json.Code===20001||json.Code===30003?'官方鉴权、授权或风控拒绝':[30001,30002].includes(json.Code)?'官方调用额度或频率受限':'官方接口返回失败');
      if(!json.Data||typeof json.Data!=='object')throw zhihuError('UNAVAILABLE','官方响应结构不兼容');return json.Data;
    }catch(e){if(e.origin==='source')throw e;const timed=combined.aborted||e.name==='TimeoutError'||e.code==='ETIMEDOUT';throw zhihuError(signal?.aborted?'CANCELLED':timed?'TIMEOUT':'NETWORK',signal?.aborted?'读取已取消':timed?'官方请求超时':'官方网络或响应解析失败');}
  }
}
function objectCursor(cursor,initial) {let c=cursor;if(typeof c==='string'){try{c=JSON.parse(c);}catch{throw zhihuError('INVALID_TARGET','游标不是有效 JSON');}}if(c===0||c===null||c===undefined)c=initial;if(!c||typeof c!=='object'||Array.isArray(c)||JSON.stringify(c).length>10000)throw zhihuError('INVALID_TARGET','阅读/发现游标无效');return c;}
function integer(v,max=10000000){if(!Number.isSafeInteger(v)||v<0||v>max)throw zhihuError('INVALID_TARGET','游标位置无效');return v;}
function continuation(paging,current) {
  if(!paging||typeof paging.IsEnd!=='boolean')throw zhihuError('UNAVAILABLE','缺少真实分页字段');if(paging.IsEnd)return null;
  if(!Number.isSafeInteger(paging.NextOffset)||paging.NextOffset<=current)throw zhihuError('UNAVAILABLE','分页游标缺失或未推进，已停止自动翻页');return paging.NextOffset;
}
function directURL(source) {return source.targetType==='article'?'https://zhuanlan.zhihu.com/p/'+source.target:source.questionId?'https://www.zhihu.com/question/'+source.questionId+'/answer/'+source.target:'https://www.zhihu.com/answer/'+source.target;}
export class ZhihuAdapter {
  constructor(root,source,{loadExport,fetcher=fetch,exchange=processExchange,credential}={}) {Object.assign(this,{root,source:{...source,...zhihuTarget(source)},loadExport,fetcher,exchange,credential});}
  capability() {
    if(!sourceAllowed(this.source))return {status:'NEEDS_AUTH',reason:'知乎来源需要读取、保存和 AI 学习许可'};
    if(this.source.adapter!=='platform-reader')return {status:'NEEDS_AUTH',configured:true,reason:'知乎授权导入，待实际正文检查（不是在线搜索）'};
    const c=this.localConfig();if(!c.config)return c;return {status:'NEEDS_AUTH',configured:true,reason:c.config.driver==='zhihu-official'?'官方本人创作全文；搜索及问题列表仅摘要，待实际权限检查':'本机已审核只读连接器，待实际正文检查'};
  }
  localConfig() {
    try{const c=JSON.parse(fs.readFileSync(path.join(this.root,'state/community-connectors.json'),'utf8'))?.[this.source.connector];
      if(c?.platform==='zhihu'&&c.driver==='zhihu-official')return {config:c};
      const local=connectorConfig(this.root,this.source);
      if(local.config?.driver==='readonly-json'&&local.config.readOnly===true&&local.config.verified===true&&local.config.protocol==='bigfatfish-zhihu-v1')return local;
      return {status:'UNAVAILABLE',reason:'知乎未配置已核实的官方或只读连接器；可使用授权文件/Feed'};
    }catch{return {status:'UNAVAILABLE',reason:'知乎连接器配置不可用；可使用授权文件/Feed'};}
  }
  async call(action,args={},options={}) {
    if(!sourceAllowed(this.source))throw zhihuError('AUTH','来源许可失效');
    const c=this.localConfig().config;if(!c)throw zhihuError('UNAVAILABLE','未配置已核实的知乎只读连接器');
    const key=this.root+':'+this.source.connector,delay=Math.max(3000,Number(c.minRequestMs)||3000);await pause((access.get(key)||0)-Date.now(),options.signal);access.set(key,Date.now()+delay);
    if(c.driver==='zhihu-official')return new OfficialZhihu(c,{fetcher:this.fetcher,credential:this.credential}).call(action,args,options);
    if(!['probe','discover','read'].includes(action))throw zhihuError('UNSUPPORTED_CAPABILITY','连接器操作不在只读白名单');
    return this.exchange(c,{version:1,platform:'zhihu',action,targetType:this.source.targetType,target:this.source.target,topicMode:this.source.topicMode,readComments:this.source.readComments,...args},options);
  }
  async exports(signal) {
    if(!sourceAllowed(this.source))throw zhihuError('AUTH','来源许可失效');signal?.throwIfAborted();const data=await this.loadExport(signal);
    if(data.version!==1||!Array.isArray(data.items)||data.items.length>1000)throw zhihuError('UNAVAILABLE','知乎导入须为 version=1 且最多 1000 条 items');
    const seen=new Set();return data.items.map(raw=>{const row=zhihuMetadata({...raw,summary:raw.summary??'',publishedAt:raw.publishedAt??0});if(seen.has(row.id))throw zhihuError('UNAVAILABLE','同一导入包含重复内容 ID');seen.add(row.id);
      const text=zhihuPlain(raw.text??raw.body);if(!text||text.length>240000)throw zhihuError('UNAVAILABLE','知乎正文为空或超过授权导入大小保护');
      const comments=raw.comments||[];if(!Array.isArray(comments)||comments.length>1000)throw zhihuError('UNAVAILABLE','评论导入结构无效');
      return {...row,text,bodyVersion:zhihuHash(text),comments};}).filter(row=>zhihuMatches(this.source,row));
  }
  async probe({signal}={}) {
    if(!sourceAllowed(this.source))throw zhihuError('AUTH','来源许可失效');
    const mode=this.source.adapter==='platform-reader'?this.localConfig().config?.driver:this.source.adapter;
    if(!mode)throw zhihuError('UNAVAILABLE','未配置已核实的知乎只读连接器');
    if(mode==='zhihu-official'&&['column','topic','question'].includes(this.source.targetType)&&!(this.source.targetType==='topic'&&this.source.topicMode==='keyword'))throw zhihuError('UNSUPPORTED_CAPABILITY',this.source.targetType==='question'?'官方问题接口仅返回回答摘要，无法承诺任意回答全文':this.source.targetType==='column'?'当前官方连接器不支持专栏列表':'官方未开放精确话题内容列表；可明确改用话题关键词搜索');
    if(mode==='readonly-json'){
      const row=await this.call('probe',{}, {signal}),c=row.capabilities;
      if(row.version!==1||row.ready!==true||c?.body!==true||!c.targets?.includes(this.source.targetType)||this.source.readComments&&c.comments!==true)throw zhihuError('UNSUPPORTED_CAPABILITY','连接器未证明对应目标的原文/评论读取能力');
    }
    const found=await this.discover({signal,cursor:0,limit:1});const sample=found.items.find(r=>r.contentType!=='question')||found.items[0];
    if(!sample)throw zhihuError('UNAVAILABLE','没有可用于实际正文验证的目标内容，尚未 READY');
    try{const r=await this.fetch(sample,{signal});if(!r.text.trim())throw zhihuError('UNAVAILABLE','未返回可验证正文');}
    catch(e){if(mode==='zhihu-official'&&['keyword','topic'].includes(this.source.targetType)&&e.kind==='INVALID_TARGET')throw zhihuError('UNSUPPORTED_CAPABILITY','搜索仅返回摘要；官方全文仅限本人创作，当前结果未通过归属验证');throw e;}
    return {status:'READY',checkedAt:Date.now(),mode,scope:mode==='zhihu-official'?'own-published-content':mode==='readonly-json'?'verified-licensed-reader':'licensed-import',reason:mode==='authorized-file'||mode==='authorized-feed'?'知乎授权导入正文检查通过（非在线搜索）':'知乎已通过目标及实际原文读取检查'};
  }
  async discover({signal,cursor=0,limit=10}={}) {
    if(!sourceAllowed(this.source))throw zhihuError('AUTH','来源许可失效');const c=objectCursor(cursor,{offset:0,page:0,seen:[]});integer(c.page??0,50);if((c.page??0)>=50)return {items:[],cursor:0,hasMore:false,paginationStopped:'BOUND_REACHED'};
    if(this.source.adapter!=='platform-reader'){
      const rows=await this.exports(signal),start=integer(c.offset??0),size=Math.max(1,Math.min(20,limit)),slice=rows.slice(start,start+size);return {items:slice.map(({text,comments,...r})=>r),cursor:start+size<rows.length?{offset:start+size,page:(c.page||0)+1}:0,hasMore:start+size<rows.length};
    }
    const config=this.localConfig().config;if(!config)throw zhihuError('UNAVAILABLE','未配置知乎只读连接器');let rows,next,hasMore;
    if(config.driver==='zhihu-official'){
      if(['article','answer'].includes(this.source.targetType)){
        const r=await this.call('body',{ContentUrl:directURL(this.source)},{signal}),identity=zhihuIdentity(r.Url),text=zhihuPlain(r.Body);
        if(!text||r.ContentType!==identity.contentType||r.ContentToken!==identity[identity.contentType+'Id'])throw zhihuError('UNAVAILABLE','官方未返回匹配的真实正文');
        rows=[{...identity,title:r.Title,summary:'',publishedAt:0,bodyVersion:zhihuHash(text)}];next=0;hasMore=false;
      }else if(this.source.targetType==='keyword'||this.source.targetType==='topic'&&this.source.topicMode==='keyword'){
        if(c.done)return {items:[],cursor:0,hasMore:false};
        const r=await this.call('search',{Query:this.source.target,Count:Math.min(10,limit)},{signal});
        if(!Array.isArray(r.Items)||typeof r.HasMore!=='boolean')throw zhihuError('UNAVAILABLE','官方搜索响应结构无效');
        rows=r.Items.filter(r=>['answer','article','question'].includes(String(r.ContentType).toLowerCase())).map(r=>{
          const identity=zhihuIdentity(r.Url);
          if(identity.contentType!==String(r.ContentType).toLowerCase())throw zhihuError('INVALID_TARGET','官方搜索类型与链接不一致');
          // Live official responses use a search ContentID distinct from the URL token.
          // Keep it as opaque provenance; only the canonical URL determines queue identity.
          // Full-body ContentToken/URL/parent checks remain mandatory in body().
          return {...identity,searchContentId:searchContentId(r.ContentID),title:zhihuPlain(r.Title),summary:zhihuPlain(r.ContentText).slice(0,400),publishedAt:r.CreateTime?Number(r.CreateTime)*1000:0,bindings:[{type:this.source.targetType,value:this.source.target,...(this.source.targetType==='topic'?{mode:'keyword'}:{})}]};
        });
        // Official HasMore is documented false; there is no documented search cursor.
        if(r.HasMore)throw zhihuError('UNSUPPORTED_CAPABILITY','官方搜索未提供可用分页契约');next=0;hasMore=false;
      }else throw zhihuError('UNSUPPORTED_CAPABILITY','当前官方连接器不支持此目标的全文发现');
    }else{
      const r=await this.call('discover',{cursor:c.cursor??null,limit:Math.min(20,limit)},{signal});
      if(r.version!==1||!Array.isArray(r.items)||r.items.length>50||typeof r.hasMore!=='boolean')throw zhihuError('UNAVAILABLE','只读连接器发现协议无效');
      rows=r.items;hasMore=r.hasMore;next=r.cursor;
      if(hasMore&&(next==null||JSON.stringify(next)===JSON.stringify(c.cursor??null)))throw zhihuError('UNAVAILABLE','发现游标缺失或未推进');
    }
    const items=rows.map(zhihuMetadata);if(items.some(row=>!zhihuMatches(this.source,row)))throw zhihuError('INVALID_TARGET','发现内容不属于登记目标');
    const signature=zhihuHash(items.map(r=>r.id).join('|'));
    if(items.length&&(c.seen||[]).includes(signature))return {items:[],cursor:0,hasMore:false,paginationStopped:'REPEATED_PAGE'};
    return {items,cursor:hasMore?{cursor:next,page:(c.page||0)+1,seen:[...(c.seen||[]),signature]}:0,hasMore};
  }
  async body(item,signal) {
    if(!zhihuMatches(this.source,item))throw zhihuError('INVALID_TARGET','材料不属于登记目标');
    if(this.source.adapter!=='platform-reader') {const row=(await this.exports(signal)).find(r=>r.id===item.id);if(!row)throw zhihuError('INVALID_TARGET','授权导入中的内容已不存在');return row;}
    const config=this.localConfig().config;if(!config)throw zhihuError('UNAVAILABLE','未配置知乎只读连接器');
    if(config.driver!=='zhihu-official')throw zhihuError('UNSUPPORTED_CAPABILITY','正文应通过已审核读取协议取得');
    if(!['answer','article'].includes(item.contentType))throw zhihuError('UNSUPPORTED_CAPABILITY','官方问题描述全文接口未开放');
    const r=await this.call('body',{ContentUrl:item.url},{signal}),identity=zhihuIdentity(r.Url);
    if(identity.id!==item.id||r.ContentToken!==identity[identity.contentType+'Id']||r.ContentType!==identity.contentType||item.questionId&&identity.questionId!==item.questionId)throw zhihuError('INVALID_TARGET','官方返回内容或父问题不匹配');
    const text=zhihuPlain(r.Body);if(!text||text.length>240000)throw zhihuError('UNAVAILABLE','官方正文为空或超过大小保护');return {...item,text,bodyVersion:zhihuHash(text)};
  }
  async fetch(item,{signal,readCursor=null}={}) {
    if(!sourceAllowed(this.source))throw zhihuError('AUTH','来源许可失效');if(!zhihuMatches(this.source,item))throw zhihuError('INVALID_TARGET','材料不属于登记目标');
    const state=objectCursor(readCursor,{stage:'body',offset:0}),mode=this.source.adapter==='platform-reader'?this.localConfig().config?.driver:'export';
    if(mode==='readonly-json'){
      const r=await this.call('read',{id:item.id,url:item.url,cursor:readCursor},{signal});
      if(r.version!==1||r.id!==item.id||r.url!==item.url||typeof r.text!=='string'||r.text.length>16000||!r.records?.length||r.records.length>1||typeof r.complete!=='boolean')throw zhihuError('UNAVAILABLE','只读连接器正文协议无效');
      const record=r.records[0];if(!['answer','article','question','comment'].includes(record.contentType)||record.contentType==='comment'&&!this.source.readComments||typeof record.text!=='string'||record.text!==r.text||record.contentHash!==zhihuHash(r.text)||!/^([a-f0-9]{64})$/.test(record.version)||record.document!==item.id||!r.complete&&(!r.readCursor||JSON.stringify(r.readCursor)===JSON.stringify(readCursor)))throw zhihuError('INVALID_TARGET','只读连接器正文、评论身份或游标无效');
      if(!Number.isSafeInteger(record.offset)||record.offset<0||!Number.isSafeInteger(record.end)||record.end-record.offset!==Array.from(record.text).length||r.complete&&r.readCursor!=null)throw zhihuError('INVALID_TARGET','只读连接器分片偏移或完成标记无效');
      if(record.contentType==='comment'){if(!numeric(record.commentId)||record.unitId!=='comment:'+record.commentId)throw zhihuError('INVALID_TARGET','缺少稳定评论 ID');}else if(record.unitId!==item.id||record.contentType!==item.contentType)throw zhihuError('INVALID_TARGET','正文类型或身份不匹配');
      return {...this.readBase(item),...r,contentType:record.contentType,stableContent:true,segmentHash:zhihuHash(r.text)};
    }
    if(!['body','comments'].includes(state.stage))throw zhihuError('INVALID_TARGET','阅读阶段无效');
    if(state.stage==='body'){
      const snap=item.zhihuSnapshot,body=snap&&snap.revision===this.source.revision&&snap.document===item.id?snap:await this.body(item,signal),version=body.bodyVersion;
      let offset=integer(state.offset??0);if(state.version&&state.version!==version)offset=0;
      if(offset>Array.from(body.text).length)throw zhihuError('INVALID_TARGET','正文分片偏移越界');
      const chars=Array.from(body.text),end=Math.min(chars.length,offset+2000),text=chars.slice(offset,end).join('');
      const next=end<chars.length?{stage:'body',offset:end,version}:this.source.readComments?{stage:'comments',offset:0,itemIndex:0,partOffset:0}:null;
      return {...this.readBase(item),text,contentType:item.contentType,records:[{unitId:item.id,document:item.id,contentType:item.contentType,version,offset,end,text,contentHash:zhihuHash(text)}],readCursor:next,complete:next===null,segmentHash:zhihuHash(text),...(end<chars.length?{zhihuSnapshot:{revision:this.source.revision,document:item.id,text:body.text,bodyVersion:version}}:{})};
    }
    if(!this.source.readComments)throw zhihuError('UNSUPPORTED_CAPABILITY','该来源没有启用评论读取');
    if((state.pages||0)>=50)throw zhihuError('UNAVAILABLE','评论分页超过单轮有界检查范围');
    const offset=integer(state.offset??0),index=integer(state.itemIndex??0,1000);let records,nextOffset,coverage;
    if(mode==='export'){
      const row=await this.body(item,signal);records=row.comments;nextOffset=null;coverage='licensed-export';
    }else{
      const page=await this.call('comments',{ContentUrl:item.url,Offset:offset,Limit:20,Order:'ascending'},{signal});
      if(!Array.isArray(page.Items)||page.Items.length>50)throw zhihuError('UNAVAILABLE','官方评论结构无效');
      records=page.Items.flatMap(r=>[{...r.Comment,parentId:undefined},...(r.Children||[]).map(x=>({...x,parentId:String(x.ReplyID||r.Comment.ID)}))]);nextOffset=continuation(page.Paging,offset);coverage='attached-children-only';
      records=records.map(r=>({id:String(r.ID),text:r.Content,parentId:r.parentId,rootId:r.RootID?String(r.RootID):undefined}));
    }
    if(index>records.length)throw zhihuError('INVALID_TARGET','评论页内位置已变化');
    const ids=records.map(r=>{if(!numeric(r.id))throw zhihuError('UNAVAILABLE','评论缺少稳定 ID');return r.id;}),signature=zhihuHash(ids.join('|'));
    if(records.length&&index===0&&(state.seen||[]).includes(signature))return {...this.readBase(item),text:'',records:[],contentType:'comment',readCursor:null,complete:true,paginationStopped:'REPEATED_PAGE'};
    if(!records.length||index===records.length){const next=nextOffset===null?null:{stage:'comments',offset:nextOffset,itemIndex:0,partOffset:0,seen:[...(state.seen||[]),signature].slice(-50),pages:(state.pages||0)+1};return {...this.readBase(item),text:'',records:[],contentType:'comment',readCursor:next,complete:next===null};}
    const row=records[index];if(row.parentId&&!numeric(row.parentId)||row.rootId&&!numeric(row.rootId))throw zhihuError('UNAVAILABLE','评论父级 ID 无效');
    const all=zhihuPlain(row.text),version=zhihuHash(all),chars=Array.from(all);let partOffset=integer(state.partOffset??0);if(state.version&&state.version!==version)partOffset=0;if(partOffset>chars.length)throw zhihuError('INVALID_TARGET','评论分片偏移无效');
    const end=Math.min(chars.length,partOffset+2000),text=chars.slice(partOffset,end).join('');let next;
    if(end<chars.length)next={...state,partOffset:end,version};else if(index+1<records.length)next={...state,itemIndex:index+1,partOffset:0,version:undefined};else next=nextOffset===null?null:{stage:'comments',offset:nextOffset,itemIndex:0,partOffset:0,seen:[...(state.seen||[]),signature].slice(-50),pages:(state.pages||0)+1};
    return {...this.readBase(item),text,contentType:'comment',records:[{unitId:'comment:'+row.id,document:item.id,commentId:row.id,parentId:row.parentId,rootId:row.rootId,contentType:'comment',version,offset:partOffset,end,text,contentHash:zhihuHash(text)}],readCursor:next,complete:next===null,segmentHash:zhihuHash(text),commentCoverage:coverage};
  }
  readBase(item){return Object.fromEntries(['id','title','summary','url','fingerprint','contentType','questionId','answerId','articleId','stableContent','platform'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));}
  async contentVersion(item,{signal}={}) {
    if(this.source.adapter==='platform-reader'&&this.localConfig().config?.driver==='readonly-json'){
      const r=await this.fetch(item,{signal}),record=r.records.find(x=>x.unitId===item.id);if(!record)throw zhihuError('UNAVAILABLE','连接器没有返回正文版本');return record.version;
    }
    return (await this.body(item,signal)).bodyVersion;
  }
}
