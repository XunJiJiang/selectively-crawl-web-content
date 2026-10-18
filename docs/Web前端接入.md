# Web 工作台前端接入

实施日期：2026-10-18。界面以《Web UI 详细设计.md》的 2026 深浅主题、语义 token 和七区布局为准，复用项目已有 Lit、CodeMirror、Codicons 与虚拟列表依赖。前端仍由核心 `/web/` 承载。

## 运行与构建

从仓库根执行：

```sh
bun run dev:web
bun run dev:server
```

开发时从核心实际打印的 `http://localhost:<实际端口>/web/` 打开。3201 是 Vite 资源服务，管理 API、插件页、启动配置与事件仍由核心处理，不要将 Vite 端口当作核心端口。源插件页使用已构建的浏览器 SDK；修改 SDK 后另执行 `bun run --cwd projects/webUtils build`。

生产产物：

```sh
bun run --cwd projects/web build
bun run --cwd projects/webUtils build
```

产物进入既有 `projects/server/public/web` 与 `public/lib` 生成目录。SDK 明确构建为单个 IIFE，供核心在插件应用脚本之前注入；终端编辑器在首次使用终端时加载。

## 交互与持久化

- 顶栏提供六类菜单和快速访问，按实际宽度从末尾溢出。`>` 查找操作，`@` 查标签，`*` 查收藏，`#` 查关闭历史。元数据通过后端搜索及游标分页补齐，在线页面内容搜索单独显示来源及分页状态。
- 活动栏切换搜索、页面、收藏、历史和插件，底部为设置与独立快捷键设置。设置页的搜索独立于工作台内容搜索。
- 侧栏、底部面板、中心分组支持拖动调整与方向键调整；标签可拖动或通过上下文菜单移动。侧栏可交换左右，标签栏支持四个位置，面板支持三个停靠方向及中心/全宽对齐。
- 主布局和标签通过租约、CAS 与串行事务保存；窗口的 `workspaceId` 进入 sessionStorage。每个文档有新的 `clientWindowId`，每 10 秒续租，pagehide 尝试 keepalive 释放，租约过期仍由服务端裁定。同名存活窗口由后端克隆；不依赖关闭浏览器事件维持唯一写入者。
- 工作区写入失败保留本地草稿并标记“尚未保存”。设置中可重试同一幂等操作、导出草稿，或显式接受服务端版本。失败的关闭事务保留标签，不伪造已关闭记录。离线时不能继续积累新的工作区写入事务。
- 收藏保存精确 URL/locator；重复 query 参数、顺序及 hash 保留。关闭插件标签通过专用事务写统一历史，内置页、终端归档、导航、刷新和休眠不产生插件关闭历史。
- 同一安装更换监听端口时，根据 locator 恢复当前地址；不同 installationId 的收藏不自动重绑定。
- 配置控件提交字符串，支持声明式、后端必需和原页面必需校验。远端修改与本地编辑冲突时保留草稿，提供接受远端或保留本地重新校验的选择，不静默覆盖。
- 公共输出和命令终端分开。每个终端独立保留草稿、历史及输出；归档可恢复。Enter 提交、Shift+Enter 换行、Tab 补全；IME 不提交，有选区的 Ctrl+C 与 Cmd+C 保持复制行为。强制取消前展示宿主影响范围。
- 通知提供未读、错误及来源筛选、共享已读和删除。日志与通知正文以纯文本显示。

窗口变窄时只临时折叠区域，不反写保存的尺寸或分组结构。默认采用详细 UI 设计的深色主题，可选择浅色或跟随系统。布局命名预设保存在当前浏览器，应用预设只改变布局并保留全部逻辑标签。

## 插件页面 SDK

`projects/webUtils/lib/index.ts` 继续暴露 `fetch/resource/websocket`，并提供：

```ts
await scwcutils.ready;
await scwcutils.page.register({ title: '我的页面', dirty: false });
scwcutils.lifecycle.register({
  serialize: () => ({ schemaVersion: '1', data: { draft: '...' } }),
  restore: state => { /* 插件核对版本并恢复自己的 JSON 数据 */ },
  canLeave: () => true,
});
await scwcutils.lifecycle.checkpoint();

await scwcutils.search.register({
  search: async ({ query, cursor, limit, signal }) => ({
    items: [{ id: 'result-1', title: query }],
    nextCursor: null,
  }),
});
```

扩展能力还包含动态 settings 注册、字符串 config CRUD/订阅、页面 logger、theme 读取/订阅、activity 保活句柄与 requests.track。函数保留在页面，宿主只接收声明与 RPC 结果；`page-required` 校验票据由实际原页面领取。

宿主与 SDK 以精确 origin、iframe.contentWindow、随机 documentNonce 和 frameEpoch 绑定 MessageChannel，只下发短期 scoped grant。导航使旧通道失效；序号、请求 ID 与代次拒收旧回调。没有 parent 的插件页独立领取页面授权并订阅配置流；不提供工作台分组或内容搜索宿主。

`fetch` 可等待初始化，兼容旧页面在 load 中发请求。同步 `websocket` 返回具有 WebSocket 常用属性、事件和方法的连接适配器，在取得一次性票据后连接；需要原生 WebSocket 实例时使用 `await scwcutils.websocketAsync(path)`。长期管理 TOKEN 不进入消息广播或 WebSocket URL。

FramePool 只在一个稳定容器中创建 iframe，跨组移动与标签排序不重新挂载。后台页面收到显式可见性/焦点通知。启用自动休眠后，30 秒协作暂停，按设置分钟数或热实例预算尝试回收；可见、脏页、保活活动、请求和不支持状态恢复的页面受到保护。只有快照持久化及工作区引用保存成功后才卸载；保存失败保留文档并恢复运行。脏状态与显式 checkpoint 合并节流保存，替换后的无引用旧快照尽力清理。

预览仅在插件提供 PNG capturePreview 时获取，并通过图片专用接口上传；无能力或失败时保留文字与通用图标，不声称可以通用截取任意 iframe。

## 当前边界

实际后端只提供扁平收藏及 theme/keybindings/energy 三类偏好。收藏文件夹、跨设备布局预设、自定义主题导入、按插件节能例外，以及保留期限/备份管理的完整设置界面尚未实现；没有显示无法落地的保存按钮。历史和通知列表按服务端游标加载，通用元数据搜索可继续加载各来源。

页面恢复依赖插件自行校验状态版本；恢复失败保留快照并显示错误。页面搜索仅调用已打开、已注册的在线实例。原生 fetch/XHR、媒体和 Worker 不纳入完整网络观测。浏览器保留的 Ctrl/Cmd+W、Ctrl+Tab 等组合键有替代操作，不能保证接管。

## 验证

```sh
bunx tsc -p tsconfig.app.json --pretty false
bunx tsc -p tsconfig.plugin-web.json --pretty false
bun run test --run --project selectively-crawl-web-content-web
bun run test --run projects/server/workbench/frontend.test.ts \
  projects/server/workbench/workbench.test.ts \
  projects/server/router/web/workbench/backend.test.ts \
  projects/server/router/web/local-config.test.ts \
  projects/server/router/web/websocket.test.ts
```

回归覆盖后端布局校验、独立导航、保存串行/CAS 草稿、原子关闭失败保护、稳定 iframe、休眠保存失败、消息身份与清理、搜索取消/游标、菜单、编辑器 Enter/IME 及票据 WebSocket 兼容。浏览器集成验证使用 `/tmp` 中的隔离插件和数据库，避免触碰实际插件业务数据。
