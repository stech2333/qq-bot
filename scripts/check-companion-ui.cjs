// Browser smoke test for ONLY the new companion controls. No live server, account or model is used.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'logs/companion-ui'); fs.mkdirSync(base, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
if (!chrome) throw Error('需要已安装的 Chrome 或 Edge 执行模块页面检查');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const state = { ok: true, key: 'group:123456', revision: 0, archive: [], lastRecall: null,
  facts: [], control: { accumulation: true, personalization: true } };
const mood = { ok: true, key: 'group:123456', revision: 0,
  config: { enabled: false, autoJudge: true, selfName: '大肥鱼', injectMode: 'event', baseline: 70, floor: 20, halfLifeHours: 12,
    emotionHalfLifeMinutes: 90, minConfidence: 0.7, significantDelta: 3, dailyCap: 12, minIntervalMinutes: 5 },
  current: { value: 70, label: '开心', dims: { happy: 0, calm: 0, sweet: 0, heartache: 0, worry: 0, sad: 0, jealous: 0 } },
  dimensionLabels: { happy: '开心', calm: '踏实', sweet: '亲近', heartache: '心疼', worry: '担心', sad: '难过', jealous: '吃醋' },
  history: [], status: '尚未判断', todayUsed: 0, globalTodayUsed: 0, globalDailyCap: 40, connected: true, preview: '' };
const globalStyle = { ok: true, revision: 0, version: 1, locked: false, error: '', replyDelivery: 'natural',
  policy: { enabled: true, apply: true, lookbackHours: 720, minMessages: 20, minDays: 3, refreshHours: 6, minNewMessages: 10, dailyCap: 4, maxChanges: 2 },
  traits: { structure: { direct: '先说结论', example: '贴切举例' } }, research: { status: 'approved' }, sample: { messages: 24, days: 3, qualified: true },
  features: [{ key: 'structure', value: 'direct', label: '<img src=x onerror=alert(1)>先说结论', active: true, manual: false, confidence: 0.95, evidence: 3, days: 3, sources: [{ id: 'source-id', time: Date.now() }] }],
  history: [{ version: 1, at: Date.now(), labels: ['先说结论'] }] };
const html = `<!doctype html><meta charset="utf-8"><title>Companion module isolated check</title>
<div id="mainNav"></div><div id="notice"></div><div id="mainContent"><div class="grid"><section id="section-bff-memory"><select id="bfMemoryKey"><option value="group:123456">group:123456</option></select></section><section id="section-bff-overview"></section></div></div><pre id="companion-test-result">RUNNING</pre>
<script>
window.errors=[]; addEventListener('error', e=>window.errors.push(e.message));
const consolePages={}, memory=${json(state)}, mood=${json(mood)}, globalStyle=${json(globalStyle)}, calls=[];
function showConsoleToast(text){document.getElementById('notice').textContent=text;}
function setConsolePage(page){document.querySelectorAll('[data-page]').forEach(e=>e.hidden=e.dataset.page!==page);}
async function api(url, method='GET', body){
  calls.push({url,method,body});
  if(url==='/api/bigfatfish/status')return {sessions:[{key:memory.key}],allow:{groups:['123456'],private:[]},deny:{}};
  if(url==='/api/bigfatfish/settings'&&method==='POST'&&body.replyDelivery){globalStyle.replyDelivery=body.replyDelivery;return {ok:true,settings:{replyDelivery:body.replyDelivery}};}
  if(url==='/api/bigfatfish/global-style'){
    if(method==='POST'){
      if(body.revision!==globalStyle.revision)return {ok:false,error:'旧版本'};
      if(body.action==='configure')Object.assign(globalStyle.policy,body.policy);
      if(body.action==='lock')globalStyle.locked=body.locked;
      if(body.action==='set')globalStyle.features=[{key:body.key,value:body.value,label:globalStyle.traits[body.key][body.value],manual:true,active:true,evidence:0,days:0}];
      if(body.action==='rollback')globalStyle.locked=true;
      if(body.action==='delete')globalStyle.features=globalStyle.features.filter(f=>f.key!==body.key);
      if(body.action==='reset'){globalStyle.features=[];globalStyle.history=[];}
      globalStyle.revision++;
    }
    return structuredClone(globalStyle);
  }
  if(url.startsWith('/api/bigfatfish/mood')){
    if(method==='POST'&&body.action==='configure'){Object.assign(mood.config,body.config);mood.revision++;}
    return structuredClone(mood);
  }
  if(url.includes('recallQuery='))return {...memory,previewRecall:{query:'咖啡',terms:['咖啡'],chars:100,rows:[{text:'喜欢咖啡',selected:true,matched:['咖啡'],evidence:1,freshness:1,reason:'已召回'}]}};
  if(body?.action==='importPreview')return {ok:true,key:memory.key,revision:memory.revision,importId:'draft',skipped:0,candidates:[{id:'c1',line:1,text:'<img src=x onerror=alert(1)> 喜欢咖啡'}]};
  if(body?.action==='importCommit'){memory.revision++; memory.facts.push({text:'喜欢咖啡'});return structuredClone(memory);}
  return structuredClone(memory);
}
document.addEventListener('bff-memory-changed',e=>document.dispatchEvent(new CustomEvent('bff-memory-view',{detail:e.detail})));
</script><script>${fs.readFileSync(path.join(root, 'extensions/bigfatfish/companion-console.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(root, 'extensions/bigfatfish/global-style-console.js'), 'utf8')}</script>
<script>
(async()=>{
  const check=(ok,label)=>{if(!ok)throw Error(label);};
  const flush=()=>new Promise(r=>setTimeout(r,30));
  document.dispatchEvent(new CustomEvent('bff-memory-view',{detail:memory}));
  document.querySelector('[data-view="bff-mood"]').click();await flush();
  check(!document.getElementById('section-bff-mood').hidden,'mood navigation');
  check(document.querySelectorAll('#bfMoodCurrent meter').length===7,'seven emotion meters');
  const form=document.getElementById('bfMoodSettings');form.elements.enabled.checked=true;form.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();await flush();
  check(calls.some(c=>c.body?.action==='configure'&&c.body.config.enabled===true),'mood configure request');
  document.getElementById('bfRecallQuery').value='咖啡';document.getElementById('bfRecallTest').click();await flush();
  check(document.getElementById('bfRecallRows').textContent.includes('已召回'),'recall explanation');
  document.getElementById('bfImportText').value='喜欢咖啡';document.getElementById('bfImportPreview').click();await flush();
  check(document.querySelectorAll('#bfImportCandidates input:checked').length===1,'import selection');
  check(!document.querySelector('#bfImportCandidates img'),'imported markup must remain text');
  document.getElementById('bfImportCommit').click();await flush();
  check(calls.some(c=>c.body?.action==='importCommit'&&c.body.ids[0]==='c1'),'scoped import commit');
  document.querySelector('[data-view="bff-global-style"]').click();await flush();
  check(!document.getElementById('section-bff-global-style').hidden,'global style navigation');
  check(document.getElementById('bfGlobalStatus').textContent.includes('24 次 / 3 天'),'global corpus status');
  for(const mode of ['single','flow','natural']){
    document.getElementById('bfReplyDelivery').value=mode;document.getElementById('bfReplyDeliveryForm').requestSubmit();await flush();
    check(globalStyle.replyDelivery===mode&&document.getElementById('bfReplyDelivery').value===mode,'delivery mode save/reload '+mode);
  }
  check(!document.querySelector('#bfGlobalFeatures img'),'style labels stay text');
  check(document.querySelector('#bfGlobalFeatures details').textContent.includes('source-id'),'style evidence');
  document.getElementById('bfGlobalLock').click();await flush();check(globalStyle.locked,'lock style');
  document.getElementById('bfGlobalLock').click();await flush();check(!globalStyle.locked,'unlock style');
  document.getElementById('bfGlobalValue').value='example';document.getElementById('bfGlobalSet').click();await flush();
  check(globalStyle.features[0].value==='example','manual trait');
  document.getElementById('bfGlobalRollback').click();await flush();check(globalStyle.locked,'rollback locks style');
  const styleForm=document.getElementById('bfGlobalPolicy');styleForm.elements.apply.checked=false;styleForm.requestSubmit();await flush();
  check(!globalStyle.policy.apply,'application switch');
  document.querySelector('#bfGlobalFeatures button').click();await flush();check(!globalStyle.features.length,'forget trait');
  document.getElementById('bfGlobalReset').click();await flush();check(!globalStyle.history.length,'clear style history');
  check(errors.length===0,'browser script errors: '+errors.join(','));
  document.getElementById('companion-test-result').textContent='PASS: memory, mood, unified style navigation, evidence, settings, lock/unlock, manual trait, rollback, forget/reset and text escaping';
})().catch(e=>document.getElementById('companion-test-result').textContent='FAIL: '+e.message);
</script>`;
const file = path.join(base, 'fixture.html'); fs.writeFileSync(file, html);
const profile = fs.mkdtempSync(path.join(base, 'profile-'));
execFile(chrome, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--dump-dom', '--virtual-time-budget=5000', pathToFileURL(file).href],
{ windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
  const result = stdout?.match(/<pre id="companion-test-result">([\s\S]*?)<\/pre>/)?.[1] || 'FAIL: browser did not produce a result';
  console.log(result); fs.writeFileSync(path.join(base, 'result.txt'), result + '\n');
  if (error) console.error(String(error.code || error.message).slice(0, 200));
  if (!stdout && stderr) console.error(stderr.slice(-1200));
  // Only remove the disposable profile created by this invocation, after Chrome exits.
  if (path.dirname(path.resolve(profile)) === path.resolve(base) && path.basename(profile).startsWith('profile-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); } catch {}
  }
  if (error || !result.startsWith('PASS:')) process.exitCode = 1;
});
