import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BigFatFish } from './runtime.mjs';
import { communitySettings } from './community-learning.mjs';
import { normalizeSource } from './community-adapters.mjs';

export const source = () => normalizeSource({ id:'synthetic',platform:'bilibili',adapter:'authorized-file',file:'synthetic.json',enabled:true,
  license:{reference:'仅用于离线测试的自有合成材料授权',allowRead:true,allowStore:true,allowLearning:true,expiresAt:0} });
export const item = (id='post1',extra={}) => ({id,title:'游戏文化：摸鱼',summary:'关于游戏文化中的摸鱼说法',text:'摸鱼在这里指工作间隙偷闲。轻松闲聊时使用。',url:'https://www.bilibili.com/video/BVsynthetic'+id,publishedAt:Date.now()-1000,...extra});
export const candidate = (extra={}) => ({kind:'slang',term:'摸鱼',meaning:'工作间隙偷闲',usage:'轻松闲聊时使用',contextTerms:['工作'],evidence:[{id:'post1',quote:'摸鱼在这里指工作间隙偷闲。'}],confidence:.95,conflict:false,...extra});
// Test-only reconstruction of an actual old schema, rather than lying about PRAGMA on v3 tables.
export function legacySchema(db,version=2) {
  db.exec(`DROP TABLE material_queue; DROP TABLE source_state; DROP TABLE learning_sessions; DROP TABLE learning_goals;
    DROP INDEX knowledge_term; ALTER TABLE knowledge DROP COLUMN term_key;
    DROP INDEX candidates_term; ALTER TABLE candidates DROP COLUMN term_key;
    DROP INDEX usage_session; ALTER TABLE usage DROP COLUMN session_id;
    DROP INDEX logs_session; ALTER TABLE community_logs DROP COLUMN session_id;
    ALTER TABLE community_logs DROP COLUMN platform; ALTER TABLE community_logs DROP COLUMN phase;`);
  if(version===1)db.exec('DROP TABLE community_logs');db.exec('PRAGMA user_version='+version);
}
export function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bff-v4-community-'));
  const config={bigfatfish:{expectedQQ:'123456789'},allow:{groups:['123456','123457'],private:['333333']},deny:{groups:[],private:[]}};
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
  const app=new BigFatFish(root,config), calls=[];
  app.community.options.autoSchedule=false;
  t.after(async()=>{app.community.close();await app.community.done.catch(()=>{});app.community.store?.close();app.community.store=null;fs.rmSync(root,{recursive:true,force:true});});
  const writeItems=items=>{const dir=path.join(root,'state/community-imports');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'synthetic.json'),JSON.stringify({version:1,items}));};
  const configure=patch=>{const prev=app.settings.communityLearning;app.settings.communityLearning=communitySettings({...prev,...patch});app.community.settingsChanged(prev);};
  const setup=()=>{writeItems([item()]);app.community.open().saveSource(source(),0);configure({enabled:true,platforms:{bilibili:true},topics:['游戏文化'],inputPriceCeiling:2,outputPriceCeiling:8});};
  const model={ready:()=>true,run:async request=>{calls.push(request);const payload=JSON.parse(request.prompt);const data=request.stage==='select'?{ids:payload.items.map(i=>i.id).slice(0,2)}:request.stage==='verify'?{approved:payload.candidates.map((_,i)=>i)}:{candidates:[candidate({evidence:[{id:payload.items[0].id,quote:'摸鱼在这里指工作间隙偷闲。'}]})]};return {text:JSON.stringify(data),usage:{input:80,output:60,reasoning:20,cacheHit:10}};}};
  app.community.connect(model);
  const run=()=>app.community.tick({manual:true});
  const state=(key)=>{const st={recentMessages:[],unread:[],activeTopics:[],pendingThoughts:[],memberImpressions:{}};app.bind(key,st);return st;};
  return {root,app,config,calls,model,writeItems,configure,setup,run,state};
}
