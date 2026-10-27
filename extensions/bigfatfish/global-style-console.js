// One global profile; model/chat content is never interpreted as HTML.
(() => {
  const el = id => document.getElementById(id);
  const section = document.createElement('section'); section.id = 'section-bff-global-style'; section.dataset.page = 'bff-global-style'; section.className = 'card span-all bf-integrated'; section.hidden = true;
  section.innerHTML = `<h2>统一风格学习</h2><p>从允许学习的真人对话中融合一份表达风格，所有会话共用。学习措辞、句式、回答结构和接话方式；不共享个人事实，不复刻原句。新特征需至少三天的真实依据，更新时逐步融合。</p>
    <button id="bfGlobalLoad" type="button">加载 / 刷新</button><p id="bfGlobalStatus" role="status"></p>
    <h3>回复分条方式（全局）</h3><form id="bfReplyDeliveryForm"><label>分条偏好 <select id="bfReplyDelivery" aria-label="回复分条方式"><option value="natural">自然分条（默认）</option><option value="single">尽量一条</option><option value="flow">适度分条</option></select></label> <button type="submit">保存分条方式</button></form>
    <p>自然分条：优先一条，确有内容和节奏需要时再分。尽量一条：尽量将回应和补充放在同一条。适度分条：允许按独立重点和自然停顿分条。三种都不固定凑两条；这是表达偏好，不保证固定条数，也不截断内容。保存后即时影响后续回复，独立于自动学习开关。</p>
    <form id="bfGlobalPolicy"><label><input name="enabled" type="checkbox">自动学习</label> <label><input name="apply" type="checkbox">影响回复</label><div id="bfGlobalNumbers"></div><button type="submit">保存学习设置</button></form>
    <p><button id="bfGlobalLock" type="button">锁定当前风格</button> <button id="bfGlobalReset" type="button">清空风格与版本，从新消息重新学习</button></p>
    <h3>当前表达特征</h3><div id="bfGlobalFeatures"></div>
    <p><label>人工指定维度 <select id="bfGlobalTrait"></select></label> <label>表达方式 <select id="bfGlobalValue"></select></label> <button id="bfGlobalSet" type="button">设置该项并保留人工值</button></p>
    <h3>风格版本</h3><select id="bfGlobalHistory" aria-label="风格历史版本" style="max-width:100%"></select> <button id="bfGlobalRollback" type="button">回滚所选版本并锁定</button>
    <p>锁定会停止自动更新，已有有效风格仍可使用。关闭“影响回复”只停用风格。删除特征后，同一批旧消息不会重新激活它；手动指定的特征需删除后才恢复该项自动学习。来源被停用或过期后，对应自动特征停止应用。版本不包含聊天正文。</p>`;
  document.querySelector('#mainContent .grid').append(section);
  const fields = { lookbackHours: ['语料回看小时', 72, 720], minMessages: ['至少有效发言数', 20, 500], minDays: ['至少覆盖日期数', 3, 30], refreshHours: ['分析至少间隔小时', 1, 168], minNewMessages: ['再次分析所需新发言', 3, 100], dailyCap: ['每日分析上限（共用研究额度）', 0, 30], maxChanges: ['每轮最多调整维度', 1, 3] };
  for (const [name, [title, min, max]] of Object.entries(fields)) {
    const label = document.createElement('label'), input = document.createElement('input'); label.textContent = title + ' '; label.style.cssText = 'display:inline-block;margin:8px';
    Object.assign(input, { name, type: 'number', min, max }); input.style.width = '75px'; label.append(input); el('bfGlobalNumbers').append(label);
  }
  let view;
  const run = async fn => { try { await fn(); } catch (e) { showConsoleToast(e.message); } };
  const request = async (method = 'GET', body) => { const r = await api('/api/bigfatfish/global-style', method, body); if (r.ok === false) throw Error(r.error || '风格操作失败'); return r; };
  const names = { tone: '语气', wording: '措辞', sentences: '句式', structure: '回答结构', engagement: '接话方式', paragraphs: '分段', punctuation: '标点', emotes: '表情' };
  function values() {
    const select = el('bfGlobalValue'); select.replaceChildren();
    for (const [value, title] of Object.entries(view?.traits[el('bfGlobalTrait').value] || {})) { const o = document.createElement('option'); o.value = value; o.textContent = title; select.append(o); }
  }
  function render(r) {
    view = r;
    el('bfReplyDelivery').value = r.replyDelivery || 'natural';
    const statuses = { researching: '分析中', approved: '已完成分析', rejected: '暂未确认', failed: '分析失败，等待重试', cancelled: '来源或设置已变化，旧结果已丢弃' };
    el('bfGlobalStatus').textContent = `统一风格 v${r.version} · ${r.locked ? '已锁定' : '可自动更新'} · ${r.policy.apply ? '允许影响回复' : '仅学习不应用'} · 有效语料 ${r.sample.messages} 次 / ${r.sample.days} 天 · 今日分析 ${r.budget?.todayUsed || 0}/${r.policy.dailyCap} 次 · ${statuses[r.research.status] || (r.sample.qualified ? '等待下一次分析' : '等待语料达标')}${r.error ? ' · ' + r.error : ''}`;
    for (const [k, value] of Object.entries(r.policy)) { const input = el('bfGlobalPolicy').elements[k]; if (input) input[input.type === 'checkbox' ? 'checked' : 'value'] = value; }
    el('bfGlobalLock').textContent = r.locked ? '解除锁定，恢复自动更新' : '锁定当前风格';
    const box = el('bfGlobalFeatures'); box.replaceChildren();
    for (const f of r.features) {
      const row = document.createElement('p'); row.textContent = `${names[f.key]}：${f.label} · ${f.active ? '有效' : '依据已失效'} · ${f.manual ? '人工指定' : `${f.evidence} 条来源 / ${f.days} 天，置信度 ${Math.round(f.confidence * 100)}%`} `;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除该项'; remove.onclick = () => run(() => action({ action: 'delete', key: f.key })); row.append(remove);
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '查看来源依据'; details.append(summary);
      for (const source of f.sources || []) { const p = document.createElement('p'); p.textContent = `${new Date(source.time).toLocaleString('zh-CN')} · 来源 ${source.id}`; details.append(p); }
      row.append(details); box.append(row);
    }
    if (!r.features.length) box.textContent = '尚无已确认的统一风格；继续使用角色原本的表达。';
    const trait = el('bfGlobalTrait').value; el('bfGlobalTrait').replaceChildren();
    for (const key of Object.keys(r.traits)) { const o = document.createElement('option'); o.value = key; o.textContent = names[key]; el('bfGlobalTrait').append(o); }
    if (r.traits[trait]) el('bfGlobalTrait').value = trait; values();
    el('bfGlobalHistory').replaceChildren();
    for (const h of [...r.history].reverse()) { const o = document.createElement('option'); o.value = h.version; o.textContent = `v${h.version} · ${new Date(h.at).toLocaleString('zh-CN')} · ${h.labels.join('；') || '基础风格'}`; el('bfGlobalHistory').append(o); }
  }
  async function load() { render(await request()); }
  async function action(body) { if (!view) throw Error('请先加载统一风格'); render(await request('POST', { ...body, revision: view.revision })); showConsoleToast('统一风格已保存'); }
  el('bfGlobalLoad').onclick = () => run(load);
  el('bfReplyDeliveryForm').onsubmit = event => { event.preventDefault(); run(async () => {
    const replyDelivery = el('bfReplyDelivery').value;
    const r = await api('/api/bigfatfish/settings', 'POST', { replyDelivery });
    if (r.ok === false) throw Error(r.error || '分条方式保存失败');
    await load(); showConsoleToast('分条方式已保存，后续回复即时生效');
  }); };
  el('bfGlobalTrait').onchange = values;
  el('bfGlobalPolicy').onsubmit = event => { event.preventDefault(); run(async () => {
    const f = event.target.elements, policy = { enabled: f.enabled.checked, apply: f.apply.checked };
    for (const k of Object.keys(fields)) policy[k] = Number(f[k].value);
    await action({ action: 'configure', policy });
  }); };
  el('bfGlobalLock').onclick = () => run(() => action({ action: 'lock', locked: !view?.locked }));
  el('bfGlobalReset').onclick = () => run(() => action({ action: 'reset' }));
  el('bfGlobalSet').onclick = () => run(() => action({ action: 'set', key: el('bfGlobalTrait').value, value: el('bfGlobalValue').value }));
  el('bfGlobalRollback').onclick = () => run(async () => { if (!el('bfGlobalHistory').value) throw Error('暂无历史版本'); await action({ action: 'rollback', version: Number(el('bfGlobalHistory').value) }); });
  consolePages['bff-global-style'] = ['统一风格学习', '融合真人表达，逐步形成自己的说话方式。', '所有会话共用一份风格；查看特征依据、学习设置与版本。'];
  const nav = document.createElement('button'); nav.type = 'button'; nav.className = 'nav-item'; nav.dataset.view = 'bff-global-style'; nav.textContent = '✦ 统一风格学习'; nav.onclick = () => { setConsolePage('bff-global-style', { focus: true }); run(load); }; el('mainNav').append(nav);
  if (typeof featureIndex !== 'undefined') featureIndex.push({ page: 'bff-global-style', label: '统一风格 自动学习 回答方式', target: section });
  if (location.hash.slice(1) === 'bff-global-style') { setConsolePage('bff-global-style', { updateHash: false }); run(load); }
})();
