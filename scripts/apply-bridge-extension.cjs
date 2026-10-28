// Apply a small, reproducible integration patch to the pinned upstream snapshot.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repo = path.join(root, 'integrations/qq-bridge');
function change(file, edit, marker) {
  if (file === 'public/console.html') return; // V3 ships one authoritative console below.
  const full = path.join(repo, file), source = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  if (source.includes(marker)) return;
  const next = edit(source); fs.writeFileSync(full, next, 'utf8');
}
function once(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('Upstream patch anchor changed: ' + before.slice(0, 90));
  return source.replace(before, after);
}
function within(source, start, end, before, after) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Upstream function boundary changed');
  return source.slice(0, a) + once(source.slice(a, b), before, after) + source.slice(b);
}
change('src/bridge.js', s => {
  s = "// BigFatFish integration v1\nimport { BigFatFish, normalizeState } from '../../../extensions/bigfatfish/runtime.mjs';\n" + s;
  s = once(s, "    ownerQQ: normalizeOwnerQQ(file.ownerQQ),", "    ownerQQ: normalizeOwnerQQ(file.ownerQQ),\n    bigfatfish: file.bigfatfish ?? {},");
  s = once(s, '  const cfg = loadConfig();\n', '  const cfg = loadConfig();\n  const bff = new BigFatFish(ROOT, cfg);\n');
  s = within(s, '  function getSocialV2State(key)', '  function loadSocialV2State()', '    return st;', '    bff.bind(key, st);\n    return st;');
  s = once(s, '            modelSeenSeqs: new Set(),\n            activeTopics:', '            modelSeenSeqs: new Set(),\n            bigfatfish: normalizeState(val.bigfatfish),\n            activeTopics:');
  s = once(s, '          lastReadThroughSeq: st.lastReadThroughSeq || 0,', '          lastReadThroughSeq: st.lastReadThroughSeq || 0,\n          bigfatfish: normalizeState(st.bigfatfish),');
  s = within(s, '  function formatMemoryV2(st)', '  function appendMemoryV2(', "    return lines.join('\\n');", "    const extra = bff.formatMemory(st);\n    if (extra) lines.push(extra);\n    return lines.join('\\n');");
  s = within(s, '  function buildWakePromptV2(key, reason)', '  function buildWakeReminderPromptV2', '    const base = roleLine +', '    const base = bff.instruction(key, st) + roleLine +');
  s = within(s, '  async function sendWakePromptV2(key, reason)', '  function cancelReplyCheckV2', '    const st = getSocialV2State(key);', '    const st = getSocialV2State(key);\n    if (!bff.beginWake(key, st, reason)) { saveSocialV2State(); return; }');
  s = once(s, '  function sendMessagesV2(key, messages, delays, replyToMessageId, atUserId = null) {', '  function sendMessagesV2(key, messages, delays, replyToMessageId, atUserId = null) {\n    messages = bff.prepareMessages(key, messages);\n    if (!messages.length) return Promise.resolve([]);');
  s = within(s, '  function sendMessagesV2(', '  // 审计范围', '      return sent;', '      if (sent.length) { bff.sent(key); saveSocialV2State(); }\n      return sent;');
  s = within(s, '  function captureSendGuard(key)', '  // 静默模式', '    return () => {', "    return () => {\n      if (String(selfUserId) !== String(cfg.bigfatfish.expectedQQ)) throw new Error('QQ 登录账号尚未核验或与配置不符');\n      const st = socialV2.conversations.get(key);\n      if (st?.bffColdRound && bff.coldGate(st)) throw new Error('冷场主动发送受到策略限制');");
  s = once(s, '    const plainContent = await segmentsToText(event.message ?? [], { resolveAtName, includeReply: false });', "    const plainContent = await segmentsToText(event.message ?? [], { resolveAtName, includeReply: false });\n    const bffState = getSocialV2State(key);\n    bff.bind(key, bffState);\n    if (!bff.inbound(key, event)) return;\n    const adminReply = await bff.adminCommand(kind, event, plainContent, onebotHttpAction);\n    if (adminReply !== null) { await sendToQQ(key, adminReply); return; }");
  s = once(s, '    bot.onEvent((event) => {', '    bot.onEvent((event) => {\n      bff.recordRequest(event);');
  const hook = `        if (await bff.handle(req, url, readBody, sendJson, {
          state: getSocialV2State, save: saveSocialV2State, format: formatMemoryV2,
          agentTokenOk, allowed: v2SessionAllowed, memoryEnabled: () => v2ToolEnabled('memory'),
          gatewayQQ: () => selfUserId, request: onebotHttpAction,
          voice: () => bff.voiceStatus(), openVoice: () => bff.openVoice()
        })) return;\n`;
  s = once(s, "        if (req.method === 'GET' && url.pathname === '/api/status') {", hook + "        if (req.method === 'GET' && url.pathname === '/api/status') {");
  s = once(s, "            const label = sent.entry?.desc || sent.entry?.localNote || '表情包';", "            bff.sent(key);\n            const label = sent.entry?.desc || sent.entry?.localNote || '表情包';");
  return s;
}, '// BigFatFish integration v1');
change('src/bridge.js', s => {
  s = once(s, '  // 发送一个收藏表情（按 emoji_id/url/md5 解析，发图片段）。', '  // 发送一个收藏表情（按 emoji_id/url/md5 解析，保留 QQ 自定义表情样式）。');
  return once(s, "    segments.push({ type: 'image', data: { file: 'base64://' + image.buffer.toString('base64') } });", `    // BigFatFish QQ favorite display v1
    // QQ 收藏表情仍用 image 段；必须带 sub_type=1，否则网关默认按普通图片发送。
    // 与 SnowLuma send_custom_face 的类型/摘要一致，原始 GIF 字节仍走安全下载。
    // 不传 emoji_id：image.emoji_id 在网关中表示商城表情，并非收藏表情 ID。
    segments.push({ type: 'image', data: {
      file: 'base64://' + image.buffer.toString('base64'),
      sub_type: 1,
      summary: '[动画表情]'
    } });`);
}, '// BigFatFish QQ favorite display v1');
change('src/mcp-snowluma-safe.js', s => '// BigFatFish memory categories v1\n' + s
  .replaceAll("z.enum(['activeTopic', 'pendingThought', 'memberImpression'])", "z.enum(['activeTopic', 'pendingThought', 'memberImpression', 'longTerm', 'summary'])")
  .replace('memberImpression=对某位群友的印象。', 'memberImpression=以群友QQ号记录的印象；longTerm=明确长期偏好/约定；summary=阶段摘要。')
  .replace('memberImpression 时的群友名字/昵称', 'memberImpression 时的真实群友QQ号，不使用昵称')
  .replace("      target: z.string().optional().describe('memberImpression", "      sourceMessageId: z.string().optional().describe('本会话来源消息ID'),\n      target: z.string().optional().describe('memberImpression"), '// BigFatFish memory categories v1');
change('src/bridge.js', s => {
  s = '// BigFatFish policies v2\n' + s;
  s = once(s, '    if (!bff.beginWake(key, st, reason)) { saveSocialV2State(); return; }\n', '');
  s = once(s, '    const wakeTime = now;', '    if (!bff.beginWake(key, st, reason)) { saveSocialV2State(); return; }\n    const wakeTime = now;');
  s = once(s, '    const rollbackWakeTime = () => {', '    const rollbackWakeTime = () => {\n      bff.cancelAttempt(key);');
  s = once(s, "    if (Number(tr.probability) > 0 && Math.random() < Number(tr.probability)) return 'probability';", "    if (bff.interestWake(key, st)) return 'interest';\n    if (Number(tr.probability) > 0 && Math.random() < Number(tr.probability)) return 'probability';");
  s = once(s, '      if (st?.bffColdRound && bff.coldGate(st))', '      if (st?.bffColdRound && bff.sendGate(key, st))');
  s = within(s, '  function sendMessagesV2(', '  // 审计范围', '          sent.push(msg);', '          sent.push(msg);\n          bff.sent(key, msg); saveSocialV2State();');
  s = once(s, '  function recordVoiceSentV2(key, sent, label) {', '  function recordVoiceSentV2(key, sent, label) {\n    bff.sent(key);');
  s = once(s, '          voice: () => bff.voiceStatus(), openVoice: () => bff.openVoice()', '          reschedule: () => { for (const key of socialV2.conversations.keys()) { cancelProactiveCheckV2(key); scheduleProactiveCheckV2(key); } },\n          voice: () => bff.voiceStatus(), openVoice: () => bff.openVoice()');
  const start = s.indexOf('  function scheduleProactiveCheckV2(key) {'), end = s.indexOf('  function clearSocialV2Timers(key)', start);
  if (start < 0 || end < start) throw new Error('Proactive scheduler boundary changed');
  s = s.slice(0, start) + `  function scheduleProactiveCheckV2(key) {
    if (cfg.socialV2?.proactive?.enabled === false || !bff.settings.schedule.enabled) return;
    if (socialV2.paused || currentMode !== 'reserved2' || !isSessionAllowedInCurrentMode(key)) return;
    const st = getSocialV2State(key);
    if (st.proactiveTimer) return;
    const delay = bff.nextDelay(key, st);
    st.proactiveTimer = setTimeout(() => {
      st.proactiveTimer = null;
      st.bigfatfish.nextCheckAt = 0;
      if (!isConversationBusyV2(key, st)) {
        void sendWakePromptV2(key, 'proactiveCheck').catch(error => log('[reserved2] 主动检查失败:', error?.message ?? error));
      }
      scheduleProactiveCheckV2(key);
      saveSocialV2State();
    }, delay);
    st.proactiveTimer.unref?.();
  }

` + s.slice(end);
  return s;
}, '// BigFatFish policies v2');
change('src/mcp-snowluma-safe.js', s => {
  s = '// BigFatFish memory provenance v2\n' + s;
  s = once(s, "      sourceMessageId: z.string().optional().describe('本会话来源消息ID'),", "      sourceMessageId: z.string().optional().describe('长期事实和摘要必填：本会话真人消息ID'),\n      confidence: z.number().min(0).max(1).optional().describe('长期事实置信度；不确定或玩笑不保存'),\n      importance: z.number().min(0).max(1).optional(),\n      expiresInDays: z.number().min(0).max(3650).optional(),");
  return s;
}, '// BigFatFish memory provenance v2');
change('src/mcp-snowluma-safe.js', s => '// BigFatFish fact correction v3\n' + once(s,
  "      confidence: z.number().min(0).max(1).optional().describe('长期事实置信度；不确定或玩笑不保存'),",
  "      replaceId: z.string().optional().describe('修正当前真人自己的旧事实ID，替换而不并列保存矛盾事实'),\n      confidence: z.number().min(0).max(1).optional().describe('长期事实置信度；不确定或玩笑不保存'),"), '// BigFatFish fact correction v3');
change('src/bridge.js', s => '// BigFatFish schedule persistence v3\n' + once(s,
  '          reschedule: () => { for (const key of socialV2.conversations.keys()) { cancelProactiveCheckV2(key); scheduleProactiveCheckV2(key); } },',
  '          reschedule: () => { for (const key of socialV2.conversations.keys()) { cancelProactiveCheckV2(key); scheduleProactiveCheckV2(key); } saveSocialV2State(); },'), '// BigFatFish schedule persistence v3');
change('src/bridge.js', s => {
  s = once(s, '  function saveSocialV2State() {', '  function saveSocialV2State({ strict = false } = {}) {');
  return once(s, `      atomicWriteJson(SOCIAL_V2_FILE, obj);
    } catch (error) {
      log('保存 socialV2 状态失败:', error?.message ?? error);
    }`, `      atomicWriteJson(SOCIAL_V2_FILE, obj);
      return true;
    } catch (error) {
      log('保存 socialV2 状态失败:', error?.message ?? error);
      if (strict) throw new Error('记忆保存失败，请稍后重试');
      return false;
    }`);
}, "if (strict) throw new Error('记忆保存失败，请稍后重试')");
change('src/bridge.js', s => {
  s = '// BigFatFish native slang scoring v1\n' + s;
  s = once(s, '  function saveSlangStore() {', '  function saveSlangStore({ strict = false } = {}) {');
  s = within(s, '  function saveSlangStore(', '  function queueSlangTask(', '      return;', "      if (strict) throw new Error('原黑话词库只读');\n      return false;");
  s = once(s, "    } catch (error) { log('保存黑话库失败:', error?.message ?? error); }", `      return true;
    } catch (error) {
      log('保存黑话库失败:', error?.message ?? error);
      if (strict) throw new Error('原黑话词库保存失败');
      return false;
    }`);
  s = once(s, '  function queueSlangTask(fn) {', `  function bffSlangStore() {
    return { entries: () => slangEntries, writable: () => slangStoreWritable, save: () => saveSlangStore({ strict: true }) };
  }
  function scanBffSlang(force = false) {
    try { bff.slang.scan(bffSlangStore(), { force }); }
    catch { log('黑话评分任务未完成，请在管理页检查词库和磁盘状态'); }
  }

  function queueSlangTask(fn) {`);
  s = once(s, '          gatewayQQ: () => selfUserId, request: onebotHttpAction,', '          gatewayQQ: () => selfUserId, request: onebotHttpAction, slang: bffSlangStore(),');
  s = within(s, '  async function runSlangExtraction(key)', '  async function runSlangResearch(', '      saveSlangStore();', '      if (saveSlangStore()) scanBffSlang(true);');
  s = within(s, '  async function runSlangResearch(', '  function maybeQueueSlangExtraction(', '      saveSlangStore();', '      if (saveSlangStore()) scanBffSlang(true);');
  s = within(s, '  function appendSocialV2Message(', '  function appendSocialV2Poke(', '    saveSocialV2State();', '    saveSocialV2State();\n    scanBffSlang();');
  return s;
}, '// BigFatFish native slang scoring v1');
change('src/bridge.js', s => {
  s = '// BigFatFish slang candidate admission v1\n' + s;
  s = within(s, '  async function runSlangExtraction(key)', '  async function runSlangResearch(',
    '        const result = upsertSlangEntry(slangEntries, item.content, { evidence, countIncrement: 1 });',
    `        if (!slangEntries.some(e => e.content === item.content) && !bff.slang.candidateAdmission(item.content).eligible) continue;
        const result = upsertSlangEntry(slangEntries, item.content, { evidence, countIncrement: 1 });`);
  s = within(s, "        if (req.method === 'POST' && url.pathname === '/api/socialV2/slang/submit')", "          const entry = createSlangEntry({",
    '          const existing = slangEntries.find((e) => e.content === content);',
    `          const existing = slangEntries.find((e) => e.content === content);
          if (!existing) {
            const admission = bff.slang.candidateAdmission(content);
            if (!admission.eligible) {
              sendJson({ ok: true, status: 'pending', admitted: false, ...admission });
              return;
            }
          }`);
  return s;
}, '// BigFatFish slang candidate admission v1');
change('src/mcp-snowluma-safe.js', s => once(s,
  '提交后进入候选库，管理员确认后会被写入黑话提示词，成为你后续可查询和使用的记忆。',
  '须达到管理页设置的不同真人消息条数才进入候选库；未达门槛返回 status=pending 和当前条数，不算已收录，也不要反复提交刷次数。管理员确认或满足自动确认策略后才会写入黑话提示词，成为你后续可查询和使用的记忆。'),
  '未达门槛返回 status=pending');
change('src/bridge.js', s => {
  const patch = JSON.parse(fs.readFileSync(path.join(root, 'extensions/bigfatfish/participation-bridge.patch.json'), 'utf8'));
  for (const { before, after } of patch.pairs) s = once(s, before, after);
  const start = s.indexOf(patch.scheduler.start), end = s.indexOf(patch.scheduler.end, start);
  if (start < 0 || end < start) throw new Error('Participation scheduler boundary changed');
  return '// BigFatFish participation v1\n' + s.slice(0, start) + patch.scheduler.replacement + s.slice(end);
}, '// BigFatFish participation v1');
change('src/bridge.js', s => {
  s = '// BigFatFish per-session personas v1\n' + s;
  s = once(s, '          gatewayQQ: () => selfUserId, request: onebotHttpAction, slang: bffSlangStore(),', '          gatewayQQ: () => selfUserId, request: onebotHttpAction, slang: bffSlangStore(),\n          roleState: readRoleState, roles: listRoles,');
  s = once(s, '  function roleRawContent() {', `  function sessionRoleState(key) { return bff.personas.resolve(key, readRoleState()); }
  function sessionRoleLine(key) {
    const selected = sessionRoleState(key);
    return selected.role
      ? '【当前角色】' + selected.role + '（以当前会话选择为准，历史中的其他人格不再适用；完整角色卡请调用 qq_get_prompt 查看）\\n\\n'
      : '【当前角色】本会话不使用人格模板，历史人格设定不再适用；继续遵循仿真规则和工具权限。\\n\\n';
  }
  function roleRawContent(key) {`);
  s = within(s, '  function roleRawContent(key)', '  function roleHintForMode(', '      const rs = readRoleState();', '      const rs = sessionRoleState(key);');
  s = once(s, '      const stateStat = fs.statSync(ROLE_STATE_FILE);', '      const stateStat = fs.existsSync(ROLE_STATE_FILE) ? fs.statSync(ROLE_STATE_FILE) : { mtimeMs: 0, size: 0 };');
  s = once(s, '  function roleHintForMode(mode) {\n    const selected = selectRoleText(roleRawContent(), mode);', '  function roleHintForMode(mode, key) {\n    const selected = selectRoleText(roleRawContent(key), mode);');
  s = once(s, "  function currentRoleHint() {\n    return roleHintForMode('v1');", "  function currentRoleHint(key) {\n    return (key ? sessionRoleLine(key) : '') + roleHintForMode('v1', key);");
  s = once(s, '  function currentRoleHintV2() {', '  function currentRoleHintV2(key) {');
  s = once(s, "    const raw = roleHintForMode('v2');", "    const raw = roleHintForMode('v2', key);");
  s = s.replaceAll('const roleHint = currentRoleHint();', 'const roleHint = currentRoleHint(key);');
  s = within(s, '  async function flushSummaries(', '  // 当前角色扮演提示', 'const roleHint = currentRoleHint(key);', 'const roleHint = currentRoleHint(k);');
  const roleLine = "const roleLine = roleState.role ? `【当前角色】${roleState.role}（完整角色卡请调用 qq_get_prompt 查看）\\n\\n` : '';";
  if (s.split(roleLine).length !== 4) throw new Error('Session persona prompt anchors changed');
  s = s.replaceAll(roleLine, 'const roleLine = sessionRoleLine(key);');
  s = once(s, "role: { name: roleState.role ?? null, hint: currentMode === 'reserved2' ? currentRoleHintV2() : currentRoleHint() },", "role: { name: sessionRoleState(key).role ?? null, source: sessionRoleState(key).source, hint: currentMode === 'reserved2' ? currentRoleHintV2(key) : currentRoleHint(key) },");
  s = once(s, '          fs.renameSync(roleFilePath(from), roleFilePath(to));', '          bff.personas.rename(from, to);');
  s = once(s, '          fs.rmSync(roleFilePath(name));', '          bff.personas.remove(name);');
  return s;
}, '// BigFatFish per-session personas v1');
change('src/bridge.js', s => {
  s = '// BigFatFish persona activation v2\n' + s;
  s = once(s, "currentMode === 'closed-agent' ? cfg.ownerQQ : null]);", "currentMode === 'closed-agent' ? cfg.ownerQQ : null, bff.personas.signature(key, readRoleState())]);");
  s = once(s, '          roleState: readRoleState, roles: listRoles,', '          roleState: readRoleState, roles: listRoles, personaChanged: reconcileSessionPolicies,');
  const start = s.indexOf('  function sessionRoleLine(key) {'), end = s.indexOf('  function roleRawContent(key)', start);
  if (start < 0 || end < start) throw new Error('Persona line boundary changed');
  s = s.slice(0, start) + `  function sessionRoleLine(key) {
    const selected = sessionRoleState(key);
    if (!selected.role) return '【当前角色】本会话不使用人格模板，历史人格设定不再适用；继续遵循仿真规则和工具权限。\\n\\n';
    const card = currentMode === 'reserved2' ? currentRoleHintV2(key) : roleHintForMode('v1', key);
    return '【当前角色】' + selected.role + '（以当前会话管理员选择为准；历史中的旧人格不再适用。QQ昵称只是账号昵称，不决定人格。）\\n'
      + '【当前角色卡】\\n' + card + '\\n【当前角色卡结束】\\n\\n';
  }
` + s.slice(end);
  s = once(s, "    return (key ? sessionRoleLine(key) : '') + roleHintForMode('v1', key);", '    return sessionRoleLine(key);');
  s = once(s, '      if (roleHintCache.key === cacheKey) return roleHintCache.raw;\n', '');
  // Apply changes before returning success so old in-flight tokens are revoked immediately.
  for (const anchor of [
    '            writeRoleState(name, rs.mode);', '            writeRoleState(null, rs.mode);',
    '          writeRoleContent(name, content);\n          log(`控制台：更新人格',
    '          if (switched) writeRoleState(to, rs.mode);', '          if (cleared) writeRoleState(null, rs.mode);'
  ]) {
    const at = anchor.indexOf('\n');
    const replacement = at < 0 ? anchor + '\n          reconcileSessionPolicies();' : anchor.slice(0, at) + '\n          reconcileSessionPolicies();' + anchor.slice(at);
    s = once(s, anchor, replacement);
  }
  return s;
}, '// BigFatFish persona activation v2');
change('src/bridge.js', s => {
  s = '// BigFatFish persona history isolation v3\n' + s;
  s = once(s, '  function sessionRoleState(key) {', `  function personaModelMessagesV2(key, messages) {
    return bff.personas.modelMessages(key, messages, readRoleState());
  }
  function sessionRoleState(key) {`);
  s = once(s, '      const recent = st.recentMessages.filter((m) => !Number.isSafeInteger(m.seq) || !unread.has(m.seq)).slice(-maxRecent);', '      const recent = personaModelMessagesV2(key, st.recentMessages).filter((m) => !Number.isSafeInteger(m.seq) || !unread.has(m.seq)).slice(-maxRecent);');
  s = once(s, '          const start = Math.max(0, st.recentMessages.length - offset - limit);\n          const end = Math.max(0, st.recentMessages.length - offset);\n          const messages = st.recentMessages.slice(start, end);', `          const history = req.headers['x-agent-token'] ? personaModelMessagesV2(key, st.recentMessages) : st.recentMessages;
          const start = Math.max(0, history.length - offset - limit);
          const end = Math.max(0, history.length - offset);
          const messages = history.slice(start, end);`);
  s = once(s, '          const mine = st.recentMessages.filter((m) => m.isSelf).slice(-limit);', `          const history = req.headers['x-agent-token'] ? personaModelMessagesV2(key, st.recentMessages) : st.recentMessages;
          const mine = history.filter((m) => m.isSelf).slice(-limit);`);
  s = within(s, '  function recordSentMessagesV2(', '  function readFeedbackEntries(', '        isSelf: true,', '        isSelf: true,\n        personaSignature: bff.personas.signature(key, readRoleState()),');
  s = once(s, "              isSelf: true,\n              media: [],\n              hasMedia: false,\n              forwardIds: [],\n              hasForward: false,\n              poke:", "              isSelf: true,\n              personaSignature: bff.personas.signature(key, readRoleState()),\n              media: [],\n              hasMedia: false,\n              forwardIds: [],\n              hasForward: false,\n              poke:");
  s = once(s, "              isSelf: true,\n              media: [],\n              hasMedia: false,\n              forwardIds: [],\n              hasForward: false,\n              sticker:", "              isSelf: true,\n              personaSignature: bff.personas.signature(key, readRoleState()),\n              media: [],\n              hasMedia: false,\n              forwardIds: [],\n              hasForward: false,\n              sticker:");
  s = s.replaceAll('selfIdentityTextV2()', 'selfIdentityTextV2(key)');
  s = once(s, '    return `【你的身份】你在 QQ 上的昵称是', '    const role = sessionRoleState(key).role;\n    const persona = role ? `当前扮演的人物是「${role}」。被问你是谁、叫什么时按当前角色卡介绍自己；账号昵称不等于人物姓名。` : \'当前没有扮演人物。\';\n    return `${persona}【QQ账号标识】你在 QQ 上的显示昵称是');
  return s;
}, '// BigFatFish persona history isolation v3');
change('src/bridge.js', s => {
  s = '// BigFatFish orphaned wake recovery v1\n' + s;
  s = once(s, '  function scheduleWakeV2(key, reason) {', `  function recoverOrphanedWakesV2() {
    const recovered = [];
    if (!dshReady || currentMode !== 'reserved2' || socialV2.paused || cfg.socialV2?.enabled === false) return recovered;
    for (const [key, st] of socialV2.conversations) {
      if (!isSessionAllowedInCurrentMode(key) || state.sessions[key] || isConversationBusyV2(key, st) || st.rateLimitRetryTimer) continue;
      const unanswered = (st.unread || []).filter(m => m && !m.isSelf
        && Number(m.seq) > Number(st.lastReadThroughSeq || 0) && Number(m.time) > Number(st.lastAiReplyAt || 0));
      const newest = unanswered.at(-1);
      if (!newest || (readRoleState().mode === 'silent' && !newest.isOwner)) continue;
      // Preserve normal group participation decisions: only restore an interrupted
      // first wake or a wake that had already been selected before retirement.
      if (key.startsWith('group:') && st.bootstrapSent && !st.pendingWakeReasons?.length) continue;
      st.bootstrapSent = true;
      scheduleWakeV2(key, key.startsWith('private:') ? 'private' : 'bootstrap');
      recovered.push(key);
      log('[reserved2] 恢复无活动会话的未答消息 ' + key + '（seq ' + newest.seq + '）');
    }
    if (recovered.length) saveSocialV2State();
    return recovered;
  }

  function scheduleWakeV2(key, reason) {`);
  s = once(s, "    } else if (dshReady) {\n      dshReady = false;", "      recoverOrphanedWakesV2();\n    } else if (dshReady) {\n      dshReady = false;");
  s = once(s, '          cfg.ownerQQ = ownerQQ;\n          reconcileSessionPolicies();', '          cfg.ownerQQ = ownerQQ;\n          reconcileSessionPolicies();\n          recoverOrphanedWakesV2();');
  return s;
}, '// BigFatFish orphaned wake recovery v1');
change('src/bridge.js', s => {
  s = '// BigFatFish formal reply context v1\n' + s;
  s = once(s, ' + roleLine + identityLine + tokenLine + initialPromptLine', ' + roleLine + bff.responseContext(key, st).instruction + identityLine + tokenLine + initialPromptLine');
  s = once(s, '            replyTiming: replyTimingV2(st),', '            replyTiming: replyTimingV2(st),\n            response: bff.responseContext(key, st),');
  s = once(s, '          sendJson({ ok: true, key, unreadCount: st.unread.length, messages, readThroughSeq });', '          sendJson({ ok: true, key, unreadCount: st.unread.length, messages, readThroughSeq, response: bff.responseContext(key, st) });');
  s = once(s, '          sendJson({ ok: true, key, messages, readThroughSeq });', '          sendJson({ ok: true, key, messages, readThroughSeq, response: bff.responseContext(key, st) });');
  s = within(s, "url.pathname === '/api/socialV2/wait'", "url.pathname === '/api/socialV2/check-send'", '            newMessages,\n            readThroughSeq,', '            newMessages,\n            response: bff.responseContext(key, st),\n            readThroughSeq,');
  s = within(s, '  function appendSocialV2Message(', '  function appendSocialV2Poke(', '      isSelf: false,', "      isSelf: false,\n      ...(st.bigfatfish?.assistantMessageIds?.includes(String(messageId)) ? { replyStyle: 'formal' } : {}),");
  return s;
}, '// BigFatFish formal reply context v1');
change('src/bridge.js', s => {
  s = '// BigFatFish interest memory load v1\n' + s;
  s = within(s, '  function loadSocialV2State()', '  function saveSocialV2State(', '          socialV2.conversations.set(key, st);', '          socialV2.conversations.set(key, st);\n          bff.bind(key, st);');
  return s;
}, '// BigFatFish interest memory load v1');
{
  const file = path.join(repo, 'public/console.html'); let s = fs.readFileSync(file, 'utf8');
  s = s.replace('    renderRoleEditor();\n  } catch (error) {\n    document.getElementById(\'roleList\')', '    renderRoleEditor();\n    document.dispatchEvent(new Event(\'bff-roles-changed\'));\n  } catch (error) {\n    document.getElementById(\'roleList\')');
  fs.writeFileSync(file, s, 'utf8');
}
change('src/bridge.js', s => {
  s = '// BigFatFish policy integration audit v1\n' + s;
  s = once(s, '    keyword: 60,', '    interest: 65,\n    keyword: 60,');
  s = within(s, '  function formatMemoryV2(st)', '  function appendMemoryV2(', "    if (!st) return '';", "    if (!st) return '';\n    if (st.bigfatfish) bff.cleanMemory(st);");
  return s;
}, '// BigFatFish policy integration audit v1');
change('src/bridge.js', s => {
  s = '// BigFatFish configured wake compatibility v1\n' + s;
  s = once(s, `  function evaluateWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf) {
    const decision = bff.chatDecision(key, st, event, { kind, text: plainContent, quoteTargetIsSelf, nickname: selfNickname });
    if (decision.handled) { saveSocialV2State(); return decision.reason; }`, `  function evaluateWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf) {
    const decision = bff.chatDecision(key, st, event, { kind, text: plainContent, quoteTargetIsSelf, nickname: selfNickname });
    if (!decision.handled) return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf);
    saveSocialV2State();
    if (decision.direct) return decision.reason;
    return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf, true) || decision.reason;
  }
  function evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf, dynamic = false) {`);
  s = once(s, "    if (bff.interestWake(key, st)) return 'interest';", "    if (!dynamic && bff.interestWake(key, st)) return 'interest';");
  s = once(s, "    if (Number(tr.probability) > 0 && Math.random() < Number(tr.probability)) return 'probability';", "    if (!dynamic && Number(tr.probability) > 0 && Math.random() < Number(tr.probability)) return 'probability';");
  return s;
}, '// BigFatFish configured wake compatibility v1');
change('src/bridge.js', s => {
  s = '// BigFatFish proactive switch lifecycle v1\n' + s;
  s = once(s, "    if (cfg.socialV2?.proactive?.enabled === false || !bff.settings.schedule.enabled) return;", "    if (cfg.socialV2?.enabled === false || cfg.socialV2?.proactive?.enabled === false || !bff.settings.schedule.enabled) return;");
  s = within(s, '  function scheduleProactiveCheckV2(key)', '  function clearSocialV2Timers(key)', '      st.bigfatfish.nextCheckAt = 0;', '      st.bigfatfish.nextCheckAt = 0;\n      if (cfg.socialV2?.enabled === false || cfg.socialV2?.proactive?.enabled === false || !bff.settings.schedule.enabled) return;');
  s = once(s, '          cfg.socialV2 = { ...(cfg.socialV2 ?? {}), ...merged };', `          cfg.socialV2 = { ...(cfg.socialV2 ?? {}), ...merged };
          if (Object.hasOwn(body, 'enabled') || (body.proactive && Object.hasOwn(body.proactive, 'enabled'))) {
            for (const [key, st] of socialV2.conversations) {
              cancelProactiveCheckV2(key);
              st.bigfatfish.nextCheckAt = 0;
              scheduleProactiveCheckV2(key);
            }
            saveSocialV2State();
          }`);
  return s;
}, '// BigFatFish proactive switch lifecycle v1');
change('src/bridge.js', s => {
  s = '// BigFatFish queued send controls v1\n' + s;
  s = within(s, '  function captureSendGuard(key)', '  // 静默模式', '    return () => {', `    return () => {
      if (currentMode === 'reserved2' && (socialV2.paused || cfg.socialV2?.enabled === false)) throw new Error('发送已取消：二代 AI 已暂停或关闭');
      if (shouldBlockSilentReply(key)) throw new Error('发送已取消：静默模式已开启');`);
  return s;
}, '// BigFatFish queued send controls v1');
change('src/bridge.js', s => {
  const before = 'bff.responseContext(key, st)';
  if (!s.includes(before)) throw new Error('Formal response context anchors changed');
  return '// BigFatFish canonical response context v1\n' + s.replaceAll(before, 'bff.responseContext(canonicalV2Key(key) || key, st)');
}, '// BigFatFish canonical response context v1');
change('src/bridge.js', s => {
  s = '// BigFatFish reply progress checkpoint v1\n' + s;
  s = within(s, '  function sendMessagesV2(', '  // 审计范围', '    const assertSendAllowed = captureSendGuard(key);', `    const assertSendAllowed = captureSendGuard(key);
    const replyState = getSocialV2State(key);
    const replyToken = replyState.agentToken;
    // Freeze visibility before queueing. New arrivals or later reads must not be
    // acknowledged by an answer that was already being sent.
    const replyThroughSeq = readThroughSeqV2(replyState);`);
  s = within(s, '  function sendMessagesV2(', '  // 审计范围', '          sent.push(msg);', `          sent.push(msg);
          if (cfg.socialV2?.tools?.markRead !== false && replyState.agentToken === replyToken
              && socialV2.conversations.get(key) === replyState && replyThroughSeq > replyState.lastReadThroughSeq) {
            acknowledgeMessagesV2(replyState, replyThroughSeq);
          }`);
  s = within(s, '  function replayPendingWakeReasonsV2(', '  function setupSleepTimerV2(', '    const item = st.pendingWakeReasons.shift();', '    let skipped = null;\n    while (st.pendingWakeReasons.length) {\n    const item = st.pendingWakeReasons.shift();');
  s = within(s, '  function replayPendingWakeReasonsV2(', '  function setupSleepTimerV2(', "    if (!item || typeof item !== 'object') return null;", "    if (!item || typeof item !== 'object') continue;");
  s = within(s, '  function replayPendingWakeReasonsV2(', '  function setupSleepTimerV2(', 'Number(m.seq) >= Number(item.seq)', 'Number(m.seq) === Number(item.seq)');
  s = within(s, '  function replayPendingWakeReasonsV2(', '  function setupSleepTimerV2(', "    return { reason: item.reason, action: 'skipped' };", "    skipped = { reason: item.reason, action: 'skipped' };\n    }\n    return skipped;");
  return s;
}, '// BigFatFish reply progress checkpoint v1');
change('src/bridge.js', s => {
  s = '// BigFatFish targeted reply checkpoint v1\n' + s;
  s = within(s, '  function sendMessagesV2(', '  // 审计范围', '    const replyThroughSeq = readThroughSeqV2(replyState);', `    const replyThroughSeq = readThroughSeqV2(replyState);
    const hasReplyTarget = replyToMessageId != null && String(replyToMessageId).trim() !== '';
    const replyTargetSeq = hasReplyTarget ? replyState.unread.find(m => String(m.messageId) === String(replyToMessageId).trim())?.seq : null;`);
  s = within(s, '  function sendMessagesV2(', '  // 审计范围', `              && socialV2.conversations.get(key) === replyState && replyThroughSeq > replyState.lastReadThroughSeq) {
            acknowledgeMessagesV2(replyState, replyThroughSeq);`, `              && socialV2.conversations.get(key) === replyState) {
            if (hasReplyTarget) {
              if (Number.isSafeInteger(replyTargetSeq)) {
                replyState.unread = replyState.unread.filter(m => m.seq !== replyTargetSeq);
                const pending = new Set(replyState.unread.map(m => m.seq));
                while (replyState.lastReadThroughSeq < replyState.lastUnreadSeq && !pending.has(replyState.lastReadThroughSeq + 1)) replyState.lastReadThroughSeq++;
                noteModelMessagesV2(replyState, []);
              }
            } else if (replyThroughSeq > replyState.lastReadThroughSeq) acknowledgeMessagesV2(replyState, replyThroughSeq);`);
  return s;
}, '// BigFatFish targeted reply checkpoint v1');
change('src/bridge.js', s => {
  s = '// BigFatFish directed natural group replies v1\n' + s;
  s = once(s, '    if (decision.direct) return decision.reason;', "    if (kind === 'group' && bff.settings.participation.requireDirected && !decision.recipientConfirmed) return null;\n    if (decision.direct) return decision.reason;");
  s = within(s, '  function captureSendGuard(key)', '  // 静默模式', '      const st = socialV2.conversations.get(key);', '      const st = socialV2.conversations.get(key);\n      bff.assertReplyAllowed(key, st);');
  s = within(s, '  async function handleIncoming(', '    // 黑话学习素材：只从群聊普通消息', '      if (!st.bootstrapSent) {', `      if (kind === 'group' && bff.settings.participation.requireDirected && !st.bootstrapSent
          && !st.bigfatfish.participation.lastDecision?.recipientConfirmed) return;
      if (!st.bootstrapSent) {`);
  s = within(s, '  function recoverOrphanedWakesV2()', '  function scheduleWakeV2(', '      st.bootstrapSent = true;', "      if (key.startsWith('group:') && bff.settings.participation.requireDirected && !bff.groupReplyContext(key, st).confirmed) continue;\n      st.bootstrapSent = true;");
  s = once(s, '  async function onebotSend(kind, id, message, replyToMessageId, atUserId = null) {', "  async function onebotSend(kind, id, message, replyToMessageId, atUserId = null) {\n    replyToMessageId = bff.quoteTarget(kind + ':' + id, replyToMessageId);");
  s = once(s, '  async function sendStickerV2(key, stickerRef, options = {}) {', '  async function sendStickerV2(key, stickerRef, options = {}) {\n    options = { ...options, replyToMessageId: bff.quoteTarget(key, options.replyToMessageId) };');
  s = s.replaceAll('quoted: quotedInfo', 'quoted: bff.quoteTarget(key, actualReplyToMessageId) ? quotedInfo : null');
  const oldQuote = /【引用：只在必要时用】[^\n]*?\\n你可以调用工具/.exec(s)?.[0];
  if (!oldQuote) throw new Error('Group quote prompt anchor changed');
  s = once(s, oldQuote, '【回复表达】先遵循本轮【群聊对象确认】和【自然表达】：不要复读原话；管理端关闭群聊引用时用普通消息回答，不带引用条。\\n你可以调用工具');
  s = once(s, '如果群聊正热但没人叫你，可以插一句有趣的/相关的，插不上再看情况潜水；不要一上来就划走。', '只有确认消息是在跟你说话时才考虑回答；群友彼此聊天、对象不明或只是谈到你时，先旁观。');
  return s;
}, '// BigFatFish directed natural group replies v1');
change('src/bridge.js', s => {
  s = '// BigFatFish directed reply batch completion v1\n' + s;
  s = within(s, '  function captureSendGuard(key)', '  // 静默模式', '    const sessionId = state.sessions[key];', '    const sessionId = state.sessions[key];\n    let recipientChecked = false;');
  s = within(s, '  function captureSendGuard(key)', '  // 静默模式', '      bff.assertReplyAllowed(key, st);', "      if (!recipientChecked) {\n        if (currentMode === 'reserved2') bff.assertReplyAllowed(key, st);\n        recipientChecked = true;\n      }");
  return s;
}, '// BigFatFish directed reply batch completion v1');
change('src/bridge.js', s => {
  s = '// BigFatFish discussion topic learning v1\n' + s;
  s = within(s, '  function appendSocialV2Message(', '  function appendSocialV2Poke(', '      isSelf: false,', "      isSelf: false,\n      ...(st.bigfatfish?.memoryControl?.accumulation === false ? { topicLearningAllowed: false } : {}),");
  s = within(s, '  function appendSocialV2Message(', '  function appendSocialV2Poke(', '    saveSocialV2State();', '    bff.observeTopics(key, st);\n    saveSocialV2State();');
  return s;
}, '// BigFatFish discussion topic learning v1');
change('src/slang-learner.js', s => once(s,
  "    sources: Array.isArray(entry.sources) ? entry.sources.map((s) => clip(s, SLANG_FIELD_MAX)).filter(Boolean).slice(-10) : [],",
  `    sources: Array.isArray(entry.sources) ? entry.sources.map((s) => clip(s, SLANG_FIELD_MAX)).filter(Boolean).slice(-10) : [],
    research: entry.research && typeof entry.research === 'object' ? {
      status: ['pending', 'researching', 'approved', 'rejected', 'failed'].includes(entry.research.status) ? entry.research.status : 'pending',
      at: Number(entry.research.at) || 0, nextAt: Number(entry.research.nextAt) || 0, confidence: Number(entry.research.confidence) || 0,
      reason: clip(entry.research.reason, 160), fingerprint: clip(entry.research.fingerprint, 500)
    } : undefined,`), 'fingerprint: clip(entry.research.fingerprint, 500)');
change('src/bridge.js', s => {
  s = '// BigFatFish rolling learning research v1\n' + s;
  s = once(s, '  function queueSlangTask(fn) {', `  function tickBffLearning() {
    if (dshReady) void bff.research.tick(bffSlangStore());
  }
  function requestBffLearning(job) {
    return new Promise((resolve, reject) => queueSlangTask(async () => {
      let sessionId;
      try {
        if (!dshReady) throw new Error('模型服务尚未连接');
        const preset = resolvePresetName(cfg.slang?.learnerPreset || cfg.agentPreset, { strict: true });
        if (!preset) throw new Error('缺少已验证的学习 preset');
        const scope = crypto.createHash('sha256').update(job.key || 'shared-slang').digest('hex').slice(0, 16);
        const ws = unwrap(await api.workspace.create({ path: path.join(STATE_DIR, 'learning-agent', scope) }), 'learning workspace');
        sessionId = unwrap(await api.sessions.create({ workspaceId: ws.workspaceId ?? ws.workspace?.workspaceId, agentPreset: preset, title: '群聊语料研究' }), 'learning session').sessionId;
        learnerSessions.add(sessionId); api.events.follow(sessionId); await ensureChatModel(sessionId);
        const accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: job.prompt }] });
        if (!accepted.result.ok) throw new Error('研究请求未被接受');
        resolve(await waitLearnerTurn(sessionId));
      } catch (error) { reject(error); }
      finally {
        if (sessionId) {
          learnerSessions.delete(sessionId); learnerCollectors.delete(sessionId);
          try { await api.workspace.archiveSession({ sessionId }); } catch {}
        }
      }
    }));
  }

  function queueSlangTask(fn) {`);
  s = within(s, '  function scanBffSlang(', '  function tickBffLearning()', '    try { bff.slang.scan(bffSlangStore(), { force }); }',
    '    try { bff.slang.scan(bffSlangStore(), { force }); tickBffLearning(); }');
  s = within(s, '  async function runSlangExtraction(key)', '  async function runSlangResearch(',
    '        queueSlangTask(() => runSlangResearch(researchCandidates));', '        tickBffLearning();');
  s = within(s, "        if (req.method === 'POST' && url.pathname === '/api/socialV2/slang/submit')", "        if (req.method === 'POST' && url.pathname === '/api/authorize/read')",
    '                queueSlangTask(() => runSlangResearch([existing]));', '                tickBffLearning();');
  s = within(s, "        if (req.method === 'POST' && url.pathname === '/api/socialV2/slang/submit')", "        if (req.method === 'POST' && url.pathname === '/api/authorize/read')",
    '            queueSlangTask(() => runSlangResearch([entry]));', '            tickBffLearning();');
  s = once(s, '  loadSocialV2State();', `  loadSocialV2State();
  bff.research.connect(requestBffLearning, saveSocialV2State);
  setInterval(tickBffLearning, 60000).unref();`);
  return s;
}, '// BigFatFish rolling learning research v1');
change('src/bridge.js', s => {
  s = '// BigFatFish learning waiter ordering v1\n' + s;
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    "        const accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: job.prompt }] });",
    `        const pendingTurn = waitLearnerTurn(sessionId);
        pendingTurn.catch(() => {});
        const accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: job.prompt }] });`);
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)', '        resolve(await waitLearnerTurn(sessionId));', '        resolve(await pendingTurn);');
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)', '          learnerSessions.delete(sessionId); learnerCollectors.delete(sessionId);',
    `          learnerSessions.delete(sessionId); learnerCollectors.delete(sessionId);
          for (const waiter of learnerWaiters.get(sessionId) || []) { clearTimeout(waiter.timer); waiter.reject(new Error('研究会话已结束')); }
          learnerWaiters.delete(sessionId);`);
  return s;
}, '// BigFatFish learning waiter ordering v1');
change('src/bridge.js', s => {
  s = '// BigFatFish learning workspace creation v1\n' + s;
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)', '      let sessionId;', "      let sessionId, stage = '准备语料工作区';");
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    "        const ws = unwrap(await api.workspace.create({ path: path.join(STATE_DIR, 'learning-agent', scope) }), 'learning workspace');",
    `        const directory = path.join(STATE_DIR, 'learning-agent', scope); fs.mkdirSync(directory, { recursive: true });
        stage = '创建工作区';
        const ws = unwrap(await api.workspace.create({ path: directory }), 'learning workspace');`);
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    "        sessionId = unwrap(await api.sessions.create({ workspaceId: ws.workspaceId ?? ws.workspace?.workspaceId, agentPreset: preset, title: '群聊语料研究' }), 'learning session').sessionId;",
    `        stage = '创建模型会话';
        sessionId = unwrap(await api.sessions.create({ workspaceId: ws.workspaceId ?? ws.workspace?.workspaceId, agentPreset: preset, title: '群聊语料研究' }), 'learning session').sessionId;`);
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    '        learnerSessions.add(sessionId); api.events.follow(sessionId); await ensureChatModel(sessionId);',
    "        stage = '选择模型';\n        learnerSessions.add(sessionId); api.events.follow(sessionId); await ensureChatModel(sessionId);");
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    '        const pendingTurn = waitLearnerTurn(sessionId);', "        stage = '提交研究请求';\n        const pendingTurn = waitLearnerTurn(sessionId);");
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    '        resolve(await pendingTurn);', "        stage = '收取研究结果';\n        resolve(await pendingTurn);");
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    '      } catch (error) { reject(error); }', "      } catch { reject(new Error('语料研究失败：' + stage)); }");
  return s;
}, '// BigFatFish learning workspace creation v1');
change('src/slang-learner.js', s => {
  s = '// BigFatFish manual research result metadata v1\n' + s;
  s = once(s, "status: ['pending', 'researching', 'approved', 'rejected', 'failed'].includes(entry.research.status)", "status: ['pending', 'queued', 'researching', 'approved', 'rejected', 'failed'].includes(entry.research.status)");
  s = once(s, '      at: Number(entry.research.at) || 0, nextAt:', `      mode: entry.research.mode === 'manual' ? 'manual' : 'auto', jobId: clip(entry.research.jobId, 80),
      result: entry.research.result && typeof entry.research.result === 'object' ? {
        ...Object.fromEntries(['meaning', 'usage', 'example', 'risk', 'reason'].map(k => [k, clip(entry.research.result[k], 300)])),
        sources: Array.isArray(entry.research.result.sources) ? entry.research.result.sources.map(s => clip(s, 300)).slice(0, 10) : []
      } : undefined,
      at: Number(entry.research.at) || 0, nextAt:`);
  return s;
}, '// BigFatFish manual research result metadata v1');
change('src/bridge.js', s => {
  s = '// BigFatFish visible manual slang research v1\n' + s;
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    "        if (!dshReady) throw new Error('模型服务尚未连接');", "        if (!dshReady) throw new Error('模型服务尚未连接');\n        await job.onStart?.();");
  const a = s.indexOf('  function requestBffLearning(job)'), b = s.indexOf('  function queueSlangTask(fn)', a);
  let part = s.slice(a, b).replace(/stage = '([^']+)';\n/g, "stage = '$1'; job.onStage?.(stage);\n");
  part = once(part, '        const pendingTurn = waitLearnerTurn(sessionId);', '        const pendingTurn = waitLearnerTurn(sessionId, Math.max(30000, Math.min(600000, Number(job.timeoutMs) || 120000)));');
  s = s.slice(0, a) + part + s.slice(b);
  s = within(s, "        if (req.method === 'POST' && url.pathname === '/api/slang/research')", "        if (req.method === 'POST' && url.pathname === '/api/slang/config')",
    '          const body = await readBody();', "          if (!dshReady) { sendJson({ ok: false, error: 'DSH未连接，研究未提交，请先恢复模型服务' }, 503); return; }\n          const body = await readBody();");
  s = within(s, "        if (req.method === 'POST' && url.pathname === '/api/slang/research')", "        if (req.method === 'POST' && url.pathname === '/api/slang/config')",
    '          queueSlangTask(() => runSlangResearch(candidates));\n          sendJson({ ok: true, count: candidates.length });',
    '          const job = bff.slang.manual.queue(candidates, bffSlangStore());\n          sendJson({ ok: true, ...job });');
  s = once(s, '          sendJson({ entries: list, config: cfg.slang, writable: slangStoreWritable });', '          sendJson({ entries: list, config: cfg.slang, writable: slangStoreWritable, researchJobs: bff.slang.manual.snapshot() });');
  s = once(s, '  bff.research.connect(requestBffLearning, saveSocialV2State);', '  bff.research.connect(requestBffLearning, saveSocialV2State);\n  bff.slang.manual.recover(bffSlangStore());');
  const oldStart = s.indexOf('  async function runSlangResearch(candidates)'), oldEnd = s.indexOf('  function maybeQueueSlangExtraction(key)', oldStart);
  if (oldStart < 0 || oldEnd < 0) throw new Error('Manual slang legacy function boundary changed');
  s = s.slice(0, oldStart) + s.slice(oldEnd);
  return s;
}, '// BigFatFish visible manual slang research v1');
change('src/bridge.js', s => once(s,
  "      let sessionId, stage = '准备语料工作区'; job.onStage?.(stage);",
  "      let sessionId, stage = '准备语料工作区'; // manual stage callbacks execute inside try"), '// manual stage callbacks execute inside try');
change('public/console.html', s => {
  s = once(s, 'async function refreshSlang() {', `// BigFatFish manual research feedback v1
function slangResearchMessage(r) {
  if (!r.ok) return '❌ ' + (r.error || '研究提交失败');
  if (!r.count) return '已有研究正在执行，无需重复提交；请查看上方“DSH研究任务与返回”。';
  return '✅ 已排队 ' + r.count + ' 条（每批5词），请查看上方“DSH研究任务与返回”，进度及结果自动刷新。';
}
function slangResearchBadge(e) {
  if (!e.research) return '';
  const labels = { pending: '待研究', queued: '已排队', researching: '研究中', approved: '研究通过', rejected: '研究未确认', failed: '研究失败' };
  return '<div class="meta"><b>' + esc(labels[e.research.status] || e.research.status) + '</b> · ' + esc(e.research.reason || '') + '</div>';
}
async function refreshSlang() {`);
  s = within(s, 'async function refreshSlang()', 'function openSlangModal(', '    renderSlangPanel();', "    renderSlangPanel();\n    document.dispatchEvent(new CustomEvent('bff-slang-results', { detail: { jobs: r.researchJobs || [], entries: r.entries || [] } }));");
  s = once(s, '<td>${meaning}${e.usage ?', '<td>${slangResearchBadge(e)}${meaning}${e.usage ?');
  s = once(s, "  setSlangMsg(r.ok ? `✅ 已送 ${r.count} 条候选到 DSH 深度联网研究，完成后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);", '  setSlangMsg(slangResearchMessage(r), r.ok);');
  s = once(s, "  setSlangMsg(r.ok ? `✅ 已送「${slangEntriesCache.find((x) => x.id === slangModalId)?.content || ''}」到 DSH 深度联网研究，稍后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);", '  setSlangMsg(slangResearchMessage(r), r.ok);');
  s = once(s, "  setSlangMsg(r.ok ? ('✅ 已触发研究 ' + r.count + ' 条') : ('❌ ' + (r.error || '失败')), r.ok);", '  setSlangMsg(slangResearchMessage(r), r.ok);\n  if (r.ok) refreshSlang();');
  return s;
}, '// BigFatFish manual research feedback v1');
change('src/bridge.js', s => within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
  "      } catch { reject(new Error('语料研究失败：' + stage)); }",
  "      } catch (error) { reject(new Error('语料研究失败：' + stage + (/超时|timeout/i.test(String(error?.message)) ? '（等待结果超时）' : ''))); }"), '（等待结果超时）');
change('src/bridge.js', s => {
  s = '// BigFatFish scoped mood v1\n' + s;
  s = once(s, '  bff.research.connect(requestBffLearning, saveSocialV2State);',
    '  bff.research.connect(requestBffLearning, saveSocialV2State);\n  bff.mood.connect(requestBffLearning, saveSocialV2State);');
  return once(s, '            if (!isCurrentSession(key, frame.sessionId)) continue;',
    `            if (!isCurrentSession(key, frame.sessionId)) continue;
            // Only live QQ chat events; learner sessions and replay snapshots never enter mood judging.
            if (currentMode === 'reserved2' && !(social.silentTurns.get(frame.sessionId)?.length)) {
              try { bff.mood.event(key, getSocialV2State(key), frame.event); }
              catch { log('心情事件记录未完成，请检查本机状态文件'); }
            }`);
}, '// BigFatFish scoped mood v1');
change('src/mcp-snowluma-safe.js', s => '// BigFatFish memory metadata v1\n' + once(s,
  "      replaceId: z.string().optional().describe('修正当前真人自己的旧事实ID，替换而不并列保存矛盾事实'),",
  `      factKey: z.string().max(80).optional().describe('对象.方面，不含具体值；同一人的同键事实更新旧状态，拿不准留空'),
      kind: z.enum(['event', 'stable']).optional().describe('event=随时间淡忘的事件；stable=稳定偏好或约定'),
      tags: z.array(z.string().min(1).max(20)).max(8).optional().describe('具体检索词，不另开扩词调用'),
      replaceId: z.string().optional().describe('修正当前真人自己的旧事实ID，替换而不并列保存矛盾事实'),`), '// BigFatFish memory metadata v1');
change('src/snowluma-conn.js', s => {
  s = '// BigFatFish target account discovery v1\n' + s;
  s = once(s, '  const base = String(baseUrl || process.env.SNOWLUMA_HTTP_URL',
    "  // A live backend is not necessarily this bot: multiple logged-in QQ accounts may coexist.\n  const expectedUin = String(cfg?.bigfatfish?.expectedQQ ?? sl.expectedQQ ?? '').trim();\n  const base = String(baseUrl || process.env.SNOWLUMA_HTTP_URL");
  s = once(s, '    for (const entry of readOneBotTokens(home)) {', '    for (const entry of readOneBotTokens(home)) {\n      if (expectedUin && entry.uin !== expectedUin) continue;');
  s = once(s, "    tried.push({ source: c.source, url: c.url, token: c.token ? c.token.slice(0, 4) + '…' : '(空)', ok: r.ok, status: r.status, wording: r.wording });\n    if (r.ok) {",
    `    const identityMatches = !expectedUin || String(r.data?.user_id ?? '') === expectedUin;
    tried.push({ source: c.source, url: c.url, token: c.token ? c.token.slice(0, 4) + '…' : '(空)', ok: r.ok && identityMatches, status: r.status,
      wording: r.ok && !identityMatches ? 'QQ身份与目标账号不符' : r.wording });
    if (r.ok && identityMatches) {`);
  return once(s, "    error: last?.status === 401", "    error: tried.some(item => item.wording === 'QQ身份与目标账号不符') ? '可达的 OneBot 接口不属于目标 QQ，拒绝切换到其他账号。请核对目标账号的独立端口与登录状态。' : last?.status === 401");
}, '// BigFatFish target account discovery v1');
change('src/bridge.js', s => {
  s = "// BigFatFish API pool v1\nimport { ApiPool } from '../../../extensions/bigfatfish/api-pool.mjs';\n" + s;
  s = once(s, '  let dshReady = false;', `  let dshReady = false;
  const apiPool = new ApiPool(ROOT, {
    rpc: (method, args) => api.callUnary(method, args), ready: () => dshReady,
    fallback: () => ({ provider: cfg.dsh.provider, model: cfg.dsh.model, reasoningEffort: cfg.dsh.reasoningEffort }),
    changed: () => { modelSelectionEpoch += 1; }, secret: value => bff.privacy.addSecret(value),
    probe: job => requestBffLearning(job)
  });`);
  s = once(s, '        if (await bff.handle(req, url, readBody, sendJson, {',
    '        if (await apiPool.handle(req, url, readBody, sendJson)) return;\n        if (await bff.handle(req, url, readBody, sendJson, {');
  s = once(s, "        if (req.method === 'GET' && url.pathname === '/api/dsh/model') {", `        if (req.method === 'GET' && url.pathname === '/api/dsh/model') {
          const selected = apiPool.selection();
          if (selected) {
            sendJson({ ...selected, reasoningEffort: selected.reasoningEffort || '', options: selected.reasoningEffort ? [selected.reasoningEffort] : [],
              labels: {}, managedByPool: true, catalogSource: 'pool', globalSideEffect: true }); return;
          }`);
  s = once(s, "        if (req.method === 'POST' && url.pathname === '/api/dsh/effort') {", `        if (req.method === 'POST' && url.pathname === '/api/dsh/effort') {
          if (apiPool.selection()) { sendJson({ ok: false, error: '当前使用 API 池，请到“模型与 API 池”编辑该条目的思考档位' }, 409); return; }`);
  s = once(s, '  async function ensureChatModel(sessionId) {\n    if (modelAppliedSessions.get(sessionId) === modelSelectionEpoch) return \'applied\';',
    `  async function ensureChatModel(sessionId, override) {
    const selected = override || apiPool.selection() || cfg.dsh;
    const stamp = modelSelectionEpoch + ':' + JSON.stringify(selected);
    if (modelAppliedSessions.get(sessionId) === stamp) return 'applied';`);
  s = within(s, '  async function ensureChatModel(', '  async function ensureSession(key)',
    "    const provider = String(cfg.dsh?.provider || 'deepseek-official');\n    const model = String(cfg.dsh?.model || 'deepseek-flash');\n    const effort = String(cfg.dsh?.reasoningEffort || REASONING_EFFORT_DEFAULT);",
    "    const provider = String(selected.provider || 'deepseek-official');\n    const model = String(selected.model || 'deepseek-flash');\n    const effort = selected.reasoningEffort;");
  s = within(s, '  async function ensureChatModel(', '  async function ensureSession(key)',
    'await api.sessions.selectModel({ sessionId, provider, model, reasoningEffort: effort })',
    'await api.sessions.selectModel({ sessionId, provider, model, ...(effort ? { reasoningEffort: effort } : {}) })');
  // Both successful and retired selections record the exact snapshot captured before the request.
  const start = s.indexOf('  async function ensureChatModel('), end = s.indexOf('  async function ensureSession(key)', start);
  let part = s.slice(start, end).replaceAll('modelAppliedSessions.set(sessionId, modelSelectionEpoch)', 'modelAppliedSessions.set(sessionId, stamp)');
  part = once(part, "    return 'failed';", "    if (override || provider.startsWith('qq-pool-')) throw new Error('API 池模型选择失败，已停止本次请求；请检查接口及模型配置');\n    return 'failed';");
  s = s.slice(0, start) + part + s.slice(end);
  s = within(s, '  function requestBffLearning(job)', '  function queueSlangTask(fn)',
    'learnerSessions.add(sessionId); api.events.follow(sessionId); await ensureChatModel(sessionId);',
    "learnerSessions.add(sessionId); api.events.follow(sessionId);\n        if (await ensureChatModel(sessionId, job.modelSelection) !== 'applied') throw new Error('研究模型选择失败');");
  return s;
}, '// BigFatFish API pool v1');
change('public/console.html', s => once(s, '    const parts = [];\n    if (r.providerDefault)', `    // BigFatFish pool effort controls v1
    select.disabled = !!r.managedByPool;
    const effortButton = document.getElementById('dshEffortSave');
    if (effortButton) effortButton.disabled = !!r.managedByPool;
    const parts = [];
    if (r.managedByPool) parts.push('当前接口和思考参数请到“模型与 API 池”管理');
    if (r.providerDefault)`), '// BigFatFish pool effort controls v1');
change('src/bridge.js', s => {
  const imported = "import { ApiPool, inspectApiAccess } from '../../../extensions/bigfatfish/api-pool.mjs';";
  if (!s.includes(imported)) s = once(s, "import { ApiPool } from '../../../extensions/bigfatfish/api-pool.mjs';", imported);
  if (!s.includes('    inspectAccess: entry => inspectApiAccess(entry),')) s = once(s, '    probe: job => requestBffLearning(job)', '    inspectAccess: entry => inspectApiAccess(entry),\n    probe: job => requestBffLearning(job)');
  return '// BigFatFish API access diagnostics v1\n' + s;
}, '// BigFatFish API access diagnostics v1');
change('src/bridge.js', s => {
  s = '// BigFatFish context initiative v1\n' + s;
  s = within(s, '  function evaluateWakeTriggerV2(', '  function evaluateConfiguredWakeTriggerV2(',
    '    if (!decision.handled) return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf);',
    "    if (!decision.handled) return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf) || (bff.contextInitiative.available(key, st) ? 'contextInitiative' : null);");
  s = within(s, '  function evaluateWakeTriggerV2(', '  function evaluateConfiguredWakeTriggerV2(',
    '    return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf, true) || decision.reason;',
    `    return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf, true) || decision.reason
      || (bff.contextInitiative.available(key, st) ? 'contextInitiative' : null);`);
  s = once(s, '  const WAKE_PRIORITY = {', '  const WAKE_PRIORITY = {\n    contextInitiative: -1, // every ordinary reply and bootstrap outranks a speculative share');
  s = within(s, '  async function sendWakePromptV2(', '  function scheduleReplyCheckV2(',
    '    if (isConversationBusyV2(key, st)) {',
    "    if (reason === 'contextInitiative' && (!dshReady || shouldBlockSilentReply(key) || isConversationBusyV2(key, st))) return;\n    if (isConversationBusyV2(key, st)) {");
  s = within(s, '  async function sendWakePromptV2(', '  function scheduleReplyCheckV2(',
    '      let retryAfterMs = 0;', "      if (reason === 'contextInitiative') return; // no late speculative retry\n      let retryAfterMs = 0;");
  s = within(s, '  async function sendWakePromptV2(', '  function scheduleReplyCheckV2(',
    '    // Only a real new wake resets observation;',
    "    if (reason === 'contextInitiative' && !bff.contextInitiative.begin(key, st)) { saveSocialV2State(); return; }\n    // Only a real new wake resets observation;");
  s = once(s, '      const result = await deliverPrompt(key, promptText, { wakeReason: reason });',
    "      const result = await deliverPrompt(key, promptText, { wakeReason: reason, ...(reason === 'contextInitiative' ? { initiativeId: st.bigfatfish.contextInitiative.round.id } : {}) });");
  s = once(s, '  async function deliverPromptNow(key, promptText, opts = {}) {', `  async function deliverPromptNow(key, promptText, opts = {}) {
    if (opts.wakeReason === 'contextInitiative') {
      const pending = getSocialV2State(key), round = pending.bigfatfish.contextInitiative?.round;
      if (!round || round.id !== opts.initiativeId || bff.contextInitiative.gate(key, pending, Date.now(), true))
        return { ok: false, error: '上下文主动机会已取消或过期' };
    }`);
  s = once(s, '      const st = socialV2.conversations.get(key);\n      if (!recipientChecked)',
    "      const st = socialV2.conversations.get(key);\n      if (st?.bigfatfish?.contextInitiative?.round && bff.contextInitiative.gate(key, st, Date.now(), true)) throw new Error('上下文主动机会已失效，不发送旧消息');\n      if (!recipientChecked)");
  return s;
}, '// BigFatFish context initiative v1');
change('src/bridge.js', s => {
  s = '// BigFatFish context initiative v2\n' + s;
  if (!s.includes("!dshReady || shouldBlockSilentReply(key) || isConversationBusyV2(key, st)")) s = once(s,
    "!dshReady || isConversationBusyV2(key, st)", "!dshReady || shouldBlockSilentReply(key) || isConversationBusyV2(key, st)");
  if (!s.includes('no late speculative retry')) s = within(s, '  async function sendWakePromptV2(', '  function scheduleReplyCheckV2(',
    '      let retryAfterMs = 0;', "      if (reason === 'contextInitiative') return; // no late speculative retry\n      let retryAfterMs = 0;");
  if (s.includes('    if (!decision.handled) return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf);')) s = once(s,
    '    if (!decision.handled) return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf);',
    "    if (!decision.handled) return evaluateConfiguredWakeTriggerV2(key, st, event, kind, textContent, plainContent, quoteTargetIsSelf) || (bff.contextInitiative.available(key, st) ? 'contextInitiative' : null);");
  return s;
}, '// BigFatFish context initiative v2');
change('src/bridge.js', s => {
  s = '// BigFatFish context initiative v3\n' + s;
  s = within(s, '  function scheduleWakeV2(key, reason)', '  /**',
    '    const st = getSocialV2State(key);',
    "    const st = getSocialV2State(key);\n    if (reason === 'contextInitiative' && (!dshReady || shouldBlockSilentReply(key) || isConversationBusyV2(key, st))) return;");
  return within(s, '  function replayPendingWakeReasonsV2(key)', '  function setupSleepTimerV2(key)',
    "    if (!item || typeof item !== 'object') continue;",
    "    if (!item || typeof item !== 'object') continue;\n    if (item.reason === 'contextInitiative') continue; // never replay a speculative share after a turn");
}, '// BigFatFish context initiative v3');
change('src/bridge.js', s => '// BigFatFish context initiative v4\n' + once(s,
  '  function acknowledgeMessagesV2(st, throughSeq) {',
  `  function acknowledgeMessagesV2(st, throughSeq) {
    // An old initiative may finish by marking its batch read. Never let it
    // consume a direct question that arrived during generation or tool waits.
    const initiative = st.bigfatfish?.contextInitiative?.round;
    if (initiative) throughSeq = throughSeq === null ? initiative.throughSeq : Math.min(throughSeq, initiative.throughSeq);`), '// BigFatFish context initiative v4');
const expressionPatch = require('./group-style-bridge-patch.cjs');
change('src/slang-learner.js', s => expressionPatch.patchSlang(s, once, within), '// BigFatFish scoped slang v2');
change('src/bridge.js', s => expressionPatch.patchBridge(s, once, within), '// BigFatFish four layer expression v2');
change('src/bridge.js', s => {
  s = '// BigFatFish expression intake permissions v3\n' + s;
  return once(s, "styleSourceVersion: /^-?[1-9]\\d{0,19}$/.test(String(messageId)) ? 2 : 0,", "styleSourceVersion: bff.groupStyle.eligible(key) && /^-?[1-9]\\d{0,19}$/.test(String(messageId)) ? 2 : 0,");
}, '// BigFatFish expression intake permissions v3');
const v3Patch = require('./v3-bridge-patch.cjs');
change('src/slang-learner.js', s => v3Patch.patchSlang(s, once), '// BigFatFish V3 global lexicon');
change('src/bridge.js', s => v3Patch.patchBridge(s, once), '// BigFatFish V3 runtime');
change('src/bridge.js', s => v3Patch.cleanupBridge(s, once), '// BigFatFish V3 retirement');
change('src/bridge.js', s => v3Patch.finalizeBridge(s, once), '// BigFatFish V3 attribution and privacy');
change('src/bridge.js', s => v3Patch.sourceSafety(s, once), '// BigFatFish V3 source and prompt diagnostics');
change('src/slang-learner.js', s => v3Patch.slangPersistence(s, once), '// BigFatFish V3 deletion ledger');
change('src/bridge.js', s => v3Patch.reliability(s, once), '// BigFatFish V3 transport settlement');
change('src/bridge.js', s => v3Patch.sharedRecipient(s, once), '// BigFatFish V3 shared recipient helper');
change('src/bridge.js', s => v3Patch.retireSleep(s, once), '// BigFatFish V3 server managed sleep');
change('src/bridge.js', s => v3Patch.zeroSettings(s, once), '// BigFatFish V3 zero settings');
change('src/mcp-snowluma-safe.js', s => '// BigFatFish V3 wait protocol\n' + s.replace('；沉睡前观察用 messages 并传 300000','；0 表示只检查当前消息，不长轮询'), '// BigFatFish V3 wait protocol');
change('src/bridge.js', s => v3Patch.unknownDelivery(s, once), '// BigFatFish V3 delivery result classification');
change('src/bridge.js', s => v3Patch.replyDiagnostics(s, once), '// BigFatFish confirmed recipient wake diagnostics');
change('src/bridge.js', s => v3Patch.replyLatency(s, once), '// BigFatFish direct reply latency v1');
const consoleTemplate = fs.readFileSync(path.join(root, 'extensions/bigfatfish/console-v3.html'), 'utf8');
const consoleScript = ['console-policy.js','console-memory.js','console-api-pool.js','console-v3.js'].map(name=>fs.readFileSync(path.join(root,'extensions/bigfatfish',name),'utf8')).join('\n');
fs.writeFileSync(path.join(repo, 'public/console.html'), consoleTemplate.replace('<!--V3_SCRIPT-->', () => '<script>\n' + consoleScript + '\n</script>'));
console.log('BigFatFish integration applied (pinned anchors, idempotent).');
