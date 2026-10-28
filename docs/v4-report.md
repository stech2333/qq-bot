# BigFatFish V4 最终交付报告

日期：2026-10-28。工作分支：`codex/v4-community-learning`。基线：`5e6a4210443562c921249c11e18683c51955db48`（已同步GitHub最新main）。

## 1. 完成范围

新增管理员可控的社区学习调度、授权JSON/Feed统一只读适配器、隔离DeepSeek调用、SQLite/FTS5知识库、预算预留/实际usage结算、证据验证与事务发布、知识撤销及本地RAG，并整合现有记忆管理页。

修复正式风格和黑话随短期样本过期失效、来源删除误清无关记忆、私聊窗口无法保存、提及机器人但明确找其他人时的强制应答识别。

复用现有MemoryManager、MemoryRecall、GlobalStyle、SlangManager、StyleResolver、API池元数据、safe-fetch和控制台鉴权；保留SnowLuma/OneBot、DSH、reserved2、会话隔离、人格系统、心情、参与策略、发送权限/白名单、DeliveryLedger和普通聊天Token账本。未重构机器人框架，未引入本地模型或向量服务。

平台直接登录采集、真实DeepSeek联调与真实QQ运行没有执行；没有任何平台被宣称实际接通。复杂事件图谱/Embedding非本次核心必要修改，未实施。

## 2. 文件与原因

共35个文件：18个新增、17个修改，删除0个；没有新增npm依赖。完整清单如下（路径相对仓库根目录）：

| 状态 | 文件 | 必要原因 |
|---|---|---|
| 新增 | `extensions/bigfatfish/community-adapters.mjs` | 五个平台的统一授权文件/Feed只读入口、格式及来源许可检查。 |
| 新增 | `extensions/bigfatfish/community-store.mjs` | SQLite/FTS5 Schema、事务、指纹、证据、版本、撤销、备份和预算。 |
| 新增 | `extensions/bigfatfish/community-model.mjs` | 无QQ工具/历史的隔离DeepSeek调用及API池元数据复用。 |
| 新增 | `extensions/bigfatfish/community-learning.mjs` | 调度、状态版本/代际、取消、低Token批处理及知识验证。 |
| 新增 | `extensions/bigfatfish/console-community.js` | 在既有记忆页内管理社区学习，包含手机布局约束。 |
| 新增 | `extensions/bigfatfish/memory-sources.mjs` | 按真实来源依赖清理记忆，保留独立来源和无关数据。 |
| 新增 | `extensions/bigfatfish/community-test-fixture.mjs` | 自有合成材料与模型模拟，统一隔离测试资源回收。 |
| 新增 | `extensions/bigfatfish/community-learning.test.mjs` | 27项社区授权、预算、撤销、恢复、事务、检索及隔离用例。 |
| 新增 | `extensions/bigfatfish/community-controls.test.mjs` | 12项开始/停止、启动条件、实时用量、日志持久化、流式解析、凭据复用和v1→v2迁移回归。 |
| 新增 | `extensions/bigfatfish/community-bridge.test.mjs` | 2项真实管理HTTP权限和可复现补丁/导航契约测试。 |
| 新增 | `extensions/bigfatfish/v4-memory.test.mjs` | 9项跨会话隔离、多义词、时间、精确删除、正式成果寿命及参与判断回归。 |
| 新增 | `scripts/v4-bridge-patch.cjs` | 保存最小桥接接入的可复现生成步骤。 |
| 新增 | `scripts/check-community-ui.cjs` | 离线桌面/手机控件、配置写入、六入口和溢出验收。 |
| 新增 | `scripts/measure-v4.mjs` | 合成负载下的真实本地检索时间及提示字符测量。 |
| 新增 | `scripts/verify-v4.mjs` | 最终统一验收编排，使用明确的测试临时目录和DSH模块路径。 |
| 新增 | `docs/v4-development.md` | 使用、配置、迁移、恢复、架构与限制说明。 |
| 新增 | `docs/v4-platform-references.md` | 六个参考仓库的功能、许可、推送时间及接入限制核对。 |
| 新增 | `docs/v4-report.md` | 本报告。 |
| 修改 | `extensions/bigfatfish/runtime.mjs` | 社区设置/API/检索接入、来源精确失效、来源时间和派生数据出处。 |
| 修改 | `extensions/bigfatfish/global-style.mjs` | 正式风格与短期学习窗口的生命周期解耦。 |
| 修改 | `extensions/bigfatfish/learning-sources.mjs` | 已发布风格的来源保留证明与删除墓碑检查。 |
| 修改 | `extensions/bigfatfish/learning-window.mjs` | 允许合法私聊独立窗口，强化来源删除参数检查。 |
| 修改 | `extensions/bigfatfish/slang-manager.mjs` | 正式黑话按保留来源/墓碑校验，不随采样窗口过期。 |
| 修改 | `extensions/bigfatfish/memory-manager.mjs` | 来源删除的局部墓碑接口，不连带清空无关摘要/版本。 |
| 修改 | `extensions/bigfatfish/memory-recall.mjs` | 相对日期路由、事件时间过滤、来源时间输出。 |
| 修改 | `extensions/bigfatfish/interest-memory.mjs` | 保留原兴趣提示，按当前查询只注入相关兴趣。 |
| 修改 | `extensions/bigfatfish/participation.mjs` | 明确找其他人时，正文出现机器人名字不升级为必须回应。 |
| 修改 | `integrations/qq-bridge/src/bridge.js` | 仅新增社区模型连接和后台tick。 |
| 修改 | `integrations/qq-bridge/src/safe-fetch.js` | 增加可选取消信号，沿用原DNS/IP/重定向/限量保护。 |
| 修改 | `integrations/qq-bridge/public/console.html` | 由原控制台模板和脚本生成，包含新增社区子区域。 |
| 修改 | `integrations/qq-bridge/scripts/audit-bridge-harness.mjs` | 为真实桥接源码模拟环境注入新模型工厂绑定。 |
| 修改 | `integrations/qq-bridge/scripts/console-ui-fixture.mjs` | 离线页面提供社区设置和来源接口，复用真实配置校验。 |
| 修改 | `scripts/apply-bridge-extension.cjs` | 应用V4桥接补丁并生成包含社区控件的控制台。 |
| 修改 | `scripts/audit-project.cjs` | 为最终测试提供有界超时和逐项失败日志，便于完整汇总。 |
| 修改 | `README.md` | 增加V4入口、默认关闭、授权及模型凭据说明和报告链接。 |

无需改动且继续保留的模块：DSH客户端、PersonaManager及可信角色插件、StyleLearning/Resolver与ExpressionMemory/Retrieval的正式风格业务、Mood、DeliveryLedger、QQ发送工具及原API池。源代码审查及对应回归均通过；没有重写等待/潜水协议、并发发送或角色管理。配置回滚没有修改消息水位或重放真实发送。

设计、配置、存储、恢复与限制见[开发说明](v4-development.md)；六个第三方参考项目的核对见[参考项目记录](v4-platform-references.md)。

## 3. 社区学习

五个平台均保留不可用状态，可登记获授权的文件或HTTPS Feed；无登录读取器。默认关闭。学习总开关管采集与新任务，知识应用开关独立管本地知识引用。关闭/取消/修改来源会中断请求并使旧generation无效；发布事务再次检查许可和版本。

每批8条先本地筛选，模型一次选少量材料、一次批量提取，仅歧义/冲突追加批量审核；证据必须命中实际读取片段，词条/释义须有可核对支持。只发布结构化公共知识，策略限制在现有枚举。知识、证据、候选、版本、任务和预算保存在SQLite，撤销保留墓碑。

## 4. 记忆和RAG

工作上下文沿用原未读与近期消息；事件和稳定事实沿用原会话facts及版本接口，增加来源时间和相对日期筛选。公共K全局共享；正式P仍是一套GlobalStyle，私聊只保存自己的记忆。私有事实先限定当前会话再检索。

社区检索采用精确词条/中文分词/二字片段、FTS5/BM25、来源许可和发布状态过滤、语境词义排序及限量注入；无匹配不注入。SQLite失败回退原会话上下文。原QQ JSON不迁移，不形成双权威。

## 5. 回复逻辑

继续使用原去重、真实@/引用识别、参与状态机、合批唤醒、StyleResolver和可信角色系统；只在待答时检索对应资料。DeepSeek生成后必须通过原QQ工具、白名单与发送保护，实际回执后才记已发送；ACK、部分失败和未知投递补救仍走DeliveryLedger。

## 6. Prompt与角色

静态审查确认已有会话系统角色快照、角色签名、旧自发历史过滤、切换退役和发送前检查，未另建角色系统。新增知识以低信任引用段进入动态记忆，不注册为可信角色指令。没有对角色正文做硬截断或加入社区QQ工具。真实模型多轮角色一致性、缓存命中和压缩后生成效果仍需授权联调，离线契约测试不能替代该项实测。

## 7. 测试

实现、迁移、50个新增测试用例、使用说明和非执行式复核完成后，才进入统一验证；各轮后续修复同样在代码、用例、文档和静态复核完成后统一回归。

最终实际执行入口为 `node scripts/verify-v4.mjs`。其逐项调用如下（工作目录为仓库根目录，标注Bridge的项目位于`integrations/qq-bridge`）：

| 验证项 | 实际Node入口/参数 | 最终结果 |
|---|---|---|
| 配置准备 | `node scripts/prepare-bridge.cjs` | 通过；原配置/记忆不覆盖。 |
| 集成生成 | `node scripts/apply-bridge-extension.cjs` | 通过；重复应用保持幂等。 |
| 主测试集 | `node --test --test-timeout=30000 --test-reporter=tap`，显式枚举全部`extensions/bigfatfish/*.test.mjs` | **353通过，0失败，0取消，0跳过**。 |
| 项目综合审计 | `node scripts/audit-project.cjs` | 通过：内部主测试353/353、上游35/35脚本、MCP stdio接入全部通过。 |
| Bridge综合审计 | `node scripts/test-audit.mjs`（Bridge） | **35/35脚本通过**。 |
| Token经济性 | `node scripts/test-token-economy.mjs`（Bridge） | 36/36通过。 |
| 等待协议 | `node scripts/test-reply-wait.mjs`（Bridge） | 10/10通过。 |
| 模型消息视图 | `node scripts/test-qq-model-view.mjs`（Bridge） | 8/8通过。 |
| QQ preset契约 | `node scripts/test-qq-preset-contract.mjs`（Bridge） | 5/5通过。 |
| 角色卡 | `node scripts/test-role-card.mjs`（Bridge） | 8/8通过。 |
| 会话路由 | `node --test src/core/session-router.test.mjs`（Bridge） | 33/33通过。 |
| 原控制台 | `node scripts/check-console-ui.cjs` | 桌面/手机、六入口、原功能写入、唯一ID及无脚本错误通过。 |
| 社区控件 | `node scripts/check-community-ui.cjs` | 缺条件启动日志、开始/结束、自动保存参数、实时实际/预留/估算用量、独立开关、旧后端兼容、六入口及手机无横向溢出通过。 |
| 本地测量 | `node scripts/measure-v4.mjs` | 通过，数据见下一节。 |

这些入口对应现有 `npm test`、`bridge:prepare`、`audit:project`、Bridge的 `test:audit`、`test:token` 和 `test:role-card` 脚本内容。各套审计包含部分重复回归，不把重复执行次数相加冒充独立用例总数。

最终 **14/14验证步骤通过，失败0**。另执行`git diff --check`通过。最终汇总保存在本机`logs/audit/v4-validation.json`，逐项日志为`logs/audit/v4-*.log`；项目审计子日志为`local.log`、`upstream.log`及`mcp-stdio.log`。桌面/手机截图为`logs/audit/v4-community-desktop.png`、`v4-community-mobile.png`，已目视复核。

失败及修复过程如实保留在本报告：默认Windows沙箱下的一轮主测试244通过、94失败、3取消，多数为临时目录原子重命名EPERM；同一沙箱也阻止localhost连接和fixture符号链接。改用项目内临时目录及普通桌面权限运行隔离验收后，环境问题解除。确认并修复了证据INSERT字段数错误和相关兴趣提示遗漏；修正新测试取样范围，使六入口断言只计算主导航。后续完整批次还发现独立Bridge审计的DSH模块路径缺失及新增控件窄屏溢出，分别补齐测试环境路径和控件尺寸约束。完成这些修复后再次运行**完整**批次，得到上述全部通过结果；没有删除测试、放宽正确断言或关闭安全机制。

未验证：真实平台读取/登录和数据许可、真实付费API、真实QQ首答/发送/重连、多轮模型角色效果及缓存。独立`voice-tool`未安装，原审计脚本中依赖该外部组件的部分分支仍按原逻辑跳过；脚本通过不表示这部分完成真实验证。

## 8. 成本与性能

Node v24.20.0、Windows、本地SQLite；1份合成文档、1个发布词义、200次本地检索。以下为最后完整批次实际计时：

| 指标 | 结果 | 口径 |
|---|---|---|
| 本地检索最小/中位/P95/最大 | 0.102 / **0.131** / **0.315** / 1.776 ms | 小型合成库，不能外推生产规模。 |
| 合成学习流水线 | 34.323 ms | 模型为内存模拟，排除真实模型与平台耗时。 |
| 唤醒指令字符数 | 960 → 1244，增加284 | 合成提问，调用现有`instruction()`；不含完整DSH历史、工具schema与系统角色，**不是Token数**。 |
| 合成知识发布 | 1条 | 只证明离线流水线可运行，不是实际社区学习结果。 |
| 实际输入/输出/推理Token、缓存命中 | 未测量 | 测试中的模拟usage只用于验证预算，未当作实际用量。 |
| 真实模型费用 | 未测量 | 无付费模型请求；配置费率计算的上界不能当作供应商账单。 |
| 真实QQ首答延迟/真实知识发布成功率 | 未测量 | 无生产消息、平台采集或部署。 |

原始测量文件：本机`logs/audit/v4-metrics.json`。没有比较真实API优化前后Token，因此不宣称实际节省百分比。

## 9. 交付限制

没有推送、部署、真实平台读取或真实QQ发送。隔离社区模型需要当前模型对应的环境或DSH命名凭据；缺失时明确暂停。费用需要管理员填写当前接口费率上界。授权文件和历史数据库备份的保留期由管理员按许可管理。旧无来源派生资料无法自动精确反推，保留并支持人工清理。

本次遵守最小必要修改：保持一套生产接入、六个主入口、一套全局正式风格及原消息发送链；新增职责集中于社区学习和必要的数据生命周期/检索修复。离线回归未发现剩余失败；这不等于完成真实平台/QQ运行验证或承诺生产零缺陷。全部代码保留在本地工作分支供审查，没有虚构已提交或已推送。

## 后续修复：长期记忆页的“接口或方法不存在”提示

只读核查正在使用的后台：`/api/bigfatfish/memory` 返回200，`/api/bigfatfish/community` 返回400及“接口或方法不存在”。根因是旧Bridge进程继续运行，而它从磁盘读取到了更新后的控制台页面；该页面同时请求了尚未加载到进程中的社区路由。

修改`console-community.js`，将明确的路由缺失响应作为兼容状态处理：在社区区域说明需从启动管理页重启QQ Bridge；禁用该区域的写入控件并停止自动轮询，保留手动刷新及原长期记忆操作。新后端可用后刷新恢复控件。新增隔离浏览器用例模拟上述400，检查长期记忆能加载、不出现通用错误弹窗，以及接口恢复后控件正常使用。`public/console.html`由原生成脚本同步更新。没有重启生产桥接或发送真实QQ消息。

修复后再次完整运行`node scripts/verify-v4.mjs`，于北京时间2026-10-28 18:52完成：14/14步骤通过、主测试341/341通过、Bridge审计35/35脚本通过，旧后端兼容/恢复及原控制台桌面/手机验收均通过。新增兼容用例保留了旧接口400错误响应，没有伪造后端升级成功。额外的在线页面只读复核曾因自动审批服务用量限制未执行；现有生产进程未自动重启，社区功能需管理员从启动管理页重启QQ Bridge后加载。

## 后续增强：开始/结束、日志与实时Token

只读诊断确认当前运行环境的社区学习总开关关闭、平台均关闭、没有登记来源、费率为空。用户选择“尚未配置，先完善控制和日志”，本次不添加或读取真实来源。

增加“开始学习”“结束学习”，保留“仅学习一次”和“取消当前任务”。开始自动保存页面参数，然后返回全部启动条件；缺失时响应`NOT_READY`并记入日志，不声称任务已运行。条件齐备后持久开启调度并启动首轮；结束持久关闭调度、取消在途任务并防止晚到发布。后台繁忙有明确等待状态和日志。凭据复用现有`readDshCredential()`，只读取当前模型对应ref，修复DSH中已保存Key但学习入口只识别环境变量的问题。

Schema升级为v2，迁移前备份v1数据库，仅新增日志表/索引。记录启动检查、任务阶段、筛选结果、模型请求、预算、实际usage、发布和结束原因，持久日志上限2000条，页面显示最近100条。页面每秒刷新本轮和今日用量，明确区分服务端确认的实际Token、仍占用额度的预留和流式文本估算。模型流式调用请求usage，计数不存原始推理；实际usage返回前不伪造真实Token数。

新增12个控制/流式/迁移用例，扩展现有HTTP权限和隔离界面验收，覆盖缺条件启动失败日志、开始/结束、未保存参数自动保存以及用量计数自动刷新。本节实现、测试、文档和静态复核完成后统一执行`node scripts/verify-v4.mjs`，于北京时间2026-10-28 20:54完成：14/14步骤通过，主测试353/353、项目综合审计353/353及上游35/35、独立Bridge审计35/35全部通过，桌面/手机截图已目视复核；本轮没有测试失败或真实模型调用。最终结果保存在本机`logs/audit/v4-validation.json`。当前生产Bridge未重启，需要从启动管理页重启后刷新才能加载本次后台控制版本；尚未配置的来源仍保持未配置。
