// BigFatFish console v1
(() => {
  const grid = document.querySelector('#mainContent .grid');
  const sections = [];
  function card(page, id, title) {
    const section = document.createElement('section'); section.className = 'card span-all bf-integrated';
    section.dataset.page = page; section.id = id; section.hidden = true;
    const heading = document.createElement('h2'); heading.textContent = title; section.append(heading); grid.append(section); sections.push(section); return section;
  }
  const panel = card('bff-policy', 'section-bff-policy', '话题学习、定时与主动聊天');
  panel.innerHTML = `<h2>话题学习、定时与主动聊天</h2>
  <p id="bfState">读取状态…</p><p id="bfPolicyLayers"></p><p id="bfNotice" role="status"></p><button id="bfManagerOpen">启动 / 停止管理</button>
  <h3>启用群聊 / 私聊</h3><p>启用只控制机器人参与范围，不会自动加入群或添加好友。</p>
  <form id="bfAccess"><select name="kind"><option value="group">QQ群</option><option value="private">个人QQ</option></select> <input name="target" required pattern="[1-9][0-9]{4,15}" placeholder="群号或QQ号"> <button name="enable" value="yes">启用</button> <button name="enable" value="no">停用</button></form><div id="bfPeers"></div>
  <h3>人格与行为</h3><p>人格正文在原控制台“人格与角色”编辑；这里修改闲聊与冷场开场策略。</p>
  <form id="bfSettings"><label>闲聊简练字数参考（不作为拆条门槛） <input name="casualMaxChars" type="number" min="5" max="200"></label> <span>仅真实 @ 时正式完整回答；其余沿用当前角色的日常风格。</span><p><label>人工补充话题（逗号分隔，可留空）<input name="interests" style="width:70%"></label></p>
  <p><label><input name="dryRun" type="checkbox">冷场主动仅演练</label> <label>安静分钟 <input name="minIdleMinutes" type="number" min="1" max="10080"></label> <label>冷却分钟 <input name="cooldownMinutes" type="number" min="1" max="10080"></label> <label>每日上限 <input name="dailyCap" type="number" min="0" max="20"></label></p>
  <p><label>静默开始 <input name="quietStart" type="number" min="0" max="23"></label> <label>静默结束 <input name="quietEnd" type="number" min="0" max="23"></label>（北京时间，冷场与随机主动共用）</p><p><label>明确称呼（逗号分隔，命中必触发并要求回应）<input name="participationAliases" style="width:90%"></label></p><p>自动统计各会话反复讨论的词组，达到门槛后加入该会话的话题兴趣；再涉及这些话题时按话题概率接话，不再根据预设兴趣词算分。明确找其他群友时不使用话题加成；普通无关消息仍按退火规则处理。多条消息可能合并回应。</p><p>随机主动只在未安排正常回复的群聊合并轮次中抽取一次，依据最近上下文主动分享；已有明确待答消息时不触发。忙碌、离线、静默或限频时跳过，概率命中也不要求硬凑内容。沿用主动小时、全局每日及推理额度；不受冷场演练和45分钟冷场门槛限制。</p><div id="bfPolicyFields"></div><button>保存，即时生效</button></form>
  <h3>长期记忆</h3><select id="bfMemoryKey"></select> <button id="bfMemoryLoad">加载</button> <input id="bfMemoryQuery" placeholder="搜索长期事实"> <button id="bfMemorySearch">搜索</button>
  <p id="bfMemoryStatus"></p><p><label><input id="bfAccumulate" type="checkbox">允许积累新记忆</label> <label><input id="bfPersonalize" type="checkbox">使用长期记忆与全局风格</label> <button id="bfMemoryControls">保存开关</button> <button id="bfMemoryExpire">清理过期记忆</button></p>
  <div id="bfMemoryRows"></div><form id="bfRemember"><select name="category"><option value="longTerm">新增长期事实</option><option value="summary">替换阶段摘要</option><option value="interest">新增已确认兴趣</option></select><textarea name="content" required maxlength="3000" rows="3" placeholder="仅保存到选中的会话" style="width:90%"></textarea><button>保存</button></form>
  <p>各会话只分别维护兴趣话题和长期记忆。表达方式统一在侧栏“统一风格学习”中管理，回答结合全局风格、当前角色卡与本会话长期记忆。</p><p id="bfLearningWindowStatus"></p>
  <h3>反复讨论的话题与主动检查</h3><p>先从真实聊天中发现反复出现的话题，再加入各自会话的兴趣。这里显示消息数、参与人数和最近提及时间，不使用0至100兴趣分决定是否接话。直接 @ 和明确称呼优先。</p><button id="bfTopicScan">从已有聊天重新发现话题</button><div id="bfDecisions"></div>
  <h3>账号申请</h3><p>当前接口支持处理好友申请及群邀请/加群申请。主动发起加群、加好友接口尚不可用；可先邀请机器人或发送好友申请。</p><div id="bfRequests"></div>
  <h3>QQ收藏与独立语音</h3><p>表情继续使用原控制台的QQ收藏同步、备注和发送工具；图片/GIF不迁入本地素材库。</p><p id="bfVoice"></p><button id="bfVoiceOpen">打开独立语音工具</button><button id="bfRefresh">刷新状态</button>`;
  // Mount existing controls in the upstream router; their event handlers and data stay shared.
  function moveBlock(title, page, id, newTitle = title) {
    const start = [...panel.querySelectorAll('h3')].find(h => h.textContent === title);
    const section = card(page, id, newTitle); let node = start.nextSibling;
    while (node && !(node.nodeType === 1 && node.tagName === 'H3')) { const next = node.nextSibling; section.append(node); node = next; }
    start.remove(); return section;
  }
  const peers = moveBlock('启用群聊 / 私聊', 'sessions', 'section-bff-peers', '添加群聊 / 私聊');
  moveBlock('长期记忆', 'bff-memory', 'section-bff-memory');
  moveBlock('反复讨论的话题与主动检查', 'bff-policy', 'section-bff-decisions');
  moveBlock('账号申请', 'sessions', 'section-bff-requests');
  moveBlock('QQ收藏与独立语音', 'operations', 'section-bff-media');
  const wakePriorityNote = document.createElement('p'); wakePriorityNote.className = 'meta'; wakePriorityNote.textContent = '接话优先级：在“话题与主动策略”开启动态接话后，根据普通概率及学到的话题参与，明确找自己优先；原关键词、指定成员等显式订阅保留。自动发现根据真实讨论频次，不用旧兴趣分覆盖概率。定时主动仍受本页总开关与本地策略共同控制。';
  document.querySelector('[data-page="social-v2"] h2').after(wakePriorityNote);
  const el = name => document.getElementById(name);
  let currentSettings, currentMemory, settingsDirty = false;
  el('bfSettings').addEventListener('input', () => { settingsDirty = true; });
  Object.assign(consolePages, {
    'bff-policy': ['话题与主动策略', '从共同讨论中学会参与。', '查看反复讨论的话题、学习门槛、接话概率和主动检查记录。'],
    'bff-memory': ['长期记忆', '记住各会话中有价值的事。', '按群聊或私聊查看、纠正长期事实与阶段摘要；表达方式在统一风格学习中管理。']
  });
  for (const page of ['bff-policy', 'bff-memory']) {
    const nav = document.createElement('button'); nav.className = 'nav-item'; nav.dataset.view = page;
    const icon = document.createElement('span'); icon.className = 'nav-icon'; icon.ariaHidden = 'true'; icon.textContent = page === 'bff-policy' ? '◷' : '▤';
    nav.append(icon, consolePages[page][0]); el('mainNav').append(nav);
    nav.onclick = () => { setConsolePage(page, { focus: true }); run(refresh); };
  }
  const quick = card('overview', 'section-bff-overview', '大肥鱼 · 功能管理');
  const summary = document.createElement('p'); summary.id = 'bfOverviewStatus'; summary.textContent = '正在读取本地设置…'; quick.append(summary);
  for (const [page, label, target] of [['sessions', '添加群聊 / 私聊', peers.id], ['persona', '新增与编辑人格', 'roleList'], ['bff-policy', '话题与主动策略', panel.id], ['bff-memory', '记忆与表达风格', 'section-bff-memory'], ['slang', '黑话评分与入库', 'section-bff-slang'], ['operations', '启动与服务管理', 'section-bff-services']]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.onclick = () => { setConsolePage(page, { focus: true, target }); run(refresh); if (page === 'persona') run(refreshPersonas); if (page === 'slang') run(refreshSlangScores); if (page === 'operations') run(refreshServices); }; quick.append(b);
  }
  const accessActions = document.createElement('div'); accessActions.className = 'row';
  for (const [kind, title] of [['group', '添加群聊'], ['private', '添加私聊']]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = title;
    b.onclick = () => { el('bfAccess').elements.kind.value = kind; el('bfAccess').elements.target.focus(); }; accessActions.append(b);
  }
  peers.querySelector('h2').after(accessActions);
  // Use the native create/update events and role files, with a clear entry in the persona list.
  const addRole = document.createElement('button'); addRole.type = 'button'; addRole.id = 'bfAddRole'; addRole.textContent = '＋ 新增人格';
  const revealRoleEditor = () => { const input = el('newRoleName'); const details = input.closest('details'); if (details) details.open = true; input.scrollIntoView({ block: 'center' }); input.focus(); };
  addRole.onclick = () => { resetRoleForm(); revealRoleEditor(); };
  el('roleList').before(addRole);
  el('roleList').addEventListener('click', event => { if (event.target.closest('.persona-item')) revealRoleEditor(); });
  const personaCard = card('persona', 'section-bff-personas', '按群聊 / 私聊选择人格');
  grid.insertBefore(personaCard, document.querySelector('[data-page="persona"]'));
  const personaIntro = document.createElement('p'); personaIntro.textContent = '每个会话可单独选择已创建的人格模板，选择后保存并从下一轮对话生效。未单独设置时跟随全局默认；切换人格保留该会话记忆和参与设置。'; personaCard.append(personaIntro);
  const defaultInput = el('roleInput'), defaultSelect = document.createElement('select'); defaultSelect.id = 'roleInput'; defaultSelect.setAttribute('aria-label', '全局默认人格模板'); defaultInput.replaceWith(defaultSelect);
  const defaultBox = defaultSelect.closest('details'); defaultBox.open = true; defaultBox.querySelector('summary').textContent = '全局默认人格（未单独设置的会话使用）';
  defaultBox.querySelector('.meta').textContent = '从已创建的模板中选择并应用；设置为“不使用人格模板”只影响跟随默认的会话。';
  el('roleSet').textContent = '应用全局默认'; el('roleClear').textContent = '取消默认人格'; personaCard.append(defaultBox);
  const personaStatus = document.createElement('p'); personaStatus.id = 'bfPersonaStatus'; personaStatus.setAttribute('role', 'status');
  const personaRows = document.createElement('div'); personaRows.id = 'bfPersonaRows'; personaRows.className = 'bf-table'; personaCard.append(personaStatus, personaRows);
  let personaRevision = 0, personaBusy = false, personaLoad = 0;
  function option(value, text) { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; }
  async function refreshPersonas() {
    const load = ++personaLoad, data = await call('/api/bigfatfish/personas'); if (load !== personaLoad) return;
    personaRevision = data.revision;
    const draft = defaultSelect.value, preserve = defaultSelect.dataset.dirty === 'true';
    defaultSelect.replaceChildren(option('', '不使用人格模板'));
    for (const name of data.roles) defaultSelect.append(option(name, name));
    if (data.defaultRole && !data.roles.includes(data.defaultRole)) defaultSelect.append(option(data.defaultRole, data.defaultRole + '（模板缺失）'));
    defaultSelect.value = preserve && [...defaultSelect.options].some(o => o.value === draft) ? draft : data.defaultRole || '';
    personaStatus.textContent = `全局默认：${data.defaultRole || '不使用人格模板'} · ${data.sessions.length} 个会话 · 选择会话下拉框后立即保存`;
    personaRows.replaceChildren();
    if (!data.sessions.length) { personaRows.textContent = '暂无会话，请先到“会话与审批”添加群聊或私聊。'; return; }
    const table = document.createElement('table'), head = document.createElement('tr');
    for (const title of ['群聊 / 私聊', '人格模板选择', '当前生效']) { const th = document.createElement('th'); th.textContent = title; head.append(th); } table.append(head);
    for (const row of data.sessions) {
      const tr = document.createElement('tr'), peer = document.createElement('td'), control = document.createElement('td'), effective = document.createElement('td');
      const [kind, id] = row.key.split(':'); peer.textContent = `${kind === 'group' ? '群聊' : '私聊'} ${id}${row.enabled ? '' : '（未启用参与）'}`;
      const select = document.createElement('select'); select.dataset.key = row.key; select.setAttribute('aria-label', peer.textContent + '的人格模板');
      select.append(option('inherit', '跟随全局默认：' + (data.defaultRole || '无人格')), option('none', '本会话不使用人格模板'));
      for (const name of data.roles) select.append(option('template:' + name, name));
      if (row.missing) select.append(option('template:' + row.role, row.role + '（模板缺失，暂用全局默认）'));
      select.value = row.mode === 'template' ? 'template:' + row.role : row.mode; select.disabled = personaBusy;
      effective.textContent = (row.effectiveRole || '不使用人格模板') + (row.missing ? '（原模板缺失）' : row.mode === 'inherit' ? '（跟随默认）' : '（单独设置）');
      select.onchange = () => run(async () => {
        const value = select.value; personaBusy = true; personaRows.querySelectorAll('select').forEach(input => { input.disabled = true; }); personaStatus.textContent = '正在保存当前会话人格…';
        try {
          await call('/api/bigfatfish/personas', 'POST', { key: row.key, revision: personaRevision, mode: value.startsWith('template:') ? 'template' : value, role: value.startsWith('template:') ? value.slice(9) : null });
          notice('已保存 ' + peer.textContent + ' 的人格选择，下一轮对话生效');
        } finally { personaBusy = false; await refreshPersonas(); }
      }); control.append(select); tr.append(peer, control, effective); table.append(tr);
    }
    personaRows.append(table);
  }
  defaultSelect.onchange = () => { defaultSelect.dataset.dirty = 'true'; };
  document.addEventListener('bff-roles-changed', () => { defaultSelect.dataset.dirty = 'false'; run(refreshPersonas); });
  document.addEventListener('click', event => { if (event.target.closest('#mainNav [data-view="persona"]')) run(refreshPersonas); });
  const style = document.createElement('style'); style.textContent = `
    .bf-integrated form{display:grid;gap:12px}.bf-integrated input[type=number]{max-width:110px}
    .bf-integrated fieldset{border:1px solid var(--line,#d9e1ea);border-radius:12px;padding:14px;margin:12px 0}
    .bf-integrated form>p{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
    .bf-integrated form>p>label,.bf-integrated fieldset label{display:inline-flex;align-items:center;gap:8px}
    .bf-integrated textarea{max-width:100%}.bf-integrated button{margin:4px}.bf-integrated .bf-table{overflow:auto}
    .bf-integrated table{width:100%;border-collapse:collapse}.bf-integrated td,.bf-integrated th{text-align:left;padding:10px;border-bottom:1px solid var(--line,#d9e1ea)}
    .bf-integrated td:first-child{min-width:150px}.bf-integrated td:nth-child(2){white-space:nowrap}
    #bfSlangFields{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
    #bfSlangFields label{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #bfAccess{grid-template-columns:140px minmax(160px,1fr) auto auto;align-items:center}
    @media(max-width:650px){#bfAccess{grid-template-columns:1fr}#bfSlangFields{grid-template-columns:1fr}}
  `; document.head.append(style);
  const fields = {
    participation: { title: '接话与退火', enabled: ['启用动态接话', 'checkbox'], requireDirected: ['群聊确认在跟机器人说话才回答', 'checkbox'], quoteReplies: ['群聊允许引用原消息', 'checkbox'], idleProbability: ['旁观接话概率', 0, 1, 0.05], interestProbability: ['兴趣话题接话概率下限', 0, 1, 0.05], engagedProbability: ['参与中接话概率', 0, 1, 0.05], floorProbability: ['退出后接话概率', 0, 1, 0.01], halfLifeMessages: ['无关消息减半条数', 1, 20], halfLifeSeconds: ['热度减半秒数', 10, 3600], exitSeconds: ['退出秒数', 30, 7200], followUpSeconds: ['追问识别秒数', 10, 600], maxOffTopicMessages: ['退出前无关消息条数', 2, 40], directBatchMs: ['直接找它合批毫秒', 100, 3000], engagedBatchMs: ['参与中合批毫秒', 100, 5000], ambientBatchMs: ['旁观合批毫秒', 100, 10000] },
    interestPolicy: { title: '话题参与', enabled: ['使用学到的话题参与聊天', 'checkbox'] },
    contextInitiative: { title: '聊天中随机主动（正常回复优先，每批只抽一次）', enabled: ['启用上下文随机主动，仅群聊', 'checkbox'], probability: ['主动发言概率', 0, 1, 0.01], cooldownMinutes: ['两次主动尝试至少间隔分钟', 1, 120], contextMinutes: ['使用最近多少分钟的上下文', 1, 120] },
    topicLearning: { title: '自动发现聊天多的话题', enabled: ['启用自动话题学习', 'checkbox'], autoResearch: ['达标后自动研究话题', 'checkbox'], autoConfirm: ['研究通过后自动加入本群话题库', 'checkbox'], lookbackHours: ['统计近多少小时', 1, 720], minMessages: ['多人研究至少消息数', 3, 20], minSpeakers: ['至少讨论人数', 2, 10], soloMinMessages: ['单人研究至少消息数', 3, 20], retentionDays: ['话题多久未提及后停用（天）', 1, 365], maxTopics: ['每会话最多使用话题数', 1, 30], sampleLimit: ['话题统计消息上限', 50, 50000] },
    learningWindow: { title: '独立滚动学习记录（不占聊天上下文）', maxMessages: ['每群最多保留消息数', 200, 50000] },
    learningResearch: { title: '话题、风格、黑话自动研究', enabled: ['启用自动研究', 'checkbox'], minConfidence: ['研究确认最低置信度', 0.5, 1, 0.05], maxPerDay: ['每日最多研究次数', 0, 200], intervalMinutes: ['研究检查间隔（分钟）', 1, 1440], retryMinutes: ['研究重试间隔（分钟）', 1, 10080] },
    schedule: { title: '定时与主动额度', enabled: ['启用定时检查', 'checkbox'], privateEnabled: ['允许主动私聊', 'checkbox'], minCheckMinutes: ['检查间隔下限（分钟）', 1, 1440], maxCheckMinutes: ['检查间隔上限（分钟）', 1, 1440], hourlyCap: ['每会话每小时发送上限', 0, 10], globalDailyCap: ['所有会话每日发送上限', 0, 100], dailyAttemptCap: ['每会话每日主动推理上限', 0, 100], globalDailyAttemptCap: ['全局每日主动推理上限', 0, 200], replyWaitMinutes: ['等回应时长（分钟）', 1, 1440], maxUnanswered: ['连续无回应停止次数', 1, 10], maxIdleHours: ['最近真人消息有效期（小时）', 1, 720], retryMinutes: ['未发言重试间隔（分钟）', 1, 1440], topicCooldownMinutes: ['同话题冷却（分钟）', 1, 10080] },
    memory: { title: '记忆保留与召回', maxFacts: ['每会话事实条数上限', 1, 200], recallLimit: ['每次最多召回条数', 1, 20], halfLifeDays: ['记忆新鲜度减半（天）', 1, 3650], minConfidence: ['最低召回置信度', 0, 1, 0.05], pendingMinutes: ['待说想法有效期（分钟）', 1, 10080], topicHours: ['活跃话题有效期（小时）', 1, 720], summaryMaxChars: ['阶段摘要字数上限', 100, 4000] }
  };
  Object.assign(fields.memory, {
    maxChars: ['每次召回引用字数上限', 100, 10000], evidenceThreshold: ['召回相关证据门槛', 0, 1, 0.05],
    stableLimit: ['每次稳定事实名额', 0, 20], dailyQuota: ['每会话每日新记忆上限', 0, 100]
  });
  fields.schedule.openingMotivation = ['主动开场动机（可空）', 'text'];
  for (const [group, spec] of Object.entries(fields)) {
    const box = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = spec.title; box.append(legend);
    for (const [key, specField] of Object.entries(spec)) {
      if (key === 'title') continue;
      const label = document.createElement('label'); label.style.cssText = 'display:inline-block;margin:8px'; label.append(specField[0]+' ');
      const input = document.createElement('input'); input.name = group+'_'+key; input.type = ['checkbox', 'text'].includes(specField[1]) ? specField[1] : 'number';
      if (input.type === 'text') { input.maxLength = 200; input.style.width = '70%'; }
      if(input.type==='number'){input.min=specField[1];input.max=specField[2];input.step=specField[3]||1;input.style.width='85px'} label.append(input); box.append(label);
    }
    if(group==='schedule'){const label=document.createElement('label');label.textContent='启用星期（1周一至7周日，逗号分隔） ';const input=document.createElement('input');input.name='weekdays';label.append(input);box.append(label)}
    el('bfPolicyFields').append(box);
  }
  const notice = text => { el('bfNotice').textContent = text; showConsoleToast(text); };
  async function call(url, method, body) { const result = await api(url, method, body); if (result.ok === false) throw new Error(result.error || '操作失败'); return result; }
  async function refresh() {
    const data = await call('/api/bigfatfish/status');
    el('bfState').textContent = `登录目标 ${data.expectedQQ}；当前网关账号 ${data.gatewayQQ || '未连接/未登录'}；管理员 ${data.ownerQQ}`;
    if (data.research) el('bfState').textContent += `；自动研究${data.research.running ? '进行中' : '等待检查'}，今日${data.research.todayUsed}/${data.research.policy.maxPerDay}次${data.research.error ? '；' + data.research.error : ''}`;
    el('bfPolicyLayers').textContent = `二代仿真总开关：${data.nativeSwitches?.socialV2 === false ? '关闭' : '开启'}；原定时主动总开关：${data.nativeSwitches?.proactive === false ? '关闭' : '开启'}。${data.settings.participation.requireDirected ? '当前仅回应明确找自己的消息，自动话题插话受限。' : '允许按普通/话题概率加入聊天；明确称呼优先。'}自动学习根据讨论频次，不看0至100兴趣分。定时主动仍需两个层级同时启用。`;
    el('bfOverviewStatus').textContent = el('bfState').textContent + `；启用 ${data.allow.groups.length} 个群聊、${data.allow.private.length} 个私聊。`;
    const form = el('bfSettings'), settings = data.settings; currentSettings = settings;
    if (!settingsDirty) {
    for(const[group,spec]of Object.entries(fields))for(const key of Object.keys(spec)){if(key==='title')continue;const input=form.elements[group+'_'+key];input[input.type==='checkbox'?'checked':'value']=settings[group][key]}
    form.elements.weekdays.value=settings.schedule.weekdays.join(',');
    form.elements.casualMaxChars.value = settings.casualMaxChars;
    form.elements.interests.value = settings.interests.join('，');
    form.elements.participationAliases.value = settings.participation.aliases.join('，');
    for (const [key, value] of Object.entries(settings.coldStart)) form.elements[key][key === 'dryRun' ? 'checked' : 'value'] = value;
    }
    const selectedMemoryKey = el('bfMemoryKey').value;
    el('bfPeers').replaceChildren(); el('bfMemoryKey').replaceChildren();
    for (const [kind, field] of [['group', 'groups'], ['private', 'private']]) {
      for (const target of data.allow[field]) {
        const row = document.createElement('p'); row.textContent = `${kind === 'group' ? '群' : '私聊'} ${target} 已启用 `;
        const disable = document.createElement('button'); disable.textContent = '停用'; disable.onclick = () => run(async () => { await call('/api/bigfatfish/access', 'POST', { kind, target, enabled: false }); await refresh(); }); row.append(disable); el('bfPeers').append(row);
      }
    }
    const memoryKeys = new Set(data.sessions.map(session => session.key));
    for (const [kind, field] of [['group', 'groups'], ['private', 'private']]) {
      for (const target of [...data.allow[field], ...(data.deny?.[field] || [])]) memoryKeys.add(`${kind}:${target}`);
    }
    for (const key of memoryKeys) {
      const [kind, target] = key.split(':'), field = kind === 'group' ? 'groups' : 'private';
      const enabled = data.allow[field].map(String).includes(target) && !(data.deny?.[field] || []).map(String).includes(target);
      const option = document.createElement('option'); option.value = key; option.textContent = key + (enabled ? '' : '（已停用 / 历史会话）'); el('bfMemoryKey').append(option);
    }
    if ([...el('bfMemoryKey').options].some(option => option.value === selectedMemoryKey)) el('bfMemoryKey').value = selectedMemoryKey;
    el('bfRequests').replaceChildren();
    for (const request of data.requests) {
      const row = document.createElement('p'); row.textContent = `${request.type} QQ:${request.userId} 群:${request.groupId} ${request.comment} `;
      for (const approve of [true, false]) { const button = document.createElement('button'); button.textContent = approve ? '同意' : '拒绝'; button.onclick = () => run(async () => { const r = await call('/api/bigfatfish/account', 'POST', { requestId: request.id, approve }); notice(r.message); await refresh(); }); row.append(button); }
      el('bfRequests').append(row);
    }
    if (!data.requests.length) el('bfRequests').textContent = '暂无待处理申请';

    el('bfDecisions').replaceChildren();
    for(const session of data.sessions){const box=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=session.key;box.append(title);for(const topic of session.topics?.active||[]){const row=document.createElement('p');row.textContent=`${topic.topic} · ${topic.messages}条不同消息 / ${topic.participants}人 · 最近提及 ${new Date(topic.lastSeen).toLocaleString('zh-CN')} · 已加入话题兴趣`;box.append(row)}if(!session.topics?.active?.length){const row=document.createElement('p');row.textContent='尚未形成反复讨论的话题';box.append(row)}const candidates=session.topics?.candidates||[];if(candidates.length){const row=document.createElement('p');row.textContent='正在积累：'+candidates.map(t=>`${t.topic}（${t.messages}条/${t.participants}人）`).join('、');box.append(row)}const next=session.nextCheckAt?new Date(session.nextCheckAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'等待安排';const decision=session.decisions.at(-1),status=document.createElement('p');status.textContent='下一检查 '+next+'；连续无回应 '+session.unanswered+'；最近决定：'+(decision?.reason||'暂无');box.append(status);el('bfDecisions').append(box)}
    const researchLabels = { pending: '待研究', researching: '研究中', approved: '研究通过', rejected: '尚未确认', failed: '等待重试' };
    [...el('bfDecisions').children].forEach((box, i) => {
      const session = data.sessions[i], row = document.createElement('p'), window = session.learningWindow;
      row.textContent = window ? `独立学习记录 ${window.messages}/${window.maxMessages}条 · 回看${window.hours}小时${window.error ? ' · ' + window.error : ''}` : '';
      const candidates = session.topics?.candidates || [];
      if (candidates.length) row.textContent += '；候选研究：' + candidates.map(t => t.topic + ' ' + (researchLabels[t.research?.status] || '积累中')).join('、');
      box.append(row);
      if (session.queues) {
        const q = session.queues, line = document.createElement('p');
        const phases = { none: '无', generating: '生成中', sent: '已发送', expired: '已过期' };
        line.textContent = `队列：待处理${q.pending}条（明确待答${q.directedPending}条）；已处理游标${q.processedThroughSeq}；近期已发记录${q.recentOutgoing}条；随机主动${phases[q.initiative] || q.initiative}${q.error ? ' · ' + q.error : ''}。已处理可包含明确跳过，不等于逐条回答；只有QQ确认发送成功才记已发记录。`;
        box.append(line);
      }
    });
    el('bfVoice').textContent = data.voice.installed ? '独立 voice-tool 已安装' : '独立 voice-tool 未安装（不使用旧SAPI替代）'; el('bfVoiceOpen').disabled = !data.voice.installed;
    if (el('bfMemoryKey').value && currentConsolePage === 'bff-memory') await memory();
  }
  async function run(work) { try { await work(); } catch (error) { notice(error.message); } }
  el('bfRefresh').onclick = () => run(refresh);
  const retryResearch = document.createElement('button'); retryResearch.id = 'bfResearchRetry'; retryResearch.type = 'button'; retryResearch.textContent = '重试失败的研究';
  retryResearch.onclick = () => run(async () => { const result = await call('/api/bigfatfish/research', 'POST', { action: 'retryFailed' }); notice(`已重新检查${result.changed}项失败研究，仍遵守每日额度`); await refresh(); });
  el('bfRefresh').parentElement.append(retryResearch);
  el('bfTopicScan').onclick = () => run(async () => { await call('/api/bigfatfish/topics', 'POST', { action: 'scan' }); await refresh(); notice('已从各会话现有聊天中更新话题，未发送聊天消息'); });
  el('bfAccess').onsubmit = event => { event.preventDefault(); const form = event.target; run(async () => { await call('/api/bigfatfish/access', 'POST', { kind: form.elements.kind.value, target: form.elements.target.value.trim(), enabled: event.submitter?.value !== 'no' }); notice('参与范围已保存，立即生效'); await refresh(); await refreshWhitelist(); }); };
  el('bfSettings').onsubmit = event => { event.preventDefault(); const f=event.target.elements; run(async()=>{
    const body={...currentSettings,casualMaxChars:Number(f.casualMaxChars.value),privateAssistant:false,interests:f.interests.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),coldStart:{dryRun:f.dryRun.checked},interestWeights:{...currentSettings.interestWeights}};
    for(const key of ['minIdleMinutes','cooldownMinutes','dailyCap','quietStart','quietEnd'])body.coldStart[key]=Number(f[key].value);
    for(const[group,spec]of Object.entries(fields)){body[group]={...currentSettings[group]};for(const key of Object.keys(spec)){if(key==='title')continue;const input=f[group+'_'+key];body[group][key]=input.type==='checkbox'?input.checked:input.type==='text'?input.value:Number(input.value)}}
    body.schedule.weekdays=f.weekdays.value.split(/[,，]/).map(Number);
    body.participation.aliases=f.participationAliases.value.split(/[,，\n]/).map(name=>name.trim()).filter(Boolean);
    delete body.slangPolicy;
    delete body.replyDelivery; // Controlled independently on the global style page.
    await call('/api/bigfatfish/settings','POST',body);settingsDirty=false;await refresh();notice('策略已保存，检查时间已重新安排');
  })};
  const button = (label, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => run(action); return b; };
  function renderMemory(data) {
    if (data.key !== el('bfMemoryKey').value) return;
    currentMemory = data;
    el('bfMemoryStatus').textContent = `当前会话 ${data.key} · 记忆版本 ${data.revision} · 本次显示 ${data.facts.length} 条长期事实；积累${data.control.accumulation ? '开启' : '暂停'}；长期记忆使用${data.control.personalization ? '开启' : '关闭'}`;
    el('bfAccumulate').checked = data.control.accumulation; el('bfPersonalize').checked = data.control.personalization;
    el('bfMemoryRows').replaceChildren();
    const interests = document.createElement('fieldset'), interestTitle = document.createElement('legend'); interestTitle.textContent = '从聊天中积累的兴趣'; interests.append(interestTitle);
    const interestHint = document.createElement('p'); interestHint.textContent = `独立学习记录统计讨论词组：近${data.interestLearning?.lookbackHours||168}小时内${data.interestLearning?.minMessages||5}条不同消息、${data.interestLearning?.minSpeakers||2}人讨论，或单人${data.interestLearning?.soloMinMessages||8}条，达标后自动研究，通过后加入本会话话题兴趣。未通过继续保留候选；不受聊天上下文100条限制。明确偏好记录也保留，记忆开关同时控制学习和使用。`; interests.append(interestHint);
    for (const topic of data.interests || []) {
      const row = document.createElement('p'); row.textContent = `${topic.topic} · ${{ active: '长期兴趣', candidate: '候选', blocked: '已删除，停止学习' }[topic.status]} · ${topic.messages}条来源 / ${topic.participants}人 `;
      if (topic.status !== 'blocked') {
        if (topic.status !== 'active') row.append(button('确认为兴趣', async () => mutateMemory({ action: 'interestConfirm', id: topic.id })));
        row.append(button('删除并停止学习', async () => mutateMemory({ action: 'interestBlock', id: topic.id })));
      } else row.append(button('重新允许学习', async () => mutateMemory({ action: 'interestResume', id: topic.id })));
      interests.append(row);
    }
    if (!(data.interests || []).length) { const empty = document.createElement('p'); empty.textContent = '尚未发现候选兴趣。'; interests.append(empty); }
    el('bfMemoryRows').append(interests);
    for (const fact of data.facts) {
      const box = document.createElement('fieldset'), meta = document.createElement('legend');
      meta.textContent = `${fact.id} · ${fact.source?.admin ? '管理员记录' : '来源QQ ' + (fact.source?.userId || '未知')} · 确认${fact.confirmations || 1}次 · 鲜活度${Math.round((fact.freshness ?? 1) * 100)}%${fact.expired ? ' · 已过期' : ''}${fact.at ? ' · 记录于' + new Date(fact.at).toLocaleString('zh-CN') : ''}`;
      box.append(meta);
      const text = document.createElement('textarea'); text.value = fact.text; text.maxLength = 500; text.rows = 2; text.style.width = '95%'; box.append(text);
      const inputs = {};
      const factKey = document.createElement('input'); factKey.value = fact.factKey || ''; factKey.maxLength = 80; factKey.placeholder = '事实键：对象.方面（可空）'; box.append(factKey);
      const kind = document.createElement('select');
      for (const [value, title] of [['event', '事件，随时间淡忘'], ['stable', '稳定事实，不随时间淡忘']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; kind.append(option); }
      kind.value = fact.kind || 'event'; box.append(kind);
      const tags = document.createElement('input'); tags.value = (fact.tags || []).join('，'); tags.placeholder = '检索词，逗号分隔'; box.append(tags);
      for (const [key, label, value, min, max, step] of [
        ['confidence', '可信度', fact.confidence ?? 1, 0, 1, 0.05], ['importance', '重要度', fact.importance ?? 0.5, 0, 1, 0.05],
        ['expiresInDays', '有效天数（0不设到期）', fact.expiresAt ? Math.max(0, Math.ceil((fact.expiresAt - Date.now()) / 86400000)) : 0, 0, 3650, 1]
      ]) {
        const wrap = document.createElement('label'), input = document.createElement('input'); wrap.textContent = label + ' ';
        Object.assign(input, { type: 'number', value, min, max, step }); input.style.width = '70px'; inputs[key] = input; wrap.append(input); box.append(wrap);
      }
      box.append(button('保存纠正', async () => mutateMemory({ action: 'update', category: 'longTerm', id: fact.id, content: text.value, factKey: factKey.value, kind: kind.value, tags: tags.value.split(/[,，]/).map(t => t.trim()).filter(Boolean),
        ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, Number(input.value)])) })),
      button('删除', async () => mutateMemory({ action: 'delete', category: 'longTerm', id: fact.id })));
      el('bfMemoryRows').append(box);
    }
    const summaryBox = document.createElement('fieldset'), title = document.createElement('legend'), summary = document.createElement('textarea');
    title.textContent = '阶段摘要'; summary.value = data.summary || ''; summary.rows = 3; summary.maxLength = data.limits.summaryChars; summary.style.width = '95%';
    summaryBox.append(title, summary, button('保存摘要', async () => mutateMemory({ action: 'update', category: 'summary', content: summary.value })), button('清空摘要', async () => mutateMemory({ action: 'delete', category: 'summary' })));
    el('bfMemoryRows').append(summaryBox);
    el('bfLearningWindowStatus').textContent = data.learningWindow ? `本会话学习记录 ${data.learningWindow.messages} 条${data.learningWindow.error ? ' · ' + data.learningWindow.error : ''}` : '';
    document.dispatchEvent(new CustomEvent('bff-memory-view', { detail: data }));
  }
  document.addEventListener('bff-memory-changed', event => renderMemory(event.detail));
  async function memory() {
    const key = el('bfMemoryKey').value; if (!key) throw new Error('请先选择会话');
    currentMemory = null; el('bfMemoryRows').replaceChildren(); el('bfMemoryStatus').textContent = '加载当前会话记忆…';
    const result = await call('/api/bigfatfish/memory?key=' + encodeURIComponent(key) + '&query=' + encodeURIComponent(el('bfMemoryQuery').value)); renderMemory(result);
  }
  async function mutateMemory(action) {
    if (!currentMemory || currentMemory.key !== el('bfMemoryKey').value) throw new Error('请先加载当前会话记忆');
    const result = await call('/api/bigfatfish/memory', 'POST', { ...action, key: currentMemory.key, revision: currentMemory.revision }); renderMemory(result); notice('已保存到当前会话');
  }
  el('bfMemoryLoad').onclick = el('bfMemorySearch').onclick = () => run(memory);
  el('bfMemoryKey').onchange = () => { el('bfMemoryQuery').value = ''; run(memory); };
  el('bfRemember').onsubmit = event => { event.preventDefault(); const f = event.target.elements; run(async () => { await mutateMemory({ action: 'create', category: f.category.value, content: f.content.value }); f.content.value = ''; }); };
  el('bfMemoryControls').onclick = () => run(async () => mutateMemory({ action: 'controls', accumulation: el('bfAccumulate').checked, personalization: el('bfPersonalize').checked }));
  el('bfMemoryExpire').onclick = () => run(async () => mutateMemory({ action: 'clearExpired' }));
  el('bfVoiceOpen').onclick = () => run(async () => notice((await call('/api/bigfatfish/voice-open', 'POST', {})).message));
  el('bfManagerOpen').onclick = () => window.open('http://127.0.0.1:3105/?token=' + encodeURIComponent(localStorage.getItem('consoleToken') || ''), '_blank', 'noopener');
  const slangCard = card('slang', 'section-bff-slang', '聊天黑话 · 评分与自动入库');
  slangCard.innerHTML += `<p>沿用原黑话提取、释义研究和词库。自动提取与 AI 提交的新词须先达到“进入候选至少真人消息数”，再进入候选词库；次数按已启用群聊跨群累计，同一条消息重复提词只算一次。只使用回看时长内保留的真人消息，不采纳 AI 自报次数、私聊或机器人自己的消息。已有词条和人工添加不受新候选门槛影响。进入候选后，仍须单独确认才能用于聊天；候选释义可在原词库编辑。自动提取和上下文注入还需开启下方“黑话系统参数”中的“启用黑话学习”；释义可使用原自动联网研究或人工补充。</p>
    <form id="bfSlangPolicy"><label><input type="checkbox" name="enabled">启用评分</label><label><input type="checkbox" name="autoConfirm">达到门槛后自动确认到原黑话词库</label><div id="bfSlangFields"></div><button>保存黑话策略</button></form>
    <p><button id="bfSlangRefresh">刷新评分</button><button id="bfSlangScan">立即按当前策略检查</button></p><p id="bfSlangStatus" role="status"></p><div id="bfSlangRows" class="bf-table"></div><h3>最近自动入库记录</h3><div id="bfSlangAudit"></div>`;
  const researchPanel = document.createElement('div'); researchPanel.id = 'bfSlangResearchPanel';
  researchPanel.innerHTML = '<h3>DSH研究任务与返回</h3><p>每批最多5词，单批最多等待5分钟；结果自动刷新。研究未确认也会显示原因及返回摘录。通过研究仍须符合正式入库条件。</p><p id="bfSlangResearchStatus" role="status">暂无研究任务记录</p><div id="bfSlangResearchJobs"></div><div id="bfSlangResearchResults"></div>';
  slangCard.append(researchPanel);
  const researchLabels = { pending: '待研究', queued: '已排队', researching: '研究中', approved: '研究通过', rejected: '研究未确认', failed: '研究失败' };
  function renderResearchResults(jobs = [], entries = []) {
    const opened = new Set([...researchPanel.querySelectorAll('details[open][data-research-key]')].map(node => node.dataset.researchKey));
    el('bfSlangResearchStatus').textContent = jobs.length ? '最近任务：' + (jobs[0].stage || jobs[0].status) : '暂无手动研究任务记录；自动研究状态见词条行。';
    el('bfSlangResearchJobs').replaceChildren();
    for (const job of jobs.slice(0, 10)) {
      const box = document.createElement('details'), title = document.createElement('summary');
      box.dataset.researchKey = 'job:' + job.id; box.open = opened.has(box.dataset.researchKey);
      title.textContent = `${new Date(job.createdAt).toLocaleString('zh-CN')} · ${job.done}/${job.total}条 · ${job.stage} · 任务${job.id.slice(0, 8)}`; box.append(title);
      const words = document.createElement('p'); words.textContent = '词条：' + job.words.join('、'); box.append(words);
      for (const response of job.returns || []) { const nested = document.createElement('details'), label = document.createElement('summary'), pre = document.createElement('pre');
        nested.dataset.researchKey = 'return:' + job.id + ':' + response.batch; nested.open = opened.has(nested.dataset.researchKey);
        label.textContent = `第${response.batch}批返回摘录`; pre.textContent = response.text; pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto'; nested.append(label, pre); box.append(nested); }
      el('bfSlangResearchJobs').append(box);
    }
    el('bfSlangResearchResults').replaceChildren();
    const history = new Map();
    for (const entry of [...jobs.flatMap(j => j.results || []), ...entries.filter(e => e.research?.mode === 'manual')]) if (!history.has(entry.id) || history.get(entry.id).research.at <= entry.research.at) history.set(entry.id, entry);
    for (const entry of [...history.values()].sort((a, b) => b.research.at - a.research.at).slice(0, 100)) {
      const data = entry.research, box = document.createElement('details'), title = document.createElement('summary');
      box.dataset.researchKey = 'word:' + entry.id; box.open = opened.has(box.dataset.researchKey);
      title.textContent = `${entry.content} · ${researchLabels[data.status] || data.status} · ${data.reason || ''}`; box.append(title);
      if (data.result) for (const [field, label] of [['meaning', '含义'], ['usage', '用法'], ['example', '示例'], ['risk', '风险'], ['reason', '研究结论'], ['sources', '参考来源']]) {
        const row = document.createElement('p'); row.textContent = label + '：' + (Array.isArray(data.result[field]) ? data.result[field].join('；') : data.result[field] || '未返回'); box.append(row);
      }
      if (data.result) { const confidence = document.createElement('p'); confidence.textContent = `置信度${Math.round(data.confidence * 100)}%${data.status !== 'approved' ? '；未确认内容仅供参考，未写入正式释义' : ''}`; box.append(confidence); }
      box.append(button('查看 / 编辑原词条', async () => { await refreshSlang(); openSlangModal(entry.id, 'edit'); })); el('bfSlangResearchResults').append(box);
    }
  }
  let researchVersion = '';
  document.addEventListener('bff-slang-results', event => {
    renderResearchResults(event.detail.jobs, event.detail.entries);
    const version = event.detail.entries.map(e => [e.id, e.research?.status, e.research?.at].join(':')).join('|');
    if (version !== researchVersion && currentConsolePage === 'slang') run(() => refreshSlangScores()); researchVersion = version;
  });
  const autoResearchLabel = document.createElement('label'); autoResearchLabel.innerHTML = '<input type="checkbox" name="autoResearch">候选达标后自动研究释义'; el('bfSlangPolicy').prepend(autoResearchLabel);
  const slangFields = { candidateMinMessages: ['进入候选至少真人消息数', 1, 100], researchMinMessages: ['自动研究至少真人消息数', 3, 100], threshold: ['候选转正式的分数门槛', 0, 100], minMessages: ['转正式至少真人消息数', 2, 100], minSpeakers: ['转正式至少发言人数', 2, 20], minSpanMinutes: ['转正式至少使用跨度（分钟）', 1, 10080], lookbackHours: ['回看时长（小时）', 1, 720], scanIntervalMinutes: ['评分检查间隔（分钟）', 1, 1440], maxAutoPerDay: ['每日自动入库上限', 0, 100] };
  for (const [key, [label, min, max]] of Object.entries(slangFields)) {
    const wrap = document.createElement('label'); wrap.textContent = label + ' '; const input = document.createElement('input'); Object.assign(input, { type: 'number', name: key, min, max, required: true }); wrap.append(input); el('bfSlangFields').append(wrap);
  }
  let slangDirty = false;
  el('bfSlangPolicy').addEventListener('input', () => { slangDirty = true; });
  async function refreshSlangScores(scan = false) {
    const data = await call('/api/bigfatfish/slang', scan ? 'POST' : 'GET', scan ? { action: 'scan' } : undefined);
    if (!slangDirty) {
      const f = el('bfSlangPolicy').elements;
      for (const [key, value] of Object.entries(data.policy)) f[key][typeof value === 'boolean' ? 'checked' : 'value'] = value;
    }
    el('bfSlangStatus').textContent = `原词库${data.writable ? '可写' : '只读'} · 自动确认${data.nativeEnabled === false ? '暂停（原黑话学习已关闭）' : data.policy.autoConfirm && data.policy.enabled ? '开启' : '关闭'} · 今日自动入库预留/已用 ${data.todayUsed}/${data.policy.maxAutoPerDay} · 候选 ${data.totalCandidates} 条${data.totalCandidates > data.rows.length ? '（显示前500条）' : ''} · 最近检查 ${data.lastScanAt ? new Date(data.lastScanAt).toLocaleString('zh-CN') : '尚未检查'}${data.lastError ? ' · ' + data.lastError : ''}`;
    el('bfSlangRows').replaceChildren();
    if (!data.rows.length) el('bfSlangRows').textContent = '暂无候选。可使用下方原黑话工具从近期聊天提取候选，并研究释义。';
    else {
      const table = document.createElement('table'), head = document.createElement('thead'), tr = document.createElement('tr');
      for (const title of ['黑话 / 释义', '分数', '真人证据', '判断 / 操作']) { const th = document.createElement('th'); th.textContent = title; tr.append(th); } head.append(tr); table.append(head);
      const tbody = document.createElement('tbody');
      for (const row of data.rows) {
        const tr = document.createElement('tr');
        for (const text of [row.content + '：' + (row.meaning || '待研究'), row.score + '/100', `${row.messages}条 · ${row.speakers}人 · ${row.spanMinutes}分钟`]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
        tr.children[1].title = Object.entries(row.parts).map(([key, value]) => key + ': ' + value).join('；');
        const action = document.createElement('td'); action.textContent = (row.research ? '研究：' + ({ pending: '待研究', researching: '进行中', approved: '通过', rejected: '尚未确认', failed: '等待重试' }[row.research.status] || '待研究') + '；' : '') + (row.eligible ? '满足入库条件 ' : row.reasons.join('；') + ' ');
        action.append(button('查看 / 编辑原词条', async () => { await refreshSlang(); openSlangModal(row.id, 'confirm'); })); tr.append(action); tbody.append(tr);
      }
      table.append(tbody); el('bfSlangRows').append(table);
    }
    el('bfSlangAudit').replaceChildren();
    for (const row of data.audit) { const p = document.createElement('p'); p.textContent = `${new Date(row.at).toLocaleString('zh-CN')} · ${row.content} · ${row.score}分 · ${{ confirmed: '已确认入原词库', reserved: '额度已预留，结果待核对', failed: '保存失败，已撤回' }[row.status] || row.status}`; el('bfSlangAudit').append(p); }
    if (!data.audit.length) el('bfSlangAudit').textContent = '暂无自动入库记录';
  }
  el('bfSlangPolicy').onsubmit = event => { event.preventDefault(); run(async () => {
    const f = event.target.elements, policy = { enabled: f.enabled.checked, autoConfirm: f.autoConfirm.checked, autoResearch: f.autoResearch.checked };
    for (const key of Object.keys(slangFields)) policy[key] = Number(f[key].value);
    await call('/api/bigfatfish/settings', 'POST', { slangPolicy: policy }); slangDirty = false; await refreshSlangScores(); notice('黑话策略已保存');
  }); };
  el('bfSlangRefresh').onclick = () => run(() => refreshSlangScores());
  el('bfSlangScan').onclick = () => run(async () => { await refreshSlangScores(true); await refreshSlang(); notice('已按当前策略检查，原词库已刷新'); });
  slangCard.parentElement.insertBefore(slangCard, document.querySelector('[data-page="slang"]'));
  // Native manual confirmation/research remains authoritative; refresh scores after its mutations.
  document.addEventListener('click', event => {
    if (event.target.closest('#mainNav [data-view="slang"]')) run(() => refreshSlangScores());
    if (event.target.closest('#mainNav [data-view="sessions"]')) run(refresh);
    if (event.target.closest('#mainNav [data-view="operations"]')) { run(refresh); run(refreshServices); }
  });
  const servicesCard = card('operations', 'section-bff-services', '一键启动与服务管理');
  const servicesStatus = document.createElement('p'); servicesStatus.id = 'bfServicesStatus'; servicesStatus.textContent = '点击刷新查看当前服务。';
  const serviceRows = document.createElement('div'); serviceRows.id = 'bfServicesRows';
  servicesCard.append(servicesStatus, button('一键启动全部', async () => serviceAction('all', 'start')), button('独立启动管理页（含停止 / 重启全部）', async () => el('bfManagerOpen').click()), button('刷新服务状态', refreshServices), serviceRows);
  async function refreshServices() {
    try {
      const data = await call('/api/bigfatfish/services');
      servicesStatus.textContent = `管理器${data.busy ? '正在操作：' + data.step : '已连接'} · QQ${data.gateway.ready ? '在线且身份已核验' : '等待登录或连接'}${data.warning ? ' · ' + data.warning : ''}`;
      serviceRows.replaceChildren();
      for (const [name, service] of Object.entries(data.services)) {
        const row = document.createElement('p'); row.textContent = `${{ snowluma: 'SnowLuma · QQ网关', dsh: 'DeepSeek Harness', bridge: 'QQ Bridge' }[name]}：${service.running ? (service.owned ? '运行中' : '运行中（外部启动）') : '已停止'} `;
        for (const [action, label] of [['start', '启动'], ['stop', '停止'], ['restart', '重启']]) {
          const b = button(label, async () => { if (name === 'bridge' && action !== 'start') { el('bfManagerOpen').click(); return; } await serviceAction(name, action); });
          b.disabled = data.busy || (action !== 'start' && !service.owned); row.append(b);
        }
        serviceRows.append(row);
      }
    } catch (error) { servicesStatus.textContent = error.message; }
  }
  async function serviceAction(service, action) {
    servicesStatus.textContent = '正在执行服务操作…'; const result = await call('/api/bigfatfish/services', 'POST', { service, action }); notice(result.step || '服务操作已完成'); await refreshServices();
  }
  for (const section of sections) {
    featureIndex.push({ page: section.dataset.page, label: section.querySelector('h2').textContent, target: section });
    section.querySelectorAll('input,textarea,select').forEach(input => { const label = input.labels?.[0]?.textContent || input.placeholder; if (label) featureIndex.push({ page: section.dataset.page, label, target: input }); });
  }
  setConsolePage(location.hash.slice(1) || currentConsolePage, { updateHash: false });
  run(refresh);
  run(refreshPersonas);
  if (currentConsolePage === 'slang') run(() => refreshSlangScores());
  if (currentConsolePage === 'operations') run(refreshServices);
})();
