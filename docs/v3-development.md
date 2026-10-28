# V3.0 开发与审查记录

以 2a7a89b 工作区为基线。按本次指令，初始阅读与调用映射用于实施设计，统一审查和测试留到全部修改完成；中途仅执行阻塞性语法/补丁检查。

## 已确认的问题与职责映射

- P0：GlobalStyle.job 返回 null，StyleLearning.jobs 产生 groupStyle；GroupStyle 按群发布/应用，SlangManager.visible 用 scope/confirmedScopes 控制可见性；PersonaManager.resolve 按会话绑定。均与 V3 的唯一全局实体目标相反。
- P1：StyleResolver.classifyScene 将普通问号和 ASSISTANT 模式直接判定求助；pending 以会话 key 关联，可能覆盖旧回合。sendMessagesV2 单条及批末都调用 bff.sent，副作用重叠。preSleepWaitMs 和多个 delay/budget 参数以 || 回退，丢失合法 0。
- P1：Mood 的默认 enabled=false，已持久化的旧默认与明确关闭无法仅凭 false 区分；应记录迁移并保守保留显式旧值。recallTrace 未按当前发言者限制第一人称事实召回。
- P2：控制台多个功能入口、风格逐群审核及 v1 独立运行/UI路径形成管理负担；仿真预设和唤醒均有较长重复说明。

保留：QQ→SnowLuma→Bridge→DSH→API；会话映射、令牌、权限、退役校验、发送队列、水位/快照、API池、事实存储/历史、话题统计、后台单并发及持久预算、预设工具限制与安全下载。

替换：按群正式风格为只读来源窗口+唯一全局Profile；风格自动候选/稳定晋升；按scope词条为全局规范词+多个sense；人格仅跟随全局可信模板；按turnId/sendId结算；六入口控制台。

退役：群风格管理/独立应用、旧scope管理、一代仿真预设/页面/专属定时器及API。旧状态备份和迁移凭据保留，未知/旧模式保持安全关闭，不能因升级自动主动发言。

最终验证：本地303项、桥接35组、MCP握手；六入口浏览器验收此前通过，上传前复验受本机Chrome启动失败影响未完成。并发、部分/未知发送、防复活、来源撤销、单群巩固、版本保护、迁移、原界面草稿与联系人选择、漏答与响应延迟、生成后未通过QQ工具发送的有界纠正、工具安全边界均有离线覆盖；真实聊天质量与付费API性能未用模拟结果代替。按用户追加授权已安装预设并重启DSH/桥接，目标QQ身份、网关在线与接收健康通过只读核验，详见 `v3-report.md`。
