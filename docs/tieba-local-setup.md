# 本机贴吧环境配置（2026-10-29）

已在当前项目内创建共享 Python 环境，三个贴吧共用，不修改系统 PATH 或原 Conda 环境。

- Python：`D:\Projects\BigFatFish-QQBot\runtime\community-python\Scripts\python.exe`，3.11.5。
- aiotieba：4.8.2，从官方 PyPI 安装二进制发布包；`pip check` 通过。
- 完整依赖清单：`runtime/community-python/requirements.lock.txt`。
- 本地连接器：`integrations/qq-bridge/state/community-connectors.json` 的 `tieba` 项，driver 为 `aiotieba`，共享最小请求间隔 3000 ms。
- B站原有连接器完整保留；修改连接器之前已创建本地备份。
- 可选登录凭据引用为 `QQ_COMMUNITY_TIEBA_BDUSS`，配置文件只保存引用名。本次公开读取未配置或索取 BDUSS。

已登记并实际通过只读 probe 的来源：

| 来源 ID | 管理员输入 | 接口规范名 | 真实 forum ID |
| --- | --- | --- | --- |
| tieba_ruozhi | 弱智吧 | 弱智 | 272685 |
| tieba_sunxiaochuan | 孙笑川吧 | 孙笑川 | 21841105 |
| tieba_tiantangjitang | 天堂鸡汤吧 | 天堂鸡汤 | 27782931 |

用途依据如实记录为管理员声明：“仅用于自身储备，可以直接读取”；未声称已经核验第三方许可证明。

抓虾吧实际返回服务器错误 340001：“抱歉，该吧神秘升级中，暂不开放”。依管理员后续要求已删除该来源；删除前已确认没有材料、文档或证据并备份数据库。其他来源及日志保留。

弱智吧额外通过一页真实帖子发现、首楼、后续楼层和楼中楼读取。核验材料为实际 tid `10658092344`；元数据、内容哈希和续读游标保存在 `output/tieba-live-read-check.json`，没有保存全文，没有调用 DeepSeek 提取或发布生产知识。

本次环境配置完成后，学习保持 `STOPPED`，总开关 `enabled=false`，贴吧平台开关已开启，三个来源已登记启用。管理员可在原后台查看状态、调整来源和手动开始学习。READY 是本次检查结果；后续平台权限或网络变化仍按现有探测、超时和退避处理。

本次定向复验为 5 项 Node 测试全部通过，包含在新 Python 环境执行的 22 项 Python 契约测试；未运行全量测试或向 QQ 群发送消息。
