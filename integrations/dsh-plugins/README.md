# 已安装的第三方 DSH 插件（vendored）

本目录是**原生 DSH profile 实际加载的插件源码**。桌面版 DeepSeek Harness 的 profile
（`~/.dsh/profiles/desktop`）通过 `link:` 依赖 + `node_modules` junction 指向这里。

安装时间：2026-11-01。与 `integrations/dsh-plugin-patches/` 的分工：那边放**补丁流程与
审查证据**，这边放**被安装的源码**。

## 已装清单

| 插件 | 版本 | 上游提交 | 上游仓库 | 备注 |
|---|---|---|---|---|
| dsh-feiyu-mood | 0.8.3 | `7e68abb6e8a4c4a1bc39a08edf86ce1dacc24b20` | Yuuyuko-uu/dsh-feiyu-mood | 心情挂饰；client 注入 `dsh-client-ui-settings` |
| dsh-fish-memory | 1.4.8 | `f2012c27e3df5281457dcc403c31d8f9a8a8ad94` | Yuuyuko-uu/dsh-fish-memory | 长期记忆，注入 systemPrompt |
| dsh-speak-up | 0.2.7 | `ed80781bd68c851f83ef4f40f9f2b9f2febf55db` | Yuuyuko-uu/dsh-speak-up | 空闲时自行开一轮 |
| dsh-vision | 0.1.0 | `285f9ae085bf7fdba0d4b99612b837ce8b0e5b56` | sjakdhasdh/dsh-vision | 只有 TS 源码，本地用 tsc 构建出 `dist/` |

四者的 `package.json` 都声明了 `dsh.bundle.patch`，各自带一条 `insert` 行
（`mood` / `memory` / `speak-up` / `dsh-vision`）。

## 安装方式（可复现）

1. `package.json`（profile）里加 `"<包名>": "link:D:/Projects/BigFatFish-QQBot/integrations/dsh-plugins/<包名>"`
   并把包名追加进 `dsh.profile.bundles`。
2. `~/.dsh/profiles/desktop/node_modules/<包名>` 建 junction 指回本目录，让 loader 能按包名解析；
   DSH 的「安装回退目录」`$DSH_HOME/profiles/node_modules` 不存在，所以必须建在 profile 自己的
   `node_modules` 下。
3. 运行时共享依赖（`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`）靠 Node 从本目录逐级
   上溯解析到项目根 `node_modules`（0.2.1-rc.2），不额外安装。
4. 重启 DeepSeek Harness 生效（HMR 的 `root: []` 不监视模块根，新包不会热挂载）。

## dsh-vision 的两处偏差

- 上游 `src` 从未构建过，本目录的 `dist/index.js` 是用 `typescript@5.6.3` + `@types/node@22`
  本地编译的（构建依赖已删，只留 `dist`）。改 `src` 后需重新 `tsc -p tsconfig.json`。
- 上游 `package.json` 依赖 `@deepseek-ai/dsh-tools@0.1.0-rc.6`，运行时实际解析到项目里的
  `0.2.1-rc.2`（构建与运行都用这份）。**没有改上游 manifest**：若以后跑 `pnpm install`，
  pnpm 会去装 0.1.0-rc.6（该版本存在，但与本机 host 不同版本）。
- 需要配置 `apiKey` 或环境变量 `DASHSCOPE_API_KEY`，否则调用时会报「未配置 API Key」。

## 副作用（重要）

- **profile 的 `ui-settings` 已重新启用**：`cordis.patch.yml` 里原来的 `enabled: false` 被删掉，
  否则 dsh-feiyu-mood 的网页端注入无处挂载（设置面板会重新出现）。
- dsh-speak-up 会在会话空闲时**自己开一轮**；dsh-fish-memory 会把记忆**注入 systemPrompt**。
  两者都会影响本 profile 的所有会话，包括本项目的开发会话。
- 与本项目自研的 memory / mood / initiative（`extensions/bigfatfish/*`）是**两套独立实现**：
  桌面 profile 装插件不影响 QQ 桥接用的 `data-bridge` DSH home，但同一份对话若两边都在看，
  写入的记忆/心情会各写各的。

## 回滚

安装前的三个文件备份在 `backups/dsh-profile-plugins-20261101-015716/`：

```
Copy-Item backups/dsh-profile-plugins-20261101-015716/* ~/.dsh/profiles/desktop/ -Force
Remove-Item ~/.dsh/profiles/desktop/node_modules/dsh-feiyu-mood, ...\dsh-fish-memory, ...\dsh-speak-up, ...\dsh-vision
```

然后重启。删本目录不影响正在运行的 harness，但下次启动会因解析失败而跳过这些 bundle。
