exports.patchSlang = (s, once) => {
  s = '// BigFatFish V3 global lexicon\n' + s;
  s = once(s, "import crypto from 'node:crypto';", "import crypto from 'node:crypto';\nimport { normalizeGlobalSlang, mergeGlobalLexicon, normalizedTerm } from '../../../extensions/bigfatfish/slang-schema.mjs';\nimport { backupOnce, atomicJson } from '../../../extensions/bigfatfish/state-store.mjs';");
  const a=s.indexOf('export function normalizeSlangEntry('),b=s.indexOf('\n/**',a);
  let block=s.slice(a,b);block=once(block,'  return {','  return normalizeGlobalSlang({');
  const close=block.lastIndexOf('  };');if(close<0)throw Error('Slang normalization boundary changed');block=block.slice(0,close)+'  }, entry);'+block.slice(close+4);s=s.slice(0,a)+block+s.slice(b);
  s=once(s,'  return parsed.map(normalizeSlangEntry).filter((e) => e.content);',`  const migrated = mergeGlobalLexicon(parsed.map(normalizeSlangEntry).filter(e => e.content));
  if (parsed.some(e => e.schemaVersion !== 3)) { backupOnce(file); atomicJson(file, migrated); }
  return migrated;`);
  s=once(s,"  const { entries: capped, dropped } = capSlangEntries(\n    (Array.isArray(entries) ? entries : []).map(normalizeSlangEntry).filter((e) => e?.content),",`  const incoming = mergeGlobalLexicon((Array.isArray(entries) ? entries : []).map(normalizeSlangEntry).filter(e => e.content));
  const deletedFile = file + '.deleted.json';
  const deleted = fs.existsSync(deletedFile) ? JSON.parse(fs.readFileSync(deletedFile,'utf8')) : {};
  if (fs.existsSync(file)) {
    const previous = mergeGlobalLexicon(JSON.parse(fs.readFileSync(file,'utf8')).map(normalizeSlangEntry));
    for (const old of previous) if (!incoming.some(e => e.id === old.id)) deleted[old.id] = Date.now();
    backupOnce(file);
  }
  atomicJson(deletedFile, deleted);
  const { entries: capped, dropped } = capSlangEntries(
    incoming.filter(e => !deleted[e.id]),`);
  s=once(s,"const existing = entries.find((e) => e.content === normalizedContent && (e.scope || 'legacy') === (patch.scope || 'legacy'));","const existing = entries.find(e => normalizedTerm(e.content) === normalizedTerm(normalizedContent));");
  return s.replace('usage: e.usage, scope: e.scope','usage: e.usage, senseId: e.senseId');
};

exports.patchBridge = (s, once) => {
  const cut = (start, end, replacement = '') => {
    const a=s.indexOf(start), b=s.indexOf(end,a+start.length);
    if(a<0||b<0) throw Error('V3 boundary missing: '+start);
    s=s.slice(0,a)+replacement+s.slice(b);
  };
  const removeFunction = name => {
    const re=new RegExp('^  (?:async )?function '+name+'\\(', 'm'), m=re.exec(s);
    if(!m) throw Error('V3 retired function missing: '+name);
    const tail=s.slice(m.index+1), next=/^  (?:async )?function /m.exec(tail);
    if(!next) throw Error('V3 function boundary missing: '+name);
    s=s.slice(0,m.index)+tail.slice(next.index);
  };
  s='// BigFatFish V3 runtime\n'+s;
  s=once(s,"import fs from 'node:fs';", "import fs from 'node:fs';\nimport { numberSetting, backupOnce, atomicJson } from '../../../extensions/bigfatfish/state-store.mjs';");
  s=once(s,"  chat: 'chat',\n  reserved: 'reserved',\n",'');
  s=once(s,"let currentMode = 'chat';", "let currentMode = 'disabled';");
  s=once(s,"      const fromDsh = normalizeModeInput(settingFromDshNamespace(ns, 'mode'));", "      const rawMode = settingFromDshNamespace(ns, 'mode');\n      const fromDsh = normalizeModeInput(rawMode);\n      if (rawMode !== undefined && !fromDsh) { currentMode = 'disabled'; return; }");
  s=once(s,'    if (fromLocal) currentMode = fromLocal;',`    currentMode = fromLocal || 'disabled';
    if (local && !fromLocal && local.schemaVersion !== 3) {
      const file = path.join(STATE_DIR, 'mode.json'); backupOnce(file);
      atomicJson(file, { ...local, schemaVersion: 3, mode: 'disabled', migration: { previousMode: String(local.mode), reason: 'retired-or-unknown', at: Date.now() } });
    }`);
  s=once(s,'    return allowed(kind, id, cfg);', "    return mode === 'reserved2' && allowed(kind, id, cfg);");
  s=once(s,"    const wanted = mode === 'reserved2' ? (cfg.socialV2?.agentPreset || cfg.agentPreset) : cfg.agentPreset;", "    if (mode !== 'reserved2') return undefined;\n    const wanted = 'qq-chat-v2';");
  s=s.replaceAll("currentMode === 'reserved2' ? (cfg.socialV2?.agentPreset || cfg.agentPreset) : cfg.agentPreset", "currentMode === 'reserved2' ? 'qq-chat-v2' : cfg.agentPreset");
  // First generation state/timers are removed. Shared delivery and media buffers stay.
  cut("        if (req.method === 'POST' && url.pathname === '/api/social/state')", '        // ── 后台控制端引导', "        if (url.pathname.startsWith('/api/social/')) { sendJson({ ok: false, error: '一代仿真已退役' }, 410); return; }\n\n");
  cut('  function scheduleSocialReply(', '  // 当前角色扮演提示');
  cut('    // 仿真群友模式', '    // DSH 重启容错');
  cut('  function cleanupSocialForModeChange()', '  function leaveActive(', `  function cleanupSocialForModeChange() {
    for (const key of bff.states.keys()) bff.delivery.cancel(key);
    messageMediaStore.clear(); social.silentContext.clear(); social.silentTurns.clear(); social.exitingSessions.clear();
    for (const entry of promptQueues.values()) for (const item of entry.queue) item.reject(new Error('模式切换，已取消排队中的投递'));
    promptQueues.clear();
  }

`);
  for(const name of ['isSocialEnabled','socialState','isDirectAddress','isDirectedAtAi','isMustReplyText','appendRecentMessage','appendSummary','buildContextBlock','enterActive','cancelSocialTimers','cancelAllSocialTimers','leaveActive','buildBatchPrompt','buildProbePrompt','buildActiveExitPrompt','triggerActiveDurationExit','buildProactivePrompt']) removeFunction(name);
  s=s.replace(/^.*(?:social\.(?:states|recentMessages|pendingSummaries|pendingTimers)\.(?:delete|clear)\(|cancelSocialTimers\(key\);).*\r?\n/gm,'');
  s=s.replace(/^    (?:states|recentMessages|pendingSummaries|pendingTimers|loopTimer): .*\r?\n/gm,'');
  cut("              if (ended.reason.kind === 'completed' && ended.text.trim()) {", "            }\n          } else if ((frame.type === 'question/requested'", `              if (currentMode === 'closed-agent' && ended.reason.kind === 'completed' && ended.text.trim() && !sendToolSucceeded && !shouldBlockSilentReply(key)) {
                await auditAndSend(key, mdToPlain(ended.text));
              } else if (ended.reason.kind === 'error') {
                log('agent 回合出错，详见受保护的 DSH 日志 (' + key + ')');
              }
`);
  s=once(s,'bff.groupStyle.eligible(key)', 'bff.learningSources.eligible(key)');
  s=once(s,'try { bff.mood.event(key, getSocialV2State(key), frame.event); }', 'try { bff.turnEvent(key, getSocialV2State(key), frame.event); }');
  // A generation lease is assigned before building its prompt and captured before enqueueing a send.
  s=once(s,'    let wakeState;\n    let wakeToken;', "    const generationState = getSocialV2State(key);\n    const generationId = opts.silent ? null : bff.delivery.begin(key, generationState);\n    generationState.bffGenerationId = generationId;\n    let wakeState;\n    let wakeToken;");
  s=once(s,"personaSignature: bff.personas.signature(key, roleState), memory: memoryText, reason })", "personaSignature: bff.personas.signature(key, roleState), memory: memoryText, reason, turnId: st.bffGenerationId })");
  s=once(s,'      accepted = await api.sessions.prompt({ sessionId, mode: \'queue\', content });', '      accepted = await api.sessions.prompt({ sessionId, mode: \'queue\', content });');
  const da=s.indexOf('  async function deliverPromptNow('), db=s.indexOf('  function deliverPrompt(',da);
  let delivery=s.slice(da,db);
  delivery=once(delivery,'    if (!accepted.result.ok) {', '    if (!accepted.result.ok) {\n      if (generationId) bff.delivery.cancelGeneration(generationId);');
  delivery=once(delivery,'    } catch (error) {\n      if (opts.farewell)', '    } catch (error) {\n      if (generationId) bff.delivery.cancelGeneration(generationId);\n      if (opts.farewell)');
  s=s.slice(0,da)+delivery+s.slice(db);
  s=once(s,'    const replyToken = replyState.agentToken;', "    const replyToken = replyState.agentToken;\n    const turnId = bff.delivery.capture(key, replyState), batchId = crypto.randomUUID();");
  s=once(s,'          bff.sent(key, msg); saveSocialV2State();', "          // Transport acceptance is final even if local persistence subsequently fails.\n          try { bff.sent(key, msg, { turnId, sendId: batchId + ':' + i }); saveSocialV2State(); }\n          catch { log('已发送消息的本地状态保存失败，请检查磁盘'); }");
  s=once(s,'    return sendChain.then(() => {\n      if (failed.length > 0)', "    return sendChain.then(() => {\n      bff.delivery.batch(turnId, failed.length, failed.some(e => /timeout|超时|ECONNRESET/i.test(String(e?.message))));\n      if (failed.length > 0)");
  s=once(s,'      if (sent.length) { bff.sent(key); saveSocialV2State(); }\n','');
  // Old five-minute configuration is archived by loadConfig; the server retains unread/visibility guards.
  s=s.replace('preSleepWaitEnabled: true,','preSleepWaitEnabled: false,').replace('preSleepWaitMs: 300000,','preSleepWaitMs: 0,');
  s=s.replaceAll('Math.max(0, Number(cfg.socialV2?.wake?.preSleepWaitMs) || 300000)', 'numberSetting(cfg.socialV2?.wake?.preSleepWaitMs, 0)');
  s=s.replaceAll('Math.max(0, Number(w.preSleepWaitMs) || 300000)', 'numberSetting(w.preSleepWaitMs, 0)');
  s=once(s,'    const waitMs = numberSetting(w.preSleepWaitMs, 0);','    const waitMs = numberSetting(w.preSleepWaitMs, 0);\n    if (waitMs === 0) return false;');
  s=s.replace(/^    const preSleepLine = .*;$/m, "    const preSleepLine = '【收尾】没有待答消息且本轮内容已经完整时即可结束。服务端校验未读水位和唤醒条件；仅在确需等待对方补充时使用等待工具。\\n\\n';");
  s=s.replace(/^    const (?:antiAiLine|proactiveLine) = .*;\r?\n/gm,'');
  // Preserve legal zero values; range validation remains at configuration writes.
  s=s.replace(/Number\(([^\n()]+(?:\?\.[^\n()]*)?)\) \|\| (\d+(?:\.\d+)?)(?![\d*])/g,(all,value,def)=>{
    if (!/(?:Ms|Probability|probability|dailyCap|noActionLimit|maxWakeConfigReminders|injectMax)/.test(value)) return all;
    return `numberSetting(${value}, ${def})`;
  });
  s=s.replace(/Math\.max\(100, (numberSetting\(sendCfg\.burstIntervalMinMs, \d+\))\)/g,'Math.max(0, $1)');
  // No proactive turn should invent an excuse to speak.
  s=s.replace(/没话[^\n'`]{0,80}搜索[^\n'`]{0,80}/g,'没有具体且相关的内容就保持沉默');
  return s;
};

exports.cleanupBridge = (s,once) => {
  s='// BigFatFish V3 retirement\n'+s;
  const cut=(start,end,replacement='')=>{const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<0)throw Error('V3 cleanup boundary: '+start);s=s.slice(0,a)+replacement+s.slice(b);};
  s=s.replaceAll('          cancelAllSocialTimers();\n','');
  cut('  // 判断字符是否属于“中文汉字”范围', '  async function onebotSend(');
  cut('    social: {','    socialV2: {');
  s=s.replace("const PRESET_NAMES = { v1: 'qq-chat', v2: 'qq-chat-v2' };", "const PRESET_NAMES = { v2: 'qq-chat-v2' };");
  s=s.replaceAll("file.agentPreset ?? 'qq-chat'", "'qq-chat-v2'").replaceAll("learnerPreset: 'qq-chat'", "learnerPreset: 'qq-chat-v2'").replaceAll("resolvePresetName(cfg.slang?.learnerPreset || cfg.agentPreset, { strict: true })", "resolvePresetName('qq-chat-v2', { strict: true })");
  s=s.replaceAll("roleHintForMode('v1', key)", "roleHintForMode('v2', key)");
  s=s.replace(/        if \(lastMode === 'reserved' && currentMode !== 'reserved'\) \{[\s\S]*?\n        \}\n/, '');
  s=s.replace(/          if \(currentMode === 'reserved' && requestedMode !== 'reserved'\) \{[\s\S]*?\n          \}\n/,'');
  s=s.replace(/          if \(currentMode === 'chat' \|\| currentMode === 'reserved'\) \{[\s\S]*?\n          \}\n/g,'');
  // Mode changes and token invalidation cancel every pending generation attribution.
  s=s.replace(/^(\s+)forgetAgentToken\(key\);/gm,'$1bff.delivery.cancel(key); forgetAgentToken(key);');
  // The legacy forced observation wait is no longer a model operation, including persisted v2 defaults.
  cut('  function preSleepWaitBlockedV2(st) {','  function ', '  function preSleepWaitBlockedV2(st) { return false; }\n\n');
  // Dynamic glossary lookup uses the same target message as scene resolution.
  s=s.replaceAll("(getSocialV2State(key).recentMessages || []).filter(m => !m.isSelf).slice(-3).map(m => m.plain || m.text || '').join(' ')", "bff.styleResolver.resolve(key, getSocialV2State(key), { preview: true }).query");
  // Trusted admins may correct senses explicitly; automatic paths cannot bypass verification.
  s=once(s,"import { numberSetting, backupOnce, atomicJson } from '../../../extensions/bigfatfish/state-store.mjs';", "import { numberSetting, backupOnce, atomicJson } from '../../../extensions/bigfatfish/state-store.mjs';\nimport { normalizeGlobalSlang, senseId, safeGeneralText } from '../../../extensions/bigfatfish/slang-schema.mjs';");
  const sync=`
          if (body.senses !== undefined) {
            if (!Array.isArray(body.senses) || body.senses.length > 8 || body.senses.some(s => !safeGeneralText(s.meaning) || !s.meaning?.trim() || !safeGeneralText(s.usage || ''))) { sendJson({ ok: false, error: '词义必须为安全的一般化说明' }, 400); return; }
            entry.senses = body.senses.map(s => ({ ...s, id: senseId(s.meaning), manual: true, generalizable: true, verified: true, verifiedAt: Date.now(), status: 'confirmed' }));
          }
          entry.revision = (entry.revision || 0) + 1;`;
  const pa=s.indexOf("        if (req.method === 'PATCH' && slangMatch"),pb=s.indexOf("        if (req.method === 'POST' && slangMatch && slangMatch[2] === 'reject')",pa);
  let part=s.slice(pa,pb);part=part.replaceAll("          entry.updatedAt = new Date().toISOString();", sync+"\n          entry.updatedAt = new Date().toISOString();");s=s.slice(0,pa)+part+s.slice(pb);
  // Generic source revocation also invalidates snapshots held by asynchronous work.
  s=s.replaceAll("schemaVersion: 3, mode: 'disabled'", "schemaVersion: 3, mode: 'disabled'");
  return s;
};

exports.finalizeBridge = (s,once) => {
  s='// BigFatFish V3 attribution and privacy\n'+s;
  const a=s.indexOf('  function confirmedSlangListV2('),b=s.indexOf('  function withSlangContext(',a);
  s=s.slice(0,a)+`  function confirmedSlangListV2(key, query = '') {
    const target = query || bff.styleResolver.resolve(key, getSocialV2State(key), { preview: true }).query;
    return bff.slang.contextEntries(slangEntries, key, '', target).map(e => ({ ...e, example: '' }));
  }

`+s.slice(b);
  s=once(s,'const list = confirmedSlangListV2(key).filter','const list = confirmedSlangListV2(key, q).filter');
  s=s.replaceAll('e.content === content && e.scope === key','e.normalized === normalizeGlobalSlang({ content }, { content }).normalized');
  const da=s.indexOf('  async function deliverPromptNow('),db=s.indexOf('  function deliverPrompt(',da);let part=s.slice(da,db);
  part=once(part,'    generationState.bffGenerationId = generationId;','    generationState.bffGenerationId = generationId;\n    try {');
  const end=part.lastIndexOf('    return { ok: true };\n  }');if(end<0)throw Error('delivery final boundary');
  part=part.slice(0,end)+part.slice(end).replace('    return { ok: true };\n  }',"    return { ok: true };\n    } catch(error) { if(generationId)bff.delivery.cancelGeneration(generationId); throw error; }\n  }");s=s.slice(0,da)+part+s.slice(db);
  // Attribute media to the turn captured before any transport queue wait.
  s=once(s,'  async function sendStickerV2(key, stickerRef, options = {}) {', '  async function sendStickerV2(key, stickerRef, options = {}) {\n    const mediaState=getSocialV2State(key), mediaTurn=bff.delivery.capture(key,mediaState), mediaSend=crypto.randomUUID();');
  s=once(s,'    return { entry: updated.entry, messageId: data?.message_id ?? null };', "    bff.sent(key, '', {turnId:mediaTurn,sendId:mediaSend});\n    return { entry: updated.entry, messageId: data?.message_id ?? null };");
  s=once(s,'            bff.sent(key);\n','');
  // Voice captures attribution when the HTTP send is scheduled, not after verification.
  const voice=s.indexOf('    bff.sent(key);');if(voice<0)throw Error('voice attribution boundary');
  const fn=s.lastIndexOf('  async function ',voice),brace=s.indexOf('{\n',fn);
  s=s.slice(0,brace+2)+"    const voiceTurn=bff.delivery.capture(key,getSocialV2State(key)), voiceSend=crypto.randomUUID();\n"+s.slice(brace+2);
  s=once(s,'    bff.sent(key);',"    bff.sent(key, '', {turnId:voiceTurn,sendId:voiceSend});");
  return s;
};

exports.sourceSafety = (s,once) => {
  s='// BigFatFish V3 source and prompt diagnostics\n'+s;
  s=once(s,'    let accepted;\n    try {\n      accepted = await api.sessions.prompt',`    const promptTextForMetrics = typeof content === 'string' ? content : (Array.isArray(content) ? content.filter(p=>p.type==='text').map(p=>p.text).join('\\n') : '');
    const diagnostic = bff.styleResolver.diagnostics.get(key);
    if (diagnostic && generationId) Object.assign(diagnostic, { turnId:generationId, totalPromptChars:promptTextForMetrics.length, totalPromptBytes:Buffer.byteLength(promptTextForMetrics), glossaryChars:(promptTextForMetrics.match(/【黑话释义资料】[^]*?(?=\\n\\n|$)/)?.[0]||'').length, mediaParts:Array.isArray(content)?content.filter(p=>p.type!=='text').length:0 });
    let accepted;
    try {
      accepted = await api.sessions.prompt`);
  return s;
};

exports.slangPersistence = (s,once) => {
  s='// BigFatFish V3 deletion ledger\n'+s;
  s=once(s,'    for (const old of previous) if (!incoming.some(e => e.id === old.id)) deleted[old.id] = Date.now();','    for (const old of previous) if (!incoming.some(e => e.id === old.id)) deleted[old.id] = { at:Date.now(), entry:old };');
  s=once(s,'  return migrated;',"  const deleted = fs.existsSync(file+'.deleted.json') ? JSON.parse(fs.readFileSync(file+'.deleted.json','utf8')) : {};\n  return migrated.filter(e=>!deleted[e.id]);");
  s=once(s,"Math.max(1, Math.min(30, Number(max) || 8))", "Math.max(0, Math.min(30, max == null ? 8 : Number(max)))");
  return s;
};

exports.reliability = (s,once) => {
  s='// BigFatFish V3 transport settlement\n'+s;
  s=once(s,"    bff.sent(key, '', {turnId:voiceTurn,sendId:voiceSend});\n",'');
  s=once(s,'      const data = await sendPromise;',"      const data = await sendPromise;\n      try { bff.sent(key, '', {turnId:voiceTurn,sendId:voiceSend}); } catch { log('语音已发送，本地结算未完成'); }");
  // Clarify that retired settings are archival only, even if legacy JSON contains them.
  s=s.replaceAll("preset === PRESET_NAMES.v1 ? 'v1' : 'v2'", "'v2'");
  return s;
};

exports.sharedRecipient = (s,once) => "// BigFatFish V3 shared recipient helper\n" + once(s,"  function formatParticipationV2(","  function isDirectedAtAi(textContent) {\n    const lower = String(textContent ?? '').toLowerCase();\n    const aiMention = /deepseek|claude|chatgpt|gpt|\u5927\u80a5\u9c7c|\u5c0f\u9cb8\u9c7c|\u9cb8\u9c7c|d\u6307\u5bfc|d\u8001\u5e08|d\u5e08\u5085|\u6df1\u5ea6\u6c42\u7d22|\\bds\\b|ai|\u4eba\u5de5\u667a\u969c|\u673a\u5668\u4eba|\u6a21\u578b/.test(lower);\n    const challenge = /\u5f3a|\u5f31|\u884c\u4e0d\u884c|\u80fd\u4e0d\u80fd|\u4f1a\u4e0d\u4f1a|\u662f\u4e0d\u662f|\u4e00\u534a|\u6c34\u5e73|\u5783\u573e|\u5e9f\u7269|\u767d\u5ad6|\u83dc|\u4e0d\u5982|\u5389\u5bb3|\u8d62|\u8f93|\u6bd4.*\u5f3a|\u6bd4.*\u5f31/.test(lower);\n    const question = /[?\uff1f\u5417\u5462\u5427]|\u600e\u4e48|\u4e3a\u4ec0\u4e48|\u54ea|\u8c01/.test(lower);\n    if (aiMention && (question || challenge)) return true;\n    // \"\u4f60/\u60a8\" + \u7591\u95ee/\u6bd4\u8f83/\u6311\u6218\uff08\u653e\u5bbd\uff0c\u907f\u514d\u6f0f\u6389\"\u4f60\u6709claude\u4e00\u534a\u5f3a\u5417\"\u8fd9\u7c7b\u76f4\u63a5\u95ee\uff09\n    if (/(\u4f60|\u60a8).{0,10}(\u5417|\u5462|\uff1f|\\?|\u600e\u4e48|\u662f\u4e0d\u662f|\u80fd\u4e0d\u80fd|\u884c\u4e0d\u884c|\u6709\u6ca1\u6709|\u6709|\u6ca1\u6709|\u6bd4|\u4e0d\u5982|\u5f3a|\u5f31|\u4e00\u534a|\u5389\u5bb3|\u5783\u573e|\u83dc|\u8d62|\u8f93)/.test(lower)) return true;\n    if (/^(\u4f60|\u60a8)(\u662f\u4e0d\u662f|\u884c\u4e0d\u884c|\u80fd\u4e0d\u80fd|\u4f1a\u4e0d\u4f1a|\u89c9\u5f97|\u6709|\u6ca1\u6709)/.test(lower)) return true;\n    // \"\u4f60\u662f...\u8fd8\u662f... / \u4f60\u662f...\u5417 / \u4f60\u662f...\uff1f\"\uff08\u5982\uff1a\u4f60\u662f\u4eba\u7c7b\u8fd8\u662fai\u3001\u4f60\u662f\u771f\u4eba\u5417\uff09\n    if (/(\u4f60|\u60a8)\u662f[^\uff1f?\u3002\uff01!]{0,14}(\u8fd8\u662f|\u6216\u8005|\u5417|\u4e48|\uff1f|\\?)/.test(lower)) return true;\n    // \u8ffd\u95ee/\u50ac\u4fc3\uff1aAI \u6ca1\u56de\u65f6\u7684\u771f\u4eba\u5f0f\u50ac\u4fc3\n    if (/\u600e\u4e48\u4e0d\u8bf4\u8bdd|\u4eba\u5462|\u56de\u6211|\u8bf4\u8bdd\u554a|\u7406\u6211|\u522b\u88c5\u6b7b|\u5728\u4e0d\u5728|\u88c5\u6b7b|\u8bf4\u8bdd/.test(lower)) return true;\n    return false;\n  }\n\n\n  function formatParticipationV2(");

exports.retireSleep = (s,once) => {
 s='// BigFatFish V3 server managed sleep\n'+s;
 s=s.replaceAll('决定潜水前必须按上面的【沉睡前强制等待】先等够观察窗口','没有待答内容时可以结束，由服务端校验已读水位');
 s=s.replaceAll('注意：设置潜水前先用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成沉睡前观察；等待期间有人说话时查看 newMessages，判断不需要你参与即可收尾。','只提交已经看过的 throughSeq；有明确待答消息时先处理，没有新内容即可结束。');
 for(const expr of ['st.wakeConfig','next']){const start='          if (isSleepingConfigV2('+expr+') && preSleepWaitBlockedV2(st)) {';const a=s.indexOf(start);if(a<0)throw Error('sleep guard boundary');const b=s.indexOf('\n          }',a);s=s.slice(0,a)+s.slice(b+12);}
 s=s.replaceAll('const preSleepWaitMs = numberSetting(cfg.socialV2?.wake?.preSleepWaitMs, 0);','const preSleepWaitMs = 0; // compatibility field; no model-managed observation');
 return s;
};

exports.zeroSettings = (s,once) => {
 s='// BigFatFish V3 zero settings\n'+s;
 s=s.replace('Math.round(Number(ms) || min)','Math.round(numberSetting(ms,min))');
 s=s.replace('Number(gapMs) || numberSetting(sendCfg.burstIntervalMinMs, 1000)','numberSetting(gapMs,numberSetting(sendCfg.burstIntervalMinMs,1000))');
 s=s.replace('randInt(Math.max(100, min), Math.max(100, max))','randInt(Math.max(0, min), Math.max(0, max))');
 s=once(s,'const timeoutMs = Math.min(maxMs, Math.max(minMs, Math.round(Number(body.timeoutMs) || defaultMs)));','const requestedTimeoutMs=numberSetting(body.timeoutMs,defaultMs);\n          const timeoutMs = requestedTimeoutMs===0 ? 0 : Math.min(maxMs, Math.max(minMs, Math.round(requestedTimeoutMs)));');
 return s;
};

exports.unknownDelivery = (s,once) => {
 s='// BigFatFish V3 delivery result classification\n'+s;
 s=s.replaceAll('const gapMs = Number(body.gapMs);','const gapMs = body.gapMs;');
 s=once(s,'        err.sent = sent.slice();',"        err.sent = sent.slice();\n        err.unknown=failed.some(e=>/timeout|超时|ECONNRESET/i.test(String(e?.message)));\n        if(err.unknown)err.message='发送结果尚未确认；先查询实际已发消息，不要直接重发。'+err.message;");
 return s;
};

exports.replyDiagnostics = (s,once) => {
  s='// BigFatFish confirmed recipient wake diagnostics\n'+s;
  return once(s,`      if (kind === 'group' && bff.settings.participation.requireDirected && !st.bootstrapSent
          && !st.bigfatfish.participation.lastDecision?.recipientConfirmed) return;`,
    `      if (kind === 'group' && bff.settings.participation.requireDirected
          && !st.bigfatfish.participation.lastDecision?.recipientConfirmed) {
        appendActivity(key + ' [reserved2] 消息已接收，仅旁观：未确认正在跟机器人说话（未唤醒）');
        return;
      }`);
};

exports.replyLatency = (s, once) => {
  s = '// BigFatFish direct reply latency v1\n' + s;
  s = once(s, '    const resolveAtName = async (qq) => {', `    // Reuse the verified identity for self mentions and resolve other names once per event.
    const incomingNames = new Map();
    const resolveAtName = async (qq) => {`);
  s = once(s, '      return resolveGroupMemberName(event.group_id, qq);', `      const target = String(qq);
      if (target === String(event.self_id) && target === String(selfUserId) && selfDisplayName) return selfDisplayName;
      if (!incomingNames.has(target)) incomingNames.set(target, resolveGroupMemberName(event.group_id, target));
      return incomingNames.get(target);`);
  return once(s, "        scheduleWakeV2(key, 'bootstrap');", "        scheduleWakeV2(key, messageWakeReason || 'bootstrap');");
};
