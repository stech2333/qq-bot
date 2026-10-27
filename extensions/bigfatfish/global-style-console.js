// Curated global strategies; the legacy mixed-corpus file stays read-only.
(() => {
  const el = id => document.getElementById(id), section = document.createElement('section');
  Object.assign(section, { id: 'section-bff-global-style', className: 'card span-all bf-integrated', hidden: true }); section.dataset.page = 'bff-global-style';
  section.innerHTML = `<h2>通用表达经验</h2><p>仅管理员确认发布可迁移的表达策略。旧统一风格文件保留但不自动学习或注入；各群经验在“群聊风格学习”独立审核。</p><button id="bfGlobalLoad">加载 / 刷新</button><p id="bfGlobalStatus" role="status"></p><form id="bfGlobalPublish"><div id="bfGlobalChoices"></div><button>确认发布通用策略</button></form><h3>回复分条方式（全局）</h3><select id="bfReplyDelivery"><option value="natural">自然分条</option><option value="single">尽量一条</option><option value="flow">适度分条</option></select><button id="bfDeliverySave">保存分条方式</button><h3>版本</h3><select id="bfGlobalHistory"></select><button id="bfGlobalRollback">回滚</button>`;
  document.querySelector('#mainContent .grid').append(section);
  const run = async fn => { try { await fn(); } catch(e) { showConsoleToast(e.message); } }; let view;
  const request = async (method='GET', body) => { const r = await api('/api/bigfatfish/global-style', method, body); if (r.ok === false) throw Error(r.error); return r; };
  const load = async () => {
    view = await request(); el('bfGlobalStatus').textContent = `v${view.version} · ${view.legacy.present ? '旧统一风格仅保留原文件，不应用' : '无旧统一风格'} · ${view.error || '管理员发布模式'}`;
    el('bfReplyDelivery').value = view.replyDelivery; el('bfGlobalChoices').replaceChildren();
    for (const [id, text] of Object.entries(view.choices)) { const label=document.createElement('label'), input=document.createElement('input'); input.type='checkbox'; input.value=id; input.checked=view.published.includes(id); label.append(input,document.createTextNode(text)); el('bfGlobalChoices').append(label,document.createElement('br')); }
    el('bfGlobalHistory').replaceChildren(); for (const h of [...view.history].reverse()) { const o=document.createElement('option'); o.value=h.version; o.textContent=`v${h.version} · ${new Date(h.at).toLocaleString('zh-CN')}`; el('bfGlobalHistory').append(o); }
  };
  const action=async body=>{ if(!view) throw Error('请先加载'); await request('POST',{...body,revision:view.revision}); await load(); };
  el('bfGlobalLoad').onclick=()=>run(load);
  el('bfGlobalPublish').onsubmit=e=>{e.preventDefault();run(()=>action({action:'publish',strategies:[...el('bfGlobalChoices').querySelectorAll('input:checked')].map(i=>i.value)}));};
  el('bfGlobalRollback').onclick=()=>run(()=>action({action:'rollback',version:Number(el('bfGlobalHistory').value)}));
  el('bfDeliverySave').onclick=()=>run(async()=>{const r=await api('/api/bigfatfish/settings','POST',{replyDelivery:el('bfReplyDelivery').value});if(r.ok===false)throw Error(r.error);await load();});
  consolePages['bff-global-style']=['通用表达经验','管理员发布的抽象表达策略。','原统一风格只读保留；群经验逐群隔离。'];
  const nav=document.createElement('button');nav.type='button';nav.className='nav-item';nav.dataset.view='bff-global-style';nav.textContent='✦ 通用表达经验';nav.onclick=()=>{setConsolePage('bff-global-style',{focus:true});run(load);};el('mainNav').append(nav);
  if(location.hash.slice(1)==='bff-global-style'){setConsolePage('bff-global-style',{updateHash:false});run(load);}
})();
