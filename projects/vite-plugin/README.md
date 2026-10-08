# SCWC Vite 插件

`@scwc/vite-plugin` 是插件前端开发使用的工作区包。放在独立的 `projects/vite-plugin/`，让本地 Vite 与核心自动构建复用同一实现；不发布到 npm。运行入口使用原生 ESM JavaScript，配套 `.d.ts` 类型与 checkJs 检查，可直接由核心的 Node 原生配置加载器执行。

## 使用

在核心工作区运行 `bun install` 会链接该包。插件的 Vite 配置建议使用：

```ts
import { defineConfig } from 'vite';
import scwcVite from '@scwc/vite-plugin';

export default defineConfig({
  plugins: [scwcVite()],
  worker: { plugins: () => [scwcVite()] },
});
```

Worker 构建使用独立的插件列表，因此存在前端 Worker 时同时配置 `worker.plugins`，每次返回新的实例。保留自己的 root、base、build.outDir 等业务配置。这里是 Vite 专用插件：使用 configResolved 和 Vite 解析、转译接口。

独立开发工程可通过本地 file 依赖或目录链接引入该包，无需发布 npm；运行本地 Vite 仍需要 Node、Vite 和 esbuild。若包被复制到核心工作区之外，使用 `scwcVite({ dependencyRoot: '/path/to/scwc' })` 显式指定已安装共享依赖的核心工作区；默认从此 Vite 包的位置解析共享包。业务私有依赖由插件提供，插件不会联网安装依赖。

## 行为

- 自动解析 dependencies.js 的前端共享白名单。业务源码保留 `import ... from 'lit'`、`'zod'` 等正常包名与子路径，不自动注入变量。先按业务插件位置解析，缺失时才回退核心包；沿用 Vite 的浏览器条件、CSS/WASM 等资源解析。
- 自动处理 `scwc:deps`，浏览器适配只导出 z；无需自行创建适配文件或 alias。前端专用文件可直接从 zod 导入；前后端共享文件仍可使用 scwc:deps，后端通过 SDK 钩子加载。
- 为 JS/TS 装饰器使用现有 esbuild 工具链预先转换，读取源码附近 tsconfig 的标准/实验模式，避免 Vite 8 的 Oxc 保留浏览器无法解析的装饰器。保留 sourcemap 和后续 JSX 转换，跳过 raw/url 资源。
- 同一页面或 Worker 环境多次注册时只有第一个实例处理解析与转译，支持核心自动注入与用户配置同时存在。

插件随源码交付自己的前端 tsconfig；experimentalDecorators 是语义选择，不是必须打开的统一开关。Lit 的实验模式配合 accessor 响应属性。后端和 Vite 配置仍遵守 Node 原生可执行语法限制。

## 核心与可执行文件

核心页面构建器自动为页面及 Worker 注入本插件；即使旧插件没有显式配置，也可使用共享能力。构建配置中导入 `@scwc/vite-plugin` 时，核心为外部目录提供该构建包的解析回退。

该包已加入核心 sharedBuildPackages，build:core 通过 shared-package-assets.ts 携带 package.json、运行模块、声明和浏览器适配；与 Vite/esbuild 一起在首次页面构建时释放。部署可执行文件时无需另装此包、Node 或 Vite。

既有 HTML 不自动重建。更新源码、共享依赖或构建插件后执行 `plugin build-web <插件目录名>`，然后刷新页面。

验证复用 `projects/server/plugin/web/web-build.test.ts`：独立 Vite 的 bundle/native 配置加载、外部目录白名单/私有包、虚拟 SDK、CSS/子路径/Worker、两种装饰器、重复注册与真实 SEA 构建。Vite 升级时核对 transformWithEsbuild 接口及 Oxc 装饰器支持。
