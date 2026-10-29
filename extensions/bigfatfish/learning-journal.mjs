import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const MODULES=new Set(['system','memory','window','topic','interest','research','style','slang','mood']);
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
const COUNTS=new Set(['facts','archived','summaryChars','interests','revision','topics','active','added','retained','todayUsed','samples','verifiedSenses','extracted','changes','candidates','features','expressions','version','confirmed','total','done','approved','uncertain','failed','skipped','history','applied','hits','selected','injected','sentTurns','literalUses']);
// An explicit metadata schema: never accept prompts, messages, facts, quotes or provider output.
export class LearningJournal {
  constructor(root) {this.directory=path.join(root,'logs','bridge','learning');this.maxBytes=10*1024*1024;this.written=0;this.lastAt=0;this.error='';}
  write(module,event,{key,task,status,reasonCode,counts={}}={}) {
    try {
      if(!MODULES.has(module)||!CODE.test(event))throw Error();
      const at=Date.now(),record={id:randomUUID(),at,module,event};
      if(/^(group|private):[1-9]\d{4,15}$/.test(key||'')){record.scope=createHash('sha256').update(key).digest('hex').slice(0,24);record.scopeType=key.split(':')[0];}
      if(/^[a-f0-9-]{36}$/.test(task||''))record.task=task;
      if(CODE.test(status||''))record.status=status;
      if(CODE.test(reasonCode||''))record.reasonCode=reasonCode;
      const safe={};for(const [k,v] of Object.entries(counts).slice(0,32))if(COUNTS.has(k)&&Number.isSafeInteger(v)&&v>=0)safe[k]=v;
      if(Object.keys(safe).length)record.counts=safe;
      const date=new Date(at+8*3600000).toISOString().slice(0,10),line=JSON.stringify(record)+'\n';
      fs.mkdirSync(this.directory,{recursive:true});
      let part=0,file;
      do {file=path.join(this.directory,date+(part?'.'+part:'')+'.jsonl');if(!fs.existsSync(file)||fs.statSync(file).size+Buffer.byteLength(line)<=this.maxBytes)break;part++;}while(part<1000);
      if(part>=1000)throw Error();
      fs.appendFileSync(file,line,{encoding:'utf8',mode:0o600});this.written++;this.lastAt=at;this.error='';return record.id;
    } catch {this.error='学习事件日志保存失败，请检查日志目录权限与磁盘空间';return '';}
  }
  snapshot() {return {ok:!this.error,error:this.error,writtenThisProcess:this.written,lastAt:this.lastAt};}
}
