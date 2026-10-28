import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, backupOnce } from './state-store.mjs';
import { STRATEGIES, SCENES, ACTIONS, STRUCTURES, day, enumList } from './expression-memory.mjs';
export const STYLE_TRAITS = {
  tone: { casual: '自然随和', restrained: '认真克制', playful: '轻松幽默' },
  wording: { plain: '用词直白', colloquial: '自然口语', vivid: '用具体形象的说法' },
  sentences: { short: '简短完整的句子', mixed: '长短句自然交替', detailed: '需要时充分解释' },
  structure: { direct: '先表达结论或态度，再按需要补理由', reasoned: '围绕具体理由展开', example: '用贴切的具体例子帮助说明' },
  engagement: { addView: '接住话题后补充自己的具体观点', followTopic: '围绕对方实际话题自然延续', acknowledge: '简短回应实际内容，再按需要展开' },
  paragraphs: { compact: '表达紧凑，不刻意拆碎', separated: '一个完整意思一段', mixed: '按内容自然分段' },
  punctuation: { plain: '标点克制', expressive: '合适时少量使用语气标点' },
  emotes: { rare: '少用表情', normal: '按语境适量使用表情', frequent: '闲聊中适度使用表情，严肃问题不用' }
};

const DEFAULTS = { enabled:true, apply:true, lookbackHours:720, minMessages:20, minDays:3, minSpeakers:2, featureMinMessages:3, refreshHours:6, minNewMessages:10, dailyCap:4, maxChanges:2, stabilityRounds:2 };
export function globalStyleSettings(value={}) {
  const p=Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,value[k]??v]));
  for(const k of ['enabled','apply']) if(typeof p[k]!=='boolean') throw Error('全局风格开关无效');
  for(const [k,lo,hi] of [['lookbackHours',72,720],['minMessages',20,500],['minDays',3,30],['minSpeakers',2,20],['featureMinMessages',3,48],['refreshHours',1,168],['minNewMessages',3,100],['dailyCap',0,30],['maxChanges',1,3],['stabilityRounds',2,10]]) if(!Number.isInteger(p[k])||p[k]<lo||p[k]>hi) throw Error('全局风格门槛无效：'+k);
  return p;
}
const empty=()=>({schemaVersion:3,scope:'global',revision:0,version:0,generation:randomUUID(),features:{},expressionExamples:[],candidates:[],published:[],history:[],blocked:{},cutoff:0,research:{},lastSources:[],createdAt:Date.now(),updatedAt:0,lastLearnedAt:0,locked:false,migration:{version:3,legacyImported:false}});
const sourceRefs=e=>({sources:(Array.isArray(e?.sources)?e.sources:[]).filter(r=>r&&typeof r.id==='string'&&Number.isFinite(r.time)).map(r=>({id:r.id,key:r.key,speaker:r.speaker,time:r.time})).slice(-48)});
export class GlobalStyle {
  constructor(app) {
    this.app=app; this.file=path.join(app.root,'state/global-style-v3.json'); this.state=empty();this.error='';
    try {
      if(fs.existsSync(this.file)) { const raw=JSON.parse(fs.readFileSync(this.file,'utf8')); if(raw.schemaVersion!==3||raw.scope!=='global'||!Number.isSafeInteger(raw.revision)||!Array.isArray(raw.candidates)||!Array.isArray(raw.history)||!raw.features||!Array.isArray(raw.expressionExamples)) throw Error(); enumList(STRATEGIES,raw.published,6);this.state=raw; }
      else this.migrate();
    } catch {this.error='全局风格记录/迁移失败，已停止覆盖';}
  }
  migrate() {
    const legacy=[];
    for(const name of ['global-style.json','global-expressions.json']) {const file=path.join(this.app.root,'state',name);if(fs.existsSync(file)){const raw=JSON.parse(fs.readFileSync(file,'utf8'));backupOnce(file);legacy.push({file:name,version:raw.version||0});if(name==='global-expressions.json')this.state.published=enumList(STRATEGIES,raw.published||[],6);}}
    const dir=path.join(this.app.root,'state/group-styles');
    if(fs.existsSync(dir))for(const name of fs.readdirSync(dir).filter(n=>/^[a-f\d]{24}\.json$/.test(n))){const file=path.join(dir,name),raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.schemaVersion!==2)throw Error();backupOnce(file);legacy.push({file:'group-styles/'+name,version:raw.version||0});
      for(const [trait,f]of Object.entries(raw.features||{}))if(Object.hasOwn(STYLE_TRAITS,trait)&&Object.hasOwn(STYLE_TRAITS[trait],f.value))this.state.candidates.push({kind:'feature',trait,value:f.value,observations:0,status:'migration-pending',updatedAt:Date.now(),evidence:sourceRefs(f.evidence),legacyScope:raw.scope});
      for(const e of raw.expressionExamples||[])if(Object.hasOwn(SCENES,e.scene)&&Object.hasOwn(ACTIONS,e.action)&&Object.hasOwn(STRUCTURES,e.structure)&&Object.hasOwn(STRATEGIES,e.strategy))this.state.candidates.push({kind:'legacy-expression',observations:0,status:'migration-pending',updatedAt:Date.now(),scene:e.scene,action:e.action,structure:e.structure,strategy:e.strategy,evidence:sourceRefs(e.evidence),legacyScope:raw.scope});
    }
    this.state.migration={version:3,at:Date.now(),backups:legacy,legacyImported:false,reason:'旧群结果保留为待重新验证候选，不直接应用'};
    this.save(this.state);
  }
  allowed(key){const m=/^(group|private):([1-9]\d{4,15})$/.exec(key||'');if(!m)return false;const f=m[1]==='group'?'groups':'private';return(this.app.config.allow?.[f]||[]).map(String).includes(m[2])&&!(this.app.config.deny?.[f]||[]).map(String).includes(m[2]);}
  save(next){if(this.error)throw Error(this.error);atomicJson(this.file,next);this.state=next;this.app.learningSources?.cache.clear();}
  evidenceValid(item,now=Date.now(),index){if(item.manual)return true;const p=this.app.settings.globalStyleLearning,s=item.evidence?.sources||[];return new Set(s.map(r=>r.id)).size>=p.featureMinMessages&&s.every(r=>this.app.learningSources.retained(r))&&new Set(s.map(r=>r.speaker)).size>=p.minSpeakers&&new Set(s.map(r=>day(r.time))).size>=p.minDays;}
  active(now=Date.now()){
    const s=this.state,p=this.app.settings.globalStyleLearning;if(this.error||!p.apply)return null;
    return {...s,features:Object.fromEntries(Object.entries(s.features).filter(([k,f])=>Object.hasOwn(STYLE_TRAITS,k)&&Object.hasOwn(STYLE_TRAITS[k],f.value)&&this.evidenceValid(f,now))),expressionExamples:s.expressionExamples.filter(e=>e.status==='approved'&&e.scope==='global'&&this.evidenceValid(e,now))};
  }
  record(next,reason){if(!next.history.length)next.history.push({version:next.version,at:Date.now(),features:structuredClone(this.state.features),expressionExamples:structuredClone(this.state.expressionExamples),published:[...this.state.published],reason:'baseline'});next.version++;next.history.push({version:next.version,at:Date.now(),reason,features:structuredClone(next.features),expressionExamples:structuredClone(next.expressionExamples),published:[...next.published]});next.history=next.history.slice(-20);}
  strategies(scene){if(!this.app.settings.globalStyleLearning.apply)return[];let community=[];try{if(this.app.settings.communityLearning.applyKnowledge&&!this.state.locked)community=this.app.community.open(false)?.communityStrategies(this.state.cutoff||0)||[];}catch{}return [...new Set([...this.state.published,...community])].filter(id=>Object.hasOwn(STRATEGIES,id)&&(['help','technical'].includes(scene)?['explain','clarify','independent_view'].includes(id):id!=='explain')).slice(0,2);}
  hint(){return '';}
  job(now){return this.app.styleLearning.jobs(now)[0]||null;}
  view(){return{ok:true,...structuredClone(this.state),sample:this.app.learningSources.sample(),policy:this.app.settings.globalStyleLearning,choices:STRATEGIES,traits:STYLE_TRAITS,error:this.error,replyDelivery:this.app.settings.replyDelivery};}
  admin(method,body){if(method==='GET')return this.view();if(method!=='POST'||body.revision!==this.state.revision)throw Error('全局风格版本已变化');const next=structuredClone(this.state);
    if(body.action==='rollback'){const old=next.history.find(h=>h.version===body.version);if(!old)throw Error('版本不存在');next.features=structuredClone(old.features);next.expressionExamples=structuredClone(old.expressionExamples);next.published=old.published||[];next.locked=true;this.record(next,'rollback');}
    else if(body.action==='reset'){Object.assign(next,{features:{},expressionExamples:[],candidates:[],history:[],blocked:{},cutoff:Date.now(),generation:randomUUID(),lastSources:[]});next.version++;}
    else if(body.action==='publish'){next.published=enumList(STRATEGIES,body.strategies,6);this.record(next,'admin');}
    else if(body.action==='configure'){if(typeof body.locked==='boolean')next.locked=body.locked;}
    else throw Error('全局风格操作无效');
    next.revision++;next.updatedAt=Date.now();next.research={};this.save(next);return this.view();
  }
}
