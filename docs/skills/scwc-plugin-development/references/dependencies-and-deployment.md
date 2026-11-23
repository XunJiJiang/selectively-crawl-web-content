# 插件共享模块、前端构建与部署

以 SDK 运行时、类型声明和发行资产清单确认共享依赖。Node 入口在 `projects/server/plugin/sdk/`，Vite 入口在 `projects/vite-plugin/`，核心构建入口在 `projects/server/plugin/web/`，发行资源见 `projects/server/scripts/shared-package-assets.ts`。

## Node 虚拟模块

插件进程在动态导入插件前注册并冻结虚拟模块。类型来自 `modules.d.ts`，运行时解析依赖 Node hooks。

- `scwc:deps` 提供 `axios`、`AxiosError`、`AxiosHeaders`、`chalk`、`z`、`Database`、`trash`、`fileType`、`fileTypeFromFile/Buffer/Stream`、`fflate` 与声明中的对应类型。白名单外的依赖由插件声明。
- `scwc:runtime` 提供 `RpcPeer`、`PluginProcessError`、`createPluginWorker` 和 `PluginWorkerOptions/PluginRequest` 类型。Worker 传 file URL，由引导文件先装 SDK 再加载入口，并保留 `SCWC_APP_DIR`、`SCWC_RUNTIME_ROOT`、`SCWC_DISTRIBUTION_MODE`。自建进程或 Worker 需自行安装所用 hooks。
- `scwc:shared/backend` 提供无 DOM 的缓存、防抖、错误处理、命令补全、声明式 UI、反馈 API、树接口与模型及共享类型。后端和 Node Worker 使用该入口。

更新 `scwc:deps` 导出时同步 `dependencies.ts` 和 `modules.d.ts`，再检查 `sharedExternalPackages` 与原生资产。SQLite、Trash 和文件资源须在实际发行环境验证。

## Shared 前端入口

`@scwc/vite-plugin` 将 `scwc:shared/frontend` 解析为 `@scwc/shared/frontend` 并注入页面 HTML。它复用 backend 导出，注册共享组件，提供 `Notify/notify`、`JSONTree`、浏览器工具和核心 Web 配置类型。业务代码可从同一入口命名导入。该入口依赖 DOM，Worker 构建不会注入它。跨运行时契约需核对 `projects/shared/{backend,frontend}.ts` 的实际入口。

## 页面 SDK `window.scwcutils`

`projects/webutils` 将页面 SDK 构建为核心注入的 `window.scwcutils` IIFE，类型入口为 `projects/webutils/lib.d.ts`。使用注入的全局 SDK。

- `ready` 完成页面 grant 握手。fetch 自行等待，调用 `fetch.websocket` 或读取 `fetch.resource` 前显式等待。ready 前 `resource` 返回空字符串。请求授权、暂停与恢复见[运行契约](runtime-contract.md)。
- `config.get/subscribe` 读取和订阅插件的有效配置。写入由后端业务 API 验证已读的 `baseRevision` 并调用 `context.config`。冲突时保留用户草稿。
- `ui.handlers.register` 注册当前文档的处理器，宿主仅接收描述和 revision。释放时调用异步 `dispose()`，会停止该文档的处理器订阅。
- `lifecycle.register` 管理离开确认、暂停与恢复、状态序列化和预览。`navigation/search` 按 `host.capabilities` 接入工作台。
- `coreConfig.subscribe('theme', listener)` 取代旧 `theme.mode/tokens/onChange`，目前只提供 `theme` 通道。先判断 `host.capabilities.coreConfig`，独立页用自身样式。可在 ready 前订阅，连接后收到初值和后续变化，重连自动登记。用返回函数注销。快照只读，`preference` 保留 `system` 等用户选择，`mode` 是生效样式，可包含未来标识，`tokens` 是公开语义变量。插件自行应用 DOM 或 CSS。[页面 SDK 示例](../../../../projects/webutils/README.md#可暴露的核心-web-配置)
- `host.executeCommand`、焦点与可见性、活动租约和归属页面的反馈能力按 `host.capabilities` 使用。

## 私有依赖与共享依赖

- Node 私有包按普通包名解析，由插件自己的依赖布局提供。SDK 未公开的根项目依赖不会自动回退到根目录。
- 前端用 `lit`、`@lit/*` 等正常包名。Vite 先从插件位置解析，再按 `sharedBrowserPackages` 白名单回退核心锚点，保留浏览器导出条件与子路径。浏览器 `scwc:deps` 当前只提供 Zod 的 `z`。
- 浏览器白名单由 `projects/vite-plugin/dependencies.js` 管理，构建工具清单由 `projects/server/plugin/web/dependencies.ts` 管理。授权的共享 API 变更须同步运行时、类型、发行收集和使用方。
- 需要额外依赖或不同版本时，由插件声明并安装自己的依赖。

## `@scwc/vite-plugin`

将 `scwcVite` 注册在插件自己的 Vite 配置中。

```ts
import { defineConfig } from 'vite';
import scwcVite from '@scwc/vite-plugin';

export default defineConfig({
  plugins: [scwcVite()],
  worker: { plugins: () => [scwcVite()] },
});
```

有 Worker 时在 `worker.plugins` 为每次构建返回新实例。页面及 Worker 的装饰器由 esbuild/Vite 转换。核心构建也会注入同一插件，重复实例只启用首个。可用 `ScwcViteOptions.dependencyRoot` 指定浏览器共享依赖的回退锚点。Vite 配置由 Node 原生加载，使用 JS 或可擦除的 TS。

## 前端配置与构建

页面使用插件自己的 `web/tsconfig.json`。模板纳入插件全局声明、虚拟模块声明和 `webutils/lib.d.ts`。浏览器页面源码由 Vite 转换，Lit 装饰器与字段写法需匹配页面 tsconfig 和转换器。

Vite 保留插件自己的 `root/outDir`，并按实际插件目录名设置 `base` 为 `/web/page/plugin/${encodeURIComponent(path.basename(directory))}/`，供构建后的 JS、CSS 和静态资源寻址。

按部署方式选择交付物。

1. `ui.entry` 指向完整 HTML，并随插件交付全部引用的 JS、CSS、WASM、字体和图片。
2. 交付源码和 Vite 配置，声明 `"build:web": "vite build --config vite.config.ts"`。核心只在 HTML 缺失时自动构建。已有页面用 `plugin build-web <插件目录名>` 或相应 CLI 重建。

仓库内构建命令先同步版本。template 声明 `node ../../../scripts/sync-versions.ts && vite build --config vite.config.ts`。核心解析器剥离该精确前缀后只运行 Vite，外部插件可直接声明 `vite build ...`。

核心按受限 Vite 声明解析 `build:web`。白名单外的选项写入 Vite 配置，精确语法见 `projects/server/plugin/web/options.ts`。核心在临时目录构建，失败保留旧页面。构建成功后刷新页面，后端有改动时另行重载。

根 `projects/scripts/sync-versions.ts` 同步工作区版本。插件中只有 `server/plugins/template`、`terminal/plugins/template` 和 `terminal/plugins/scwc` 跟随根版本，普通插件独立维护。直接运行同步脚本可传 `1/2/3` 递增主、次、修订位并归零后续位。构建前缀使用无参数同步。

## 独立部署与验证

插件路径应通过 `import.meta.url`、`fileURLToPath()` 和 `pathToFileURL()` 等稳定方式解析。不要假定 cwd、仓库根或 `projects/server/plugins` 是运行根。业务持久数据不要写入 SEA 临时 SDK 目录。

也可在仓库根运行 `bun run build:plugin-web --directory <插件目录>`，或使用发行程序的 `--build-plugin-web <插件目录>`。SEA 和外置 Node 的配包见 `projects/server/scripts/{shared-package-assets,build-runtime}.ts`，外置 Node 兼容边界以 `external-node-runtime.ts` 的实际启动探针为准。

按改动选择验证原生 Node hooks、外部插件目录、真实 Worker、Vite 产物和资源路径、API/Range/Socket 或页面授权。涉及发行依赖时直接验证对应发行。测试数据放在隔离目录。
