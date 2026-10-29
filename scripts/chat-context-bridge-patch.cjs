const changes = [
  ["import { createCommunityModel } from '../../../extensions/bigfatfish/community-model.mjs';", "import { createCommunityModel } from '../../../extensions/bigfatfish/community-model.mjs';\n// BigFatFish chat context renewal v1\nimport { contextHead, contextPolicy, needsContextRenewal } from '../../../extensions/bigfatfish/chat-context-budget.mjs';"],
  ["  const nominalModel = () => cfg.dsh?.model || 'deepseek-flash';", `  const nominalModel = () => cfg.dsh?.model || 'deepseek-flash';
  function chatContextState(sessionId) {
    const entry=apiPool.state.entries.find(e=>e.id===apiPool.state.activeId),policy=contextPolicy(entry||cfg.dsh);
    const head=state.contextHeads?.[sessionId];return {...policy,tokens:head?.tokens??null,needsRenewal:needsContextRenewal(head,policy)};
  }
  function recordChatContext(sessionId,event,persist=true) {
    if(!reverse.has(sessionId))return false;
    if(!state.contextHeads||typeof state.contextHeads!=='object'||Array.isArray(state.contextHeads))state.contextHeads={};
    const previous=state.contextHeads[sessionId],head=contextHead(event,previous);if(head===previous)return false;
    state.contextHeads[sessionId]=head;
    for(const id of Object.keys(state.contextHeads))if(!Object.values(state.sessions).includes(id))delete state.contextHeads[id];
    if(persist)saveState();return true;
  }`],
  ["      if (event?.type === 'model/selection') rememberModel(sessionId, event.data);", "      recordChatContext(sessionId,event);\n      if (event?.type === 'model/selection') rememberModel(sessionId, event.data);"],
  ['      if (!snapshot) return;', `      if (!snapshot) return;
      let contextChanged=false;for(const entry of snapshot.records||[]){const event=entry?.type==='event'?entry.event:entry;contextChanged=recordChatContext(sessionId,event,false)||contextChanged;}if(contextChanged)saveState();`],
  ['    reverse.delete(sessionId);\n    collectors.delete(sessionId);', '    if(state.contextHeads)delete state.contextHeads[sessionId];\n    reverse.delete(sessionId);\n    collectors.delete(sessionId);'],
  ['    const existing = state.sessions[key];\n    if (existing) {', `    const current=state.sessions[key];
    if(current&&chatContextState(current).needsRenewal&&!v2TurnStartAt.has(current)) {
      const context=chatContextState(current);retireSession(key);
      appendActivity(key+' 上下文已接近窗口，轮换模型会话并保留群消息、长期记忆和知识（'+context.tokens+'/'+context.window+' Token）');
    }
    const existing = state.sessions[key];
    if (existing) {`],
  ["            list.push({ key, sessionId, owner: key === `private:${String(cfg.ownerQQ ?? '')}` });", "            list.push({ key, sessionId, owner: key === `private:${String(cfg.ownerQQ ?? '')}`, context:chatContextState(sessionId) });"],
  ["          if (!key || !state.sessions[key]) { sendJson({ ok: false, error: '会话不存在' }, 404); return; }\n          sessionEpoch++;", `          if (!key || !state.sessions[key]) { sendJson({ ok: false, error: '会话不存在' }, 404); return; }
          if(body.preserveConversation===true) {
            if(!dshReady||!isSessionAllowedInCurrentMode(key)||!modePreset(key,currentMode,cfg)){sendJson({ok:false,error:'桥接模式或模型入口尚未就绪，请稍后重试'},409);return;}
            if(body.expectedSessionId&&body.expectedSessionId!==state.sessions[key]){sendJson({ok:false,error:'会话已变化，请刷新后重试'},409);return;}
            if(isConversationBusyV2(key,getSocialV2State(key))){sendJson({ok:false,error:'当前会话仍在处理消息，请稍后重试'},409);return;}
            const archived=state.sessions[key];retireSession(key);const sessionId=await ensureSession(key);
            sendJson({ok:true,key,archived,sessionId,preservedConversation:true});return;
          }
          sessionEpoch++;`],
  ['              if (!deliveryRecoveryHandled && pendingWakeKeys.has(key)) {', `              if(ended.reason.kind!=='completed') {
                pendingWakeKeys.delete(key);disarmPendingWakeLease(key);
                wakeConfigUpdatedKeys.delete(key);markReadCalledKeys.delete(key);wakeConfigMissCount.delete(key);
                appendActivity(key+' 回合未完成（'+ended.reason.kind+'），保留待答消息，不向失败会话追加收尾提醒');
              }
              if (!deliveryRecoveryHandled && pendingWakeKeys.has(key)) {`]
];
exports.patchBridge=(source,once)=>{for(const [before,after] of changes)source=once(source,before,after);return source;};
exports.unpatchBridge=source=>{for(const [before,after] of [...changes].reverse())source=source.replace(after,before);return source;};
