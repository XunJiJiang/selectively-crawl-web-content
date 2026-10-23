# Web 插件工作台

采用 Lit 构建的 SCWC 前端。视觉规范见 [Web UI 详细设计](../../docs/Web%20UI%20详细设计.md)，运行方式、状态与 SDK 边界见 [Web 前端接入](../../docs/Web前端接入.md)。

```sh
# 仓库根运行 Vite 和核心，然后打开核心实际打印的 /web/ 地址
bun run dev:web
bun run dev:server

bun run --cwd projects/web build
bun run test --run --project selectively-crawl-web-content-web
```

核心持久化工作区、收藏、统一关闭历史、通知与 Web 终端。前端的租约/CAS、事件恢复与实例池分别位于 `src/workbench/store.ts`、`src/api/workbench.ts`、`src/workbench/frames.ts`。浏览器 SDK 的源码位于 `projects/webutils/lib/`，修改后需单独构建。

开发模式下，核心的 `/web/` 跳转到 `--web-port` 指定的 Vite 端口（默认 3201，可用 `--web-host` 指定地址）。Vite 保留页面来源，将启动配置、API、插件页面、资源及 WebSocket 转发给核心，本机页面可自动加载当前 TOKEN；手动认证成功后也会保存 TOKEN。生产模式仍由核心直接提供 `/web/`。

开发模式下，核心固定监听 `PORT` / `--port`，端口占用时直接启动失败；`.env` 的 `PORT_SEARCH_RANGE` 和 CLI 的 `--port-range` 均被忽略，显式配置非零范围时会输出服务日志说明。生产模式保留端口自增能力。

Vite 从仓库根目录的环境文件读取核心的 `HOST` / `PORT`，缺省连接 `http://localhost:3200`；`SCWC_CORE_URL` 可覆盖完整的核心代理地址。使用 `--core-port` 可以单独覆盖核心代理端口，优先于上述环境配置，仅对本次 Web 启动生效，不需要设置 PowerShell 的 `$env:PORT`。

`--port` 是 Web 自身的监听端口，`--core-port` 是它连接的核心端口。修改 Web 端口时，同时设置核心的 `--web-port`。例如在两个终端分别运行：

```sh
bun run dev:server --port=5174 --web-port=5173
bun run dev:web --port=5173 --core-port=5174
```

打开 `http://localhost:5173/web/`。`--core-port 5174` 和 `--core-port=5174` 两种写法均支持；其他 Vite 参数（例如 `--host`、`--mode`）继续原样传递。
