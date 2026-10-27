// Integrated authenticated console page. All learned values are rendered as text nodes.
(() => {
  const el = id => document.getElementById(id), section = document.createElement('section');
  Object.assign(section, { id: 'section-bff-group-style', className: 'card span-all bf-integrated', hidden: true }); section.dataset.page = 'bff-group-style';
  section.innerHTML = `<h2>群聊风格学习</h2><p>同一人格适应不同群的表达氛围。自动学习只产生候选；审核发布后按场景选择，认真求助优先完整准确。</p>
    <select id="bfGroupSelect" aria-label="选择已启用群"></select> <button id="bfGroupLoad">加载 / 刷新</button><p id="bfGroupStatus" role="status"></p>
    <form id="bfGroupConfig"><label><input name="enabled" type="checkbox">允许学习</label> <label><input name="apply" type="checkbox">应用群风格与经验</label> <label><input name="locked" type="checkbox">锁定群风格</label><div id="bfGroupThresholds"></div><button>保存本群设置</button></form>
    <h3>当前特征和候选</h3><div id="bfGroupFeatures"></div><select id="bfGroupTrait"></select><select id="bfGroupValue"></select><button id="bfGroupSet">人工指定并锁定该特征</button>
    <h3>场景表达经验</h3><div id="bfGroupExpressions"></div><form id="bfGroupEdit"><select name="id" aria-label="选择编辑经验"></select><div id="bfGroupEditFields"></div><button>保存修改为候选并锁定</button></form>
    <h3>版本历史</h3><select id="bfGroupHistory"></select><button id="bfGroupRollback">回滚并锁定</button><button id="bfGroupReset">清空本群风格数据</button>
    <p>清空同时删除本群风格版本和审核记录，并阻止旧任务回写。原事实记忆、黑话词库和共享学习日志保留；旧消息不会重新成为本群风格来源。关闭应用只影响本群表达，不清空聊天队列。</p>
    <h3>本群黑话与待确认旧词</h3><div id="bfGroupSlang"></div><p>公开用语需管理员确认，多个群共同使用须逐群确认；同词不同群可保留不同释义。原词库编辑和研究仍在“黑话词库”。</p>
    <h3>只读模拟检索</h3><form id="bfGroupPreview"><input name="message" required maxlength="1000" placeholder="输入模拟消息"><button>预览</button></form><pre id="bfGroupPreviewResult" style="white-space:pre-wrap"></pre><h3>最近提示词诊断</h3><pre id="bfGroupDiagnostics" style="white-space:pre-wrap"></pre>`;
  document.querySelector('#mainContent .grid').append(section);
  let view, groups = [], requestSerial = 0;
  el('bfGroupThresholds').style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0';
  el('bfGroupEditFields').style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px';
  for (const label of el('bfGroupConfig').querySelectorAll('label')) label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:20px';
  const run = async fn => { try { await fn(); } catch(e) { showConsoleToast(e.message); } };
  const call = async (route, method = 'GET', body) => { const r = await api(route, method, body); if (r.ok === false) throw Error(r.error || '群风格操作失败'); return r; };
  const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
  const button = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = () => run(fn); return b; };
  const fields = { minMessages: '至少有效消息', minDays: '至少日期数', minSpeakers: '至少发言者', featureMinMessages: '单项至少证据', lookbackHours: '回看小时', refreshHours: '研究间隔小时', minNewMessages: '再次研究新增消息', dailyCap: '本群每日研究上限', maxChanges: '每轮最多更新' };
  for (const [key, text] of Object.entries(fields)) { const label = document.createElement('label'), input = document.createElement('input'); input.name = key; input.type = 'number'; input.style.width = '80px'; label.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0'; label.append(document.createTextNode(text + ' '), input); el('bfGroupThresholds').append(label); }
  const editInputs = {};
  function evidence(node, entry, target) {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `来源 ${entry.evidence?.sources.length || 0} 条 / ${entry.evidence?.speakerCount || 0} 人 / ${entry.evidence?.dayCount || 0} 天；${entry.status}；支持分 ${Number(entry.confidence || 0).toFixed(2)}（非正确率）`; details.append(summary);
    const text = document.createElement('pre'); text.style.whiteSpace = 'pre-wrap'; text.textContent = JSON.stringify(entry.evidence || {}, null, 2); details.append(text);
    const key = view.scope;
    details.append(button('查看本群来源原文（仅管理员）', async () => { const params = new URLSearchParams({ key, action: 'evidence', ...target }); const r = await call('/api/bigfatfish/group-style?' + params); text.textContent = JSON.stringify(r.sources, null, 2); })); node.append(details);
  }
  function controls(node, target, entry) {
    for (const [action, title] of [['approve', '审核发布'], ['reject', '拒绝'], ['delete', '删除']]) node.append(button(title, () => actionRequest({ action, ...target })));
    node.append(button(entry.locked ? '解锁该项' : '锁定该项', () => actionRequest({ action: 'lock', ...target, locked: !entry.locked })));
  }
  async function actionRequest(body) {
    if (!view || view.scope !== el('bfGroupSelect').value) throw Error('请先加载本群');
    await call('/api/bigfatfish/group-style', 'POST', { ...body, key: view.scope, revision: view.revision }); await load();
  }
  function editSelection() {
    const e = view?.expressionExamples.find(e => e.id === el('bfGroupEdit').elements.id.value);
    for (const [k, input] of Object.entries(editInputs)) {
      if (input.multiple) { for (const option of input.options) option.selected = (e?.[k] || (k === 'when' ? ['general'] : [])).includes(option.value); }
      else input.value = e?.[k] || input.options[0]?.value;
    }
  }
  function values() { el('bfGroupValue').replaceChildren(); for (const [v, label] of Object.entries(view?.traits[el('bfGroupTrait').value] || {})) el('bfGroupValue').append(option(v, label)); }
  async function load() {
    const serial = ++requestSerial, key = el('bfGroupSelect').value; if (!key) return;
    const data = await call('/api/bigfatfish/group-style?key=' + encodeURIComponent(key)); if (serial !== requestSerial) return; view = data;
    const stages = { candidates: '等待审核', unchanged: '表达经验无实质变化', researching: '正在研究', failed: '研究失败，等待重试' };
    el('bfGroupStatus').textContent = `${key} · v${view.version} / r${view.revision} · 有效 ${view.sample.messages} 条 / ${view.sample.days} 天 / ${view.sample.speakers} 人 · ${view.sample.qualified ? '达到研究门槛' : '等待真实语料'} · ${stages[view.research.status] || '尚未研究'} · ${view.error || ''} · 句长中位数 ${view.sample.statistics.medianChars} 字，短句 ${Math.round(view.sample.statistics.shortFraction * 100)}%`;
    for (const k of ['enabled', 'apply', 'locked']) el('bfGroupConfig').elements[k].checked = view[k];
    for (const k of Object.keys(fields)) el('bfGroupConfig').elements[k].value = view.policy[k];
    el('bfGroupFeatures').replaceChildren();
    for (const [key, entry] of Object.entries(view.features)) { const row = document.createElement('div'); row.textContent = `${key}：${view.traits[key]?.[entry.value] || entry.value} · ${view.active?.features[key] ? '生效' : '未生效'} `; evidence(row, entry, { feature: key }); controls(row, { feature: key }, entry); el('bfGroupFeatures').append(row); }
    el('bfGroupExpressions').replaceChildren(); el('bfGroupEdit').elements.id.replaceChildren();
    for (const entry of view.expressionExamples) { const row = document.createElement('div'); row.textContent = `${view.vocabulary.scene[entry.scene]} / ${view.vocabulary.action[entry.action]} / ${view.vocabulary.strategy[entry.strategy]} / ${view.vocabulary.structure[entry.structure]} · 适用 ${entry.when.join('、')} · 避免 ${entry.avoid.join('、')} · 最近使用 ${entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleString('zh-CN') : '尚无'} `; evidence(row, entry, { id: entry.id }); controls(row, { id: entry.id }, entry); el('bfGroupExpressions').append(row); el('bfGroupEdit').elements.id.append(option(entry.id, entry.scene + ' · ' + entry.id)); }
    const fieldNames = { scene: '场景', action: '回应动作', structure: '表达结构', strategy: '表达策略', when: '适用条件（可多选）', avoid: '不适用场景（可多选）' };
    el('bfGroupEditFields').replaceChildren(); for (const [k, table] of Object.entries(view.vocabulary)) { const label = document.createElement('label'), input = document.createElement('select'); input.name = k; input.multiple = ['when', 'avoid'].includes(k); if (input.multiple) input.size = 3; for (const [value, title] of Object.entries(table)) input.append(option(value, title)); label.append(document.createTextNode(fieldNames[k] + ' '), input); el('bfGroupEditFields').append(label); editInputs[k] = input; } editSelection();
    el('bfGroupTrait').replaceChildren(); for (const k of Object.keys(view.traits)) el('bfGroupTrait').append(option(k, k)); values();
    el('bfGroupHistory').replaceChildren(); for (const h of [...view.history].reverse()) el('bfGroupHistory').append(option(h.version, `v${h.version} · ${h.reason} · ${new Date(h.at).toLocaleString('zh-CN')}`));
    el('bfGroupDiagnostics').textContent = JSON.stringify(view.promptDiagnostics || { status: '尚无回复诊断', tokens: null }, null, 2);
    const slang = await call('/api/slang'); if (serial !== requestSerial) return; el('bfGroupSlang').replaceChildren();
    for (const e of slang.entries.filter(e => e.scope === key || e.scope === 'public' || e.scope === 'legacy' || e.confirmedScopes?.includes(key))) {
      const row = document.createElement('p'); row.textContent = `${e.content}：${e.meaning || '待研究'} · ${e.scope || 'legacy'} · ${e.status} `;
      const scope = document.createElement('select'); for (const v of ['legacy', 'public', 'shared', ...groups]) scope.append(option(v, v)); scope.value = e.scope || 'legacy'; row.append(scope);
      const confirmed = document.createElement('input'); confirmed.placeholder = '独立确认的 group:群号，逗号分隔'; confirmed.value = (e.confirmedScopes || []).join(','); row.append(confirmed);
      row.append(button('确认范围', async () => { await call('/api/bigfatfish/slang-scope', 'POST', { id: e.id, revision: e.revision || 0, scope: scope.value, confirmedScopes: confirmed.value.split(',').map(s => s.trim()).filter(Boolean) }); await load(); })); el('bfGroupSlang').append(row);
    }
  }
  async function refresh() { const r = await call('/api/bigfatfish/group-style'), old = el('bfGroupSelect').value; groups = r.groups; el('bfGroupSelect').replaceChildren(...groups.map(k => option(k, k))); if (groups.includes(old)) el('bfGroupSelect').value = old; await load(); }
  el('bfGroupLoad').onclick = () => run(refresh); el('bfGroupSelect').onchange = () => run(load); el('bfGroupTrait').onchange = values; el('bfGroupEdit').elements.id.onchange = editSelection;
  el('bfGroupConfig').onsubmit = e => { e.preventDefault(); run(() => { const f = e.target.elements, policy = Object.fromEntries(Object.keys(fields).map(k => [k, Number(f[k].value)])); return actionRequest({ action: 'configure', enabled: f.enabled.checked, apply: f.apply.checked, locked: f.locked.checked, policy }); }); };
  el('bfGroupSet').onclick = () => run(() => actionRequest({ action: 'setFeature', feature: el('bfGroupTrait').value, value: el('bfGroupValue').value }));
  el('bfGroupEdit').onsubmit = e => { e.preventDefault(); run(() => actionRequest({ action: 'editExpression', id: e.target.elements.id.value, ...Object.fromEntries(Object.entries(editInputs).map(([k, i]) => [k, i.multiple ? [...i.selectedOptions].map(o => o.value) : i.value])) })); };
  el('bfGroupRollback').onclick = () => run(() => actionRequest({ action: 'rollback', version: Number(el('bfGroupHistory').value) }));
  el('bfGroupReset').onclick = () => run(() => actionRequest({ action: 'reset' }));
  el('bfGroupPreview').onsubmit = e => { e.preventDefault(); run(async () => { const r = await call('/api/bigfatfish/group-style', 'POST', { key: el('bfGroupSelect').value, action: 'preview', message: e.target.elements.message.value }); el('bfGroupPreviewResult').textContent = JSON.stringify(r, null, 2); }); };
  consolePages['bff-group-style'] = ['群聊风格学习', '独立学习，审核发布，按场景检索。', '群风格、表达经验、来源、黑话范围、版本与提示诊断。'];
  const nav = button('✦ 群聊风格学习', async () => { setConsolePage('bff-group-style', { focus: true }); await refresh(); }); nav.className = 'nav-item'; nav.dataset.view = 'bff-group-style'; el('mainNav').append(nav);
  if (typeof featureIndex !== 'undefined') featureIndex.push({ page: 'bff-group-style', label: '群聊风格 表达经验 审核 隔离 检索 诊断', target: section });
  if (location.hash.slice(1) === 'bff-group-style') { setConsolePage('bff-group-style', { updateHash: false }); run(refresh); }
})();
