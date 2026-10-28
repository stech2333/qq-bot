# V4 社区读取参考项目核对

## V4.1接口复核（2026-10-28）

本次重新读取下列仓库元数据及涉及的源码，未安装或执行平台客户端。`pushed_at`与下表历史记录一致，均未归档。Polylens的实际MCP方法/参数以 [server.py](https://github.com/liu-xindi/polylens-bilibili-mcp/blob/main/src/polylens_bilibili/server.py) 为准，本次实现登录检查、search_videos、get_subtitles、get_comments和get_comment_replies的固定参数转换，全部内容请求固定jq裁剪；MCP客户端不允许调用写工具或登录工具。Python环境依赖由管理员独立安装，不打包其完整项目。

贴吧以 [aiotieba client.py](https://github.com/lumina37/aiotieba/blob/develop/src/aiotieba/client.py) 的get_threads/get_posts/get_comments契约编写可选worker；保留父帖子和楼层ID，不暴露管理/发送方法。Unlicense允许本次接口复用，但代码许可不授予平台数据的保存或AI学习权。

[知乎README](https://github.com/we1005/zhihu-mcp) 的Cookie与读取工具需单独转换，许可证尚未确认；[虎扑README](https://github.com/zhangtaopy/hupu-bot-pub) 声明MIT但元数据未识别，其CLI含写入和画像，因此未整体接入。[AstrBot插件](https://github.com/NickCharlie/astrbot_plugin_self_learning) 为AGPL-3.0，仅借鉴证据积累和审核思路，不复制源码。其他平台由原授权文件/Feed及新的readonly-json标准进程接口扩展，不能称为已有原生平台连接。真实登录、数据许可和付费联调均未执行。

## V4历史核对

核对时间：2026-10-28。通过GitHub连接器读取仓库元数据与默认分支README，没有安装或执行第三方工具，也没有复制源码。`pushed_at`仅表示仓库最近推送，不保证维护质量或API可用性。

| 项目 | 最近推送（UTC） | GitHub识别的许可证 | 实际声明能力及适用性 |
|---|---|---|---|
| [liu-xindi/polylens-bilibili-mcp](https://github.com/liu-xindi/polylens-bilibili-mcp) | 2026-10-16 15:13 | Apache-2.0 | 只读视频搜索/推荐、评论/回复、字幕等；业务工具需登录；有jq裁剪。适合未来在授权明确时将读取输出转换为Feed；本次没有连接登录会话。 |
| [xiaoyaya191/bilibili_learning_bot](https://github.com/xiaoyaya191/bilibili_learning_bot) | 2026-10-10 19:23 | MIT | 包含浏览、知识库，也含评论、私信及点赞/投币等互动；不整体接入，避免把平台写操作暴露给学习器。 |
| [lumina37/aiotieba](https://github.com/lumina37/aiotieba) | 2026-10-27 04:15 | Unlicense | 贴吧Python接口集合，可读取帖子，也服务吧务/管理等。不是单纯只读工具；未引入Python运行链或自动授权采集。 |
| [we1005/zhihu-mcp](https://github.com/we1005/zhihu-mcp) | 2026-09-09 07:59 | GitHub元数据未识别 | README声明主站搜索、原文读取、直答及Cookie管理，需自己的有效Cookie。许可证未确认，不复制实现、不配置登录、不宣称接通。 |
| [zhangtaopy/hupu-bot-pub](https://github.com/zhangtaopy/hupu-bot-pub) | 2026-10-20 08:28 | GitHub元数据未识别 | Rust CLI包含搜索/帖子详情，也包括回帖、点赞和用户画像/模仿，需Cookie。仅参考读取接口思路，不接入互动或画像。 |
| [NickCharlie/astrbot_plugin_self_learning](https://github.com/NickCharlie/astrbot_plugin_self_learning) | 2026-10-26 19:13 | AGPL-3.0 | AstrBot插件，风格/黑话审核、记忆/知识图谱、人格演化及多数据库。仅参考候选→审核→发布流程，保留现有框架，不移植插件。 |

以上仓库核对时均未标记archived。没有完成网络API运行可用性测试、平台数据许可审查或登录授权；不据此声称目标平台“已接入”。小黑盒没有用户指定的已许可读取项目，本次同样保留不可用状态和授权文件/Feed转换入口。后续若添加直接读取器，应另外确认平台条款和内容权利，并在适配器中只暴露discover/fetch，禁止平台写操作。
