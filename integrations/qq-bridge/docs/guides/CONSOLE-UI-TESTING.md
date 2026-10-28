# 管理界面离线验收

运行 `node scripts/check-console-ui.cjs` 或完整审计 `node scripts/audit-project.cjs --ui`。使用 Playwright 和本机 Chrome，服务端为 `scripts/console-ui-fixture.mjs` 的临时回环夹具；不加载生产凭据、不改真实设置、不连接 QQ 或模型。

当前界面基于原版总览、会话映射/审批、模型/API 池与花费图表，保留完整原表单。六个主入口通过页内分组访问原功能；全局风格为 V3 适配。

测试覆盖真实日志文本返回、群/好友下拉选择及保存请求、人格草稿保留、费用图表、全局风格保存、DOM ID 与移动宽度。截图输出 `logs/audit/console-restored-desktop.png` 和 `console-restored-mobile.png`。
