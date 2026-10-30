# 表情语义与按语境使用（V4.1）

此变更只影响表情收藏、语义管理与发送准入。模型选择、人格、学习器和社区库不变。

## 数据与兼容

继续读取 `state/stickers.json` 数组，保留 id/resId/url/md5/desc/localNote/tags/usage/useCount/lastUsedAt 等原字段。同步只合并 QQ 返回的数据，不因缺失、分页或暂时空返回删除旧记录。

新增 usageScenes、avoidScenes、tone、visualContent、imageText、subtext、ambiguity、privacySensitive、understandingStatus、understandingSource、understandingConfidence、reviewedAt、semanticPersistence、requestedRemark。旧条目缺少确认状态时一律 unreviewed；有 desc 或旧笔记也不等于已理解。reviewed 必须具备含义、用途、标签、有效场景及 visual/manual 来源，不得存在歧义、隐私风险或保存失败。自评 confidence 不参与升级判定。

第一次实际写入前验证原库并创建原始字节备份 `stickers.json.pre-v4.1.bak`，随后原子替换。损坏原库拒绝覆盖；本次开发不主动迁移或改写真实收藏文件。

## 收藏

1. 校验当前授权会话与消息归属。单图兼容旧调用；多图必须指定从 0 开始的 mediaIndex 或唯一 mediaId，两者同时传入时必须一致。
2. 复用 fetchOneBotImage/fetchFaceMedia 获取真实图片，保留原始字节。下载失败直接拒绝收藏。
3. 复用当前 DSH 模型、已验证安全 preset 和现有 normalizeImageForModel。GIF 按现有抽帧拼图路径输入模型；抽帧降级成首帧时不确认语义。不创建额外模型服务，不改模型配置，不把原聊天、文件名或 QQ 备注当作识图结果。
4. 输出内容、文字、动作变化、情绪、潜台词、用途、禁止场景、歧义和隐私标记。含糊结果不自动收藏。当前模型不支持图片、服务离线或识图失败时允许收藏为 unreviewed，返回实际错误；提供的旧 note/usage 参数不会自动授予 reviewed。
5. add_custom_face 仍接收原始图片/GIF 字节。使用实际返回的 emoji_id 自动关联本地认知。remark 作为 requestedRemark 保留，不调用 modify_custom_face；QQ 官方备注仍只能通过独立授权工具修改。
6. 分别返回 qqCollected、localSaved、understandingStatus、qqRemarkSaved。QQ 已收藏而本地写失败时返回部分失败，条目标记 pending/unreviewed，并记入 `state/sticker-recovery.json`。管理页显示恢复入口；恢复或管理员成功编辑前不会自动使用。ID 缺失会记录待人工关联状态，不冒充收藏失败重新收藏。

## 管理与补充理解

在二代仿真设置的“表情包认知与使用管理”展开列表，可查看缩略图、QQ 原始备注、本地含义/用途/标签/语气、场景、歧义、状态、次数和最近时间。编辑本地信息立即生效；设为 reviewed 前需要补齐语义。可改为 unreviewed、uncertain 或 disabled。管理员编辑单独标记 manual，AI 与批处理不得覆盖。

单张“重新识图”或 qq_sticker_note 的 reanalyze=true 只分析现有收藏，不删除或重新收藏。Agent 与批处理跳过管理员语义和禁用决定；管理员单张重新识图会生成可编辑建议，保留原记录，只有显式保存才应用。受限批处理默认不运行，每次最多五张，跳过已确认/管理员/禁用条目，显示进度并可取消。单次视觉等待 60 秒，最多一张并发、每小时最多 20 次，不因普通聊天额外识图。取消会停止待处理项和当前模型工作，已保存结果保留。

## 聊天选择与发送

从真实近期消息（最多六条、十分钟窗口）提取当前情绪、话题和严肃/技术/求助场景。先排除未理解、禁用、保存待恢复、场景不符和用途限定话题不符，再按情绪/标签/用途/话题相关性排序。useCount 只有至多一分的轻微负权重，不能主导选择。反讽、自嘲必须存在对应语境依据，并检查上一条文字表达是否衔接。没有明确匹配即可不发；别人发图、固定轮次或概率都不是发图任务。

sendStickerV2 默认按 Agent 自动发送校验，进入发送队列后在真正发往 QQ 前再次检查开关、权限与真实语境；不信任调用者传入的 scene。既有令牌、白名单、频率、消息顺序、安全下载保持不变。其他 Agent 文字入口仍生成转义文本段，不能用 CQ 字符串变成收藏表情。控制台独占 test-send 通道可显式测试未确认图片，Agent 不能进入该通道。

仅 QQ 成功回执后更新 useCount/lastUsedAt；在发送队列内记录本会话成功使用历史。`social-v2.json` 的 stickerRecentUses 仅保存有界的图片 ID、时间、场景和成功状态，无原聊天内容。已移除同图十分钟冷却和表情间隔45秒的限制；使用历史不再作为时间准入条件。失败不增加次数。最近诊断只保留场景、候选 ID/分数、选择或拒绝原因、发送状态及记录落盘状态，不保存完整 Prompt。

## 定向验证

在 qq-bridge 目录运行 `npm run test:stickers:v41`。仅运行表情语义、收藏/管理/发送隔离测试、原始 QQ 图片/GIF 字节测试，以及 SnowLuma WS/HTTP 同步兜底测试。测试使用临时状态、模拟图片、模拟 DSH 视觉结果和模拟 QQ 网关，不向真实群发消息，不批量调用真实模型。

真实视觉模型的识别准确率、具体 GIF 的实际 ffmpeg 抽帧质量和真实 QQ 回执仍需在部署后由管理员用少量图片核验；模拟通过不能证明实际图片识别正确。
