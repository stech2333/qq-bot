// Run with Bridge stopped. The SQLite snapshot and legacy provenance are retained for rollback.
import fs from 'node:fs';
import path from 'node:path';
import { BigFatFish } from '../extensions/bigfatfish/runtime.mjs';
const root=path.resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||'integrations/qq-bridge');
const state=path.join(root,'state'),lock=path.join(state,'bridge.lock');
if(fs.existsSync(lock)){const pid=Number(fs.readFileSync(lock,'utf8'));if(pid&&pid!==process.pid){try{process.kill(pid,0);throw Error('请先通过启动管理器停止桥接服务');}catch(e){if(e.code!=='ESRCH')throw e;}}}
const rollback=process.argv.find(a=>a.startsWith('--rollback='))?.slice(11);
if(rollback){
  const backup=fs.realpathSync(path.resolve(rollback)),base=fs.realpathSync(path.join(state,'knowledge-backups'))+path.sep;
  if(!backup.startsWith(base)||!fs.existsSync(path.join(backup,'manifest.json')))throw Error('回滚目录必须为本项目的完整迁移备份');
  const manifest=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json')));
  if(manifest.version!==1)throw Error('迁移备份版本不支持');
  for(const name of ['community.sqlite',...(manifest.files||[]).filter(n=>['slang.json','slang.json.deleted.json','bigfatfish-slang-audit.json','slang-research-jobs.json'].includes(n))])if(fs.existsSync(path.join(backup,name)))fs.copyFileSync(path.join(backup,name),path.join(state,name));
  for(const suffix of ['-wal','-shm'])fs.rmSync(path.join(state,'community.sqlite'+suffix),{force:true});
  fs.writeFileSync(path.join(state,'knowledge-migration-paused.json'),JSON.stringify({at:Date.now(),backup,reason:'回滚后暂停自动重新迁移；使用 --migrate 重新启用'}));
  console.log(JSON.stringify({rolledBack:true,backup,automaticRemigrationPaused:true}));
}else{
  if(process.argv.includes('--migrate'))fs.rmSync(path.join(state,'knowledge-migration-paused.json'),{force:true});
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')),app=new BigFatFish(root,config);
  try{
    app.community.options.autoSchedule=false;
    app.slang.connectUnified();
    const result=app.slang.unified.migration;
    fs.writeFileSync(path.join(state,'slang.json.retired.json'),JSON.stringify({authority:'community.sqlite',migration:'qq-slang-v1',backup:result.backup,at:result.at},null,2));
    console.log(JSON.stringify({migration:result,application:app.community.applicationView('group:'+config.allow.groups[0]),learningEnabled:app.settings.communityLearning.enabled}));
  }finally{app.community.close();app.community.store?.close();}
}
