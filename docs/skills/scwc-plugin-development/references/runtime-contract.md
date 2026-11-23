# SCWC 插件运行契约

先读 `projects/server/plugins/plugin-env.d.ts`、`projects/server/types/{plugin-process,command,task}.d.ts` 及 `projects/server/plugin/process/`。页面行为以 `projects/webutils/lib/` 为准。

## 加载与生命周期

- 加载器扫描配置目录的直接子目录，`package.json.enabled` 控制启用状态，启停命令也可写回该字段。所有启用插件使用独立 Node 进程，未知模式或契约版本会拒绝加载。可选的 `startupTimeoutMs/requestTimeoutMs/shutdownTimeoutMs` 均为 100–600000 的整数。命令执行的时限规则见下节。
- 缺页面 HTML 时，宿主在导入入口后、`onLoad` 前尝试构建，再注册命令、API、资源和 Socket。导入或 `onLoad` 失败使插件无法激活。页面构建失败单独记录，后端可以继续启动。入口顶层读取页面文件会早于自动构建。
- 启停与重载按插件目录串行。`onUnload(logger, { isRestart })` 先撤销引用处理器的视图，再释放处理器、订阅、定时器和 Worker。持久配置跨卸载保留。重载替换宿主、`safeId`、授权和路由，调用方应重新取得身份。
- `link-with` 的普通项按前缀匹配，通配和否定按顺序由首项命中决定。空数组匹配全部。只有正通配且均未命中时不匹配。测试包含和排除顺序见 `projects/server/router/utils/index.ts`。

## 采集与命令

- `onRequest(context, logger)` 获取 `data/site/utils` 和调用级 `signal/tasks`。采集 logger 支持 `toWeb(message, type?)`。单个插件失败后其他匹配插件仍可运行。插件绑定的 `createRetryGet`、`LimitPromise` 和 `cache` 从 `onLoad` 上下文取得。缓存 IPC 可传类型见 `types/cache.d.ts`，流、函数和 Socket 留在创建进程。
- 保存采集数据可用 `context.utils.writeData/writeDataURL/fetchImage/strValidation/convertToCN`。`writeData` 向目标目录的 `data.json` 追加记录，可落地图片并写入路径。`writeDataURL` 支持 data URL 或 HTTP(S) 图片。规定输出目录并校验外部路径、文件名和写入结果。实现见 `projects/server/utils/writeData.ts`。
- `package.json.commandName` 启用 `pluginConfig.command` 的唯一一级命令。名称冲突可能加目录前缀。`execute` 依次收到 logger、解析选项、未用参数、原始参数及 `InvocationContext`。检查 `next(message, Type?)` 返回的 `[error, value]`，并使业务等待响应 `signal`。
- 命令执行无固定 RPC 时限，可以在运行超过 `requestTimeoutMs` 后发起待答输入。只有仍活动的命令能请求输入。后台工作须在函数返回前登记任务句柄，成功、失败或取消时结束，卸载时释放。日志沿用原调用身份。示例见 template 的 `wait-ask`。
- `complete` 返回 `{ command, commands }`，候选为当前位置的完整词项，由终端做前缀过滤。缓存随一级命令注册存活，取消时停止发布。选项设 `multiValue: true` 后，`--name=值,前缀` 或别名的末段可补全。回调 `context.optionValue` 提供 `raw`、保序且允许重复的 `values`、当前 `prefix` 和 `isNextValue`。替换只改末段，保留先前值和引号。`execute` 仍收到单个标量，由业务解析逗号列表。

## 插件提供的后端接口

插件的 `ui` 声明页面入口、可选 `html()` 及由核心代理的后端接口。

- `ui.api` handler 接收数据、`context.request` 快照（method、url、params、query、headers）及调用级任务、取消信号和 logger。核心将结果包装为 `{ success, message, data }`，错误保留可用状态码。
- `ui.resources` 处理 GET 查询和请求快照，返回 `{ kind: 'file', path, contentType?, downloadName?, headers? }` 或 `{ kind: 'response', status, body?, headers? }`。插件验证 `file.path` 为受控绝对路径，核心负责 Range、背压和断连。
- `ui.websocket` handler 在插件进程内使用 `connectionId/channel/query` 与局部 `send/broadcast/close`，通过协议传输数据。
- 使用核心路由和进程代理提供这些接口。RPC 单消息限 16 MiB、待答限 64，其他限额见 `protocol.ts` 和 `rpc.ts`。普通插件请求仍使用对应时限。超时只结束等待，可能已有写入，应先核对业务结果再决定后续操作。

## 页面路径与 `scwcutils`

- `/web/page/plugin/<插件目录名>/...` 用目录身份挂载。`ui.entry` 相对 `package.json.main` 所在目录解析，静态文件以 HTML 入口目录为根。核心检查真实路径并拒绝越界符号链接。页面通过注入的 `scwcutils` 与核心交互。授权和主题订阅见[依赖与部署](dependencies-and-deployment.md)。
- `fetch(path, init?)` 使用当前页面 grant 访问本插件 API，带页面 URL 并返回核心包装结果。`fetch.resource(path)` 构造供媒体和链接使用的 URL，附带 `site` 上下文，没有 API Bearer header。敏感资源由插件 handler 验证短期票据或其他授权。
- WebSocket 使用核心单次票据。`TicketSocket` 暂停和恢复底层连接时保留处理器，手动关闭后结束该连接。页面离开时释放授权、监听和任务。

默认请求阻止工作台暂停，显式 `interruptible` 才可因暂停中断并恢复。主动取消或普通错误终止请求。仅在可安全重放时标记写入。授权重连可保留原文档，交付异步结果前检查取消信号和身份。

## 通知与任务

- **脚本事件反馈。** v1 控制器与 v2 handler 返回 `{ type: 'notification', data: { type, message } }`。工作台声明式事件使用 `core:notification.show(...)`。[脚本与配置](scripts-and-configuration.md)
- **后台主动通知。** `onLoad` 的 `context.notifications.notify(site, { title, description?, type?, scope?, placement?, duration?, progress? })` 可在加载结束后调用，异步返回通知 ID。按 HTTP(S) origin 投递给已连接的脚本或扩展。扩展默认 `scope: 'internal'`，`'external'` 在网页展示。用户脚本忽略 scope，在自身可见时展示。选项仅传序列化数据，首次连接不会补发历史。服务端校验见 `projects/server/user-script/notifications.ts`。
- **持久工作台反馈。** 后端使用 `context.workbench.logger/tasks`，页面使用 `scwcutils.logger/tasks`。通知工厂返回异步控制对象，支持最多四个动作，进度为 0–100、`null`（不定）或 `false`（隐藏）。`systemNotification` 默认为 false，启用后可由宿主在应用失焦时升级系统提醒。`autoRead: false` 保留未读。内建任务按权限查询或取消，自定义任务进入终态后不可重启。回调留在创建进程或文档，宿主按归属释放。
- **插件 Web 展示。** 从 `scwc:shared/frontend` 导入 `Notify/notify`，也可用 `scwcutils.Notify/notify`。嵌入时默认投影到核心通知区并随核心位置，`useCore: false` 或独立页使用本地六向 `placement`。悬停、已读、按钮及关闭回到创建文档。自动隐藏保留记录和句柄，`close()` 静默删除。文档销毁时释放投影。[通知与任务示例](../../../workbench-feedback.md)
