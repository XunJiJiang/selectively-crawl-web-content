# 插件共享模块、前端构建与部署

本参考用于需要确认共享 API、类型、Worker、Vite 页面构建或独立部署时。根目录依赖不是插件 API 清单；以 SDK 运行时、类型声明及发行资产清单为准。

主要源码入口：

- Node SDK：`projects/server/plugin/sdk/dependencies.ts`、`runtime.ts`、`register.ts`、`modules.d.ts`
- 后端插件类型：`projects/server/plugins/plugin-env.d.ts`、`projects/server/types/plugin-process.d.ts`
- shared 包：`projects/shared/backend.ts`、`frontend.ts`、`package.json`
- 浏览器 SDK：`projects/webutils/lib/index.ts`、`workbench.ts`、`lib.d.ts`
- Vite 集成：`projects/vite-plugin/index.js`、`dependencies.js`、`index.d.ts`
- 页面构建和发行依赖：`projects/server/plugin/web/`、`projects/server/scripts/shared-package-assets.ts`

## Node 虚拟模块

插件进程在动态导入插件之前注册同步 Node 模块钩子。SDK 虚拟模块不需要同名 npm 包；声明文件只帮助类型检查，不会注册运行时模块，也不会改变普通 Node 包名的解析。

| 模块 | 当前公开内容 | 用途与边界 |
| --- | --- | --- |
| `scwc:deps` | `axios`、`AxiosError`、`AxiosHeaders`、`chalk`、`z`、`Database`、`trash`、`fileType` 及 `fileTypeFromFile/Buffer/Stream`、`fflate`；同时导出对应依赖类型 | 受控后端共享依赖。它不是根依赖的通用转发器；私有依赖由插件自己声明。 |
| `scwc:runtime` | `RpcPeer`、`PluginProcessError`、`createPluginWorker`，及 `PluginWorkerOptions`、`PluginRequest` 类型 | 创建 SDK 已初始化的插件 Worker 和使用 RPC 类型。Worker 入口必须是 file URL。 |
| `scwc:shared/backend` | `@scwc/shared/backend` 的通用缓存/防抖/错误处理/命令补全、声明式 UI 与表达式、反馈 API 及共享类型 | 无 DOM 的 Node/Worker 共享逻辑。不能导入需要浏览器 DOM 的 frontend 入口。 |

SDK 会冻结并注册各模块导出。每个 Worker 有独立模块环境，`createPluginWorker()` 使用引导文件先注册 SDK 再加载入口，并保留 `SCWC_APP_DIR`、`SCWC_RUNTIME_ROOT`、`SCWC_DISTRIBUTION_MODE` 运行字段。自建 Worker 或子进程不能假设会继承 Node hooks。

`scwc:deps` 的运行时导出见 `dependencies.ts`，类型映射见 `modules.d.ts`；增加或删除导出需要两处同步，并检查 `sharedExternalPackages` 和原生资源收集。SQLite、Trash 或文件资源不能只验证 JS bundle。

## Shared 前端入口

`@scwc/shared` 的 `./backend` 与 `./frontend` 是明确工作区子路径。

- `scwc:shared/frontend` 由 `@scwc/vite-plugin` 解析为 `@scwc/shared/frontend`，并由 Vite HTML transform 注入页面 head。它复用 backend 导出，还注册 shared 表单组件、通知、滚动组件并提供浏览器工具、存储/配置和请求生命周期类型。
- 该入口需要 DOM，不要从 Node 插件后端或 Worker 导入。Worker 插件列表不会自动注入 `scwc:shared/frontend`。
- 插件代码需要 shared 页面工具/组件类时，可显式从入口命名导入；副作用入口自动注册组件，不会创建 `window` 全局变量。
- `scwc:shared/backend` 是 Node SDK 模块，`@scwc/vite-plugin` 不把它映射成浏览器入口。需要两端共用的纯数据/类型契约时，先查看 `@scwc/shared` 实际导出与各运行时加载方式，避免让前端导入 Node-only 内容。

## 页面 SDK `window.scwcutils`

`projects/webutils` 将 SDK 构建为全局 IIFE，类型由 `projects/webutils/lib.d.ts` 提供。插件页面只在该全局下使用 SDK，不要通过相对路径导入核心运行时源码。

- `ready` 完成页面 grant 握手；fetch 会等待 ready。创建 WebSocket 前应先等待 ready；ready 前调用 `resource` 会返回空字符串。
- `fetch(path, init?)` 经当前 grant 调用当前插件的 `ui.api`；`fetch.resource(path, options?)` 返回给 `img`、`video`、`audio`、`link` 等元素使用的 URL；`fetch.websocket` 与 `websocketAsync` 使用核心单次票据/可恢复 Socket 代理。
- `config.get/subscribe` 读取并订阅本插件有效配置，不提供页面写入接口。写配置应由后端业务 API 调用 `context.config`，验证已读快照并提交 `baseRevision`；冲突时保留用户草稿，不静默改用最新版本。
- `ui.handlers.register` 注册当前文档内处理器；callback 不离开文档，只将描述和 revision 发给宿主。注册返回 disposer，注销会停止该文档全部 handler watches。
- `lifecycle.register` 管理页面可离开确认、暂停/恢复、状态序列化/恢复和预览；`navigation`/`search` 在 `host.capabilities` 声明可用时与工作台集成。
- SDK 还公开 `host.executeCommand`、页面 focus/visibility、外部工作台状态、theme、活动租约、请求中断管理，以及归属当前页面的通知与任务 API。不要在普通浏览器上下文假定工作台能力存在。
- 默认请求会保护页面的工作台活动；仅明确标记 `interruptible` 的请求/资源/Socket 可被暂停中断并恢复。调用方取消、普通错误不应被当作可重放中断。

页面 API 包装结果为 `{ success, message, data }`；结构化 API 不用于大型媒体流。资源 URL 带 `site` 上下文但没有 API Bearer header，也不能凭 `site` 认证。敏感资源在插件端验证授权票据。

## 私有依赖与共享依赖

- Node 私有包按普通包名解析，由插件自己的依赖布局提供。SDK 未公开的根项目依赖不会自动回退到根目录。
- 前端正常使用 `lit`、`@lit/*` 等包名。`@scwc/vite-plugin` 的显式 `sharedBrowserPackages` 是浏览器共享白名单；它先尝试从插件导入位置解析，再为缺失共享包回退到其核心锚点，保留 Vite 的浏览器导出条件和子路径。白名单外的包不会自动从核心回退。
- 前端适配的 `scwc:deps` 目前只导出 Zod 的 `z`；它不暴露 `Database`、`axios` 等 Node SDK 能力。一般 Lit/浏览器共享依赖走正常包名，不改写为该虚拟模块。
- 增加浏览器共享包应修改 `projects/vite-plugin/dependencies.js`；核心构建工具依赖由 `projects/server/plugin/web/dependencies.ts` 维护。修改核心共享 API 属于核心改动，应先确认授权，并同步运行时、类型、构建收集、文档和受影响插件。
- 核心锁文件/白名单中的版本不等于用户插件私有版本承诺。需要不同版本或额外 Vite 插件时由插件管理自己的依赖；核心不会为了插件自动联网安装白名单外包。

## `@scwc/vite-plugin`

在插件自己的 Vite 配置中注册：

```ts
import { defineConfig } from 'vite';
import scwcVite from '@scwc/vite-plugin';

export default defineConfig({
  plugins: [scwcVite()],
  worker: { plugins: () => [scwcVite()] },
});
```

页面与 Worker 是不同构建环境；有 Worker 时 `worker.plugins` 应为每次构建返回新实例。该插件：

- 解析前端共享包名及子路径，优先插件自己的依赖，再回退浏览器白名单；
- 将 `scwc:deps` 映射到仅含 `z` 的浏览器模块；
- 将 `scwc:shared/frontend` 映射到 shared 包，并在 HTML head 注入一次副作用导入；
- 使用现有 esbuild/Vite 转换流程处理页面和 Worker 装饰器，并保留 sourcemap。

插件不自动注入任意变量，也不让 Worker 自动载入需要 DOM 的 shared frontend。核心也会自动注入同一 Vite 插件；同一 Vite 配置中重复实例只有首个生效。`ScwcViteOptions` 当前支持可选 `dependencyRoot`，用于明确指定缺失浏览器共享依赖的核心工作区锚点。Vite 配置自身由 Node 原生加载，使用 JS 或 Node 可直接擦除的 TS 语法。

## 前端配置与构建

每个插件页面自带 `web/tsconfig.json`；不要依赖仓库根或当前工作目录偶然找到的配置。模板将插件全局声明、SDK 虚拟模块声明和 `webutils/lib.d.ts` 纳入页面检查。后端与 Vite 配置遵循 Node 原生可擦除 TS 限制；浏览器页面源码由 Vite 转换。

推荐的 Vite 配置保留插件自己的 `root`、`outDir` 等设置，并将 `base` 指向实际插件目录名：`/web/page/plugin/<目录名>/`。这决定打包后的 JS/CSS/静态资源 URL，不能用 `package.json.name` 代替目录名。Lit 实验装饰器模式显式打开 `experimentalDecorators` 并采用 accessor 响应属性；标准模式按自己的 tsconfig 语义转换。只把 `build.target` 设高不能替代装饰器转换验证。

两种交付方式：

1. `ui.entry` 指向完整 HTML，并随插件交付全部引用的 JS、CSS、WASM、字体和图片。
2. 交付页面源码和 Vite 配置，并声明 `"build:web": "vite build --config vite.config.ts"`。核心只在 HTML 缺失时自动构建；已有产物需要 `plugin build-web <插件目录名>` 或对应构建 CLI 主动重建。

核心把 build:web 作为受限 Vite 构建声明解析，不执行任意 shell 命令链。构建在临时目录进行，普通失败保留旧页面；构建不重载插件后端，成功后刷新页面。详细支持参数以 `projects/server/plugin/web/README.md` 和当前构建器源码为准。

## 独立部署与验证

插件路径应通过 `import.meta.url`、`fileURLToPath()` 和 `pathToFileURL()` 等稳定方式解析。不要假定 cwd、仓库根或 `projects/server/plugins` 是运行根。业务持久数据不要写入 SEA 临时 SDK 目录。

页面构建可通过核心命令、`bun run build:plugin-web --directory <插件目录>` 或发行程序的 `--build-plugin-web <插件目录>` 执行。SEA 与外置 Node 发行的工具链收集情况查看 `projects/server/scripts/shared-package-assets.ts` 与部署文档；不要依据本机 `node_modules` 推断压缩包一定包含某项依赖。

验证应覆盖本次影响的真实边界：插件 Node 原生动态加载和 hooks、实际 Worker、外部插件目录、页面 Vite 构建与资源路径、API/Range/WebSocket、配置 revision 或页面授权。Vitest alias 和 TypeScript 检查不能代替原生 Node 加载或真实浏览器运行。测试数据放在插件专属临时目录，避免依赖 Redis 或真实用户数据。
