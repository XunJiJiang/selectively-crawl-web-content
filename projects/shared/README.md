# Shared

`@scwc/shared` 是独立的私有工作区包，为核心及插件提供共享组件、工具和类型；不发布到 npm。根目录提供两个公开入口：

| 入口 | 插件导入 | 内容 |
| --- | --- | --- |
| `frontend.ts` / `@scwc/shared/frontend` | `scwc:shared/frontend` | 后端入口的通用能力，以及表单组件、通知、滚动容器、浏览器配置/存储/日志、刷新规则、自定义元素注册、请求生命周期和 DOM 资源管理 |
| `backend.ts` / `@scwc/shared/backend` | `scwc:shared/backend` | cache、debounce、tryCatch、FetchError、补全解析、声明式 UI 校验与表达式、反馈客户端，以及响应、JSON、UI、通知和任务类型 |

```ts
// 插件前端
import { SCWCButton, SCWCScrollContainer, tryCatch, notify } from 'scwc:shared/frontend';
import type { SCWCButtonEventMap, ScrollState } from 'scwc:shared/frontend';

// 插件后端或 createPluginWorker 创建的 Node Worker
import { cache, tryCatch, UIError } from 'scwc:shared/backend';
import type { UIContent, ResponseData } from 'scwc:shared/backend';
```

前端入口会注册 `scwc-button/input/trigger/toggle/select/checkbox/notify/scroll-container`，并创建或复用页面通知挂载点。`@scwc/vite-plugin` 自动为每个 HTML 入口加载它；只使用组件标签时无需手工 import，调用工具或引用组件类时使用命名导入。前端入口需要 DOM，不能在 Node 或浏览器 Worker 中加载；Vite 的 Worker 构建不会自动注入它。前端配置与存储仍按当前页面 origin 隔离。

后端入口没有浏览器依赖，支持 Node 原生 strip-only TS。核心 SDK 在导入插件前注册 `scwc:shared/backend`，与 `scwc:deps`、`scwc:runtime` 使用同一钩子及 Worker 引导机制；源码、CJS bundle 与两种发行包复用同一入口。前端的虚拟入口由 Vite 解析到核心包，插件无需在自己目录安装 shared。

运行 `bun install` 链接工作区包。插件开发类型继续通过 `projects/server/plugin/sdk/modules.d.ts` 和 `projects/server/plugins/plugin-env.d.ts` 接入；前端入口同时引入 Vite 资源声明及组件标签类型。包内已有的工作台协议、布局和配置交付队列仍作为核心内部模块使用，未加入公开入口。

发行构建通过 `@scwc/vite-plugin` 的工作区依赖收集 shared 源码、CSS 及前端依赖；工具链在首次页面构建时释放。已有插件页面需执行 `plugin build-web <目录名>` 后刷新才能使用新增组件。
