import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件位于 <项目>/extensions/bigfatfish/，向上的两级就是项目根。
// 注意：BigFatFish 实例的 this.root 是 **integrations/qq-bridge**（桥接运行目录），
// 不是项目根；两者不能混用，否则插件安装状态会永远读成"未安装"。
export function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
function resolveRoot(root) {
  if (!root) return projectRoot();
  // 传入桥接目录时（basename === 'qq-bridge'）回溯到项目根。
  return path.basename(path.resolve(root)) === 'qq-bridge' ? path.resolve(root, '..', '..') : path.resolve(root);
}

// V4.2 插件整合登记表。
//
// 目的不是"证明插件不好"，而是让"某个功能由谁负责"变成可查询的事实：
//   · 每个候选插件的上游版本、提交、许可证、本机兼容性证据；
//   · 最终选定的主实现（唯一所有权）；
//   · 是否存在重复实现、是否需要补丁；
//   · 回滚方式。
//
// 事实来源（本次真实执行，不是 README 转述）：
//   · 克隆上游到 .tmp/plugin-review/ 并 `git rev-parse HEAD` 取提交；
//   · `node -e "import('./lib/index.js')"` 验证模块能否在本机 Node 24 下导入；
//   · 在上游目录执行 `node --test` 取真实用例数。
// 未做的验证必须在 `unverified` 里写清楚，不能默认写成通过。
export const PLUGIN_REVIEWS = Object.freeze([
  {
    id: 'dsh-fish-memory',
    feature: '长期记忆',
    upstream: 'https://github.com/Yuuyuko-uu/dsh-fish-memory',
    version: '1.4.8',
    commit: 'f2012c27e3df5281457dcc403c31d8f9a8a8ad94',
    license: 'SEE LICENSE IN LICENSE',
    moduleImport: 'ok',
    tests: { run: 123, pass: 122, fail: 0 },
    compatibility: {
      dshVersion: '0.2.1-rc.2',
      injectServices: ['systemPrompt', 'agents', 'timer', 'tools', 'webServer', 'sessions', 'sessionTitle', 'llm'],
      note: '插件用 hostdeps 动态解析宿主 @deepseek-ai/*，不写死版本；导入与自带测试均通过。'
    },
    decision: 'adopted',
    owner: 'DSH 插件 dsh-fish-memory（本项目 memory-*.mjs 降级为只读/迁移兼容）',
    reasons: [
      '三轮评审后按"插件优先"定稿：插件能力完整、有 123 个自带用例、装上即接管每个 DSH 会话；QQ 每个会话本来就是一个 DSH 会话，天然对齐。',
      '本项目同名实现已停用：formatMemory 不再注入【长期事实/阶段摘要】，memory-append/update 直接拒绝写入，工具面 memory 关闭——双注入与双写都已消除。',
      '社区知识、学到的话题、黑话仍由本项目注入：这些插件不覆盖，属于本项目特有资产。',
      '旧数据（social-v2.json 的 facts/archive/deleted）原样保留、只读，供迁移核对与管理端删除，不做破坏性清理。'
    ],
    borrowable: [
      '本项目继续保留：community.sqlite 知识检索、学习话题（learnedInterests）、黑话统一库、管理员删除入口。',
      '未采用其 zstd 会话归档格式。'
    ],
    unverified: ['记忆提取的准确率与 token 成本只能靠长期真机观察；本机已确认插件挂载会话并接收本轮消息，但尚未做质量对比。'],
    rollback: '删掉 profile 里的 link 依赖与 node_modules junction，重启即可：engines.memory 自动回落 local；如需恢复工具，把 socialV2.tools.memory 改回 true。'
  },
  {
    id: 'dsh-feiyu-mood',
    feature: '心情',
    upstream: 'https://github.com/Yuuyuko-uu/dsh-feiyu-mood',
    version: '0.8.3',
    commit: '7e68abb6e8a4c4a1bc39a08edf86ce1dacc24b20',
    license: 'SEE LICENSE IN LICENSE',
    moduleImport: 'ok',
    tests: { run: 49, pass: 49, fail: 0 },
    compatibility: {
      dshVersion: '0.2.1-rc.2',
      storage: '$DSH_HOME/feiyu-mood/state.json',
      note: '每轮用 ctx.llm.stream 判定一次心情（额外模型调用）；按"份"绑定会话；带右下角挂饰与设置页。'
    },
    decision: 'adopted-with-patch',
    owner: 'DSH 插件 dsh-feiyu-mood + extensions/bigfatfish/plugin-mood-feed.mjs（补丁）',
    reasons: [
      '三轮评审后按"插件优先"定稿：插件的判定、衰减、时间线与设置页都比本项目完整，且自带 49 个用例。',
      '本项目 mood.mjs 已停用判定与注入（delegated：active=false、hint 恒空），两段心情不再同时出现。',
      '插件没有"把心情交给接话决策"的接口，这是本项目的特殊需求——用只读镜像补丁补上：每 60s 读 /dsh-feiyu-mood/state，压成一句话注入提示词。',
      '插件默认只有一份全局心情（key=__default__），QQ 多群共用一个角色心情；需要按群隔离时再给插件配 slots，而不该在本地重造一套判定。'
    ],
    borrowable: ['本项目保留：历史心情数据（只读）、/api/bigfatfish/mood 管理入口、mood-budget.json 的历史额度记录。'],
    unverified: ['插件心情在真实群聊里的判定质量与每回合的额外模型成本，需要长期观察；本机已确认状态路由可读、镜像已注入。'],
    rollback: '删掉 profile 里的 link 依赖与 junction，重启即可：engines.mood 自动回落 local，mood.mjs 恢复判定与注入。'
  },
  {
    id: 'dsh-speak-up',
    feature: '主动聊天',
    upstream: 'https://github.com/Yuuyuko-uu/dsh-speak-up',
    version: '0.2.7',
    commit: 'ed80781bd68c851f83ef4f40f9f2b9f2febf55db',
    license: 'SEE LICENSE IN LICENSE',
    moduleImport: 'ok (lib/host.js)',
    tests: { run: 0, pass: 0, fail: 0 },
    compatibility: {
      dshVersion: '0.2.1-rc.2',
      note: '宿主半边自行按间隔掷骰子并启动一轮 DSH turn；与 QQ Bridge 自己的 proactive/replyCheck/contextInitiative 调度器是并列关系。'
    },
    decision: 'rejected',
    owner: 'extensions/bigfatfish/{participation,context-initiative,policies}.mjs + bridge.js scheduleWakeV2',
    reasons: [
      '它本身就是"按间隔掷骰子"的实现，正是 V4.2 要去掉的机械概率机制；采用它会与"由上下文决定是否开口"的目标相反。',
      '它自行创建 DSH 回合，而 QQ 发送必须经过桥接的会话令牌、发送队列、幂等与额度；两个调度器同时为同一事件建回合，违反 2.4 的单一调度入口。',
      '上游自带测试未能在本机自动发现（node --test 收集到 0 个用例），无法作为稳定性证据；相较之下本项目有 606 个用例覆盖调度与发送路径。'
    ],
    borrowable: ['"掷骰子不花模型"的成本意识；本项目已有等价做法（本地判断后再决定是否唤醒模型）。'],
    unverified: ['未安装，未做 A/B。'],
    rollback: '未安装，无需回滚。'
  },
  {
    id: 'dsh-vision',
    feature: '图片理解 / 表情语义',
    upstream: 'https://github.com/sjakdhasdh/dsh-vision',
    version: '0.1.0',
    commit: '285f9ae085bf7fdba0d4b99612b837ce8b0e5b56',
    license: 'MIT',
    moduleImport: 'built (integrations/dsh-plugins/dsh-vision/dist/index.js)',
    tests: { run: 0, pass: 0, fail: 0 },
    compatibility: {
      dshVersion: '0.2.1-rc.2',
      blocking: '上游 manifest 依赖 @deepseek-ai/dsh-tools@0.1.0-rc.6；项目内 integrations/dsh-plugins/ 已用 tsc 构建出 dist，运行时实际解析到本机 0.2.1-rc.2。仍缺 DASHSCOPE_API_KEY，调用时会报「未配置 API Key」。'
    },
    decision: 'rejected',
    owner: 'integrations/qq-bridge/src/{media-normalize.js,sticker-lib.js}',
    reasons: [
      '不可用的原因是**缺 key**：插件已 vendored 且构建好，但没有 DASHSCOPE_API_KEY，装上只会多一个每次调用都失败的工具（正是本项目禁止的"注册了必然失败"的反模式）。',
      '它做的是通用"看图描述"，不是本项目需要的"表情用途/适用与禁用场景/能否单发"语义；本机 STICKER_VISION_PROMPT 已直接要求 visualGrounded、usage、avoidScenes、ambiguity 等字段。',
      '本项目模型通道（config.json 的 deepseek-flash，input 含 image）已能直接识别图片，GIF 也已按 6 帧拼图处理，另装插件是重复链路。'
    ],
    borrowable: ['无（其能力已被本机多模态直连 + 表情语义提示词覆盖）。'],
    unverified: ['未安装，未做 A/B。'],
    rollback: '未安装，无需回滚。'
  }
]);

// 功能所有权：一份功能只能有一个实际生效的主实现。
export const FEATURE_OWNERSHIP = Object.freeze([
  { feature: '长期记忆', owner: 'DSH 插件 dsh-fish-memory（本项目 memory-*.mjs 只读/迁移）', writer: 'single', note: '插件负责提取与注入；本项目不再注入事实/摘要、拒绝 memory-append 写入，工具面 memory 关闭。' },
  { feature: '心情', owner: 'DSH 插件 dsh-feiyu-mood + plugin-mood-feed.mjs（只读镜像补丁）', writer: 'single', note: '本项目 mood.mjs 停用判定与注入；接话决策读插件状态镜像。' },
  { feature: '聊天参与决策', owner: 'extensions/bigfatfish/participation.mjs', writer: 'single', note: '输出 action/reasonCode/contextVersion；bridge 只消费，不再二次抽签。' },
  { feature: '主动唤醒', owner: 'bridge.js scheduleWakeV2 + runtime.proactiveDecision/contextInitiative', writer: 'single', note: '优先级队列统一入口；contextInitiative 只提交候选，不再独立掷骰子。' },
  { feature: '表情库存与选图', owner: 'integrations/qq-bridge/src/sticker-lib.js', writer: 'single', note: '候选排序按场景/语气/用途/最近使用/置信度；QQ 收藏接口只是底层能力。' },
  { feature: '图片与 GIF 理解', owner: 'integrations/qq-bridge/src/{media-normalize.js,mcp-snowluma-safe.js}', writer: 'single', note: '走本机多模态模型，不叠加视觉插件。' },
  { feature: '社区知识与黑话', owner: 'extensions/bigfatfish/{community-*.mjs,slang-manager.mjs}', writer: 'single', note: 'community.sqlite 是唯一知识库；slang 通过 unified 存储接入同一条检索。' },
  { feature: '全局风格', owner: 'extensions/bigfatfish/global-style.mjs', writer: 'single', note: '按验证后的表达经验发布，各群共享，上下文各自隔离。' }
]);

// 插件"一旦启用"会跟哪套自研实现抢同一份数据或同一个调度入口。
//
// 这一节回答的是比"装没装"更关键的问题：**装上去之后会发生什么**。
// 每条都写了证据（插件源码位置）、失效方式、以及"要让插件赢，管理员必须关掉的自研开关"——
// 不新造开关，复用现有配置，避免又长出一层"冲突管理配置"。
export const PLUGIN_CONFLICTS = Object.freeze([
  {
    plugin: 'dsh-fish-memory',
    feature: '长期记忆',
    severity: 'high',
    resolution: 'delegated',
    collidesWith: [
      'extensions/bigfatfish/memory-manager.mjs（写入/纠错/撤销）',
      'qq_memory_append → runtime.handle(/api/socialV2/memory-append)',
      'runtime.formatMemory() 注入的【长期事实】'
    ],
    failureMode: '同一事实两套系统各写一份、各注入一次；删除或纠错只作用于其中一套，模型会看到互相矛盾的记忆，且每次请求多付一份记忆 token。',
    evidence: '插件配置 $DSH_HOME/fish-memory-config.json 的「全局开关」默认就是开（lib/index.js:720 `return c.全局开关 !== false`），安装即接管每个会话；数据在 $DSH_HOME/fish-memory/。',
    localSwitch: '已执行：本项目不再注入事实/摘要、拒绝 memory-append 写入、关闭 memory 工具；旧数据只读保留。'
  },
  {
    plugin: 'dsh-feiyu-mood',
    feature: '心情',
    severity: 'high',
    resolution: 'delegated',
    collidesWith: [
      'extensions/bigfatfish/mood.mjs（状态/衰减/额度）',
      'runtime.instruction() → mood.hint() 注入的【当前会话心情】',
      'mood-budget.json 每日额度'
    ],
    failureMode: '每回合两次心情判断（两次模型调用），两份心情状态互相矛盾，提示词里同时出现两段心情描述。',
    evidence: '插件没有全局开关，安装并加载即通过 agent.ctx.systemPrompt.context 注入（lib/index.js:1505），并在回合内调用 ctx.llm.stream 判定（lib/index.js:1305）；状态在 $DSH_HOME/feiyu-mood/state.json。',
    localSwitch: '已执行：MoodManager.delegated=true → active=false、hint 恒空；插件心情经 plugin-mood-feed 只读镜像进入接话决策。'
  },
  {
    plugin: 'dsh-speak-up',
    feature: '主动聊天',
    severity: 'medium',
    resolution: 'blocked',
    collidesWith: [
      'bridge.js scheduleWakeV2（唯一调度入口）',
      'runtime.proactiveDecision（定时主动）',
      'runtime.contextInitiative（上下文主动）'
    ],
    failureMode: '两个调度器各自为"同一段安静时间"建 DSH 回合，可能同一时刻产生两轮唤醒，并各自认为自己有发送权。',
    evidence: '插件用 ctx.interval 定时掷命中线（lib/host.js:798 起）。默认「总开关=true + 试运行=true」，试运行只记账不发消息，所以默认配置下的冲突是**潜伏**的；把「试运行」关掉才会真的开回合。',
    localSwitch: '未安装：它自行起回合但拿不到 reserved2 的会话令牌，发送必被拒；需要插件先提供唤醒回调/上下文注入扩展点。'
  },
  {
    plugin: 'dsh-vision',
    feature: '图片理解',
    severity: 'low',
    resolution: 'blocked',
    collidesWith: [
      'integrations/qq-bridge/src/media-normalize.js（GIF 多帧/尺寸规整）',
      'mcp-snowluma-safe.js 的 qq_get_message_images 自动多模态'
    ],
    failureMode: '模型多一个看图工具，可能与自动多模态重复识图，白花一次调用；不写共享状态，不会互相覆盖。',
    evidence: '插件只注册工具，不注入 systemPrompt、不写状态；源码已 vendored 到 integrations/dsh-plugins/dsh-vision 并用 tsc 构建出 dist，运行时解析到本机 0.2.1-rc.2。真正的阻塞是没配 DASHSCOPE_API_KEY。',
    localSwitch: '未安装：补一个 DASHSCOPE_API_KEY（.env 或插件配置）后，把 link 依赖与 junction 加上即可；在此之前不要装，否则多一个每次失败的工具。'
  }
]);

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// 真实读取本机 DSH profile，判断插件是否"已安装"。
// 注意：已安装 != 已加载；加载状态只能在 DSH 运行时确认，这里绝不猜。
export function installedPlugins(root) {
  const base = resolveRoot(root);
  const profileDir = path.join(base, 'data-bridge', 'profiles', 'web');
  const pkg = readJson(path.join(profileDir, 'package.json'), {}) || {};
  const deps = { ...(pkg.dependencies || {}) };
  const links = new Set();
  try {
    for (const name of fs.readdirSync(path.join(profileDir, 'node_modules'))) links.add(name);
  } catch { /* 没有 node_modules 就是没装 */ }
  const result = {};
  for (const review of PLUGIN_REVIEWS) {
    const declared = Object.hasOwn(deps, review.id);
    result[review.id] = { installed: declared || links.has(review.id), declaredInProfile: declared, linkedInProfile: links.has(review.id) };
  }
  return result;
}

export function dshHomeFor(root) {
  return process.env.DSH_HOME || path.join(resolveRoot(root), 'data-bridge');
}

// 判断"装上了会不会真的接管"。依据是插件自己的配置默认值，不是我们的猜测：
//   · fish-memory：`全局开关 !== false` 即生效（默认 true）
//   · feiyu-mood：没有全局开关，安装即生效
//   · speak-up：`总开关 !== false` 生效；另有 `试运行` 决定是否真的开回合
//   · vision：纯工具，安装即注册
export function detectPluginRuntime(root, { dshHome } = {}) {
  const base = resolveRoot(root), home = dshHome || dshHomeFor(base);
  const installed = installedPlugins(base);
  const has = id => installed[id]?.installed === true;
  const state = {};

  const fmPath = path.join(home, 'fish-memory-config.json');
  const fm = readJson(fmPath);
  state['dsh-fish-memory'] = {
    installed: has('dsh-fish-memory'), configPath: fmPath, configPresent: fm != null,
    enabled: has('dsh-fish-memory') && (fm ? fm['全局开关'] !== false : true),
    basis: fm ? '读取 fish-memory-config.json 的「全局开关」' : '无配置时插件默认开启（全局开关默认 true）'
  };

  const moodPath = path.join(home, 'feiyu-mood', 'config.json');
  const mood = readJson(moodPath);
  state['dsh-feiyu-mood'] = {
    installed: has('dsh-feiyu-mood'), configPath: moodPath, configPresent: mood != null,
    enabled: has('dsh-feiyu-mood'),
    basis: '插件没有全局开关，安装并加载即接管；config.json 只描述绑定的会话/份'
  };

  const suPath = path.join(home, 'speak-up-config.json');
  const su = readJson(suPath);
  state['dsh-speak-up'] = {
    installed: has('dsh-speak-up'), configPath: suPath, configPresent: su != null,
    enabled: has('dsh-speak-up') && (su ? su['总开关'] !== false : true),
    dryRun: su ? su['试运行'] !== false : true,
    basis: su ? '读取 speak-up-config.json 的「总开关」「试运行」' : '无配置时默认总开关 true、试运行 true'
  };

  state['dsh-vision'] = {
    installed: has('dsh-vision'), enabled: has('dsh-vision'),
    basis: '纯工具插件，没有开关；安装即注册工具'
  };
  return state;
}

export function pluginIntegrationReport(root, options = {}) {
  const base = resolveRoot(root);
  const runtime = detectPluginRuntime(base, options);
  const enabledRules = PLUGIN_CONFLICTS.filter(rule => runtime[rule.plugin]?.enabled === true);
  const describe = rule => ({
    plugin: rule.plugin, feature: rule.feature, severity: rule.severity, resolution: rule.resolution,
    collidesWith: rule.collidesWith, failureMode: rule.failureMode, evidence: rule.evidence, localSwitch: rule.localSwitch,
    // speak-up 的试运行是个关键区别：它只记账，不会真的开回合。
    dryRun: rule.plugin === 'dsh-speak-up' ? runtime[rule.plugin]?.dryRun === true : null,
    status: rule.resolution === 'delegated' ? 'resolved'
      : rule.plugin === 'dsh-speak-up' && runtime[rule.plugin]?.dryRun === true ? 'latent' : 'active'
  });
  // 已经被插件接管的项不算"冲突"，单独列成 delegations：管理端要看到的是"谁在负责"，
  // 而不是一条永远挂着的红色告警。
  const delegations = enabledRules.filter(rule => rule.resolution === 'delegated').map(describe);
  const conflicts = enabledRules.filter(rule => rule.resolution !== 'delegated').map(describe);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    projectRoot: base,
    plugins: PLUGIN_REVIEWS.map(review => ({
      ...review,
      installed: runtime[review.id]?.installed === true,
      enabled: runtime[review.id]?.enabled === true,
      runtime: runtime[review.id] || null,
      loaded: 'unverified',
      loadedNote: runtime[review.id]?.installed
        ? '已安装；是否加载需以 DSH 启动日志为准，接口不猜测。'
        : '未安装。'
    })),
    conflicts,
    conflictCount: conflicts.length,
    delegations,
    delegationCount: delegations.length,
    ownership: FEATURE_OWNERSHIP,
    duplicates: [
      { area: '长期记忆写入', detail: 'V4.2 已删除：上游 /api/socialV2/memory-* 四路由与 appendMemoryV2 此前是死代码（bff.handle 先行拦截），现已整段移除并留补丁步骤。' },
      { area: '闲聊设置', detail: 'config.json 的 social.*（V1）无任何读取点；启动时会备份为 config.json.pre-v3.bak 并从磁盘移除。' }
    ]
  };
}
