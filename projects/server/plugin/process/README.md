# 默认第二版独立插件宿主

核心 HTTP 进程只读取 package.json、运行调用代理、执行鉴权和发送资源。声明独立进程模式的插件只在 `host.ts` 中动态导入；不会为了读取插件描述再次在核心导入入口。

## 启用与兼容

```json
{
  "runtime": {
    "mode": "process",
    "apiVersion": 2,
    "startupTimeoutMs": 30000,
    "requestTimeoutMs": 300000,
    "shutdownTimeoutMs": 5000
  }
}
```

所有启用插件默认使用独立 Node 子进程和 apiVersion 2。package.json 可以完全省略 runtime；入口可以省略 apiVersion，按第二版签名实现并用 `satisfies SCWC.IPluginHandler` 约束即可。`SCWC.IProcessPluginHandler` 和 TProcess* 类型保留为别名。THosted* / IHostedPluginHandler 只描述核心生成的 Express/socket 代理，插件不要使用这些内部类型。

上面的 mode/apiVersion 都可省略，runtime 也可只配置超时。显式填写其他模式或版本会进入 inactivePlugins，不允许进程内回退。enabled: false 仍跳过加载。超时设置必须为 100–600000 的整数；未设置时为启动 30 秒、普通请求 30 秒、卸载 5 秒。贴纸、ASMR、本地关注、图片与 Twitter 保留 5 分钟普通请求额度，以兼容批量抓取和下载。

HTTP 在插件激活前启动。加载器最多同时激活两个插件，成功项立即注册并加入 plugins；单个加载/激活失败会被记录。启动期间页面列表可能只包含已激活项。`plugin ps/ls` 展示进程状态、PID 和最近失败原因；心跳检测到无响应只标记状态，不结束正在执行的写操作。

## 文件分工

- `client.ts`：fork、生命周期、缓存桥接、IPluginHandler 调用代理和 HTML 快照。
- `host.ts`：本地插件对象、生命周期、API/控件/命令分发、WebSocket 本地回调。
- `rpc.ts`：双向请求与事件、超时、队列和消息大小限制。
- `protocol.ts`：版本、序列化描述和通信错误。
- `resource.ts`：请求数据提取、文件/小响应描述的核心发送。
- `../../types/plugin-process.d.ts`：插件公开的第二版契约。

## 第二版契约

生命周期、抓取、命令、控件的本地函数签名保持兼容。函数在所属进程内创建；core 只接收描述和处理器索引。createRetryGet 与 LimitPromise 在子进程本地提供。缓存由核心按插件目录名绑定 `plugin:<pluginId>`，子进程不传命名空间参数；支持可序列化值、Buffer 和 bigint，不支持 Readable 或含函数的值。所有插件的注入缓存均按目录名绑定。createRetryGet 的流式响应留在子进程直接消费，不读写 IPC 缓存；可序列化响应继续使用缓存，命中后立即返回。ASMR 原有私有缓存仍在自己的进程内运行。

公共 TPluginApi / TPluginRequestContext 默认描述第二版。API handler 使用 `{ request: { method, url, params, query, headers } }`，不存在 Express req/res。资源 handler 返回以下描述之一，媒体票据必须先由插件校验：

```ts
{ kind: 'file', path: absolutePath, contentType, downloadName, headers }
{ kind: 'response', status: 404, body: 'not found', headers }
```

文件只通过描述跨 IPC，core 使用 Express sendFile/download 处理 Range、背压和断开。文件描述只来自服务端回调，不接受浏览器直接指定路径。WebSocket 的真实连接、Origin/site/token 校验和客户端集合仍由 core 持有；子进程使用 connectionId、request、query 及本地 send/broadcast/close 回调。断开与延迟 onConnect 的 cleanup 均在宿主内执行。

动态 HTML 支持 Promise，正常请求从子进程读取。读取超过 1 秒时可返回最近一次成功快照；在后台忙时主题可能暂时使用旧值，之后重新加载即可更新。没有 html 回调时，core 直接读取 entry 文件。静态资产不经过插件 IPC。

## 故障与资源边界

- 每端最多 64 个等待中的 RPC、64 个正在处理的 RPC、128 个待发送消息；序列化消息最多 16 MiB。超过限制返回 429/413。
- 普通调用超时返回 504，进程不可用返回 503；插件业务异常传回 message/code/status，HTTP 继续使用 success/message 外层包装。
- 插件日志使用按序发送的队列，不再按每秒 100 条或每条 8000 字符静默截断；队列最多 32 MiB 或 16384 条，极端过载显示截断提示。终端同样按序显示输出再更新完成状态。原始 stdout/stderr 不再按每秒 64 KiB 丢弃；只有一个活动命令时归该命令窗口，并行时无法判定来源的原始输出归公共窗口，插件应优先使用 logger。
- 命令第五参数 InvocationContext 提供 next(message, String/Number/Boolean/BigInt/Date)，返回 `[InvocationInputError, undefined] | [undefined, 输入]`。等待输入暂停该次命令 RPC 的执行计时，回复后恢复剩余时限。Ctrl+C 取消当前输入并返回 cancelled，取消任务或断开宿主也会结束等待。具体规则见 [终端说明](../../../terminal/README.md)。
- 每个插件代理最多保留 128 个 WebSocket 连接。配置读取限时 1.5 秒，失败不会阻止其他插件的控件配置返回。
- 超时只结束调用方等待，不表示写操作回滚。不会自动重试写请求或自动重启故障插件；恢复需重启服务，持久任务仍使用已有恢复逻辑。
- 卸载停止接收业务调用，等待现有异步调用结束后运行 onUnload；超过卸载时限会强制终止宿主。POSIX 使用独立进程组清理后代；Windows 使用 taskkill /T /F。核心退出也清理宿主进程组；核心被强制结束而跳过 exit hook 时，宿主在 IPC disconnect 后自行清理进程树。

第一阶段没有提供进程级 CPU/内存硬配额，也没有迁移贴纸的 SQLite 写连接、分离读通道或统一 FFmpeg/OCR 调度。独立进程内部的长同步操作仍可阻塞该插件自身 API，后续阶段处理这一点。

## 验证

```bash
npx tsc -b tsconfig.json --pretty false
npx vitest run projects/server/plugin/process
npx vitest run projects/server/plugins/sticker-management/test/node-runtime.test.ts
```

process.test.ts 使用原生 Node 类型擦除，覆盖真实 HTTP、另一个插件、HTML 缓存、Range/下载、大于 IPC 限制的文件、WebSocket、退出/超时/后代清理、父进程强制结束及真实贴纸入口。loader.test.ts / options.test.ts 覆盖省略及部分配置、禁用、失败、挂起和错误版本；rpc.test.ts 验证队列及消息边界。installed-plugins.test.ts 逐个以原生 Node 激活十个插件（在测试中也验证禁用插件的入口），使用临时数据库验证 ASMR 登录和媒体票据；axios.test.ts 验证流式响应、缓存命中和自定义类。全部媒体库数据位于临时目录，HTTP/WebSocket 测试需要允许本机临时端口。

## 当前迁移范围

asmr、exhentai、image、jm-comic、local-watch-list、resource-site、sticker-management 已使用默认独立宿主；template、test、twitter 的入口和类型也已迁移，但保留其 enabled: false。ASMR 媒体仍先校验本插件票据，再由核心流式发送。图片插件修正 raw 图片字节读取，并等待下载和数据保存完成后结束抓取回调，避免卸载提前中断其后台写入。未增加依赖、HTTP 服务或端口。
