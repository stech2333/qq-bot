# 群聊表达系统开发记录

## 实施前调用关系与兼容决定

- 保留：`PersonaManager` 模板/绑定/签名；桥接 `sessionPolicy`、退役令牌和发送前校验；原收发队列、已读水位、主动额度；事实记忆与心情；`LearningWindow` 有界日志；`LearningResearch` 单并发及持久调用预算；原 `state/slang.json`。
- 重构：学习窗口的群风格来源标记、逐群研究任务、黑话作用域、管理台与可重放补丁脚本。
- 替换：`buildWakePromptV2` 同时调用 `instruction` 和 `responseContext.instruction` 的重复组装。统一由 `style-resolver` 选择场景、可信枚举策略和最多两条已审核经验。
- 废弃生产用途：旧 `GlobalStyle.job/run/hint` 的跨群/私聊融合学习及注入。旧状态只作兼容资料展示，不自动迁移为群风格或全局经验；保留原文件。全局经验改为管理员确认的固定策略枚举。
- 原问题证据：`GlobalStyle.rows` 遍历全部允许会话且 `allowed` 接受 private；单项不要求多发言者；`runtime.instruction` 与 `responseContext` 都调用 `globalStyle.hint`；桥接原 `buildWakePromptV2` 又同时拼接两入口。`conversationMaterial` 和 `formatMemory` 重复召回事实。黑话原按词面 upsert、全局按热度注入，不能隔离同词异义。
- 人格原文保留在 `roles/*.md`。安装的 DSH 的 persona 是 system-prompt section，公开 session.create 并无任意 systemPrompt 字段；不得编造该参数。实施采用实际可用的 session sections 能力或经验证的桥接可信注入，具体结果在交付报告记录。历史压缩由 DSH 管理，本次不修改压缩事件或工具配对。

本次只在全部实现后进行一次全量审查。中途仅做语法和必要的定向验证，不访问真实 QQ/API，不启停生产服务，不推送远程。

## 完成与最终审查

已完成独立存储、证据校验/后台候选、检索与唯一组装、可信人格系统段、原词库范围、管理页和文档。按要求只在全部更改完成后进行了全量审查，之后对发现问题做定向修正与补测。

最终本地319项全部通过，上游35组脚本累计全部通过，MCP和隔离浏览器通过。审查发现及修正、性能实测和人工验收项目见 group-style-report.md。未修改生产名单/凭据/学习状态、未真实发信、未重启任何生产服务、未远程推送。
