// V4 adds only scheduling/model seams; QQ delivery and trusted role injection stay intact.
exports.patchBridge = (source, once) => {
  source = '// BigFatFish V4 community learning\n' + source;
  source = once(source, "import { ApiPool, inspectApiAccess } from '../../../extensions/bigfatfish/api-pool.mjs';",
    "import { ApiPool, inspectApiAccess } from '../../../extensions/bigfatfish/api-pool.mjs';\nimport { createCommunityModel } from '../../../extensions/bigfatfish/community-model.mjs';");
  source = once(source, '    if (dshReady) void bff.research.tick(bffSlangStore());',
    '    if (dshReady) void bff.research.tick(bffSlangStore());\n    void bff.community.tick();');
  source = once(source, '  bff.research.connect(requestBffLearning, saveSocialV2State);',
    '  bff.research.connect(requestBffLearning, saveSocialV2State);\n  bff.community.connect(createCommunityModel({ pool: apiPool, config: cfg }),\n    () => [...socialV2.conversations].some(([key, st]) => pendingWakeKeys.has(key) || isConversationBusyV2(key, st)));');
  return source;
};
