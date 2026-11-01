# DSH 插件补丁目录

本目录保存**第三方 DSH 插件**的本地补丁、版本锁定与验证记录。本项目自己的 DSH 插件
（`qq-agent-presets`、`qq-mode-console`）不在这里，它们在 `integrations/qq-bridge/plugins/`。

## 当前状态（V4.2）

**没有对任何第三方插件打补丁，也没有安装任何第三方插件。**

四个候选插件（dsh-fish-memory / dsh-feiyu-mood / dsh-speak-up / dsh-vision）的审查结论、
证据与回滚方式记录在 `upstream-lock.json`，并在运行时通过
`GET /api/bigfatfish/plugin-integration` 与管理端「插件整合与功能所有权」面板展示。

之所以是"未安装"而不是"装了再补"，理由写在每个条目的 `reasons` 里，核心是同一条：
这些插件都会在 DSH 的 `systemPrompt`/调度层自行注入或自建回合，而本项目已经有一份
经过来源校验、按 QQ 会话隔离并在管理端可纠正的实现。**同时启用就是双写/双注入**，
正是 V4.2 要消除的问题。要用插件当主实现，必须先拆掉自研那份，那是一次需要 A/B 的
独立迁移，不能顺手做。

## 引入补丁时必须做到的事（硬性约定）

1. 确认许可证允许修改与再分发；保留原始源码与 `LICENSE`。
2. 在 `upstream-lock.json` 记录：上游仓库、版本、**提交 SHA**、补丁版本、改动文件。
3. 补丁以**可重复执行**的方式应用（锚点唯一 + 幂等），不得手工改 `node_modules`。
   本项目已有先例：`scripts/apply-bridge-extension.cjs` 用 marker 短路 + `once()` 唯一锚点，
   `npm run bridge:prepare` 可反复执行。
4. 每次应用后运行验证命令；验证结果写回 `upstream-lock.json` 的 `verification`。
5. 上游更新前先做三方合并或锚点冲突检测：锚点不存在就**失败并停下**，不要静默跳过。
   已废弃锚点用 `optionalOnce()` 显式标注，其它锚点继续用 `once()` 强制失败。
6. 回滚 = 删除补丁目录中的文件 + 重新 `npm i`/`dsh plugin remove`；业务数据
   （记忆、心情、图片用途）不得随插件卸载被删除，卸载前先导出。

## 文件约定

```
integrations/dsh-plugin-patches/
  README.md                 # 本文件：流程与硬性约定
  upstream-lock.json        # 上游版本/提交/决策/验证/回滚
  <plugin-id>/
    patches/                # 可重复应用的补丁或 diff
    apply.mjs               # 幂等应用（锚点缺失即失败）
    verify.mjs              # 应用后自检
    README.md               # 该插件的改动说明与上游更新步骤
```
