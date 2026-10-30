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

`wb-scroll-container` 支持 `wheel-distance-ratio`（属性 `wheelDistanceRatio`，默认 1）和 `max-wheel-distance`（属性 `maxWheelDistance`，工作台默认 80px，0 表示不限）。滚轮的像素、行或页距离先换算为像素，乘以倍率后再限制单个事件的距离，超出部分丢弃；随后按原有平滑或跳跃模式滚动。双轴限幅保持方向比例，倍率 0 阻止滚轮移动。可在组件上独立设置，例如 `<wb-scroll-container scroll-behavior="instant" step-distance="20" wheel-distance-ratio="0.5" max-wheel-distance="40">…</wb-scroll-container>`。

底部面板的终端和输出页启用 `line-scroll`，单事件上限自动设为当前一行的排版高度，并随字体和行高更新；每次滚轮事件最多滚动一行。

中心标签拖拽时显示插入线，顶部和底部标签栏按左右位置、左侧和右侧标签栏按上下位置判断；松手后的顺序与插入线一致，固定标签仍排列在前。终端输出支持拖选后使用 Ctrl/Cmd+C 或浏览器右键菜单复制；没有输出选区时 Ctrl+C 保留取消运行命令的行为。

开发模式下，核心的 `/web/` 跳转到 `--web-port` 指定的 Vite 端口（默认 3201，可用 `--web-host` 指定地址）。Vite 保留页面来源，将启动配置、API、插件页面、资源及 WebSocket 转发给核心，本机页面可自动加载当前 TOKEN；手动认证成功后也会保存 TOKEN。生产模式仍由核心直接提供 `/web/`。

开发模式下，核心固定监听 `PORT` / `--port`，端口占用时直接启动失败；`.env` 的 `PORT_SEARCH_RANGE` 和 CLI 的 `--port-range` 均被忽略，显式配置非零范围时会输出服务日志说明。生产模式保留端口自增能力。

Vite 从仓库根目录的环境文件读取核心的 `HOST` / `PORT`，缺省连接 `http://localhost:3200`；`SCWC_CORE_URL` 可覆盖完整的核心代理地址。使用 `--core-port` 可以单独覆盖核心代理端口，优先于上述环境配置，仅对本次 Web 启动生效，不需要设置 PowerShell 的 `$env:PORT`。

`--port` 是 Web 自身的监听端口，`--core-port` 是它连接的核心端口。修改 Web 端口时，同时设置核心的 `--web-port`。例如在两个终端分别运行：

```sh
bun run dev:server --port=5174 --web-port=5173
bun run dev:web --port=5173 --core-port=5174
```

打开 `http://localhost:5173/web/`。`--core-port 5174` 和 `--core-port=5174` 两种写法均支持；其他 Vite 参数（例如 `--host`、`--mode`）继续原样传递。
