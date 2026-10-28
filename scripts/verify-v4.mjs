// Full offline acceptance runner. Invoke only after implementation, docs and static review.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),bridge=path.join(root,'integrations/qq-bridge'),out=path.join(root,'logs/audit');
fs.mkdirSync(out,{recursive:true});const results=[];
const temp=path.join(out,'v4-temp');fs.mkdirSync(temp,{recursive:true});
const testEnv={...process.env,TEMP:temp,TMP:temp,QQ_BRIDGE_TEST_LIVE:'0',DSH_INSTALL_MODULES:path.join(root,'node_modules'),DSH_HOME:path.join(root,'data-bridge')};
const steps=[
  ['prepare',['scripts/prepare-bridge.cjs']],
  ['integration',['scripts/apply-bridge-extension.cjs']],
  ['root-tests',['--test','--test-timeout=30000','--test-reporter=tap',...fs.readdirSync(path.join(root,'extensions/bigfatfish')).filter(f=>f.endsWith('.test.mjs')).map(f=>'extensions/bigfatfish/'+f)]],
  ['project-audit',['scripts/audit-project.cjs']],
  ['bridge-audit',['scripts/test-audit.mjs'],bridge],
  ['bridge-token',['scripts/test-token-economy.mjs'],bridge],
  ['bridge-wait',['scripts/test-reply-wait.mjs'],bridge],
  ['bridge-model-view',['scripts/test-qq-model-view.mjs'],bridge],
  ['bridge-preset',['scripts/test-qq-preset-contract.mjs'],bridge],
  ['bridge-role-card',['scripts/test-role-card.mjs'],bridge],
  ['session-router',['--test','src/core/session-router.test.mjs'],bridge],
  ['console-ui',['scripts/check-console-ui.cjs']],
  ['community-ui',['scripts/check-community-ui.cjs']],
  ['metrics',['scripts/measure-v4.mjs']],
];
for(const [name,args,cwd=root]of steps){
  const log=path.join(out,'v4-'+name+'.log'),stream=fs.createWriteStream(log),started=Date.now();
  console.log('START '+name);const child=spawn(process.execPath,args,{cwd,windowsHide:true,env:testEnv,stdio:['ignore','pipe','pipe']});child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
  const code=await new Promise(resolve=>{child.once('error',()=>resolve(-1));child.once('close',resolve);});await new Promise(resolve=>stream.end(resolve));
  results.push({name,command:[process.execPath,...args],cwd,code,ms:Date.now()-started,log});console.log((code===0?'PASS ':'FAIL ')+name+' ('+Math.round((Date.now()-started)/1000)+'s)');
}
const summary={at:new Date().toISOString(),node:process.version,results,limitations:['Only disposable fixture peers and synthetic community materials; no production QQ, platform login/crawling, paid model requests or deployment.']};
fs.writeFileSync(path.join(out,'v4-validation.json'),JSON.stringify(summary,null,2));process.exitCode=results.every(r=>r.code===0)?0:1;
