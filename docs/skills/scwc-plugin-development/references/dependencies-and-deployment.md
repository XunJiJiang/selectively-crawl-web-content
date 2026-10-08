# 依赖、前端构建与独立部署

源码核对日期：2026-10-08。开发涉及依赖、类型、Worker、页面构建、Redis 或可执行文件部署时阅读本参考。

本参考服务于插件开发，不额外授权修改核心、安装依赖或全局安装 skill。当前源码是事实依据；主要入口为 [共享 SDK](../../../../projects/server/plugin/sdk/README.md)、[页面构建器](../../../../projects/server/plugin/web/README.md)、[依赖维护地图](../../../map.md) 和 [环境模板](../../../core.env.example)。

## 1. 依赖解析与类型

| 使用位置 | 推荐写法 | 需要注意 |
| --- | --- | --- |
| 后端共享包 | `import { axios, z, Database } from 'scwc:deps'` | 宿主钩子提供模块，不是 npm 包；只提供明确的公共导出 |
| 后端私有包 | 普通包名导入 | 插件需提供自身依赖；包名不会自动回退后端 SDK |
| 前端共享包 | `import { html } from 'lit'` 等原包名 | 核心 Vite 构建器优先按插件位置解析，缺失时回退浏览器白名单，保留子路径和浏览器导出条件 |
| 前后端共享 Zod 模型 | `import { z } from 'scwc:deps'` | @scwc/vite-plugin 自动提供浏览器适配；核心自动注入，本地 Vite 建议显式注册 |
| Worker/RPC | `import { createPluginWorker, RpcPeer } from 'scwc:runtime'` | Worker 独立注册钩子，不通过相对路径导入核心实现 |

根 package.json 声明的依赖不等于 SDK 公共依赖。后端公共导出看 `projects/server/plugin/sdk/dependencies.ts` 和 `modules.d.ts`；浏览器白名单看 `projects/vite-plugin/dependencies.js` 的 sharedBrowserPackages，构建工具看 `projects/server/plugin/web/dependencies.ts` 的 sharedBuildPackages。不要将“源码目录里能找到包”视作 SEA 或外部目录的可用性承诺。

运行时与类型检查分别处理：

```ts
import { axios, z, Database } from 'scwc:deps';
import type { AxiosRequestConfig, FileTypeResult } from 'scwc:deps';

const options: AxiosRequestConfig = { timeout: 1000 };
const schema = z.object({ count: z.number() });
type Result = z.infer<typeof schema>;
```

- 模板 tsconfig.files 包含 `../plugin-env.d.ts` 和 `../../plugin/sdk/modules.d.ts`。独立目录开发时显式指定核心工作区中这两份文件的实际路径，不照搬已失效的相对路径。
- 当前声明引用原包类型和核心源码类型，需要可访问的核心源码布局及已安装类型依赖；没有独立类型发行包，不能从压缩 JS 或可执行文件还原声明。开发文件无需随插件部署。
- TypeScript 声明不会注册 Node 钩子；Vite 别名也不改变原生 Node 解析。类型检查通过不能替代实际加载测试。
- `scwc:deps` 的浏览器适配目前只导出 `z`，不提供 Database 等 Node 能力；普通 Lit 包共享不经过这个适配。前端保留正常的 `lit` / `@lit/*` 导入，无需统一改成虚拟模块。

## 2. 新增、升级与移除依赖

- 核心私用的新依赖不必加入 SDK。插件先检查现有公共接口，只有需要对插件承诺共享时才扩展对应契约；没有核心修改授权时不要仅为插件方便主动改核心。
- 共享后端包同时更新运行时导出与声明。原生二进制、资源相对路径或外部工具不能只依赖 JS bundle，需核对 `sharedExternalPackages` 和 SEA 资源收集。
- 共享前端包加入 projects/vite-plugin/dependencies.js 的 sharedBrowserPackages；核心 plugin/web/dependencies.ts 保留兼容导出并维护构建工具白名单，包含 @scwc/vite-plugin。额外 Vite 插件、预处理器和私有包不能因“根目录装过”而假定已随可执行文件交付。特殊版本由插件提供自己的依赖，并记录原因。
- 根 package.json 与 bun.lock 决定共享版本。兼容升级通常不改 SDK 导出或声明里的版本数字，安装更新后声明自动引用新类型；仍需验证并重新构建核心。已有页面里嵌入的是旧依赖，需主动重新构建页面。
- 主版本、默认/命名导出、子路径、泛型或资源布局变化时，核对 SDK 适配、受影响插件、浏览器导出条件、Vite 插件兼容性、原生平台/运行时。移除公共导出保留兼容别名或明确约定升级，避免只删根依赖破坏已有插件。
- 安装前核对用户已给出的授权；不要重复询问已决定的版本和安装位置，也不要默默在插件目录重复安装核心已共享的包。

## 3. Worker、路径与原生运行

```ts
import { createPluginWorker } from 'scwc:runtime';

const worker = createPluginWorker(new URL('./worker.ts', import.meta.url), {
  workerData: { mode: 'reader' },
});
```

- Node 同步模块钩子不自动继承到 Worker。工厂先注册 SDK，再导入入口；入口是 file: URL，不支持 eval 或 SHARE_ENV。普通 Worker 或另起 Node 子进程需要自己的 SDK 注册流程。
- 每个进程/Worker 有独立依赖实例。函数、类、流和真实 socket 不能通过 IPC 作为共享依赖传递；遵循可序列化第二版接口。
- 后端及被它执行的 shared 模块只能使用 Node 24+ 可直接擦除的 TS。类型用 `import type`；参数属性、运行时 enum/namespace 或需要转译的装饰器应改写为可直接执行的语法。前端源码由 Vite 转译，不受同一语法限制。
- 插件可能位于程序同目录 plugins、SCWC_PLUGIN_DIR 或 --plugin-dir 指定目录；不能按 `projects/server/plugins/<name>` 拼接运行时资源路径，也不按相对路径读取核心实现。
- 插件自带静态资源使用 `import.meta.url` / `fileURLToPath()` 定位，动态导入绝对文件路径用 `pathToFileURL()`，避免手拼 file: URL、Windows 盘符和空格编码错误。可写数据使用明确配置的基准，保持既有数据路径约定，不假定 cwd 是仓库根或插件目录。
- SDK 的 SEA 临时资源目录不是业务持久化目录。插件私有原生库需要匹配目标平台/运行时；共享 SQLite/Trash 的运行资源由核心携带。
- 在 Windows 对刚写入的临时文件执行 fsync 时使用可写句柄，再按既有原子改名流程发布；不要以只读句柄导致的 EPERM 作为“插件依赖缺失”处理。

## 4. 前端交付二选一

**提供完整产物**：ui.entry 指向已有 HTML，并提供它引用的 JS、CSS、WASM、字体和图片。核心直接加载，既有产物可以来自其他构建工具，不要求 build:web。构建产物是否提交 Git 由插件自己的交付策略决定；忽略产物时应选择下述源码方案或通过发行包提供产物。

**提供 Vite 源码**：保留页面源码、Vite 配置及 package.json 的脚本，例如：

```json
{
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "build:web": "vite build --config vite.config.ts"
  }
}
```

入口在插件根目录时，常用 `ui.entry: './web/dist/index.html'`。相对 ui.entry 的实际基准是 main 指向的入口文件目录；main 位于 src/ 等子目录时，相应调整路径。

- 初始化顺序为入口导入 → ui.entry 准备/构建 → onLoad → 注册页面/API 等。入口顶层不能读取尚未生成的 HTML；放在 onLoad 或 ui.html。构建暂停 startupTimeoutMs，并有单独五分钟截止；失败清理宿主，插件进入 inactivePlugins。
- 核心仅检测 HTML 是否存在，不检查时间戳、不自动因依赖升级重建，也不保证只有 HTML 而缺少其他资源的交付完整性。
- SEA 内置 @scwc/vite-plugin、Vite、vite-plugin-monkey、esbuild、本机绑定和共享浏览器包；无需另装 Node/Vite，工具链首次构建时按需释放。源码模式需要安装根工作区的构建依赖。核心不自动联网安装私有包。
- build:web 被解析为 Vite 构建声明，不交给 shell 执行。支持一个 root、`--config/-c`、`--mode/-m`、`--outDir`、`--target`、`--sourcemap`、`--sourcemap=inline` / `=hidden`、`--emptyOutDir`。其他参数放入 Vite 配置；`tsc && vite build`、`bunx vite ...` 等命令链不属于当前自动构建契约。
- Vite 配置由 Node 原生加载，使用 JS 或可擦除 TS；不能依赖本地 Vite 默认配置转译来运行 enum、参数属性或装饰器。配置和 Vite 插件属于受信任代码。
- 前端自带 tsconfig.json，并随源码一起交付；不能依赖插件位于工作区内时找到的外层配置。Vite 8 的 Oxc 不会转换标准装饰器，单独设置 build.target / oxc.target 不够。核心为页面和 Worker 提供 esbuild 装饰器转换，尊重源码附近的标准/experimentalDecorators 配置。Lit 使用实验模式时在 web/tsconfig.json 显式设置 experimentalDecorators: true、useDefineForClassFields: true，响应属性使用 accessor；直接本地 Vite 构建也读取这份配置。自行交付标准装饰器产物时需提供能转换装饰器的构建插件，不能直接把含 @decorator 的 JS 交给浏览器。
- outDir 是插件内独立产物目录，不等于插件根或源码根；ui.entry 位于其中。核心构建时按实际目录名设置 `/web/page/plugin/<目录名>/`，不是 package.json.name。本地自行构建时在配置中设置正确 base；移动或重命名插件后核对预构建资源 URL。
- 构建先写临时产物，普通失败保留旧页面；同插件并发请求合并、全局串行。取消/强停可能遗留隐藏临时目录，不把它们当作正式产物交付。

## 5. 别名、重建与重启

使用 Vite 构建插件前端时，建议导入工作区包 [@scwc/vite-plugin](../../../../projects/vite-plugin/README.md)，在页面与 Worker 各自的插件列表注册：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import scwcVite from '@scwc/vite-plugin';

export default defineConfig({
  plugins: [scwcVite()],
  worker: { plugins: () => [scwcVite()] },
  // 保留插件自己的 root、base、build.outDir 等配置。
});
```

此插件自动解析前端白名单、普通包子路径/CSS/WASM、scwc:deps 浏览器适配（仅 z）及装饰器。它处理已有 import，不自动注入变量；保留 `import ... from 'lit'`、`'zod'` 等包名，前后端共享文件可继续使用 scwc:deps。不再需要自己的浏览器适配文件或 alias，也不依赖核心源码的运行时相对路径。普通包先使用业务插件私有版本，缺失时才回退白名单。

核心工作区运行 bun install 会链接该包；包使用 JS 运行入口和 .d.ts 声明，不需发布 npm。外部独立开发可通过本地 file 依赖/目录链接引入，并按需配置 `scwcVite({ dependencyRoot: '/path/to/scwc' })` 指向已安装依赖的核心工作区；本地 Vite 仍需要 Node/Vite/esbuild。仅部署 SEA 时，包及工具链已经内置，核心的配置加载器自动回退解析它，无需在业务插件中重复安装。

核心自动构建为页面与 Worker 注入同一个插件；旧插件未显式注册也可构建，同时注册时忽略重复实例。前端 Worker 的 Vite 构建使用独立插件列表，因此直接本地构建有 Worker 时需要 worker.plugins 返回新实例，不能只配置页面 plugins。配置只影响前端，后端依赖仍由 SDK 钩子处理。

```text
plugin build-web <插件目录名>
```

该命令在直接核心和多窗口终端都可用。也可不启动 HTTP/Redis，独立执行：

```sh
bun run build:plugin-web --directory <插件目录>
./scwc --build-plugin-web <插件目录>
```

Windows 可执行文件名为 scwc.exe。重建后刷新页面；重建不重新执行后端入口或 onLoad，不需要单插件动态加载/卸载。后端源码变更或未激活插件修复后，通过 restart/:r 重启核心再验证。

## 6. Redis 与缓存持久性

- 核心默认启用 Redis，但不在启动前等待其就绪；离线 Redis 可能使缓存操作报错或等待。
- 在源码根或可执行文件同目录的 .env 设置 `REDIS_ENABLED=false` / `0`，核心不创建或连接 Redis，也不校验其他 Redis 连接参数。文件中的配置优先于进程环境。
- 注入的 cache 仍提供命名空间、重定向、删除和文件缓存能力，但内存元数据不跨核心重启保留。业务必需的数据、操作历史和任务恢复记录使用插件持久化存储，不以缓存命中作为正确性前提。
- 核心开关不关闭插件自行创建的 Redis 客户端；插件确需 Redis 时声明自己的配置和必需性，不假定所有部署都有 Redis。

## 7. 与改动相称的验证

- 运行根或插件自身类型检查，保留严格约束。原生 Node 加载测试先注册 SDK，再动态导入真实入口，不用 tsx/Vitest 转译掩盖 strip-only 不兼容。
- 依赖/Worker 变更核对外部目录与 SDK 的真实加载；原生/资源型包核对 SEA 目标平台。前端变更运行核心构建器，尤其验证缺少 Vite/Lit 的外部目录、CSS/子路径/Worker 和完整静态资源。
- 装饰器或 TS/Vite 配置变更需检查外部目录产物不含未转换的装饰器语法，并验证 Lit 组件注册、响应属性变化和渲染；类型检查、构建成功均不能替代执行验证。已有错误产物不会自动覆盖，更新核心或配置后用 plugin build-web 重新生成，再刷新页面。
- 自动构建流程验证“入口 HTML 不存在但 build:web 有效”；预构建模式验证完整页面；失败不得被报告为已激活。重建后验证 iframe、scwcutils API/资源通信和目录名对应的 URL。
- 缓存使用有变更时验证 REDIS_ENABLED=false，以及命名空间隔离和缓存缺失；全部使用临时数据，避免真实媒体库和 Redis 数据。
- 复用核心现有检查：`projects/server/plugin/sdk/*.test.ts`、`plugin/web/*.test.ts`、`plugin/process/*.test.ts` 和 `utils/cache-disabled.test.ts`。按任务选择，真实可执行文件项需先构建；不是每次普通页面改动都运行整个仓库测试。
- 交付说明列出使用的共享/私有依赖、前端交付方式、重建/重启命令及实际验证范围；同步插件地图和本规范引用，避免只更新代码而留下旧契约。
