// UI-only verification. Never invokes verify-v4, the project audit, or learning/model/QQ tests.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'logs/audit');fs.mkdirSync(out,{recursive:true});
const results=[],template=fs.readFileSync(path.join(root,'extensions/bigfatfish/console-v3.html'),'utf8');
const scripts=['console-policy.js','console-memory.js','console-api-pool.js','console-v3.js','console-community.js'].map(name=>fs.readFileSync(path.join(root,'extensions/bigfatfish',name),'utf8')).join('\n');
const expected=template.replace('<!--V3_SCRIPT-->',()=>'<script>\n'+scripts+'\n</script>');
const synchronized=fs.readFileSync(path.join(root,'integrations/qq-bridge/public/console.html'),'utf8')===expected;
results.push({name:'generated-console',code:synchronized?0:1});console.log((synchronized?'PASS':'FAIL')+' generated-console');
for(const [name,args]of [
  ['navigation-contract',['--test','--test-name-pattern=V4 integration patch','extensions/bigfatfish/community-bridge.test.mjs']],
  ['community-page',['scripts/check-community-ui.cjs']],
]){
  const log=path.join(out,'community-ui-'+name+'.log'),stream=fs.createWriteStream(log);console.log('START '+name);
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,env:{...process.env,QQ_BRIDGE_TEST_LIVE:'0'},stdio:['ignore','pipe','pipe']});child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
  const code=await new Promise(resolve=>{child.once('error',()=>resolve(-1));child.once('close',resolve);});await new Promise(resolve=>stream.end(resolve));results.push({name,command:[process.execPath,...args],code,log});console.log((code===0?'PASS ':'FAIL ')+name);
}
fs.writeFileSync(path.join(out,'community-ui-validation.json'),JSON.stringify({at:new Date().toISOString(),results,excluded:['full project regression/audit','community acquisition, extraction and database algorithms','DSH/persona/mood/slang algorithms','real platform/DeepSeek/QQ calls']},null,2));process.exitCode=results.every(r=>r.code===0)?0:1;
