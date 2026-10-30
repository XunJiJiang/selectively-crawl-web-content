# SCWC 插件运行契约

本文件记录当前仓库源码中的插件接口和运行行为。遇到版本变化时，以 `projects/server/plugins/plugin-env.d.ts`、`projects/server/types/plugin-process.d.ts`、`projects/server/plugin/process/`、`projects/webutils/lib/` 与对应宿主实现为准。

## 加载与生命周期

- 加载器扫描配置插件目录的直接子目录；插件可能在仓库之外。入口由 `package.json.main` 指定，只接受 `.js`/`.ts`。默认导出须实现 `SCWC.IPluginHandler` 且包含 `onRequest`。
- 所有启用插件默认运行于独立 Node 进程。`runtime`/`apiVersion` 省略时为 `process`/`2`；不支持的模式或版本会使插件加载失败，不会退回核心进程。可选超时为 `startupTimeoutMs`、`requestTimeoutMs`、`shutdownTimeoutMs`。
- 页面 HTML 缺失时，加载流程尝试构建页面，再调用 `onLoad` 并注册命令/API/资源/WebSocket。页面构建失败会记录 UI 错误，后端仍可启动；入口导入或 `onLoad` 失败会使插件未激活。入口顶层不要读取自动构建才会生成的页面文件。
- `onUnload(logger, { isRestart })` 释放插件持有的定时器、订阅、声明式 UI、Worker 与其他资源。启停/重载针对插件目录串行处理；持久配置在卸载时不会清除。
- `package.json.enabled` 控制启动启用状态；运行时启停命令可能更新该字段。`link-with` 普通项按前缀匹配，带 `*` 的项按通配模式匹配，`!` 为否定规则；空数组在调用处表示匹配全部。验证时检查命中和排除案例。

## 插件可用的宿主能力

### `onLoad` 上下文

`SCWC.ILoadContext` 提供：

- `config`：插件目录隔离的持久字符串配置对象，含 `get`、`list`、`set`、`update`、`delete`、`reset`、`subscribe`。所有值均为字符串；写入可带 `baseRevision`。持久配置不是缓存，插件卸载不会删除。
- `workbench.logger`、`workbench.tasks`：长期通知与任务控制接口。通知支持创建、更新、进度、操作按钮和关闭；任务可创建自定义任务或查询/取消允许的内建任务。控制回调留在所属进程，不通过 RPC 序列化函数。
- `workbench.ui`：注册后端声明式处理器、主/辅助侧栏、状态栏、页面信息提供器和静态 UI 资源；支持事务。注册返回 disposer，卸载时应释放。
- `createRetryGet`、`LimitPromise`、插件专属 `cache`，以及可选调用级 `tasks` 与 `signal`。缓存接受的类型见 `types/cache.d.ts`，不传流、函数或 socket。

插件顶层还可声明 `configuration` 的配置定义、标准化、验证与变更回调。配置定义中的持久值仍是字符串；编解码及业务规则由插件负责。页面 SDK 的 `config` 是只读快照/订阅接口，页面的写操作应调用插件明确提供的业务 API，由后端执行校验并按已读 `baseRevision` 写入。

### 抓取与浏览器脚本控制器

- `onRequest(context, logger)` 接收采集 `data`、`site`、`signal`/`tasks` 和工具函数；抓取 logger 可用 `toWeb(message, type?)` 发通知。核心可以继续运行其他匹配插件，即使某插件请求失败。
- `pluginConfig.scripts.controls` 可为数组或动态工厂。支持 `button`、`toggle`、`select`、`input:text`、`input:number`、`checkbox`。每项需有稳定 channel 和触发器；动态工厂可按 site 返回控件。
- 控制器回调收到当前值、相关通道值、采集数据、site、signal/tasks 和普通插件 logger；没有 `toWeb`，须返回 `{ type: 'notification', data: { type, message } }`。页面数据始终需要后端重新校验。

### 命令

- 只有 `package.json.commandName` 存在时，`pluginConfig.command` 才注册一级命令；每个插件一个。冲突名称可能显示目录身份前缀。
- `execute` 收到 logger、解析后的选项、未使用参数、原始参数和 `InvocationContext`。上下文提供调用身份、取消 `signal`、任务 `tasks` 和 `next(message, Type?)`；待答输入返回 `[error, value]` 二元组，必须检查错误。
- 可选 `complete` 接收当前命令、父级词、缓存、当前位置、键值上下文和取消信息，返回 `{ command, commands }`。`commands` 应是当前位置完整有效词项，终端负责按前缀过滤。缓存由已注册一级命令持有；不要在取消后继续发布过期候选。
- 用户输入的路径、选项和参数均须校验；不要把它们直接拼成任意文件路径或 shell 命令。

## 插件提供的后端接口

插件的 `ui` 可声明 `entry`、可选 `html()`、`api`、`resources`、`websocket`：

- `ui.api` handler 接收数据和 `context.request`（method、url、params、query、headers），可访问调用级任务、取消信号和 logger。它不能访问 Express req/res。返回值由核心包装为 `{ success, message, data }`；错误使用统一错误包装并保留可用状态码。
- `ui.resources` 目前只支持 GET。handler 收到查询数据和请求快照，返回 `{ kind: 'file', path, contentType?, downloadName?, headers? }` 或 `{ kind: 'response', status, body?, headers? }`。`file.path` 必须由插件验证为受控绝对路径；核心负责 Range、文件传输背压和断连处理。
- `ui.websocket` 使用 `connectionId`、`channel`、`query` 和局部 `send`/`broadcast`/`close`；连接处理器运行在插件进程内。只传输协议允许的数据，不依赖共享真实 socket 对象。
- 这些接口通过核心路由和插件进程代理提供；插件不要启动自己的 Express/Koa/Fastify 服务或额外监听端口。RPC 的单消息、待答和事件队列限额见 `projects/server/plugin/process/README.md`；超时不会证明写操作已取消。

## 页面路径与 `scwcutils`

- `/web/page/plugin/<插件目录名>/...` 用插件目录身份挂载页面。`ui.entry` 相对路径以 `package.json.main` 所在目录解析；静态文件以 HTML 入口目录为根，核心同时检查真实路径边界并拒绝越界符号链接。
- 核心在 HTML head 最前注入 `scwcutils` IIFE（若该构建资产存在）。页面是隔离 iframe，不能依赖主页面 DOM 或主页面内部存储格式。
- `window.scwcutils.ready` 在页面授权握手后完成。调用页面授权的 API 前等待 ready；`fetch` 会自行等待，创建 WebSocket 前显式等待。SDK 提供 `fetch`、`fetch.resource`、`fetch.websocket`/`websocketAsync`、只读 `config`、`ui.handlers`、`lifecycle`、`navigation`、`search`、`host` 能力声明、通知与任务、页面可见/焦点/主题和请求生命周期等接口。用 `host.capabilities` 检查工作台可选能力。
- `fetch(path, init?)` 使用当前页面 grant 访问当前插件 API，并附带页面 URL；响应是 `{ success, message, data }` 外层包装。它不是浏览器原生 `fetch` 的直接别名。
- `fetch.resource(path)` 只构造资源 URL，供媒体/链接属性使用；URL 会带 `site`，但不带 API Bearer header。不能把 `site` 当认证；敏感资源应在插件 handler 验证短期票据或其他授权。`interruptible` 资源可参与工作台暂停恢复机制。
- WebSocket 通过核心签发的单次票据建立，`TicketSocket` 在可中断请求生命周期中暂停/恢复底层连接并保留处理器；手动关闭后不会恢复。页面离开时 SDK/宿主会撤销页面授权、监听和任务。
- `ui.handlers.register(name, definition)` 的回调留在浏览器文档内，宿主只收到带 revision 的描述。模板/渲染表达式调用只读处理器；带副作用的处理器只能绑定受支持的用户事件。watch 必须是只读处理器，使用结束后释放 disposer。

## 插件页面工作台与反馈

工作台 UI 可由后端 `context.workbench.ui` 声明，也可通过页面 `scwcutils.ui.handlers` 提供文档内处理器。支持主/辅助侧栏、状态栏、提示和上下文菜单、检视器及 JSON/HTML UI 内容。后端处理器收到宿主构造的 `HandlerContext`，身份含 workspace/window/source/tab 等字段；用 `signal` 处理中止。跨进程内容只允许有界 JSON/描述，不把 DOM、函数或非有限数字传过 RPC。

`workbench.logger` 通知与 `workbench.tasks` 的回调归属于创建它们的插件/页面 owner。任务状态、通知动作回调和 UI handler 均按 owner 生命周期清理；异步完成时检查取消信号和仍有效的身份。插件页面配置不可直接写入，写入逻辑应留在后端业务 API。

## 保存采集数据

当前后端抓取工具可从 `context.utils` 获取 `writeData`、`writeDataURL`、`fetchImage`、`strValidation`、`convertToCN`。`writeData` 把数据追加到指定目录的 `data.json`，对 DataItem 图片字段可保存图片并记录路径；`writeDataURL` 保存支持的 data URL 或 HTTP(S) 图片。调用前检查返回值，清理文件名并为输出选择明确目录；外部输入不应决定任意绝对路径。具体行为以 `projects/server/utils/writeData.ts` 为准。
