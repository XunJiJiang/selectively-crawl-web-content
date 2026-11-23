---
name: scwc-plugin-development
description: 开发或维护 SCWC 核心插件，涵盖独立进程后端、采集与命令、脚本/扩展配置、工作台声明式 UI 和插件 Web 页面。终端插件与核心实现使用各自的开发约定。
metadata:
  version: '3.4.19'
---

# SCWC 核心插件开发

Skill 版本 `3.4.19` 对应本次完整更新所依据的根 `package.json.version`。完整更新时以当时的根版本刷新标记。局部修订沿用原标记。

## 1. 确认范围与契约

适用于 `projects/server/plugins/*` 及按相同契约部署的外部插件。先遵守仓库和插件的 `AGENTS.md` 及环境限制。优先改目标插件及其专属文档。核心、共享 SDK 和公共构建改动须在任务授权范围内。根据当前类型、宿主执行路径和测试确认契约，用提交历史定位行为变化。

插件的 `package.json.main` 指向 `.js` 或 `.ts`，默认导出用 `satisfies SCWC.IPluginHandler` 检查，必须实现 `onRequest`。后端 tsconfig 纳入 `projects/server/plugins/plugin-env.d.ts` 和 `projects/server/plugin/sdk/modules.d.ts`。本地导入写全扩展名，Node 直接加载的 TS 及其导入链使用可擦除语法。

- 插件发行版本由自己的 `package.json.version` 管理。内置示例的同步规则见[依赖与部署](references/dependencies-and-deployment.md)。
- 独立进程契约使用 `runtime.mode: 'process'` 和数字 `apiVersion: 2`，省略时使用这两个默认值。
- 脚本外层 `pluginConfig.scripts.version` 省略或取 `'v1'` 时使用旧 `controls`，取 `'v2'` 时使用声明式 `content` 和 `handlers`。内容另有数字版本，JSON 用 `1`，HTML 用 `2`。工作台仍兼容 HTML `1`。

## 2. 按能力读取参考并实现

- **采集、命令与后端接口。** `onRequest` 获取 `data/site/utils`，采集通知用 `logger.toWeb`。命令用包内 `commandName` 和 `pluginConfig.command`，通过 `InvocationContext` 处理取消、任务和 `next()`。API 使用请求快照，媒体交核心发送，Socket 使用连接上下文。选项多值补全、请求时限与实例生命周期见[运行契约](references/runtime-contract.md)。
- **脚本、扩展与持久配置。** 两个客户端共用插件 v1/v2 配置。v2 JSON 支持树和字段绑定，HTML 使用受限标签、CSS 和事件。全局值由后端 `configuration` 定义并经 `context.config` 读写，声明式设置优先复用自动绑定。编码 URL、本站绑定、版本门槛与冲突处理见[脚本与配置](references/scripts-and-configuration.md)。
- **工作台贡献。** 用 `onLoad` 的 `context.workbench.ui` 注册侧栏、状态栏、菜单、提示和页面信息。处理器通常放在后端，仅依赖文档状态的回调注册到 `scwcutils.ui.handlers`。内容格式、树、表达式、字段校验与释放顺序见[声明式 UI](references/declarative-ui.md)。
- **独立 Web 页面。** 用 `ui.entry` 接入核心，按需提供 `ui.api/resources/websocket`。页面 SDK 的授权能力依赖 `scwcutils.ready`，fetch 自行等待，创建 Socket 前显式等待。通过 `host.capabilities.coreConfig` 判断能否订阅主题。共享模块、Worker、Vite 和外部部署见[依赖与部署](references/dependencies-and-deployment.md)。
- **通知。** 脚本事件返回通知值，后台主动通知用 `context.notifications.notify`，持久工作台反馈用日志与任务工厂，插件 Web 页内或核心展示用共享 `Notify/notify`。选择对应的生命周期和展示宿主。[运行契约](references/runtime-contract.md)

参考 `projects/server/plugins/template` 的可运行实现。按需读 `index.ts`（命令）、`script-ui.ts`（双格式脚本 UI）、`settings-ui.ts`（绑定）、`tree-ui.ts`（树）、`input-validation-ui.ts`（校验）或 `web/`（页面 SDK）。故意非法的声明只用于验证拒绝行为。

## 3. 验证与收尾

按影响执行目标插件已有检查。分别检查后端和页面类型，构建改动过的页面并验证资源路径。配置和处理器改动覆盖实际渲染、输入与失焦、无效值阻断和并发冲突。脚本 v2 改动覆盖用户脚本和浏览器扩展。涉及 Node hooks、Worker、隔离宿主、HTTP/Range 或 Socket 时，验证对应运行时边界。测试使用隔离的插件数据和配置。

复查改动范围，受影响时更新目标插件已有的 `docs/map.md`。AOCI 范围遵循根 [AGENTS.md](../../../AGENTS.md) 的插件开发条款。普通插件及本 Skill 的变更无需根维护。插件有独立 AOCI 时依目录约定维护。修改核心示例 template 的受管理对象时维护根 AOCI。
