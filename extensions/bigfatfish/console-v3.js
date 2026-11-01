// V3 adaptations on the original console; original native pages and controls are retained.
(() => {
  const el=id=>document.getElementById(id),run=async fn=>{try{await fn();}catch(e){showConsoleToast(e.message);}};
  const request=async(path,method='GET',body)=>{const r=await api(path,method,body);if(r.ok===false)throw Error(r.error||'操作失败');return r;};
  document.querySelectorAll('#consoleSubnav [data-subpage]').forEach(b=>b.addEventListener('click',()=>setConsolePage(b.dataset.subpage,{focus:true})));
  document.querySelector('#mainNav [data-view=models]').addEventListener('click',()=>document.querySelector('[data-subpage="model-pool"]').click());
  const access=el('bfAccess'),hint=document.createElement('p'),search=document.createElement('input');
  hint.id='bfContactsStatus';hint.className='meta';hint.setAttribute('role','status');search.id='bfContactSearch';search.type='search';search.placeholder='筛选群名、群号、好友备注或 QQ 号';search.setAttribute('aria-label','筛选可选群聊或好友');access.before(search);access.after(hint);
  let directory,loading=false;
  function renderContacts(){const kind=access.elements.kind.value,rows=kind==='group'?directory?.groups:directory?.friends,previous=access.elements.target.value,q=search.value.trim().toLowerCase(),select=access.elements.target;select.replaceChildren();
    const first=document.createElement('option');first.value='';first.textContent=loading?'正在读取 QQ 列表…':kind==='group'?'请选择已加入的群聊':'请选择好友或已配置私聊';select.append(first);
    const filtered=(Array.isArray(rows)?rows:[]).filter(r=>(r.name+' '+r.id).toLowerCase().includes(q));for(const r of filtered){const o=document.createElement('option');o.value=r.id;o.textContent=`${r.name||(kind==='group'?'群聊':'好友')}（${kind==='group'?'群号':'QQ'}：${r.id}）${r.enabled?' · 已启用':''}${r.available===false?' · 已配置 / 当前列表未返回':''}`;select.append(o);}if(filtered.some(r=>r.id===previous))select.value=previous;
    hint.textContent=(directory?.errors||[]).join('；')||`可选 ${filtered.length}/${rows?.length||0} 个${kind==='group'?'群聊':'好友'}。选择后启用，无需输入号码；不会自动加群或加好友。`;
  }
  async function loadContacts(){if(loading)return;loading=true;renderContacts();try{directory=await request('/api/bigfatfish/contacts');}finally{loading=false;renderContacts();}}
  access.elements.kind.addEventListener('change',()=>{search.value='';renderContacts();});search.addEventListener('input',renderContacts);el('bfContactsRefresh').onclick=()=>run(loadContacts);document.querySelector('#mainNav [data-view=sessions]').addEventListener('click',()=>run(loadContacts));
  const submit=access.onsubmit;access.onsubmit=e=>{if(!access.elements.target.value){e.preventDefault();showConsoleToast('请先从列表选择群聊或好友');return;}submit(e);};run(loadContacts);
  const card=document.createElement('section');card.id='section-bff-global-style';card.className='card span-all bf-integrated';card.dataset.page='bff-global-style';card.hidden=true;
  card.innerHTML=`<h2>全局风格学习</h2><p class="meta">所有群聊共同学习一份风格，群聊与私聊统一使用；具体事实和上下文各自隔离。跨日、多成员和多轮证据验证后自动巩固，无需逐条审核。</p><p id="bfGlobalStatus" role="status"></p><div class="row"><span class="pill" id="bfGlobalVersion"></span><span id="bfGlobalSamples" class="meta"></span><button id="bfGlobalLoad">刷新学习状态</button></div>
  <form id="bfGlobalPolicy"><fieldset><legend>学习与应用</legend><div class="row"><label><input name="enabled" type="checkbox">允许后台学习</label><label><input name="apply" type="checkbox">全局应用风格</label></div><div class="row"><label>至少消息数 <input name="minMessages" type="number" min="20" max="500"></label><label>至少日期数 <input name="minDays" type="number" min="3" max="30"></label><label>至少参与人数 <input name="minSpeakers" type="number" min="2" max="20"></label></div><button>保存学习设置</button></fieldset></form>
  <h3>稳定特征</h3><div id="bfGlobalFeatures"></div><h3>候选积累</h3><div id="bfGlobalCandidates"></div><h3>回复分条方式</h3><div class="row"><select id="bfReplyDelivery"><option value="natural">自然分条</option><option value="single">尽量一条</option><option value="flow">适度分条</option></select><button id="bfDeliverySave">保存分条方式</button></div>
  <details><summary>版本回滚与管理员补充策略</summary><p class="meta">回滚后会锁定，防止在途学习覆盖；解除锁定后才继续学习。</p><div class="row"><select id="bfGlobalHistory"></select><button id="bfGlobalRollback">回滚并锁定</button><button id="bfGlobalUnlock">解除学习锁定</button></div><form id="bfGlobalPublish"><div id="bfGlobalChoices"></div><button>保存补充策略</button></form></details>`;
  document.querySelector('#mainContent .grid').append(card);consolePages['bff-global-style']=['全局风格学习','从共同表达中，积累稳定经验。','跨群共享一份风格；候选自动验证，私人事实留在原会话。'];
  let profile,dirty=false;el('bfGlobalPolicy').oninput=()=>{dirty=true;};const line=(parent,value)=>{const p=document.createElement('p');p.textContent=value;parent.append(p);};
  async function loadStyle(){profile=await request('/api/bigfatfish/global-style');el('bfGlobalStatus').textContent=profile.error||`${profile.policy.enabled?'自动学习开启':'学习已暂停'} · ${profile.locked?'版本锁定':'自动巩固'} · ${profile.policy.apply?'全局应用开启':'应用已暂停'}`;el('bfGlobalVersion').textContent='全局 v'+profile.version;el('bfGlobalSamples').textContent=`有效来源 ${profile.sample?.messages||0} 条 · ${profile.sample?.groups||0} 个群 · ${profile.sample?.speakers||0} 位成员 · ${profile.sample?.days||0} 天`;
    if(!dirty)for(const k of ['enabled','apply','minMessages','minDays','minSpeakers']){const input=el('bfGlobalPolicy').elements[k];input[input.type==='checkbox'?'checked':'value']=profile.policy[k];}
    const features=el('bfGlobalFeatures');features.replaceChildren();for(const [k,f]of Object.entries(profile.features||{}))line(features,`${k}：${profile.traits?.[k]?.[f.value]||f.value}`);for(const e of profile.expressionExamples||[])line(features,`${e.scene} · ${e.action} · ${e.strategy}`);if(!features.children.length)line(features,'暂无稳定成果，正在积累跨日和多成员证据。');
    const progress=profile.progress;const candidates=el('bfGlobalCandidates');candidates.replaceChildren();
    if(progress){const stages={COLLECTING:'收集语料中',SAMPLES_COLLECTED:'已收集有效样本，等待研究',ACCUMULATING:'候选积累中',APPROVED:'已有批准风格'};line(candidates,`${stages[progress.stage]||progress.stage} · 新增有效消息 ${progress.newMessages} · 候选 ${progress.candidateCount} · 待稳定 ${progress.waitingStabilityCount} · 实际应用特征 ${progress.appliedFeatures}`);line(candidates,`最近研究 ${progress.research.status} · 自动研究日额度 ${progress.research.sharedDailyUsed}/${progress.research.sharedDailyLimit} · 失败次数 ${progress.research.failureCount}${progress.research.nextAt?' · 下次最早 '+new Date(progress.research.nextAt).toLocaleString('zh-CN'):''}`);for(const b of progress.blockers)line(candidates,`${b.message}${b.gap?'（还差 '+b.gap+'）':''}`);if(progress.research.lastFailure)line(candidates,'最近失败原因：'+progress.research.lastFailure.code);}
    for(const c of (profile.candidates||[]).slice(-30)){const state=progress?.candidates.find(x=>x.id===c.id);line(candidates,`${c.trait||c.scene||'迁移候选'} · ${c.value||c.strategy||''} · 已观察 ${c.observations||0}/${state?.requiredRounds||profile.policy.stabilityRounds} 轮`);}if(!candidates.children.length)line(candidates,'暂无待验证候选。');
    const history=el('bfGlobalHistory');history.replaceChildren();for(const h of [...(profile.history||[])].reverse()){const o=document.createElement('option');o.value=h.version;o.textContent=`v${h.version} · ${new Date(h.at).toLocaleString('zh-CN')} · ${h.reason}`;history.append(o);}el('bfGlobalChoices').replaceChildren();for(const [id,title]of Object.entries(profile.choices||{})){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=id;input.checked=profile.published.includes(id);label.append(input,document.createTextNode(title));el('bfGlobalChoices').append(label,document.createElement('br'));}el('bfReplyDelivery').value=profile.replyDelivery;
  }
  const action=async body=>{if(!profile)throw Error('请先读取风格状态');await request('/api/bigfatfish/global-style','POST',{...body,revision:profile.revision});await loadStyle();};
  el('bfGlobalLoad').onclick=()=>run(loadStyle);document.querySelector('[data-subpage="bff-global-style"]').addEventListener('click',()=>run(loadStyle));
  el('bfGlobalPolicy').onsubmit=e=>{e.preventDefault();run(async()=>{const f=e.target.elements;await request('/api/bigfatfish/settings','POST',{globalStyleLearning:{enabled:f.enabled.checked,apply:f.apply.checked,minMessages:Number(f.minMessages.value),minDays:Number(f.minDays.value),minSpeakers:Number(f.minSpeakers.value)}});dirty=false;await loadStyle();showConsoleToast('全局学习设置已保存');});};
  el('bfGlobalRollback').onclick=()=>run(()=>action({action:'rollback',version:Number(el('bfGlobalHistory').value)}));el('bfGlobalUnlock').onclick=()=>run(()=>action({action:'configure',locked:false}));el('bfGlobalPublish').onsubmit=e=>{e.preventDefault();run(()=>action({action:'publish',strategies:[...el('bfGlobalChoices').querySelectorAll('input:checked')].map(i=>i.value)}));};el('bfDeliverySave').onclick=()=>run(async()=>{await request('/api/bigfatfish/settings','POST',{replyDelivery:el('bfReplyDelivery').value});showConsoleToast('分条偏好已保存');});
  featureIndex.push({page:'bff-global-style',label:'全局风格 自动学习 版本 回滚',target:card});const initial=window.bffInitialHash||'overview';setConsolePage(initial,{updateHash:false});if(initial==='models'||initial==='model-pool')document.querySelector('[data-subpage="model-pool"]').click();if(initial==='bff-global-style')run(loadStyle);
})();

// BigFatFish V4.1 sticker semantics management
(() => {
  const $ = id => document.getElementById(id);
  let view, offset = 0, busy = false, previewObserver;
  const states = { reviewed: '已确认', unreviewed: '待理解', uncertain: '有歧义', disabled: '已禁用' };
  const list = value => String(value || '').split(/[,，\n]+/).map(s => s.trim()).filter(Boolean);
  const request = async (path, body) => { const r = await api(path, body ? 'POST' : 'GET', body); if (r.ok === false) throw Error(r.error || '操作未完成'); return r; };
  async function run(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { $('stickerNotice').textContent = e.message; } finally { busy = false; } }
  function diagnostics(r) {
    const d = r.diagnostics || {};
    $('stickerStats').textContent = `收藏 ${d.total || 0} · 已理解 ${d.reviewed || 0} · 待理解 ${d.unreviewed || 0} · 有歧义 ${d.uncertain || 0} · 禁用 ${d.disabled || 0} · 语义可用 ${d.autoEligible || 0}（发图时仍需匹配语境）`;
    const job = r.reviewJob || {};
    $('stickerProgress').textContent = `整理：${({idle:'未启动',running:'处理中',completed:'完成',cancelled:'已取消',failed:'失败'})[job.status] || job.status || '未启动'} ${job.done || 0}/${job.total || 0} ` + (job.results || []).map(x => `${x.id}：${states[x.status] || x.status}${x.reason ? '（' + x.reason + '）' : ''}`).join('；');
    $('stickerDecisions').textContent = (r.decisions || []).map(x => `${x.key} · ${new Date(x.at).toLocaleString()} · ${x.scene || '未知场景'} · 候选 ${(x.candidates || []).map(c => c.id).join(', ') || '无'} · ${x.selected || ''} · ${x.status} · ${x.reason || ''}${x.usageSaved === false ? ' · 使用记录落盘失败' : ''}`).join('\n') || '暂无诊断';
    const box = $('stickerRecovery'); box.replaceChildren();
    for (const item of r.recovery || []) {
      const row = document.createElement('p'); row.textContent = `QQ已收藏，本地语义待恢复：${item.emojiId || 'ID缺失，请同步核对'} ${item.error || ''} `;
      if (item.emojiId) { const b = document.createElement('button'); b.type = 'button'; b.textContent = '重试保存本地认知'; b.onclick = () => run(async () => { await request('/api/stickers/recover', { stickerId: item.emojiId }); await load(); }); row.append(b); }
      box.append(row);
    }
    if (r.writable === false) $('stickerNotice').textContent = '表情库处于只读保护：请修复文件并重启桥接；未覆盖原库。';
  }
  async function preview(card) {
    const id = card.dataset.sticker;
    try { const r = await request('/api/stickers/image?stickerId=' + encodeURIComponent(id)); const img = card.querySelector('img'); img.src = `data:${r.image.mimeType};base64,${r.image.data}`; img.hidden = false; card.querySelector('[data-preview]').textContent = '重新查看原图'; }
    catch { card.querySelector('[data-preview]').textContent = '缩略图读取失败，点击重试'; }
  }
  function render() {
    previewObserver?.disconnect();
    const cards = $('stickerCards'); cards.replaceChildren();
    const entries = view.stickers || [], page = entries.slice(offset, offset + 12);
    for (const e of page) {
      const card = document.createElement('article'); card.dataset.sticker = e.id; card.style.cssText = 'border:1px solid var(--border,#ddd);padding:12px;margin:12px 0;border-radius:8px';
      card.innerHTML = `<div class="row"><img alt="表情缩略图" hidden style="width:96px;height:96px;object-fit:contain"><button type="button" data-preview>查看缩略图</button><b>${esc(e.id)}</b><span>${esc(states[e.understandingStatus] || e.understandingStatus)} · ${e.understandingSource === 'manual' ? '管理员' : e.understandingSource === 'visual' ? '视觉理解' : '未确认来源'} · 自动发送：${e.autoEligible ? '语义已准入，仍需场景匹配' : '禁止'}</span></div>
        <p>QQ原始备注：${esc(e.desc || '无')} · 使用 ${Number(e.useCount) || 0} 次 · 最近 ${e.lastUsedAt ? esc(new Date(e.lastUsedAt).toLocaleString()) : '未使用'}</p>
        <p class="meta">图像：${esc(e.visualContent || '未理解')}；图片文字：${esc(e.imageText || '无记录')}；潜台词：${esc(e.subtext || '无记录')}；歧义：${esc(e.ambiguity || '无记录')}</p>
        <form><p><label>图片含义 <input name="note" maxlength="200" style="width:80%" value="${esc(e.localNote)}"></label></p>
        <p><label>适合用途 <input name="usage" maxlength="200" style="width:80%" value="${esc(e.usage)}"></label></p>
        <p><label>标签（逗号分隔） <input name="tags" value="${esc(e.tags.join(','))}"></label> <label>语气 <input name="tone" value="${esc(e.tone.join(','))}"></label></p>
        <p><label>适用场景 <input name="usageScenes" placeholder="casual_chat,casual_banter" value="${esc(e.usageScenes.join(','))}"></label> <label>禁止场景 <input name="avoidScenes" placeholder="help,technical,serious" value="${esc(e.avoidScenes.join(','))}"></label></p>
        <p><label>歧义备注 <input name="ambiguity" value="${esc(e.ambiguity)}"></label> <label><input type="checkbox" name="privacySensitive" ${e.privacySensitive ? 'checked' : ''}>含不宜传播个人信息</label></p>
        <p><label>理解状态 <select name="understandingStatus">${Object.entries(states).map(([v,label]) => `<option value="${v}" ${e.understandingStatus === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label> <button type="submit">保存本地认知</button> <button type="button" data-review>重新识图</button></p></form>`;
      card.querySelector('[data-preview]').onclick = () => run(() => preview(card));
      card.querySelector('[data-review]').onclick = () => run(async () => {
        $('stickerNotice').textContent = '正在读取真实图片并调用当前视觉模型…';
        const r = await request('/api/stickers/review', { stickerId: e.id });
        $('stickerNotice').textContent = `${states[r.result.status] || r.result.status}：${r.result.reason || '已保存本地认知'}`;
        if (r.result.proposal) {
          const p = r.result.proposal, f = card.querySelector('form').elements;
          f.note.value = p.note || ''; f.usage.value = p.usage || ''; f.ambiguity.value = p.ambiguity || ''; f.privacySensitive.checked = !!p.privacySensitive;
          for (const key of ['tags','tone','usageScenes','avoidScenes']) f[key].value = (p[key] || []).join(',');
          // Administrator explicitly chooses status and saves the proposal.
          card.scrollIntoView({ block: 'nearest' });
        } else await load();
      });
      card.querySelector('form').onsubmit = ev => { ev.preventDefault(); run(async () => {
        const f = ev.target.elements, body = { stickerId: e.id, expectedUpdatedAt: e.updatedAt, note: f.note.value, usage: f.usage.value, understandingStatus: f.understandingStatus.value, ambiguity: f.ambiguity.value, privacySensitive: f.privacySensitive.checked };
        for (const key of ['tags','tone','usageScenes','avoidScenes']) body[key] = list(f[key].value);
        if (body.understandingStatus === 'reviewed' && (!body.note.trim() || !body.usage.trim() || !body.tags.length || !body.usageScenes.some(x => ['casual_chat','casual_banter'].includes(x)) || body.ambiguity.trim() || body.privacySensitive)) throw Error('确认前请补齐含义、用途、标签和适用场景，消除歧义并检查隐私');
        await request('/api/stickers/note', body); $('stickerNotice').textContent = '本地认知已保存，立即生效'; await load();
      }); };
      cards.append(card);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      previewObserver = new IntersectionObserver(items => { for (const item of items) if (item.isIntersecting) { previewObserver.unobserve(item.target); void preview(item.target); } });
      for (const card of cards.children) previewObserver.observe(card);
    }
    $('stickerPage').textContent = `${entries.length ? Math.floor(offset / 12) + 1 : 0}/${Math.ceil(entries.length / 12)} 页 · 匹配 ${view.matched || 0}`;
    $('stickerPrev').disabled = offset === 0; $('stickerNext').disabled = offset + 12 >= entries.length;
  }
  async function load() { view = await request('/api/stickers?count=500&query=' + encodeURIComponent($('stickerQuery').value)); if (offset >= view.stickers.length) offset = 0; diagnostics(view); render(); }
  $('stickerRefresh').onclick = () => run(load);
  $('stickerSync').onclick = () => run(async () => { await request('/api/stickers/sync', {}); await load(); });
  $('stickerBatch').onclick = () => run(async () => { await request('/api/stickers/review', {}); await load(); });
  $('stickerCancel').onclick = async () => { try { await request('/api/stickers/review', { cancel: true }); $('stickerNotice').textContent = '已请求取消，已保存的结果保留'; } catch (e) { $('stickerNotice').textContent = e.message; } };
  $('stickerPrev').onclick = () => { offset = Math.max(0, offset - 12); render(); }; $('stickerNext').onclick = () => { offset += 12; render(); };
  $('stickerManager').addEventListener('toggle', () => { if ($('stickerManager').open && !view) void run(load); });
  setInterval(async () => { if (view?.reviewJob?.status !== 'running' || !$('stickerManager').open || document.hidden) return; try { const r = await request('/api/stickers?count=1'); diagnostics(r); view.reviewJob = r.reviewJob; if (r.reviewJob.status !== 'running') { if (!$('stickerCards').contains(document.activeElement)) await load(); else $('stickerNotice').textContent = '整理已结束；当前编辑内容已保留，刷新列表查看新认知'; } } catch {} }, 2000);
})();
