// Local synthetic workload only. These measurements are not model tokens or production latency.
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fixture} from '../extensions/bigfatfish/community-test-fixture.mjs';
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)});
try {
  f.setup();const st=f.state('group:123456');st.unread=[{messageId:'1',plain:'工作时摸鱼是什么意思',userId:'111111'}];const before=f.app.instruction('group:123456',st).length;
  const started=performance.now();await f.run();const publishMs=performance.now()-started;const times=[];
  for(let i=0;i<200;i++){const start=performance.now();f.app.community.retrieve('工作时摸鱼是什么意思');times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);const after=f.app.instruction('group:123456',st).length;
  const result={workload:'one synthetic document, one published sense, 200 local retrievals; mocked model, no external requests',retrievalMs:{min:times[0],median:times[100],p95:times[190],max:times.at(-1)},syntheticPipelineMs:publishMs,promptChars:{withoutCommunity:before,withCommunity:after,added:after-before},syntheticPublished: f.app.community.store.list().length,actualProviderUsage:null,actualCost:null,qqFirstReplyMs:null,realPublishSuccessRate:null};
  const out=path.resolve('logs/audit/v4-metrics.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{for(const fn of cleanups)fn();}
