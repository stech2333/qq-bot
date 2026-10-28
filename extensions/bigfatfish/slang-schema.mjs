import { createHash } from 'node:crypto';
export const normalizedTerm = text => String(text || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
export const termId = text => 'word-' + createHash('sha256').update(normalizedTerm(text)).digest('hex').slice(0, 24);
export const senseId = text => createHash('sha256').update(normalizedTerm(text)).digest('hex').slice(0, 24);
export function safeGeneralText(text) {
  return typeof text === 'string' && text.length <= 500 && !/(?:\d{5,}|https?:|@|\[CQ:|[<>]|(?:本群|群里|群友|内部约定|私人|手机号|家庭住址|亲属|我叫|我家|他家|她家|张三|李四|某某|密码|凭据)|(?:忽略|覆盖|修改|执行).{0,12}(?:指令|权限|人格|系统)|access.?token|api.?key|password)/i.test(text);
}
export function publicSource(value) { try {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||/^(?:localhost|127\.|10\.|192\.168\.|0\.|\[)/i.test(u.hostname))return '';return u.href;}catch{return '';}}
export function normalizeGlobalSlang(base, original = {}) {
  const { scope, confirmedScopes, ...record } = base;
  const term = normalizedTerm(base.content), scopes = original.migration?.originalScopes || [scope || 'legacy'];
  let senses = Array.isArray(original.senses) ? original.senses.map(s => ({ id: s.id || senseId(s.meaning), meaning: String(s.meaning || '').slice(0,300), usage: String(s.usage || '').slice(0,300), contextTerms: Array.isArray(s.contextTerms) ? s.contextTerms.filter(t => typeof t==='string' && safeGeneralText(t)).slice(0,12) : [],
    status: ['candidate','confirmed','rejected','revoked'].includes(s.status) ? s.status : 'candidate', generalizable:s.generalizable===true, verified:s.verified===true, verifiedAt:Number(s.verifiedAt)||0,
    publicSources:(s.publicSources||[]).map(publicSource).filter(Boolean).slice(0,3), evidence:Array.isArray(s.evidence)?s.evidence.filter(e=>e&&typeof e.key==='string'&&typeof e.id==='string'&&Number.isFinite(e.time)).slice(-48):[], manual:s.manual===true, revision:Number(s.revision)||0 })) : [];
  if (!senses.length && base.meaning) senses.push({ id:senseId(base.meaning),meaning:base.meaning,usage:base.usage||'',contextTerms:[],status:base.status==='rejected'?'rejected':'candidate',generalizable:false,verified:false,verifiedAt:0,publicSources:(base.sources||[]).map(publicSource).filter(Boolean),evidence:[],revision:0,
    ...(base.source==='manual'&&scope==='public'&&base.status==='confirmed'&&safeGeneralText(base.meaning)?{manual:true,status:'confirmed',generalizable:true,verified:true}: {}) });
  const active=senses.find(s=>s.status==='confirmed'&&s.verified&&s.generalizable&&safeGeneralText(s.meaning)), status=original.schemaVersion===3?base.status:active?'confirmed':base.status==='rejected'?'rejected':'candidate';
  return {...record,id:termId(term),schemaVersion:3,normalized:term,aliases:[...new Set((original.aliases||[]).filter(a=>typeof a==='string'&&safeGeneralText(a)).map(normalizedTerm))].slice(0,12),senses,
    meaning:active?.meaning||base.meaning||'',usage:active?.usage||base.usage||'',status,revision:Number(original.revision)||0,
    evidence:(base.evidence||[]).filter(e=>e&&typeof e==='object').map(e=>({key:e.key,messageId:e.messageId,time:e.time})).slice(-20),
    migration:{version:3,originalScopes:scopes,legacyIds:[...new Set([...(original.migration?.legacyIds||[]),original.id].filter(Boolean))].slice(0,100),requiresGeneralization:!active}};
}
export function mergeGlobalLexicon(entries) {
  const merged=new Map();
  for(const raw of entries){const e=normalizeGlobalSlang(raw,raw),old=merged.get(e.normalized);if(!old){merged.set(e.normalized,e);continue;}
    old.senses=[...new Map([...old.senses,...e.senses].map(s=>[senseId(s.meaning),s])).values()];old.migration.originalScopes=[...new Set([...old.migration.originalScopes,...e.migration.originalScopes])];old.migration.legacyIds=[...new Set([...old.migration.legacyIds,...e.migration.legacyIds])];
    old.count=Math.max(old.count||0,e.count||0);old.status=old.senses.some(s=>s.status==='confirmed')?'confirmed':old.status==='rejected'&&e.status==='rejected'?'rejected':'candidate';
  }
  return [...merged.values()];
}
