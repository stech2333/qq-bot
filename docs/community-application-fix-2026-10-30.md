# 社区知识与 QQ 聊天应用修复报告

2026-10-30，实际运行实例复核时间为北京时间 14:50。检查范围仅社区知识检索、表达选择、Prompt 组装和管理员诊断。

## 1. 实际数据库状态

权威存储仍分别为 `integrations/qq-bridge/state/slang.json`、`global-style-v3.json` 和 `community.sqlite`。

|系统|实际状态|
|---|---|
|原生黑话|正式确认 1 条，不包含社区 slang|
|全局风格|version 0；published 0；features 0；expressionExamples 0|
|社区正式发布|160 条|
|knowledge / slang / meme / culture / strategy|91 / 48 / 8 / 11 / 2|
|待验证候选 pending|803 条，来自 candidates 表，不计入正式知识|
|已撤销 revoked|1 条，来自 knowledge 表，不可检索|
|当前有效来源|11 个；逐条知识检查当前许可及有效证据后，可用 160 条|

真实群会话 `group:887421353`：会话许可有效，`applyKnowledge=true`，可检索 160 条。`enabled=true` 是现场原值，未更改。停止继续学习与停止应用知识分别控制；测试证明 `enabled=false` 仍可使用已经发布且许可有效的知识。

原生黑话目前为 1，不追溯推断用户先前截图时的数值。

## 2. 问题根因与分类

1. **统计口径错误，已确认。** 原有 `expressionIds` 只包含全局风格表达，不能证明社区库为空。`contextual` 是本轮选中的表达，也不是库的总量。机器人据此声称“社区没保存”“还没发布”“需要重启”没有证据。
2. **正常未发布。** 全局风格版本为 0、其表达为空是该系统的真实状态，不影响社区知识应用。803 条社区候选仍须验证，本次不强制发布。
3. **真实检索漏项，已确认。** 对所有正式词条复核原 FTS 候选查询，发现“牢”“996”“007”没有进入候选。“牢”还被旧别名规则排除。现在对正式词条增加独立精确匹配，单字中文仍要求词边界或明确词义询问。
4. **场景不匹配。** 普通游戏句子未选中“斩杀线”；保留原有置信度、语境交集、冲突、许可、防重复及严肃语境规则，没有为了覆盖该案例放宽过滤。真实库中的“地球ol”和“地球online”属于同一表达概念，已补别名去重，避免同轮重复推荐。
5. **数据库异常被静默吞掉，代码缺陷已确认。** 旧 `retrieve()` 将打开及查询错误一律变为 `[]`。现场库没有发生此类错误；故障注入测试验证了修复后的区分能力。
6. **Prompt 注入失败，现场未证实。** 不能以检索非空推断发送成功。新增组装、最终请求内容、DSH 接受及发送文字观察四阶段诊断。修复了在覆盖 memory 时仍将旧选择记为注入的诊断问题；最终请求缺少资料时明确标记不一致。

## 3. 修复文件

|文件|本次修改原因|
|---|---|
|`extensions/bigfatfish/community-store.mjs`|只读打开模式、真实应用统计、许可/有效证据过滤诊断、精确词条兜底；聊天检索不再清理过期来源或修改学习检查点|
|`extensions/bigfatfish/community-learning.mjs`|独立聊天只读连接；检索原因与限频日志；现有社区管理员 API 增加 diagnostics 视图，保持学习启停与应用独立|
|`extensions/bigfatfish/community-retrieval.mjs`|单字词边界、地球 online/ol 别名去重|
|`extensions/bigfatfish/expression-retrieval.mjs`|传递真实会话 key，记录表达检索诊断，保留表达保护|
|`extensions/bigfatfish/runtime.mjs`|传递解释检索诊断；可信行为指令明确禁止从本轮空数组推断数据库总量或猜测保存失败|
|`extensions/bigfatfish/style-resolver.mjs`|区分全局表达、社区检索、contextual、组装、实际注入及已发送文字中的词条出现；校验实际请求内容|
|`extensions/bigfatfish/learning-journal.mjs`|日志只接受检索模式、reasonCode、候选/有效/来源过滤数量及数据库错误标记，不写聊天、知识正文或 Prompt|
|`integrations/qq-bridge/src/bridge.js`|在 `api.sessions.prompt()` 前核对最终内容；接受成功后沿用注入结算|
|`scripts/v4-bridge-patch.cjs`、`scripts/apply-bridge-extension.cjs`|保证新装及已有桥接的补丁重放均保留请求核验|
|`extensions/bigfatfish/community-application.test.mjs`|新增应用链路、错误诊断、最终请求与统计回归测试|
|`scripts/diagnose-community-chat.mjs`|可复跑的真实数据库快照及离线聊天预览，不调用模型或发送 QQ|

只读管理诊断：

```text
GET /api/bigfatfish/community?view=diagnostics&key=group:887421353
```

沿用管理令牌及现有授权；群聊 agent 无权访问。返回原生黑话、全局风格、社区发布/可用状态及最后一轮诊断，统计不逐轮注入模型。

检索原因包括 `DATABASE_MISSING`、`DATABASE_OPEN_FAILED`、`DATABASE_QUERY_FAILED`、`NO_PUBLISHED_KNOWLEDGE`、`ALL_SOURCES_UNUSABLE`、`NO_VALID_KNOWLEDGE`、`SESSION_NOT_ALLOWED`、`APPLICATION_DISABLED`、`NO_MATCH`、`SCENE_SUPPRESSED` 和 `MATCHED`。正常无匹配的 `databaseError=false`；数据库异常明确为 true，仍允许普通聊天继续。

## 4. QQ 聊天验收

以下均为**离线检索与 Prompt 预览**，使用实际生产 SQLite 的只读一致性快照及当前角色文本。没有伪造生产 QQ 消息。

|类别|输入|实际结果|
|---|---|---|
|显式解释|“耍起是什么意思？”|原条目存在、来源有效、检索命中，meaning 和 usage 进入 Prompt|
|显式解释|“签名档是什么意思？”|原条目存在、来源有效、检索命中，资料进入 Prompt|
|主动表达|“哈哈，现实生活的难度又升级了，像在打游戏副本”|未直接说词条；contextual 选中真实 slang“地球ol”，与“地球online”按别名去重，进入 Prompt|
|保留未命中|“对面残血了，队友这波技能应该能直接秒杀，哈哈”|未主动选中“斩杀线”；未降低语境过滤门槛|
|严肃问题|“请帮我准确解释数据库事务失败时如何恢复数据，别玩梗”|contextual 0，无强制玩梗|

样本覆盖 knowledge 2/91、slang 2/48、meme 2/8、culture 2/11，8 个词条的相应概念资料均进入 Prompt。部分重复记录被同词/别名去重：概念召回不等于所有同词记录 ID 都同时注入。全部 158 条非 strategy 记录的精确询问均可返回对应概念；各记录 ID 是否选中在 JSON 中单独记录。

**桥接请求验收：** 测试运行真实桥接组装代码，在隔离环境中捕获替代 DSH 的 `api.sessions.prompt()` 参数，确认 contextual 的 id、term、meaning、usage 完整进入请求，接受后注入计数为 1，没有调用真实 QQ 发送接口。

**真实模型与实际 QQ：** 本次真实模型调用 0，实际 QQ 测试发送 0。因此模型实际采用、语义正确性及自然度均标记未核验；不以字面出现率代替语义判断。

## 5. 定向测试与实例生效

最终执行 9 个相关测试文件，共 **103/103 通过**，无跳过；未运行全量测试。覆盖原生/社区统计分离、风格 v0、学习停止、应用关闭、来源禁用与到期、知识到期和撤销、精确及中文语境检索、contextual、严肃保护、数据库故障、正常无匹配、最终请求、分群冷却及恢复、原聊天与费用保护。`git diff --check`、桥接和补丁脚本语法检查通过。

首次在 Windows 沙箱默认临时目录执行时出现文件替换/清理权限错误；改用项目内 `.tmp/community-test-temp` 后原样重跑，最终全部通过。未以放宽断言消除失败。

通过现有管理器仅重载桥接服务，原 PID 18776 → 新 PID 10628。重载前确认没有在途学习、已允许会话未读为 0；31 条历史未读属于不在允许列表或被禁群，没有读取或清理。服务已恢复 `dshReady=true`、`mode=reserved2`、`socialV2Paused=false`。新管理员诊断返回社区 160 条可检索，来源有效 11 个。

没有修改人格卡、采集实现、正式知识、许可、候选状态、验证门槛或学习启停配置。原生黑话、全局风格、当前角色及学习设置文件在验收和重载前后的 SHA-256 均保持一致；未执行知识库清空、迁移、重建或将社区 slang 写入原生词库。

原始结果保存在本机：

- `.tmp/community-application-20261030/results.json`：真实源过滤、全部精确查询、样本及逐轮诊断。
- `.tmp/community-application-20261030/report.md`：离线验收表。
- `.tmp/community-application-20261030/tests.txt`：最终 103 项测试输出。
- `.tmp/community-application-20261030/live-status.json`：新实例诊断与就绪状态。

复跑离线预览：`node scripts/diagnose-community-chat.mjs --output=.tmp/community-application-recheck`。
