# Web 插件工作台

采用 Lit 构建的 SCWC 前端。视觉规范见 [Web UI 详细设计](../../docs/Web%20UI%20详细设计.md)，运行方式、状态与 SDK 边界见 [Web 前端接入](../../docs/Web前端接入.md)。

```sh
# 仓库根运行 Vite 和核心，然后打开核心实际打印的 /web/ 地址
bun run dev:web
bun run dev:server

bun run --cwd projects/web build
bun run test --run --project selectively-crawl-web-content-web
```

核心持久化工作区、收藏、统一关闭历史、通知与 Web 终端。前端的租约/CAS、事件恢复与实例池分别位于 `src/workbench/store.ts`、`src/api/workbench.ts`、`src/workbench/frames.ts`。浏览器 SDK 的源码位于 `projects/webUtils/lib/`，修改后需单独构建。
