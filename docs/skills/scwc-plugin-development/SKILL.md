---
name: scwc-plugin-development
description: 开发或维护 SCWC 核心插件，包括独立进程后端、用户脚本与浏览器扩展的 v1/v2 配置、声明式工作台 UI 和插件 Web 页面；不用于终端插件或核心实现本身。
metadata:
  version: '3.3.2'
---

# SCWC 核心插件开发

Skill 版本：`3.3.2`，取自本次更新时仓库根 `package.json.version`。它标识本 skill 的源码基准，不是业务插件版本或协议版本；以后更新本 skill 时重新读取根版本。

本 skill 面向 `projects/server/plugins/*` 及部署在外部目录的同类核心插件。默认修改目标插件与其专属文档。需要改核心、共享 SDK 或公共构建能力时，先检查任务是否已授权该范围；已授权的工作直接继续。终端插件使用 `SCWCTerminal.Plugin`，不套用本契约。

## 开始与证据入口

先遵守仓库及目标插件的 `AGENTS.md`、环境限制和现有约束。README、历史 skill 和代码注释可能滞后；接口以当前类型、执行路径和对应测试共同确认，历史提交只帮助解释变化。

按需求选择源码与参考，不必一次加载全部：

| 任务 | 当前源码入口 | Skill 参考 |
| --- | --- | --- |
| 入口、命令、采集、HTTP/资源/Socket、页面 SDK | `projects/server/plugins/plugin-env.d.ts`、`projects/server/types/{plugin-process,command,task}.d.ts`、`projects/server/plugin/process/`、`projects/webutils/lib/` | [运行契约](references/runtime-contract.md) |
| 侧栏、状态栏、提示、菜单、处理器、输入校验 | `projects/shared/{declarative-ui,ui-expressions,ui-validation}.ts`、`projects/server/workbench/{ui-compiler,declarative-ui}.ts` | [声明式 UI](references/declarative-ui.md) |
| 脚本/扩展配置、URL 刷新、全局/本站绑定、分组配置 | `projects/shared/script-ui.ts`、`projects/server/user-script/{ui,ui-config,refresh}.ts`、`projects/server/types/plugin-config.d.ts` | [脚本与配置](references/scripts-and-configuration.md) |
| SDK 模块、Worker、Vite、独立部署 | `projects/server/plugin/sdk/`、`projects/vite-plugin/`、`projects/server/plugin/web/` | [依赖与部署](references/dependencies-and-deployment.md) |

`projects/server/plugins/template` 是可运行示例，按需求查看 `index.ts`、`configuration.ts`、`settings-ui.ts`、`script-ui.ts`、`declarative-ui.ts`、`input-validation-ui.ts` 和 `web/ui-demo.ts`。其中故意非法的表达式、控件名和验证器返回值只供拒绝测试，不复制成初始内容。

## 入口与版本边界

插件目录包含 `package.json` 和 `main` 指向的 `.js`/`.ts`，默认导出满足 `SCWC.IPluginHandler` 的对象，`onRequest` 必须存在。用 `satisfies` 检查对象；后端 tsconfig 显式纳入 `plugin-env.d.ts`、`plugin/sdk/modules.d.ts`，本地导入写全扩展名。Node 直接加载的 TS 及其导入链只用可擦除语法。

以下版本各有用途，不能互相替代：

| 字段 | 当前含义 |
| --- | --- |
| `package.json.version` | 插件自身发行版本；普通业务插件独立维护 |
| `package.json.runtime.apiVersion` / handler `apiVersion` | 独立进程可序列化接口，省略使用 `2`；`runtime.mode` 省略使用 `process` |
| `pluginConfig.scripts.version` | 省略或 `'v1'` 为旧 controls；显式 `'v2'` 为 JSON UI |
| `scripts.content.version` / 工作台 `UIContent.version` | 内容格式版本，当前为数字 `1` |

所有启用插件都在独立 Node 进程运行；不要依赖核心进程内对象、Express req/res 或真实 WebSocket。API 接收 `context.request` 数据快照，资源返回文件/响应描述，Socket 使用连接上下文操作。RPC 超时只结束等待，不证明业务写入撤销；写请求不能据此自动重试。

## 选择插件能力

- 采集使用 `onRequest(context, logger)`，数据与工具来自 `context.data/site/utils`；抓取 logger 的 `toWeb` 可返回采集通知。
- 命令使用 `pluginConfig.command`，同时在包中声明 `commandName`。第五参数 `InvocationContext` 提供任务、取消和类型化 `next()`；补全返回完整候选词，前缀过滤交终端。
- 脚本浮窗与浏览器扩展共用 `pluginConfig.scripts`。新 JSON 配置显式声明 `version: 'v2'`，以 `content`、`handlers` 和可选 `components` 实现；维护旧 controls 时保留 v1 行为，不因使用本 skill 强制迁移。
- 全局持久配置由后端 `configuration` 定义并通过 `context.config` 操作；声明式设置优先复用自动绑定。自定义 Web 页面 `scwcutils.config` 只有读取/订阅，写入走后端明确业务 API。
- 工作台贡献由 `onLoad` 的 `context.workbench.ui` 注册，不要求先有独立插件页面。处理器留在插件进程；仅需要当前页面状态的回调才注册在页面 `scwcutils.ui.handlers` 中。
- 独立 Web 页面使用 `ui.entry`；`ui.api/resources/websocket` 分别提供结构化 API、媒体资源和实时通道。通过核心路由接入，不为这些功能另起 HTTP 服务。

不要混用通知接口：脚本 v1/v2 事件返回 `{ type: 'notification', data: { type, message } }`；工作台声明式事件可使用 `core:notification.show(...)`；后端/页面的长期反馈使用各自的通知与任务工厂。脚本运行器只支持其源码列出的 `core:` 子集，不能直接移植工作台全部表达式。

## 模块、页面与构建

后端共享依赖用 `scwc:deps`，Worker/RPC 用 `scwc:runtime`，无 DOM 工具和共享类型用 `scwc:shared/backend`；声明文件不负责安装运行时 hooks。前端通过 `@scwc/vite-plugin` 使用共享白名单依赖及 `scwc:shared/frontend`，HTML 会自动加载后者；不要把需要 DOM 的入口导入 Node 或 Worker。

插件页面全局 SDK 的类型位于 `projects/webutils/lib.d.ts`。先 `await scwcutils.ready` 再创建 Socket 或调用依赖页面授权的能力；fetch 会等待 ready。按 `host.capabilities` 使用可选工作台能力，并释放订阅和注册。资源 URL 中的 `site` 是上下文，不能充当认证。

页面配置使用 `plugins: [scwcVite()]`，浏览器 Worker 另设 `worker.plugins: () => [scwcVite()]`。`base` 根据插件**目录名**生成。`ui.entry` 相对 `main` 所在目录解析；缺 HTML 时核心在导入入口后、`onLoad` 前尝试构建，已有 HTML 不因源码变化自动重建。后端改动需重载插件；前端构建后刷新页面。受限 `build:web` 声明、仓库版本同步前缀与外部部署差异见[依赖与部署](references/dependencies-and-deployment.md)。

## 验证与收尾

按改动运行目标插件已有检查：后端和页面各自类型检查；页面改动实际构建并验证资源路径；处理器/配置改动验证渲染、事件、校验失败与冲突；涉及 hooks、隔离、HTTP/Range/Socket 时验证对应真实边界。v2 配置在用户脚本和浏览器扩展两端验证，不能用工作台渲染代替。针对校验至少检查输入、失焦、提交、字段依赖和无效值阻止副作用。按需测试，不机械运行全仓或使用模板的业务探针。

测试隔离插件数据、配置和环境，不依赖真实用户数据；普通 Node 或 TypeScript 检查、Vitest alias 不能互相替代运行时验证。更新目标插件 `docs/map.md`（存在且受影响时），复查 diff 与授权范围。

AOCI 范围遵循根 [AGENTS.md](../../../AGENTS.md)：普通插件及本 skill 的变化不触发根目录 `aoci_maintain`；插件目录已有独立 AOCI 时按其约定维护。**template 是核心示例例外**，实际修改 template 受管理对象时由根目录 AOCI 维护。
