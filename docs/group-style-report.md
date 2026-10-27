# BigFatFish 群聊风格重构技术报告

日期：2026-10-27。范围：本地源码实现与隔离验收，不部署、不发送真实 QQ、不调用付费模型、不推送 GitHub。

## 原问题与代码证据

1. 原 `global-style.mjs::rows/allowed` 遍历允许的 group 和 private，按全局融合；单项来源只检查日期，允许单一发言者建立整个角色的风格。本次移除这条生产学习链路。
2. 原 `runtime.mjs::instruction`、`responseContext` 都调用 `globalStyle.hint`；原 `bridge.js::buildWakePromptV2` 又同时拼接两者。正式模式下 instruction 内部也调用 responseContext，进一步叠加日常要求。
3. 原 `conversationMaterial` 与 `formatMemory` 各召回相同长期事实。现在事实仅在统一组装时提供一次；状态工具不重复返回整段提示。
4. 原角色卡在 `sessionRoleLine` 生成，按次放入用户角色唤醒内容。管理员正文保留，但实际模型投递改用会话系统段。
5. 原黑话按 content 单键合并，所有会话按热度取得相同词义；虽然隐藏 evidence，meaning/usage 本身仍可能包含群内文化。现在按 scope+content 保存，所有会话读出口先过滤范围。
6. 旧 `MemoryManager.bind` 删除的是遗留会话 style 字段，现有长期事实、心情、话题仍有独立语义。本次新的群风格独立持久化，不再混入 facts。

## 实际架构与接入证据

| 层 | 实现 | 数据/信任边界 |
| --- | --- | --- |
| L0 | PersonaManager + qq-persona 预设系统段 | 模板原文、管理员绑定、persona-v3 签名；聊天不能修改 |
| L1 | GlobalStyle 管理员发布的闭合策略枚举 | global-expressions.json；不自动晋升或复制跨群原句 |
| L2 | GroupStyle + StyleLearning | 每群哈希文件、来源、候选、审核、版本、墓碑、锁定 |
| L3 | StyleResolver + ExpressionRetrieval | 作用域先过滤、场景和动作约束、本地排序、最多两条 |

真实链路为：`handleIncoming → appendSocialV2Message` 标注来源，`LearningWindow → LearningResearch.jobs/run → StyleLearning` 生成候选；管理员 `group-style` 接口审核；`buildWakePromptV2 → bff.instruction → StyleResolver.assemble` 进入正常与主动回复；`deliverPromptNow` 发布可信人格快照，现有 `qq-tool-restrict` 加载系统段并从用户投递中移除卡片；`bff.sent` 记录经验的有效使用。

安装的 DSH `sessions.create` 公共契约只接受 workspaceId/cwd/sessionId/agentPreset，没有任意 systemPrompt 参数。实际使用 `SystemPrompt.section({text(context), interpolate:false})` 与 `context.agent.id`，在既有预设作用域贡献人格。历史压缩仍由 DSH 的完整事件/替换消息机制处理；本次未截断工具 JSON、修改压缩器或新建机器人框架。

## 学习、检索与隔离

每群默认20条、3天、2名真人，单项至少3条、3天、2人；可逐群配置。相同正文去重、每人每分钟一条、每天12条；模型最多看到48条按日期和发言者平衡的本群材料，语料不足不请求。保持真实引用目标和相邻序号，但不猜一问一答。

模型只返回闭合 Schema。来源必须属于本轮提供的本群消息；支持分结合来源数、人数和日期计算，明确不是校准概率。经验保存场景、行为、结构、策略、适用和不适用条件、匿名来源、状态和最近使用时间。自动结果不直接发布。

检索依据场景标签、适用条件、表达动作、结构、支持分及近期使用，属于首版轻量词法/规则检索，没有向量库或本地模型。先范围和状态过滤，才排序；没有相关经验时返回空。不同动作保证多样性，连续两次同经验后暂避。正式帮助排除闲聊语气和简短目标。后续可在同一检索接口增加中文分词/BM25或可选 embedding，不要求新的存储基础设施。

原黑话词库继续保存。自动研究按单群计数、取样和释义，scope+content 支持同词异义；public 由管理员显式发布，shared 只用于逐群确认的列表；legacy 保留但不注入。手工研究按作用域分批，同词不放同一批，范围/版本变化后旧结果不得覆盖。

## 持久化、迁移与回滚

- 新群风格目录位于桥接原 ROOT 的 `state/group-styles/`；通用经验在 `state/global-expressions.json`；人格系统快照在 `state/persona-prompts/`。文件名为校验后 scope/sessionId 的哈希。
- 原子临时文件重命名，成功后才切换内存。损坏状态报错并禁止覆盖；管理员操作校验 revision。后台提交重查允许名单、积累开关、群学习开关、策略、revision、generation、语料正文和时间。
- 清空清除群风格内容及历史，保留截止时间和新 generation；旧任务和旧消息不能重建。删除保留墓碑，回滚不能复活删除项。最多20版历史不包括消息游标或发送账本。
- 原 global-style.json 原样保留，作为原始备份与兼容资料，不转换成任何群的成果。新风格仅使用新验证入站来源；旧日志仍可供原话题功能使用，不伪造 styleSourceVersion。
- 不保存 API 密钥，不复制聊天流水入群风格。共用学习日志默认30天、10000条；来源到期或撤销授权后自动经验失效。启用会话的维护轮次会压缩过期原始日志；停用群的日志不再读取用于学习，磁盘旧文件不会因本次迁移自动删除，可由管理员在原学习日志目录归档或删除，重新启用时会按窗口过滤。清空风格不连带清空原事实或共享日志。

## 管理界面

新增同一控制台的“群聊风格学习”：选择已启用群；查看样本、人数/日期/本地统计、候选及有效特征、经验、匿名证据与按需查看本群来源原文、审核状态；独立学习/应用开关；整体或单项锁定；人工指定特征及编辑经验；审核/拒绝/删除；历史回滚；清空；只读模拟检索；最近提示诊断；原词库范围确认。

“通用表达经验”替换旧统一融合学习页面，只允许管理员从可信策略中确认发布。继续支持全局分条偏好。管理接口沿用原控制台鉴权与 Origin 检查，显式拒绝 x-agent-token/x-agent-call；动态页面全部使用 textContent/文本节点，静态页面结构不插入学习文本。

## 提示词与人格安全

resolver 是唯一表达组装入口。人格原文只有系统段为实际模型提供，群资料是低信任枚举 JSON；用户聊天和模型自由文本不能升级为系统指令。事实仅在 memory 部分出现一次，群风格和通用策略只在一个表达资料段内。responseContext 只提供最新模式、场景、版本及经验 ID，不重发风格。诊断标明每段字符数、重复标记、版本、经验 ID 和人格签名；token 未取得时为 null。

人格变更继续触发旧 DSH 会话退役、令牌撤销、发送前 sessionPolicy 校验；本次没有另开队列、改变已读水位或发送重试语义。关闭本群风格应用只停止其注入，不清队列、不影响别群或事实记忆。

## 文件变更与验证

新增 group-style、style-learning、expression-memory、expression-retrieval、style-resolver 及对应隔离测试、group-style-console、DSH qq-persona 插件、可重放桥接补丁与隔离浏览器验证脚本。修改 runtime、global-style/console、learning-window/research、slang-manager、manual-slang-research、persona-manager、原控制台、桥接及 slang-learner、既有预设工具守卫、README 与规划文档。未删除人格、事实、词库或生产状态文件。

最终全量审查在全部工程实现后执行一次；随后只修正发现的问题并补测相关路径。审查修复包括：候选替换期间保持已审核特征；学习关闭时不标注新证据；去重抑制随成功轮次恢复；人工黑话范围变更失效旧研究；来源查看保持管理端独占；策略拒绝未知字段；明确求助优先于结束语。

| 验证 | 结果 | 日志 |
| --- | --- | --- |
| 全部本地 Node 测试 `node --test extensions/bigfatfish/*.test.mjs` | 319 / 319 通过，0跳过 | `logs/group-style-all-final.log` |
| 上游隔离审计 `scripts/test-audit.mjs` | 35 / 35 脚本累计通过：首轮27通过，其余8组修正/解除沙箱限制后逐项补测通过 | `logs/audit/upstream.log`、`logs/group-style-upstream-retest.json` |
| MCP stdio 接入 | 全部三个受限服务通过；仅工具清单测试，未发送QQ | `logs/audit/mcp-stdio.log` |
| 隔离浏览器管理页 | 审核发布、开关应用、换群、检索预览、安全转义通过；全部数据虚拟，页面请求在内存中路由 | `logs/group-style-ui.log` |
| 桥接补丁幂等重放 | 虚拟文件两次应用结果完全一致，不写生产状态 | 本地319项测试中的 `style-patch.test.mjs` |
| 语法与差异空白 | Node语法检查及 `git diff --check` 通过 | 本地检查 |

沙箱初次阻止了临时目录原子重命名、本地回环连接和目录链接，日志保留原失败。临时目录改为工作区后，本地测试通过；仅8组隔离上游脚本获得运行权限后补测，测试仍未接触真实QQ/API或生产配置。没有将初次失败的原始审计 summary 改写成成功。

性能夹具包含100条经验及24条来源，1000次本地解析共3330.83毫秒，均值约3.33毫秒/次（本次机器及并行测试条件）；不含模型、网关或真实首答，不能据此声称端到端改善。真实token和API费用均未测量。管理页截图为 `output/group-style-console.png`。

## 人工验收与后续扩展

管理员需在维护时段同时重载 DSH 与桥接才能使用新增系统段；本次未重启服务。旧黑话范围需管理员确认，新群风格和通用经验也需审核后发布，无需修改真实名单或密钥。实际 QQ 收发、重连、真实 API Schema 遵从率、端到端首答延迟与 token/费用未测量，不能据本地计时声称收益。

后续可在现有经验 ID 上追加明确引用/回复和管理员好坏标记，不把相邻消息或无人回复当反馈；可以扩展词法检索与可选 embedding、独立经验失效策略和事实记忆共享的来源删除通知。首版不自动训练、不自动跨群晋升、不新增模型调用作在线场景判断。

## 完整文件清单

新增文件：

- `docs/group-style-development.md`
- `docs/group-style-report.md`
- `extensions/bigfatfish/expression-memory.mjs`
- `extensions/bigfatfish/expression-retrieval.mjs`
- `extensions/bigfatfish/group-style-console.js`
- `extensions/bigfatfish/group-style.mjs`
- `extensions/bigfatfish/group-style.test.mjs`
- `extensions/bigfatfish/style-bridge.test.mjs`
- `extensions/bigfatfish/style-learning.mjs`
- `extensions/bigfatfish/style-learning.test.mjs`
- `extensions/bigfatfish/style-patch.test.mjs`
- `extensions/bigfatfish/style-resolver.mjs`
- `extensions/bigfatfish/style-resolver.test.mjs`
- `extensions/bigfatfish/style-test-fixture.mjs`
- `integrations/qq-bridge/plugins/qq-agent-presets/qq-persona.mjs`
- `scripts/group-style-bridge-patch.cjs`
- `scripts/retest-group-style-upstream.cjs`
- `scripts/test-group-style-ui.cjs`

修改文件：

- `AUDIT.md`
- `README.md`
- `docs/optimization-plan.md`
- `extensions/bigfatfish/GLOBAL_STYLE.md`
- `extensions/bigfatfish/console.js`
- `extensions/bigfatfish/directed-chat.test.mjs`
- `extensions/bigfatfish/formal-reply.test.mjs`
- `extensions/bigfatfish/global-style-console.js`
- `extensions/bigfatfish/global-style.mjs`
- `extensions/bigfatfish/global-style.test.mjs`
- `extensions/bigfatfish/learning-research.mjs`
- `extensions/bigfatfish/learning-research.test.mjs`
- `extensions/bigfatfish/learning-window.mjs`
- `extensions/bigfatfish/manual-slang-research.mjs`
- `extensions/bigfatfish/manual-slang-research.test.mjs`
- `extensions/bigfatfish/memory-manager.test.mjs`
- `extensions/bigfatfish/persona-manager.mjs`
- `extensions/bigfatfish/runtime.mjs`
- `extensions/bigfatfish/runtime.test.mjs`
- `extensions/bigfatfish/slang-candidate.test.mjs`
- `extensions/bigfatfish/slang-manager.mjs`
- `extensions/bigfatfish/slang-manager.test.mjs`
- `integrations/qq-bridge/plugins/qq-agent-presets/qq-tool-restrict.mjs`
- `integrations/qq-bridge/public/console.html`
- `integrations/qq-bridge/scripts/test-slang-learn.mjs`
- `integrations/qq-bridge/src/bridge.js`
- `integrations/qq-bridge/src/slang-learner.js`
- `scripts/apply-bridge-extension.cjs`

删除文件：无。
