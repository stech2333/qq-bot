import path from 'node:path';
import {fixture,A} from './style-test-fixture.mjs';
import {createSlangEntry,saveSlang} from '../../integrations/qq-bridge/src/slang-learner.js';
export function slangFixture(t){const f=fixture(t);f.app.settings.slangPolicy.enabled=true;f.app.settings.slangPolicy.autoConfirm=true;const st=f.app.states.get(A);for(let i=0;i<6;i++)f.feed(A,i,{plain:'今天又在摸鱼讨论'+i,time:Date.now()-i*600000});
 const entry=createSlangEntry({content:'摸鱼'}),entries=[entry],file=path.join(f.root,'state/slang.json'),store={entries:()=>entries,writable:()=>true,save:()=>{saveSlang(file,entries);return true;}};
 const rows=f.app.learningWindow.messages(A,st).map(m=>({...m,messageId:A+':'+m.messageId,sourceId:String(m.messageId),sourceKey:A}));
 const output={approved:true,confidence:.95,sourceMessageIds:rows.map(r=>r.messageId),senses:[{meaning:'工作间隙偷闲',usage:'轻松聊天时使用',contextTerms:['工作'],sourceMessageIds:rows.map(r=>r.messageId),publicSources:['https://example.org/slang'],generalizable:true,privateReferences:false}]};
 f.app.slang.verifyPublicSources=async()=>['https://example.org/slang'];return {...f,entry,entries,file,store,rows,output};}
