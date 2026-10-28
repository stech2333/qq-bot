// BigFatFish API pool console v1
(() => {
  const grid = document.querySelector('#mainContent .grid');
  const section = document.createElement('section'); section.className = 'card span-all'; section.dataset.page = 'model-pool'; section.id = 'section-api-pool'; section.hidden = true;
  section.innerHTML = `<h2>模型与 API 池</h2>
    <p>为每个接口或密钥保存一个条目，手动实时切换；下一次请求生效，进行中的回复继续完成。聊天、话题、风格和黑话研究共用当前选项。</p>
    <p>联网搜索单独配置：聊天中转可用不代表它支持原 DeepSeek 搜索接口。这里的测试不发送 QQ 消息。原用量页面的费用仍为内置价格估算，中转费用请以平台账单为准。</p>
    <p id="poolCurrent" role="status">读取中…</p><p id="poolNotice" role="status"></p>
    <div class="row"><button type="button" id="poolRefresh">刷新</button><button type="button" id="poolBuiltin">切回原接口</button><button type="button" id="poolNew">＋ 新增 API</button></div>
    <div id="poolEntries"></div>
    <details id="poolEditor"><summary>新增 / 编辑 API</summary><form id="poolForm" autocomplete="off">
    <p><label>名称 <input name="name" required maxlength="80" placeholder="例如：南航 Token"></label></p>
    <p><label>接口基址 <input name="baseURL" type="url" placeholder="https://token.nuaa.edu.cn/v1" style="width:75%"></label></p>
    <p class="meta">填写基址，不包含 /chat/completions、/messages 或 /responses；接口或模型暂时留空可保存为待配置条目。</p>
    <p><label>协议 <select name="protocol"><option value="openai-completions">Chat Completions</option><option value="openai-responses">Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
    <label>模型 ID <input name="model" maxlength="200" placeholder="deepseek-flash"></label></p>
    <p><label>API Key <input name="apiKey" type="password" autocomplete="new-password" placeholder="新增时填写；编辑留空保留现有密钥" maxlength="4096" style="width:65%"></label></p>
    <p class="meta">密钥只写入本机 DSH 凭据存储，不回传浏览器，不写入普通配置文件。</p>
    <p><label><input name="enabled" type="checkbox" checked>启用</label> <label><input name="vision" type="checkbox">接口已支持图片输入</label> <label><input name="deepseekCompat" type="checkbox">DeepSeek Chat 协议兼容</label></p>
    <p><label>思考档位 <select name="effort"><option value="">接口默认（不附加思考参数）</option><option>minimal</option><option>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select></label></p>
    <p class="meta">只选择服务商实际支持的档位；默认不保证关闭服务端推理。图片能力需按接口实际支持情况勾选。</p>
    <p><label>上下文容量 <input name="contextWindow" type="number" min="4096" max="2000000" value="65536"></label> <label>单次输出上限 <input name="maxTokens" type="number" min="128" max="131072" value="4096"></label></p>
    <button type="submit">保存 API</button><button type="button" id="poolCancel">取消编辑</button><span id="poolEditing"></span>
    </form></details>`;
  grid.append(section);
  consolePages['model-pool'] = ['模型与 API 池', '管理模型接口与密钥。', '新增、编辑、测试接口，并选择当前使用的 API。'];
  const nav=document.querySelector('#consoleSubnav [data-subpage="model-pool"]');
  const $ = id => document.getElementById(id), form = $('poolForm');
  let cache, editingId = null, editRevision, busy = false;
  const notice = value => { $('poolNotice').textContent = value; };
  function render(data) {
    cache = data;
    const active = data.entries?.find(e => e.id === data.activeId);
    $('poolCurrent').textContent = data.error || (active ? `当前：${active.name} · ${active.model}` : `当前：原接口 ${data.fallback?.provider || ''} / ${data.fallback?.model || ''}`) + (data.ready ? '' : ' · DSH未连接');
    $('poolBuiltin').disabled = !!data.error || busy || !data.activeId;
    $('poolEntries').innerHTML = (data.entries || []).map(e => `<article class="card" style="margin:12px 0"><h3>${esc(e.name)}${e.id === data.activeId ? ' · 当前使用' : ''}${e.enabled ? '' : ' · 已停用'}</h3>
      <p>${esc(e.protocol)} · ${esc(e.model || '模型待填写')} · ${e.keyStored ? '密钥已保存' : '密钥待填写'}</p><p>${esc(e.baseURL || '接口待填写')}</p>
      <p class="meta">${e.vision ? '文本与图片' : '仅文本'} · 思考：${esc(e.effort || '接口默认')} ${e.lastTest ? ' · ' + esc(e.lastTest.message || '') + (e.lastTest.elapsedMs ? `（${Math.round(e.lastTest.elapsedMs / 1000)}秒）` : '') : ''}</p>
      <div class="row"><button data-pool-action="activate" data-id="${e.id}" ${!e.enabled || e.id === data.activeId || busy ? 'disabled' : ''}>切换使用</button>
      <button data-pool-action="test" data-id="${e.id}" ${!e.enabled || e.lastTest?.status === 'running' || busy ? 'disabled' : ''}>测试连接</button>
      <button data-pool-action="edit" data-id="${e.id}" ${e.lastTest?.status === 'running' ? 'disabled' : ''}>编辑</button>
      <button data-pool-action="delete" data-id="${e.id}" ${e.id === data.activeId || e.lastTest?.status === 'running' || busy ? 'disabled' : ''}>删除接口及密钥</button></div></article>`).join('') || '<p>尚无 API 条目。点击“新增 API”添加。</p>';
  }
  async function refresh() { const data = await api('/api/model-pool'); render(data); }
  function edit(entry) {
    form.reset(); editingId = entry?.id || null; editRevision = cache?.revision;
    for (const field of ['name', 'baseURL', 'model', 'protocol', 'effort', 'contextWindow', 'maxTokens']) if (entry?.[field] !== undefined) form.elements[field].value = entry[field];
    for (const field of ['enabled', 'vision', 'deepseekCompat']) form.elements[field].checked = entry ? !!entry[field] : field === 'enabled';
    $('poolEditing').textContent = entry ? `正在编辑：${entry.name}` : '新增条目';
    $('poolEditor').open = true; form.elements.name.focus();
  }
  async function action(kind, body) {
    if (busy) return;
    const locksPage = kind !== 'test';
    if (locksPage) busy = true;
    else { const entry = cache?.entries.find(e => e.id === body.id); if (entry) entry.lastTest = { status: 'running', message: '内部会话测试中…' }; }
    if (cache) render(cache);
    notice(kind === 'test' ? '内部会话测试中，通常需数秒，模型响应最多等待60秒；若研究队列繁忙则需等待排队。' : '正在保存…');
    try {
      const data = await api('/api/model-pool/' + kind, 'POST', body);
      if (!data.ok) throw new Error(data.error || '操作失败');
      render(data);
      notice(data.test?.message || data.message || '已保存');
      if (kind === 'save') { form.elements.apiKey.value = ''; editingId = null; $('poolEditor').open = false; }
      refreshDshModel();
    } catch (error) { notice(error.message); await refresh().catch(() => {}); }
    finally { if (locksPage) busy = false; if (cache) render(cache); }
  }
  nav.onclick = () => { setConsolePage('model-pool', { focus: true }); refresh().catch(e => notice(e.message)); };
  $('poolRefresh').onclick = () => refresh().catch(e => notice(e.message));
  $('poolNew').onclick = () => edit(null);
  $('poolCancel').onclick = () => { form.elements.apiKey.value = ''; editingId = null; $('poolEditor').open = false; };
  $('poolBuiltin').onclick = () => action('activate', { id: null, revision: cache.revision });
  form.onsubmit = event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form)); body.id = editingId; body.revision = editRevision;
    for (const field of ['enabled', 'vision', 'deepseekCompat']) body[field] = form.elements[field].checked;
    for (const field of ['contextWindow', 'maxTokens']) body[field] = Number(body[field]);
    action('save', body);
  };
  $('poolEntries').onclick = event => {
    const button = event.target.closest('[data-pool-action]'); if (!button || busy) return;
    const entry = cache.entries.find(e => e.id === button.dataset.id); if (!entry) return;
    if (button.dataset.poolAction === 'edit') { edit(entry); return; }
    if (button.dataset.poolAction === 'delete' && !confirm(`删除“${entry.name}”及其本机密钥？`)) return;
    action(button.dataset.poolAction, { id: entry.id, revision: cache.revision });
  };
  const original = document.getElementById('dshModelText')?.closest('.card');
  if (original) { const link = document.createElement('button'); link.type = 'button'; link.textContent = '管理模型与 API 池'; link.onclick = nav.onclick; original.append(link); }
  setConsolePage(location.hash.slice(1) || currentConsolePage, { updateHash: false });
  refresh().catch(e => notice(e.message));
  setInterval(() => { if (currentConsolePage === 'model-pool' && !busy) refresh().catch(() => {}); }, 5000);
})();
