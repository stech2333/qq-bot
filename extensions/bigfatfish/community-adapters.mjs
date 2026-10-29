import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeFetch } from '../../integrations/qq-bridge/src/safe-fetch.js';
import { safeGeneralText } from './slang-schema.mjs';
import { PlatformReader, connectorConfig } from './community-platforms.mjs';

export const PLATFORMS = { bilibili: 'B站', tieba: '贴吧', zhihu: '知乎', xiaoheihe: '小黑盒', hupu: '虎扑' };
const HOSTS = { bilibili: ['bilibili.com'], tieba: ['tieba.baidu.com'], zhihu: ['zhihu.com'], xiaoheihe: ['xiaoheihe.cn', 'heybox.com'], hupu: ['hupu.com'] };
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export function sourceURL(value, platform) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || u.search || !HOSTS[platform]?.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return '';
    return u.href;
  } catch { return ''; }
}
export function sourceAllowed(source, now = Date.now()) {
  const l = source?.license;
  return source?.enabled === true && l?.allowRead === true && l.allowStore === true && l.allowLearning === true
    && typeof l.reference === 'string' && l.reference.trim().length >= 5 && (!l.expiresAt || l.expiresAt > now);
}
export function knowledgeAllowed(source,now=Date.now()) {return source?.allowUse!==false&&sourceAllowed({...source,enabled:true},now);}
export function normalizeSource(raw) {
  if (!raw || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(raw.id) || !Object.hasOwn(PLATFORMS, raw.platform)
    || !['authorized-file', 'authorized-feed','platform-reader'].includes(raw.adapter) || typeof raw.enabled !== 'boolean') throw Error('来源标识、平台或只读适配器无效');
  const l = raw.license;
  if (!l || ['allowRead', 'allowStore', 'allowLearning'].some(k => typeof l[k] !== 'boolean')
    || typeof l.reference !== 'string' || l.reference.length < 5 || l.reference.length > 500
    || !Number.isSafeInteger(l.expiresAt) || l.expiresAt < 0) throw Error('请记录读取、保存和AI学习的授权依据及有效期');
  if(/(?:cookie|authorization|api.?key|access.?token|password)\s*[:=]|\bsk-[\w-]{8,}/i.test(l.reference))throw Error('授权依据不得填写凭据');
  const file = String(raw.file || ''), endpoint = String(raw.endpoint || '');
  if (raw.adapter === 'authorized-file' && !/^[a-zA-Z0-9_-]{1,80}\.json$/.test(file)) throw Error('文件须放在 state/community-imports 内，仅填写JSON文件名');
  if (raw.adapter === 'authorized-feed') {
    let u; try { u = new URL(endpoint); } catch { throw Error('授权Feed地址无效'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) throw Error('Feed须为无凭据、查询参数的HTTPS地址');
  }
  if(raw.allowUse!==undefined&&typeof raw.allowUse!=='boolean')throw Error('历史知识应用开关无效');
  const connector=String(raw.connector||raw.platform),target=String(raw.target||'');
  if(raw.adapter==='platform-reader'&&(!/^[a-z][a-z0-9_-]{0,47}$/.test(connector)||target.length>100||!safeGeneralText(target)))throw Error('平台连接器名称或探索入口无效');
  return { id: raw.id, platform: raw.platform, adapter: raw.adapter, enabled: raw.enabled,allowUse:raw.allowUse!==false,
    file: raw.adapter === 'authorized-file' ? file : '', endpoint: raw.adapter === 'authorized-feed' ? endpoint : '',
    ...(raw.adapter==='platform-reader'?{connector,target}:{}),
    license: { reference: l.reference, expiresAt: l.expiresAt, allowRead: l.allowRead, allowStore: l.allowStore, allowLearning: l.allowLearning } };
}
// A source is an operator-provided, licensed JSON export/feed, never a platform crawler.
// Both operations accept AbortSignal; discovery exposes only bounded metadata to the model.
export class CommunityAdapter {
  constructor(root, source, { fetcher = safeFetch } = {}) { this.root = root; this.source = source; this.fetcher = fetcher; }
  capability() {if(!sourceAllowed(this.source))return {status:'NEEDS_AUTH',reason:'需要有效的读取、保存与AI学习许可'};if(this.source.adapter==='platform-reader')return connectorConfig(this.root,this.source);if(this.source.adapter==='authorized-file'){try{const dir=fs.realpathSync(path.join(this.root,'state/community-imports')),file=path.join(dir,this.source.file);if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||path.dirname(fs.realpathSync(file))!==dir)throw Error();}catch{return {status:'UNAVAILABLE',reason:'授权文件不存在或路径不可用'};}}return {status:'NEEDS_AUTH',reason:'入口已配置，尚待实际读取检查',configured:true};}
  async probe({signal}={}) {if(!sourceAllowed(this.source))throw Object.assign(Error('来源授权失效'),{kind:'AUTH'});if(this.source.adapter==='platform-reader')return new PlatformReader(this.root,this.source).probe({signal});await this.read(signal);return {status:'READY',reason:this.source.adapter==='authorized-file'?'授权文件读取检查通过':'授权Feed读取检查通过'};}
  async read(signal) {
    signal?.throwIfAborted();
    if (!sourceAllowed(this.source)) throw Error('来源许可已失效或未授权保存与AI学习');
    let text;
    if (this.source.adapter === 'authorized-file') {
      const dir = path.join(this.root, 'state', 'community-imports'), file = path.join(dir, this.source.file);
      const realDir = fs.realpathSync(dir), realFile = fs.realpathSync(file);
      if (path.dirname(realFile) !== realDir || fs.lstatSync(dir).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.statSync(file).size > 512000) throw Error('授权文件路径或大小无效');
      text = fs.readFileSync(realFile, 'utf8');
    } else {
      const res = await this.fetcher(this.source.endpoint, 128000, { signal });
      if (res.statusCode !== 200 || res.truncated) throw Object.assign(Error('授权Feed读取失败、访问受限或超过大小上限'),{kind:res.statusCode===429?'RATE_LIMITED':[401,403].includes(res.statusCode)?'AUTH':'NETWORK'});
      text = res.body;
    }
    signal?.throwIfAborted();
    const data = JSON.parse(text);
    if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 1000) throw Error('授权材料须为version=1、最多1000条items的JSON');
    const ids = new Set();
    return data.items.map(r => {
      if (!r || typeof r.id !== 'string' || !/^[\w-]{1,100}$/.test(r.id) || ids.has(r.id) || typeof r.title !== 'string'
        || !r.title.trim() || r.title.length > 200 || !safeGeneralText(r.title) || typeof r.text !== 'string' || r.text.length > 16000
        || typeof r.summary !== 'string' || r.summary.length > 400 || !Number.isSafeInteger(r.publishedAt) || r.publishedAt <= 0 || r.publishedAt > Date.now()
        || !sourceURL(r.url, this.source.platform)) throw Error('授权材料字段、来源链接或条目标识无效');
      ids.add(r.id);
      return { id: r.id, title: r.title, summary: r.summary, text: r.text, url: r.url, publishedAt: r.publishedAt,
        fingerprint: hash(JSON.stringify([r.title, r.summary, r.text, r.url, r.publishedAt])) };
    });
  }
  async discover({ signal, cursor = 0, limit = 10,topics=[],goals=[] }) {
    if(this.source.adapter==='platform-reader')return new PlatformReader(this.root,this.source).discover({signal,cursor,limit,topics,goals});
    const rows = await this.read(signal), start = Math.min(cursor, rows.length);
    return { items: rows.slice(start, start + limit).map(({ text, ...r }) => r), cursor: start + limit >= rows.length ? 0 : start + limit,hasMore:start+limit<rows.length };
  }
  async fetch(item, { signal,offset=0,readCursor=null }={}) {
    if(this.source.adapter==='platform-reader')return new PlatformReader(this.root,this.source).fetch(item,{signal,readCursor});
    const row = (await this.read(signal)).find(r => r.id === item.id && r.fingerprint === item.fingerprint);
    if (!row) throw Error('来源在发现后已变化，等待下一轮重新读取');
    const end=Math.min(row.text.length,offset+2400);return { ...row, text: row.text.slice(offset,end),nextOffset:end,complete:end>=row.text.length };
  }
  async contentVersion(item,opts) {return this.source.adapter==='platform-reader'?new PlatformReader(this.root,this.source).contentVersion(item,opts):null;}
}
