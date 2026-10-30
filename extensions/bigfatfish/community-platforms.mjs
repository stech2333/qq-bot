// Only an administrator-owned local config can choose processes. No model tools or shell commands.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { readDshCredential } from '../../integrations/qq-bridge/src/web-search.js';
import { hash, sourceURL, sourceAllowed } from './community-adapters.mjs';

export function connectorConfig(root,source) {
  try {
    const file=path.join(root,'state/community-connectors.json');if(!fs.existsSync(file))return {status:'UNAVAILABLE',reason:'尚未配置本地只读连接器'};
    const config=JSON.parse(fs.readFileSync(file,'utf8'))?.[source.connector];
    if(!config||config.platform!==source.platform||!['polylens','aiotieba','readonly-json'].includes(config.driver))return {status:'UNAVAILABLE',reason:'没有匹配的平台只读驱动'};
    if(!path.isAbsolute(config.command)||!fs.existsSync(config.command)||!Array.isArray(config.args)||config.args.some(a=>typeof a!=='string'))return {status:'UNAVAILABLE',reason:'连接器程序尚未安装或配置无效'};
    if(config.driver==='polylens'&&source.platform!=='bilibili'||config.driver==='aiotieba'&&source.platform!=='tieba')return {status:'UNAVAILABLE',reason:'平台驱动不匹配'};
    return {status:'NEEDS_AUTH',configured:true,reason:'本地驱动已配置，等待实际能力和授权检查',config};
  }catch{return {status:'ERROR',reason:'本地只读连接器配置无法读取'};}
}
const fail=(message,kind='NETWORK')=>Object.assign(Error(message),{kind});
export function killReader(child) { if(!child?.pid)return;if(process.platform==='win32'){const k=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('error',()=>child.kill());}else child.kill('SIGKILL'); }
export function processExchange(config,request,{signal,timeoutMs=30000,mcp=false,spawnProcess=spawn}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(fail('来源读取已取消','CANCELLED'));return;}
    const env=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','XDG_CACHE_HOME','SSL_CERT_FILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
    if(config.credentialRef){if(!/^QQ_COMMUNITY_[A-Z0-9_]{1,80}$/.test(config.credentialRef)){reject(fail('来源凭据引用无效','AUTH'));return;}env.QQ_COMMUNITY_CREDENTIAL=process.env[config.credentialRef]||readDshCredential(config.credentialRef);}
    let child,settled=false,buffer='',bytes=0;const decoder=new StringDecoder('utf8');let id=0,pending=new Map(),timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(child){child.stdin?.end();killReader(child);}error?reject(error):resolve(value);};
    const abort=()=>{if(mcp&&child?.stdin?.writable)child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'管理员取消'}})+'\n');finish(fail('来源读取已取消','CANCELLED'));};
    const send=(method,params)=>new Promise((res,rej)=>{const n=++id;pending.set(n,{res,rej});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
    try{child=spawnProcess(config.command,config.args,{windowsHide:true,shell:false,env,stdio:['pipe','pipe','pipe']});}catch{finish(fail('来源只读程序无法启动','UNAVAILABLE'));return;}
    timer=setTimeout(()=>finish(fail('来源网络读取超时','TIMEOUT')),timeoutMs);timer.unref?.();signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>finish(fail('来源只读程序无法启动','UNAVAILABLE')));child.stdin.on('error',()=>finish(fail('来源只读程序通信中断')));
    child.stderr.on('data',()=>{}); // Raw stderr may contain platform cookies; never persist or return it.
    child.stdout.on('data',chunk=>{try{bytes+=chunk.length;if(bytes>512000)throw fail('来源返回超过单次读取保护');buffer+=decoder.write(chunk);let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const row=JSON.parse(line);if(mcp){const p=pending.get(row.id);if(p){pending.delete(row.id);row.error?p.rej(fail('来源MCP接口拒绝请求')):p.res(row.result);}}else {if(row.error)throw fail(row.error==='AUTH'?'来源授权失效':row.error==='RATE_LIMITED'?'来源访问频率受限':row.error==='INVALID_FORUM'?'贴吧不存在或目标不匹配':row.error==='TIMEOUT'?'来源读取超时':row.error==='UNAVAILABLE'?(row.reason==='指定贴吧暂不开放，平台拒绝读取'?row.reason:'只读依赖未安装或接口不兼容'):'来源网络读取失败',row.error);finish(null,row);}}}catch(e){finish(e.kind?e:fail('来源只读程序返回格式无效'));}});
    child.on('close',()=>{if(!settled)finish(fail('来源只读程序提前结束'));});
    if(!mcp){child.stdin.end(JSON.stringify(request)+'\n');return;}
    void(async()=>{try{
      await send('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'bigfatfish-readonly',version:'4.1'}});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      const tools=await send('tools/list',{});const allowed=['get_login_status','search_videos','get_feed','suggest_keywords','get_video_info','get_parts','get_subtitles','get_comments','get_comment_replies'];
      if(request.name==='__probe'){if(!['get_login_status','search_videos','get_subtitles','get_comments'].every(n=>tools.tools?.some(t=>t.name===n)))throw fail('来源MCP缺少所需只读能力','UNAVAILABLE');}
      const name=request.name==='__probe'?'get_login_status':request.name;if(!allowed.includes(name))throw fail('来源操作不在只读白名单','UNAVAILABLE');
      const result=await send('tools/call',{name,arguments:{description:name+':管理员授权的公共知识只读学习',...request.args}});
      if(result.isError)throw fail('来源MCP调用失败，请检查登录、访问配额和客户端日志');
      const value=result.structuredContent||JSON.parse(result.content?.find(c=>c.type==='text')?.text||'null');finish(null,value);
    }catch(e){finish(e.kind?e:fail('来源MCP返回格式无效'));}})();
  });
}
const jsonField=(row,key)=>{let value=row?.[key];if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw fail('来源字段裁剪结果应为JSON数组');}}if(!Array.isArray(value))throw fail('来源字段裁剪结果无效');return value;};
const jq=expr=>'tojson | fromjson | '+expr+' | tojson';
const accessAt=new Map();
export function explorationQueries(source,topics,goals) {
  const anchor=String(source.target||'').trim(),valid=t=>typeof t==='string'&&t.length>=2&&t.length<=100&&!/[\r\n<>]/.test(t);
  // Keep the operator's authorized anchor on every expanded search. Bounded rotation, not a crawler.
  const directions=[...new Set([...(anchor?[anchor]:[]),...topics.filter(valid),...goals.slice(0,8).map(g=>g.term).filter(valid)])].slice(0,16);
  return directions.map(t=>anchor&&t!==anchor?anchor+' '+t:t);
}
const waitAccess=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted){reject(fail('来源读取已取消','CANCELLED'));return;}const end=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(end,Math.max(0,ms)),abort=()=>{clearTimeout(timer);reject(fail('来源读取已取消','CANCELLED'));};signal?.addEventListener('abort',abort,{once:true});});
export class PlatformReader {
  constructor(root,source,{exchange=processExchange}={}) {this.root=root;this.source=source;this.exchange=exchange;}
  config() {if(!sourceAllowed(this.source))throw fail('来源授权失效','AUTH');const c=connectorConfig(this.root,this.source);if(!c.config)throw fail(c.reason,'UNAVAILABLE');return c.config;}
  async call(action,args,opts) {const config=this.config(),key=this.source.connector,delay=Math.max(2000,Number(config.minRequestMs)||2500);await waitAccess((accessAt.get(key)||0)-Date.now(),opts?.signal);accessAt.set(key,Date.now()+delay);if(config.driver==='aiotieba'){config.args=[...config.args,'-I',fileURLToPath(new URL('./community-tieba.py',import.meta.url))];}return this.exchange(config,config.driver==='polylens'?{name:action,args}:{action,...args,target:this.source.forum?.name||this.source.target,platform:this.source.platform},{...opts,mcp:config.driver==='polylens'});}
  async probe(opts) {const c=this.config(),row=await this.call(c.driver==='polylens'?'__probe':'probe',{},opts);if(c.driver==='polylens'?row?.is_login!==true:row?.ready!==true)throw fail('来源需要正常登录或许可检查未通过','AUTH');if(this.source.platform==='tieba'&&(!row.forum?.id||!forumMatches(this.source.target,row.forum.name)))throw fail('贴吧能力检查未返回匹配的真实贴吧','INVALID_FORUM');return {status:'READY',reason:'已通过只读能力及登录检查',checkedAt:Date.now(),...(row.forum?{forum:row.forum}:{})};}
  async discover({signal,cursor=0,topics=[],goals=[]}) {
    const c=this.config();if(c.driver!=='polylens'){const row=await this.call('discover',{cursor,topics,goals:goals.map(g=>g.term),forum:this.source.forum}, {signal});return this.normalizeDiscovery(row);}
    let state;try{state=typeof cursor==='string'?JSON.parse(cursor):null;}catch{}state??={topic:0,cursor:null};
    const queries=explorationQueries(this.source,topics,goals);if(!queries.length)throw fail('来源没有已授权探索范围','AUTH');
    const searches=state.searches||{},now=Date.now();let index=state.topic||0,keyword;
    for(let i=0;i<queries.length;i++){index=((Number.isSafeInteger(state.topic)?state.topic:0)+i)%queries.length;const q=queries[index];if(!searches[q]?.doneAt||now-searches[q].doneAt>=3600000){keyword=q;break;}}
    if(!keyword)return {items:[],cursor:JSON.stringify(state),hasMore:false};
    const page=searches[keyword]?.cursor??(state.searches?null:state.cursor),signature=hash(JSON.stringify([keyword,page]));
    const row=await this.call('search_videos',{keyword,cursor:page,jq:jq('map({title,url,summary,published_at,tags,comment_count})')},{signal});
    const more=row.has_more===true&&row.next_cursor!=null&&JSON.stringify(row.next_cursor)!==JSON.stringify(page);
    searches[keyword]={cursor:more?row.next_cursor:null,...(!more?{doneAt:now}:{}),last:signature};
    const items=jsonField(row,'results').map(r=>({id:r.url?.match(/\/(BV[\w]+|av\d+)/)?.[1],title:r.title,summary:(r.summary||'').slice(0,400),url:r.url,publishedAt:Date.parse(r.published_at)||0,tags:r.tags,stableVideo:true,commentVersion:String(r.comment_count||0)}));
    return this.normalizeDiscovery({items,cursor:JSON.stringify({topic:(index+1)%queries.length,searches:Object.fromEntries(queries.filter(q=>searches[q]).map(q=>[q,searches[q]])),cursor:more?row.next_cursor:null}),hasMore:more||queries.some(q=>!searches[q]?.doneAt)});
  }
  normalizeDiscovery(row) {if(!Array.isArray(row?.items)||row.items.length>100)throw fail('来源发现数据无效');return {...row,items:row.items.map(r=>{if(!/^[\w-]{1,100}$/.test(r.id)||typeof r.title!=='string'||r.title.length>200||!sourceURL(r.url,this.source.platform))throw fail('来源材料标识或链接无效');if(this.source.platform==='tieba'&&(!r.stableThread||!/^\d+$/.test(r.id)||new URL(r.url).pathname!=='/p/'+r.id||!r.forum?.id||!forumMatches(this.source.target,r.forum.name)))throw fail('贴吧材料不属于登记目标','INVALID_FORUM');return {id:r.id,title:r.title,summary:String(r.summary||'').slice(0,400),url:r.url,publishedAt:r.publishedAt,tags:String(r.tags||'').slice(0,200),...(r.stableThread?{stableThread:true,forum:r.forum,replyCount:r.replyCount,lastReplyAt:r.lastReplyAt}:{}),...(r.stableVideo?{stableVideo:true,commentVersion:r.commentVersion,subtitleVersion:r.subtitleVersion}:{}),metadataVersion:hash(JSON.stringify([r.title,r.summary,r.tags])),fingerprint:hash(JSON.stringify(r.stableThread?['thread',this.source.id,r.id]:r.stableVideo?['video',this.source.platform,r.id]:[r.id,r.title,r.summary,r.updatedAt||r.revision||r.publishedAt]))};})};}
  async contentVersion(item,{signal}={}) {
    if(this.config().driver!=='polylens')return null;
    const r=await this.call('get_subtitles',{video:item.id,jq:jq('map(.content) | join("\\n")')},{signal});let text=r.subtitles;
    if(typeof text!=='string')throw fail('来源字幕版本无效');try{text=JSON.parse(text);}catch{}
    if(typeof text!=='string'||text.length>120000)throw fail('来源字幕超过版本检查保护');return hash(text);
  }
  async fetch(item,{signal,readCursor=null,offset=item.offset||0}={}) {
    const c=this.config();if(c.driver!=='polylens'){const r=await this.call('read',{id:item.id,cursor:readCursor,forum:item.forum},{signal});return this.normalizeRead(item,r);}
    const s=readCursor||{stage:'subtitles',offset};let text,next,paginationStopped;
    if(s.stage==='subtitles'){
      const r=await this.call('get_subtitles',{video:item.id,jq:jq(`map(.content) | join("\\n") | .[${s.offset}:${s.offset+2400}]`)},{signal});text=typeof r.subtitles==='string'?r.subtitles:'';try{text=JSON.parse(text);}catch{}
      const characters=Array.from(text).length;
      next=characters>=2400?{stage:'subtitles',offset:s.offset+characters}:{stage:'comments',cursor:null};
    }else if(s.stage==='replies'){
      const r=await this.call('get_comment_replies',{video:item.id,comment_ids:[s.parents[0]],pages:1,start_page:s.page,jq:jq('map({id,parent_id,content})')},{signal});const thread=r.results?.[0],rows=jsonField(thread,'replies');text=rows.length?'主评论 '+s.parents[0]+' 的回复：\n'+rows.map(r=>'回复 '+r.id+' → '+(r.parent_id||s.parents[0])+': '+r.content).join('\n'):'';next=thread?.has_more&&rows.length?{...s,page:s.page+1}:s.parents.length>1?{...s,parents:s.parents.slice(1),page:1}:s.next??null;if(thread?.has_more&&!rows.length)paginationStopped='EMPTY_REPLY_PAGE';
    }else{
      const r=await this.call('get_comments',{video:item.id,count:20,cursor:s.cursor,mode:'newest',jq:jq('map({id,content,reply_count})')},{signal});if(r.message)throw fail('来源访问频率受限','RATE_LIMITED');const rows=jsonField(r,'comments');text=rows.map(r=>'主评论 '+r.id+': '+r.content).join('\n');const parents=rows.filter(r=>r.reply_count>0).map(r=>r.id);const advances=rows.length&&r.next_cursor!=null&&JSON.stringify(r.next_cursor)!==JSON.stringify(s.cursor);const after=r.has_more&&advances?{stage:'comments',cursor:r.next_cursor}:null;next=parents.length?{stage:'replies',parents,page:1,next:after}:after;if(r.has_more&&!advances)paginationStopped=rows.length?'COMMENT_CURSOR_NOT_ADVANCING':'EMPTY_COMMENT_PAGE';
    }
    return {...this.normalizeRead(item,{text,readCursor:next,complete:next===null,contentType:s.stage}),...(s.stage==='subtitles'?{nextOffset:s.offset+Array.from(text).length,offsetUnit:'unicode-codepoints'}:{}),...(paginationStopped?{paginationStopped}:{})};
  }
  normalizeRead(item,r) {if(typeof r?.text!=='string'||r.text.length>16000||typeof r.complete!=='boolean')throw fail('来源正文过大或缺少分页完成标记');const base=this.source.platform==='tieba'?Object.fromEntries(['id','title','summary','url','fingerprint','stableThread','platform','source','forum'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]])):item;return {...base,text:r.text,readCursor:r.readCursor??null,complete:r.complete,nextOffset:(item.offset||0)+r.text.length,contentType:r.contentType||'body',...(this.source.platform==='tieba'?{records:validateTiebaRecords(item,r),forum:r.forum,paginationStopped:r.paginationStopped}:{}),segmentHash:hash(r.text)};}
}

export function forumMatches(target,name) {return typeof name==='string'&&[target,target?.endsWith('吧')?target.slice(0,-1):target].some(t=>t?.normalize('NFC').toLowerCase()===name.normalize('NFC').toLowerCase());}
function validateTiebaRecords(item,r) {
  if(!Array.isArray(r.records)||r.records.length>1||!r.forum?.id||!forumMatches(item.forum?.name||'',r.forum.name)||String(item.forum.id)!==String(r.forum.id))throw fail('贴吧读取缺少匹配的结构化证据','INVALID_FORUM');
  if(!r.complete&&(!r.readCursor||typeof r.readCursor!=='object'))throw fail('贴吧缺少后续阅读游标');
  for(const x of r.records)if(x.tid!==item.id||!/^\d+$/.test(x.pid)||x.replyId!==null&&!/^\d+$/.test(x.replyId)||x.replyId&&x.parentPid!==x.pid||typeof x.text!=='string'||!r.text.endsWith(x.text)||hash(x.text)!==x.contentHash||!/^([a-f0-9]{64})$/.test(x.itemHash)||!Number.isSafeInteger(x.offset)||x.offset<0||!Number.isSafeInteger(x.end)||x.end<x.offset||typeof x.itemComplete!=='boolean')throw fail('贴吧楼层/回复结构或内容哈希无效');
  return r.records;
}
