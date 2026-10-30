---
name: scwc-plugin-development
description: 为 Selectively Crawl Web Content 开发或维护 projects/server/plugins 下的插件，包括独立进程后端、浏览器脚本控制器、工作台集成和插件 Web 页面；不用于修改核心实现。
---

# SCWC 插件开发

本 skill 面向 `projects/server/plugins/*` 内的插件后端、控制器和独立页面。默认把改动限制在目标插件及其专属文档；修改核心实现、共享 SDK 或公共构建能力前，先确认用户授权。插件可能部署在核心源码目录之外，不要依赖插件位于仓库内这一事实。

## 开始前

阅读仓库 `README.md`、`projects/server/plugins/plugin-env.d.ts`、模板入口与页面配置，并查看目标插件自己的 `AGENTS.md`、`docs/map.md` 或现有约束。涉及运行边界时读 [运行契约](references/runtime-contract.md)；涉及模块、Worker、前端构建或发行包时读[依赖与部署](references/dependencies-and-deployment.md)。以当前类型、源码和测试为准，文档与实现冲突时不要沿用旧契约。

## 插件入口与运行模式

插件目录至少包含 `package.json` 和 `main` 指向的 `.js`/`.ts` 入口，入口默认导出实现 `SCWC.IPluginHandler` 的对象。优先 `satisfies SCWC.IPluginHandler`，不要用 `as any` 避开类型检查。类型声明由 `projects/server/plugins/plugin-env.d.ts` 和 `projects/server/plugin/sdk/modules.d.ts` 提供；插件 TypeScript 配置应显式引用这两份文件及它们所需的核心源码类型。入口导入本地文件时写全扩展名。

启用插件默认在独立 Node 进程运行，`runtime.mode` / `apiVersion` 省略时使用 `process` / `2`。不要依赖核心进程内执行，也不要在插件中接收 Express request/response 或真实 WebSocket。第二版 API 使用 `context.request` 数据快照；资源处理器返回文件/响应描述；WebSocket 通过连接身份和局部 `send`、`broadcast`、`close` 操作。超时只终止等待方，不代表插件中的业务写入已撤销，写请求不能因超时自动重试。

插件后端可使用的宿主能力包括：

- `onLoad` 的 `context.config`：按插件目录隔离的持久字符串配置 CRUD 与订阅；值始终是字符串。插件可以声明 `configuration.definitions`、异步 `normalize`/`validate` 和 `onChange`。
- `context.workbench`：长期持有的通知 logger、任务管理器和声明式 UI 注册 API。处理器函数留在插件进程，跨进程只传序列化数据与描述；在 `onUnload` 释放注册项、订阅和资源。
- `context.createRetryGet`、`context.LimitPromise`、插件专属 `context.cache`，以及调用级 `tasks`、`signal`。缓存只能放支持的可序列化值，不放函数、流或 socket。
- 抓取 `onRequest` 的 `context.data`、`context.site` 与 `context.utils`。抓取 logger 可通过 `toWeb` 发送通知；控制器触发 logger 没有该方法，应返回 notification 结果。

实际接口以 `plugin-env.d.ts`、`types/plugin-process.d.ts` 和 `types/task.d.ts` 为准。更完整的页面、配置、声明式 UI、通知和任务边界见[运行契约](references/runtime-contract.md)。

## 插件提供给宿主的功能

- `pluginConfig.command` 在 `package.json.commandName` 存在时注册一个一级命令。命令回调含 logger、解析后的选项、未用参数、原始参数和 `InvocationContext`；后者提供 `signal`、任务状态及可类型化的 `next()` 待答输入。可用 `complete` 提供异步补全；回调接收取消信号和按一级命令生命周期保留的候选缓存，返回当前位置的完整候选词，由终端执行前缀过滤。
- `pluginConfig.scripts` 向采集脚本浮窗注册按钮、toggle、select、文本/数字输入和 checkbox。动态 controls 工厂可按 site 生成控件；channel 要稳定且插件内唯一。控制器回调应验证所有来自页面的数据，并返回通知结构。
- `ui.entry` 提供插件页面；`ui.api`、`ui.resources`、`ui.websocket` 分别注册结构化 API、浏览器直接加载资源和实时通道。不要另起 HTTP 服务或监听额外端口。
- 可选 `scwc.ui` package 元数据为工作台插件目录提供标题、描述、SPA 路由和资源前缀等展示/路由提示；它不是后端 handler 的替代品。

对页面及工作台的当前安全、授权和生命周期契约，按任务阅读[运行契约](references/runtime-contract.md)。不要将旧版页面属性注入、页面写配置或旧 Express 插件接口当作当前能力。

## 共享模块与浏览器 SDK

后端共享依赖使用 `scwc:deps`，Worker/RPC 使用 `scwc:runtime`，通用无 DOM 后端工具和类型使用 `scwc:shared/backend`。它们由 Node 宿主在动态导入插件前注册；`modules.d.ts` 只提供开发期类型，不负责运行时注册。不要把根目录依赖视为全部已公开，也不要在插件中重复安装已由 SDK 承诺的共享依赖。

`projects/shared/backend.ts` 提供无 DOM 的通用工具、声明式 UI/表达式和反馈契约；插件页面使用 `scwc:shared/frontend` 或从 `@scwc/shared/frontend` 复用浏览器组件、通知、滚动容器和工具。该前端入口需要 DOM，只由 Vite HTML 页面自动加载，不要导入到 Node Worker。共享入口的详细解析规则见[依赖与部署](references/dependencies-and-deployment.md)。

页面全局对象 `window.scwcutils` 来自大小写为 `projects/webutils/lib.d.ts` 的声明。加载页面后先 `await scwcutils.ready` 再创建 WebSocket 或调用依赖页面授权的能力。`fetch` 经当前页面授权代理访问本插件 `ui.api`；`fetch.resource` 生成给媒体等元素使用的资源 URL；`websocket`/`websocketAsync` 使用核心票据代理。页面端 `config` 只有读取与订阅能力，配置写入应由插件明确提供的业务 API 完成，并携带从已读快照获得的 `baseRevision`。SDK 还提供页面处理器注册、生命周期、导航/搜索、任务与通知、活动和主题/可见性状态等能力；使用前检查 `host.capabilities`，离页时释放注册与订阅。详情见[运行契约](references/runtime-contract.md)。

## 插件页面构建

页面可交付完整静态产物，或交付源码、插件自己的 `vite.config.ts`、`web/tsconfig.json` 和 `build:web` 声明。`ui.entry` 相对 `package.json.main` 所在目录解析。自动构建在插件入口导入后、`onLoad` 前准备 HTML；入口顶层不要读取尚未生成的产物。核心不会因依赖/源码时间戳自动重建已有 HTML；重新构建后刷新页面，前端重建本身不重载后端插件。

Vite 页面配置使用 `@scwc/vite-plugin`：`plugins: [scwcVite()]`；含浏览器 Worker 时另设 `worker.plugins: () => [scwcVite()]`。配置 `base` 时使用插件目录名而非包名。插件会提供白名单依赖回退、`scwc:deps` 的浏览器 Zod 适配、`scwc:shared/frontend` 的 HTML 自动注入和装饰器转换；它不注入全局变量，Worker 也不自动载入需要 DOM 的 shared frontend。页面带自己的 tsconfig；Lit 实验装饰器模式使用 accessor 响应属性。外部工程在确有依赖解析需要时配置 `dependencyRoot`。具体限制与命令见[依赖与部署](references/dependencies-and-deployment.md)及 [`@scwc/vite-plugin` 文档](../../../projects/vite-plugin/README.md)。

## 实现与验证

先复用 `projects/server/plugins/template` 中与需求对应的入口、配置、声明式 UI、页面和测试形态。测试放在目标插件或合适的集成测试位置，使用插件私有临时数据目录。至少检查插件后端和页面各自的 TypeScript 配置；改页面时实际构建并检查生成资源路径。涉及宿主/RPC/授权边界时，用能验证真实进程或 HTTP/Socket 行为的针对性集成测试；类型检查或 Vitest 别名不能替代 Node 原生加载验证。

按改动选择测试和构建，不要求每次都跑全仓。验证控制器和命令冲突、错误响应、取消/资源释放等与本次行为相关的边界。改动完成后更新目标插件自己的 `docs/map.md`（若存在并受影响），复查 diff 只包含获准范围。

插件开发期间的 AOCI 收尾范围见仓库根 [AGENTS.md](../../../AGENTS.md)：不要维护根目录 AOCI；若目标插件目录存在自己的 AOCI，且本次改动涉及其受管理对象，则在插件对象稳定后按该插件的本地约定维护。
