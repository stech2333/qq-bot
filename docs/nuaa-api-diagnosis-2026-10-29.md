# 南航 Token API 检查（2026-10-29）

配置条目：南航 Token · DeepSeek Flash。基址 `https://token.nuaa.edu.cn/v1`，协议 `openai-completions`，模型 `deepseek-flash`；本地配置仅文本，DeepSeek 兼容选项开启，上下文 65536、输出上限 4096。密钥已在 DSH 凭据服务保存，本文不记录密钥。

## 检查证据

- 无密钥访问 `/models` 返回 JSON 401，属于预期鉴权拒绝。
- 使用已保存密钥访问 `/models` 返回 200，模型列表包含 `deepseek-flash`。
- 最小 Chat Completions 请求返回 200，响应的实际模型为 `deepseek-v4.1-flash`。
- 使用应用依赖的 OpenAI SDK 直接进行流式请求，成功取得 `API_POOL_OK`。
- 应用内部测试失败可复现，约 3.5 秒结束；DSH 会话记录为两次 `TRANSPORT / Connection error.`，不是配置的 120 秒模型请求超时。
- 使用 DSH 自带代理模块复现其网络路由，确认目标走 `http://127.0.0.1:7897` 时发生 TLS 建连前连接重置（ECONNRESET）；恢复直连，同一无密钥端点正常返回 401。

## 修复与结果

本项目 `.env` 加入 `NO_PROXY=localhost,127.0.0.1,::1,token.nuaa.edu.cn`。服务管理器会将此值作为 DSH/桥接子进程的启动环境；只对该域名增加直连例外，其余站点仍沿用原代理，用户级代理变量不改动。

重启 DSH 并恢复桥接后，通过管理页面相同的 `/api/model-pool/test` 接口再次测试，得到 `passed`，耗时 3782 毫秒，返回“模型流式文本调用成功”。三个服务均恢复运行。API 池 activeId 仍为 null，当前默认模型选择保持原接口。

本次未验证图片、工具调用及联网搜索能力；“仅文本”是本地条目的能力声明，不能据此断言上游不支持图片。没有调整密钥、接口协议或模型 ID，没有发送 QQ 测试消息。
