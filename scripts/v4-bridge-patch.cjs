// V4 adds only scheduling/model seams; QQ delivery and trusted role injection stay intact.
exports.patchBridge = (source, once) => {
  source = '// BigFatFish V4 community learning\n' + source;
  source = once(source, "import { ApiPool, inspectApiAccess } from '../../../extensions/bigfatfish/api-pool.mjs';",
    "import { ApiPool, inspectApiAccess } from '../../../extensions/bigfatfish/api-pool.mjs';\nimport { createCommunityModel } from '../../../extensions/bigfatfish/community-model.mjs';");
  source = once(source, '    if (dshReady) void bff.research.tick(bffSlangStore());',
    '    if (dshReady) void bff.research.tick(bffSlangStore());\n    void bff.community.tick();');
  source = once(source, '    probe: job => requestBffLearning(job)',
    '    probe: job => requestBffLearning(job),\n    communityRoute: () => bff.settings.communityLearning.modelRoute');
  source = once(source, '  bff.research.connect(requestBffLearning, saveSocialV2State);',
    '  bff.research.connect(requestBffLearning, saveSocialV2State);\n  bff.community.connect(createCommunityModel({ pool: apiPool, config: cfg, route: () => bff.settings.communityLearning.modelRoute }),\n    () => [...socialV2.conversations].some(([key, st]) => pendingWakeKeys.has(key) || isConversationBusyV2(key, st)));');
  return source;
};

exports.knowledgeApplication = (source, once) => {
  source = '// BigFatFish V4.1 knowledge application\n' + source;
  source = once(source, '  function bffSlangStore() {', '  function bffSlangStore() {\n    bff.slang.entries = () => cfg.slang?.enabled === false ? [] : slangEntries;');
  const start=source.indexOf('  function withSlangContext('),end=source.indexOf('\n  if (!cfg.allow.private',start);
  if(start<0||end<0)throw Error('Knowledge fusion prompt boundary missing');
  const block=once(source.slice(start,end),'    if (cfg.slang?.enabled !== false) {',"    if (cfg.slang?.enabled !== false && !promptText.includes('【本轮表达参考】')) {");
  source=source.slice(0,start)+block+source.slice(end);
  return once(source, '    if (wakeSnapshot && isCurrentSession(key, sessionId)', '    if (generationId) { bff.styleResolver.injected(generationId); saveSocialV2State(); }\n    if (wakeSnapshot && isCurrentSession(key, sessionId)');
};
