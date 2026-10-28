// Scoped memory and mood controls; all imported/model text is rendered with textContent.
(() => {
  const el = id => document.getElementById(id), grid = document.querySelector('#mainContent .grid');
  const request = async (url, method, body) => { const r = await api(url, method, body); if (r.ok === false) throw Error(r.error || '操作失败'); return r; };
  const notice = text => showConsoleToast(text);
  const run = async fn => { try { await fn(); } catch (error) { notice(error.message); } };
  const button = (title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = title; b.onclick = () => run(fn); return b; };
  let memoryView, draft, moodView, moodDirty = false;
  const extras = document.createElement('div'); extras.id = 'bfMemoryDetails';
  extras.innerHTML = `<h3>记忆召回与历史</h3><p>具体检索词决定相关性；新鲜度只影响排序。事件逐渐淡忘，稳定偏好和约定不随时间衰减；查看不会强化记忆。</p>
    <label>试问一句 <input id="bfRecallQuery" maxlength="300" placeholder="例如：之前聊过的模型训练"></label> <button id="bfRecallTest" type="button">查看召回原因</button><div id="bfRecallRows"></div>
    <details><summary>旧状态与可恢复版本</summary><div id="bfMemoryArchive"></div></details>
    <h3>从旧档案导入</h3><p>选择文本文件或粘贴内容，先预览再勾选导入当前会话。每行一件事，5至500字；代码块、表格和已删除内容会跳过。导入标注为管理员档案，不冒充群友发言，也不触发模型调用。</p>
    <input id="bfImportFile" type="file" accept=".md,.markdown,.txt,.text,.log,.rst,.org"><textarea id="bfImportText" rows="5" maxlength="100000" placeholder="每行一条候选记忆" style="width:95%"></textarea>
    <button id="bfImportPreview" type="button">预览候选</button> <button id="bfImportCommit" type="button" disabled>导入选中的候选</button><p id="bfImportStatus"></p><div id="bfImportCandidates"></div>`;
  el('section-bff-memory').append(extras);
  function traceRows(trace) {
    const box = el('bfRecallRows'); box.replaceChildren();
    if (!trace) { box.textContent = '尚无召回记录；可输入问题预览。'; return; }
    const p = document.createElement('p'); p.textContent = `问题：${trace.query}；检索词：${trace.terms.join('、') || '无'}；引用预算已用 ${trace.chars} 字。`; box.append(p);
    for (const row of trace.rows) { const p = document.createElement('p'); p.textContent = `${row.selected ? '✓' : '·'} ${row.text} —— ${row.reason}；命中${row.matched.join('、') || '无'}；证据${Math.round(row.evidence * 100)}%；鲜活度${Math.round(row.freshness * 100)}%`; box.append(p); }
  }
  async function memoryAction(action) {
    const key = el('bfMemoryKey').value;
    if (!memoryView || memoryView.key !== key) throw Error('请先加载当前会话的记忆');
    const r = await request('/api/bigfatfish/memory', 'POST', { ...action, key, revision: memoryView.revision });
    document.dispatchEvent(new CustomEvent('bff-memory-changed', { detail: r })); notice('已保存到当前会话'); return r;
  }
  document.addEventListener('bff-memory-view', event => {
    memoryView = event.detail;
    traceRows(memoryView.previewRecall || memoryView.lastRecall);
    const box = el('bfMemoryArchive'); box.replaceChildren();
    for (const entry of [...(memoryView.archive || [])].reverse()) {
      const p = document.createElement('p'); p.textContent = `${new Date(entry.at).toLocaleString('zh-CN')} · ${entry.fact.text} · ${entry.reason} `;
      p.append(button('恢复此版本', () => memoryAction({ action: 'restoreFact', archiveId: entry.archiveId })), button('删除此历史', () => memoryAction({ action: 'deleteArchive', archiveId: entry.archiveId }))); box.append(p);
    }
    if (!box.children.length) box.textContent = '暂无历史版本。';
    if (draft && (draft.key !== memoryView.key || draft.revision !== memoryView.revision)) {
      draft = null; el('bfImportCommit').disabled = true; el('bfImportCandidates').replaceChildren(); el('bfImportStatus').textContent = '会话或记忆已变化，请重新预览。';
    }
  });
  el('bfRecallTest').onclick = () => run(async () => {
    const key = el('bfMemoryKey').value; if (!key) throw Error('请先选择会话');
    const r = await request('/api/bigfatfish/memory?key=' + encodeURIComponent(key) + '&recallQuery=' + encodeURIComponent(el('bfRecallQuery').value));
    if (key === el('bfMemoryKey').value) traceRows(r.previewRecall);
  });
  el('bfImportFile').onchange = () => run(async () => {
    const file = el('bfImportFile').files[0]; if (!file) return;
    if (file.size > 100000) throw Error('请选择不超过100KB的文本文件');
    el('bfImportText').value = await file.text(); draft = null; el('bfImportCommit').disabled = true;
  });
  el('bfImportText').oninput = () => { draft = null; el('bfImportCommit').disabled = true; };
  el('bfImportPreview').onclick = () => run(async () => {
    const key = el('bfMemoryKey').value;
    if (!memoryView || memoryView.key !== key) throw Error('请先加载当前会话的记忆');
    const revision = memoryView.revision;
    const r = await request('/api/bigfatfish/memory', 'POST', { action: 'importPreview', key, revision,
      name: el('bfImportFile').files[0]?.name || '手动档案', text: el('bfImportText').value });
    if (el('bfMemoryKey').value !== key || memoryView.revision !== revision) throw Error('会话或记忆已变化，请重新预览');
    draft = r; const box = el('bfImportCandidates'); box.replaceChildren();
    for (const row of r.candidates) {
      const p = document.createElement('p'), label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = row.id; input.checked = true;
      label.append(input, document.createTextNode(`第${row.line}行：${row.text}`)); p.append(label); box.append(p);
    }
    el('bfImportCommit').disabled = !r.candidates.length; el('bfImportStatus').textContent = `${r.candidates.length} 条候选，跳过 ${r.skipped} 条。请核对后勾选导入。`;
  });
  el('bfImportCommit').onclick = () => run(async () => {
    if (!draft || draft.key !== el('bfMemoryKey').value) throw Error('请先预览当前会话的档案');
    const ids = [...el('bfImportCandidates').querySelectorAll('input:checked')].map(input => input.value);
    await memoryAction({ action: 'importCommit', importId: draft.importId, ids }); draft = null; el('bfImportCommit').disabled = true;
    el('bfImportCandidates').replaceChildren(); el('bfImportStatus').textContent = '选中的档案已导入。';
  });

  const section = document.createElement('section'); section.className = 'card span-all bf-integrated'; section.dataset.page = 'bff-mood'; section.id = 'section-bff-mood'; section.hidden = true;
  section.innerHTML = `<h2>鱼的心情</h2><p>每个群聊或私聊各有一份角色心情。只在实际回复后判断，情绪会自然回稳。新会话默认开启，旧关闭设置保留；明确情绪事件后使用现有模型，每会话有判断额度，所有会话每日合计最多40次。</p>
    <select id="bfMoodKey" aria-label="心情所属会话"></select> <button id="bfMoodLoad" type="button">加载 / 刷新</button><p id="bfMoodStatus"></p>
    <div id="bfMoodCurrent"></div><form id="bfMoodSettings"><p><label><input name="enabled" type="checkbox">启用本会话心情</label> <label><input name="autoJudge" type="checkbox">回复后自动判断</label></p>
    <p><label>伙伴称呼 <input name="selfName" maxlength="30"></label> <label>对回复的影响 <select name="injectMode"><option value="off">仅展示，不影响回复</option><option value="label">只告诉当前心情</option><option value="event">带上最近一次感受</option></select></label></p>
    <div id="bfMoodNumbers"></div><button type="submit">保存心情设置</button> <button id="bfMoodReset" type="button">恢复基线并清空心情记录</button></form>
    <p>可信度不足的判断只记入记录。显著变化最多带入后续一轮闲聊；正式问题以完整回答为先。关闭“允许积累新记忆”会暂停自动判断；关闭“使用长期记忆与全局风格”会停止影响回复。重置不返还已用判断额度。</p>
    <h3>本会话心情记录</h3><div id="bfMoodHistory"></div>`; grid.append(section);
  const numbers = { baseline: ['平稳基线', 0, 100], floor: ['最低心情', 0, 100], halfLifeHours: ['心情回稳半衰期（小时）', 1, 168],
    emotionHalfLifeMinutes: ['单项情绪半衰期（分钟）', 1, 1440], minConfidence: ['判断可信度门槛', 0.5, 1, 0.05], significantDelta: ['显著变化门槛', 1, 10], dailyCap: ['本会话每日判断上限', 0, 100], minIntervalMinutes: ['判断间隔至少（分钟）', 0, 1440] };
  for (const [name, [title, min, max, step]] of Object.entries(numbers)) {
    const label = document.createElement('label'), input = document.createElement('input'); label.textContent = title + ' '; label.style.cssText = 'display:inline-block;margin:8px';
    Object.assign(input, { name, type: 'number', min, max, step: step || 1 }); input.style.width = '80px'; label.append(input); el('bfMoodNumbers').append(label);
  }
  el('bfMoodSettings').oninput = () => { moodDirty = true; };
  consolePages['bff-mood'] = ['鱼的心情', '观察每个会话里的情绪变化。', '查看心情、七项情绪和历史记录，选择是否影响后续闲聊。'];
  const nav = button('♡ 会话心情', async () => { setConsolePage('bff-mood', { focus: true }); await loadMoodScopes(); }); nav.className = 'nav-item'; nav.dataset.subpage = 'bff-mood';document.querySelector('#consoleSubnav [data-subpage="bff-mood"]').replaceWith(nav);
  el('section-bff-overview').append(button('鱼的心情', async () => { setConsolePage('bff-mood', { focus: true }); await loadMoodScopes(); }));
  function renderMood(r) {
    if (r.key !== el('bfMoodKey').value) return;
    moodView = r; el('bfMoodStatus').textContent = `${r.config.enabled ? '已启用' : '未启用'} · ${r.pending ? '等待判断结果' : r.status} · 今日 ${r.todayUsed}/${r.config.dailyCap} 次；全部会话 ${r.globalTodayUsed}/${r.globalDailyCap} 次${r.error ? ' · ' + r.error : ''}${!r.connected ? ' · 模型判断尚未连接' : ''}`;
    const box = el('bfMoodCurrent'); box.replaceChildren(); const p = document.createElement('p'); p.textContent = `${r.current.label} · ${r.current.value}/100${r.reason ? ' · 最近感受：' + r.reason : ''}`; box.append(p);
    for (const [name, label] of Object.entries(r.dimensionLabels)) {
      const p = document.createElement('p'), meter = document.createElement('meter'); meter.min = 0; meter.max = 100; meter.value = r.current.dims[name]; meter.setAttribute('aria-label', label);
      p.append(document.createTextNode(`${label} ${r.current.dims[name]} `), meter); box.append(p);
    }
    const preview = document.createElement('p'); preview.textContent = r.preview ? '下一轮闲聊会参考：' + r.preview : '下一轮暂不附加新的心情提示。'; box.append(preview);
    if (!moodDirty) for (const [key, value] of Object.entries(r.config)) { const input = el('bfMoodSettings').elements[key]; input[input.type === 'checkbox' ? 'checked' : 'value'] = value; }
    const history = el('bfMoodHistory'); history.replaceChildren();
    for (const row of [...r.history].reverse()) { const p = document.createElement('p'); p.textContent = `${new Date(row.at).toLocaleString('zh-CN')} · ${row.kind === 'proactive' ? '主动参与' : '回应聊天'} · ${row.applied ? '已更新' : '仅记录'} · 心情变化${row.delta > 0 ? '+' : ''}${row.delta} · 可信度${Math.round(row.confidence * 100)}% · ${row.reason}`; history.append(p); }
    if (!r.history.length) history.textContent = '暂无判断记录。启用后，在下一轮实际发言后更新。';
  }
  async function loadMood() { const key = el('bfMoodKey').value; if (key) renderMood(await request('/api/bigfatfish/mood?key=' + encodeURIComponent(key))); }
  async function loadMoodScopes() {
    const r = await request('/api/bigfatfish/status'), previous = el('bfMoodKey').value, keys = new Set(r.sessions.map(s => s.key));
    for (const [kind, field] of [['group', 'groups'], ['private', 'private']]) for (const id of [...r.allow[field], ...(r.deny?.[field] || [])]) keys.add(kind + ':' + id);
    el('bfMoodKey').replaceChildren(); for (const key of keys) { const o = document.createElement('option'); o.value = key; o.textContent = key; el('bfMoodKey').append(o); }
    if (keys.has(previous)) el('bfMoodKey').value = previous; await loadMood();
  }
  el('bfMoodLoad').onclick = () => run(loadMoodScopes);
  el('bfMoodKey').onchange = () => { moodDirty = false; moodView = null; run(loadMood); };
  el('bfMoodSettings').onsubmit = event => { event.preventDefault(); run(async () => {
    if (!moodView || moodView.key !== el('bfMoodKey').value) throw Error('请先加载当前会话心情');
    const form = event.target.elements, config = { selfName: form.selfName.value, injectMode: form.injectMode.value, enabled: form.enabled.checked, autoJudge: form.autoJudge.checked };
    for (const key of Object.keys(numbers)) config[key] = Number(form[key].value);
    const r = await request('/api/bigfatfish/mood', 'POST', { key: moodView.key, revision: moodView.revision, action: 'configure', config }); moodDirty = false; renderMood(r); notice('心情设置已保存');
  }); };
  el('bfMoodReset').onclick = () => run(async () => {
    if (!moodView || moodView.key !== el('bfMoodKey').value) throw Error('请先加载当前会话心情');
    renderMood(await request('/api/bigfatfish/mood', 'POST', { key: moodView.key, revision: moodView.revision, action: 'reset' })); notice('已恢复基线，判断额度保持原计数');
  });
  if (typeof featureIndex !== 'undefined') featureIndex.push({ page: 'bff-mood', label: '鱼的心情 七项情绪', target: section });
  if (location.hash.slice(1) === 'bff-mood') { setConsolePage('bff-mood', { updateHash: false }); run(loadMoodScopes); }
})();
