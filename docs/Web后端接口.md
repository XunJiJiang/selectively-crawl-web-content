# Web 工作台后端接入

实施日期：2026-10-18。本文描述已实现的服务端合同；工作台 UI 与浏览器 SDK 已接入，运行与前端能力边界见[Web 前端接入](Web前端接入.md)；整体合同见[设计](Web插件工作台技术契约.md)。

源码入口：[HTTP](../projects/server/router/web/workbench/index.ts)、[WebSocket](../projects/server/router/web/workbench/websocket.ts)、[业务服务](../projects/server/workbench/runtime.ts)、[数据库](数据库.md)。旧 `/web/api/pages`、safeId 和插件业务 API 保持兼容。

## 1. 地址、身份与错误

前缀 `/web/api/workbench`。使用核心实际监听端口；开发时启动 Vite 后仍从核心 `/web/` 打开。核心仅将工作台 HTML/模块资源代理到回环 3201，`local-config`、API、插件页由核心处理；HMR 走中心 dispatcher 的 `/web/__vite_hmr`。

管理请求携带 `Authorization: Bearer <TOKEN>`，以及与核心**协议、主机、端口完全一致**的 Origin/Referer；两头都存在时都检查，不使用旧接口仅比较 hostname 的规则，也不要求 `site` 参数。显式 `TOKEN=null` 仍检查同源。写工作区、终端、页面会话时另带 `X-SCWC-Client-Window: <clientWindowId>`，客户端每次浏览器文档连接生成新 ID。`profile=local`，没有账户隔离。

JSON 上限 1MiB，PNG 独立上传上限 2MiB。成功响应 `{success:true,message:'success',code:'ok',requestId,data}`；常见错误：

| 状态 | code | 客户端处理 |
| --- | --- | --- |
| 400 | invalid_request / validation_failed / invalid_layout | 修正数据；值不能隐式转换为字符串 |
| 403 | unauthorized / grant_scope / page_owner | 重新连接或重新签发页面授权 |
| 404 | not_found | 目标已不存在 |
| 409 | revision_conflict / lease_conflict / schema_conflict | 读取当前快照、重新合并和校验；revision 冲突 data 含当前值 |
| 409 | backend_unavailable / page_validation_required | 等待插件宿主/原页面可用 |
| 409 | idempotency_conflict / stale_execution / stale_boot | 不复用幂等键或旧执行按钮 |
| 409 | quota_exceeded / snapshot_referenced | 清理无引用数据或保留草稿，不能假报保存成功 |
| 429 | rate_limited | 降低通知速率 |
| 503 | database_unhealthy / schema_too_new | 保留现场并恢复健康备份或使用匹配的核心版本 |

列表 query 支持 `cursor,limit,search,pluginId,status`；limit 默认 50、上限 100。`status` 用于 catalog 运行状态。cursor 绑定过滤条件与排序，换条件从第一页开始；列表变化后应重新读取首批。终端输出使用自己的持久 seq 分页。

## 2. 目录、任务和 URL

| 方法、路径 | 请求与返回 |
| --- | --- |
| GET `/bootstrap` | installationId、coreBootId、local profile、capabilities、catalogRevision、preferences 和命令清单 |
| GET `/plugins` | 完整扫描目录投影，含禁用、失败、坏包、无 UI 项；支持 ETag/304；不导入禁用插件，不返回绝对路径或 handler |
| POST `/plugins/rescan` | `{idempotencyKey}` → 202 Job |
| POST `/plugins/:id/actions` | `{action,idempotencyKey}` → 202 Job；action 为 enable/disable/once-disable/reload/build-ui |
| GET `/jobs/:id` | Job 的 status、phase、revision、最多 500 条带 seq 的日志、error |
| POST `/jobs/:id/cancel` | `{baseRevision}`；排队任务可取消，已运行时仅构建可取消 |
| POST `/url/resolve` | `{url,pluginId?}` → canonical URL、pluginId、持久 locator；仅解析本核心插件地址，不抓取外部地址 |

同插件操作串行；CLI 构建也参与同一锁。构建仍全局串行，同一插件的工作台构建共享 Job；取消是显式取消共享任务，关掉订阅页不取消任务。Job 状态 queued/running/succeeded/failed/cancelling/cancelled；核心重启将未完成 Job 标为 failed，不自动重跑。幂等收据保留 7 天。

展示标题依次为导出 title、scwc.ui.title、导出 name、包 name、目录名；描述依次为导出 description、scwc.ui.description、包 description。运行时元数据停止后仅在包与入口指纹相符时使用内存 last-known，重启后重新探测；仅 title/description 不表示有 UI。UI 构建失败保留后端 onLoad 机会，后端与页面状态正交。

## 3. 工作区、租约、偏好和历史

| 方法、路径 | 请求与返回 |
| --- | --- |
| POST `/workspaces/:id/lease` | `{action:'acquire'|'renew'|'release',lease?}`；返回 workspaceId、token、expiresAt；重复存活窗口返回克隆后的新 workspaceId |
| GET `/workspaces/:id` | snapshot、revision、最近执行和当前未结束输入；snapshot 为 `{layout,tabs,focusedPluginTabId?}`，布局/标签字段见技术契约 §1.2 |
| POST `/workspaces/:id/save` | `{snapshot,baseRevision,lease,operationId}`；完整结构 CAS；布局无环、深度≤20、节点≤999、标签≤500 |
| POST `/workspaces/:id/close-tabs` | `{tabIds,baseRevision,lease,operationId}`；原子更新布局与唯一关闭历史，返回 closeIds、batchId |
| GET/POST `/preferences` | GET 返回 `{values,revision}`；POST `{values,baseRevision,reset?}`，values 允许 theme、keybindings、energy；reset 删除对应覆盖字段 |
| GET/POST `/bookmarks` | GET 分页；POST `{value:{pluginId,url,locator,originalTitle,customTitle?,previewId?}}` |
| POST `/bookmarks/:id/update`、`/delete` | 更新传 `{value,baseRevision}`；删除传 `{baseRevision}` |
| GET `/history` | 统一关闭插件标签列表，含 closeId、batchId、closedAt、restoredAt、完整 tab |
| POST `/history/delete` | `{closeIds}`；只清历史 |
| POST `/history/restore` | `{closeIds}` 或 `{batchId}`，另传 workspaceId、groupId、baseRevision、lease、operationId；恢复到目标组，ID 冲突时分配新 tabId |

租约 30 秒，客户端建议每 10 秒续期；过期后必须重新领取。同一个客户端续领复用 token，另一个存活 owner 获取同名工作区时克隆。刷新时需要重新签发页面会话。工作区写入与关闭/恢复操作均先校验租约、再做事务 CAS；重复 operationId 返回原结果，不新增历史。导航、刷新、休眠、内置标签关闭、终端关闭均不会增加 closed_tabs。

`theme` 为 system/light-2026/dark-2026；`keybindings` 是 `{commandId,platform:'mac'|'windows'|'linux'|'all',context,keys:string[]|null}[]`；null 解除绑定，重置删除覆盖。上下文只允许受限表达式字符，不执行脚本。前端负责命令注册表、有效绑定合并和冲突交互。

## 4. 配置与页面授权

| 方法、路径 | 请求与返回 |
| --- | --- |
| GET `/plugins/:id/config` | `{values,effectiveValues,definitions,revision,schemaRevision}`，values 仅用户覆盖，effectiveValues 合并默认 |
| POST `/plugins/:id/config/definitions` | 页面 grant；`{definition,baseRevision}`，definition 为 `{id,schemaVersion,items}` |
| POST `/plugins/:id/config/validation` | 在线原页面 grant；`{accepted:true,values?,keys?,baseRevision,schemaRevision}` → 一次性 validationTicket，5 秒有效 |
| POST `/plugins/:id/config/update` | `{values:Record<string,string>,baseRevision,schemaRevision,originRequestId?,validationTicket?}` |
| POST `/plugins/:id/config/reset` | `{keys:string[],baseRevision,schemaRevision,originRequestId?,validationTicket?}`；删除覆盖，采用当前默认值 |
| POST `/page-sessions` | 管理凭证；`{pluginId,url,frameEpoch,tabId?,workspaceId?,lease?}` → grant、safeId、tabId、frameEpoch、expiresAt；工作台实例必须绑定工作区中已有的插件标签，独立页可不传 workspaceId |

配置只接受字符串，包括空字符串；键长 1–200，value≤64KiB，每插件≤2000个覆盖键。点分键不展开；不自动存 JSON，不使用 null 代表缺省。定义默认值保存在元数据，读取缺失键不会插入覆盖。readonly 后端拒写；支持 integer/number/boolean/string codec、min/max/maxLength/options。没有定义的字符串键也可读写；未定义的默认值保持缺失。

`declarative` 后端校验声明；`backend-required` 调插件 configuration.normalize/validate，宿主不可用拒绝；`page-required` 需要原页面完成本地函数校验后领取一次性回执。回执绑定页面会话、完整值/键、两个 revision 和插件，不能用于另一值、代次或插件。等待自定义验证时不持有 SQLite 写事务，提交时重查版本。

grant 5 分钟有效，绑定精确 origin、pluginId、safeId、tabId 和 frameEpoch。新代次签发使同 owner/tab 的旧 grant 失效；重载/停止使旧 safeId 授权失效。grant 仅能调用本插件配置/业务 API、页面通知、所属快照及 stream-ticket，不能访问 bootstrap、插件管理或命令执行。浏览器 postMessage/MessageChannel 的发送方验证由后续 SDK 适配落实；同源受信插件并不构成恶意代码隔离。

## 5. 插件后端配置对象

`onLoad(logger, context)` 的 **`context.config`** 是冻结的当前插件配置控制器，可长期持有。核心从实际 PluginProcessClient 绑定目录命名空间，插件不能指定 pluginId 或读写其他插件。

```ts
export default {
  onRequest() {},
  async onLoad(logger, { config }) {
    await config.set('global.pageSize', '40'); // 新增或更新，只接受 string
    const raw = await config.get('global.pageSize'); // string | undefined，有默认时返回默认
    const snapshot = await config.list();
    await config.update({ 'global.pageSize': '60', 'global.filter': '' }, {
      baseRevision: snapshot.revision,
    });
    await config.delete('global.filter'); // 删除覆盖；有定义时回到默认
    const unsubscribe = config.subscribe(change => {
      logger.info(change.revision, change.changedKeys); // 只应用变更，不回写形成循环
    });
    // 不再需要时 unsubscribe()；卸载也会清理 IPC 订阅。
    // JSON.stringify/JSON.parse、数字和布尔转换均由插件自行执行。
    logger.workbench.success('配置已保存');
  },
} satisfies SCWC.IPluginHandler;
```

还提供 `reset(keys, {baseRevision?})` 批量删除。未指定 baseRevision 时核心以调用开始时版本 CAS；并发冲突仍会拒绝，插件可读取后重试。配置与 Web 页面共享数据库、默认定义及变更流，不经过 Redis，不随页面关闭、插件停止或核心退出清理。

后端可选导出 `configuration:{definitions?,normalize?,validate?,onChange?}`。normalize 收到批量字符串并返回**同一键集合**的字符串，validate 返回 true 或错误文本。定义声明先于 onLoad 注册；函数留在宿主，manifest 仅传定义与能力。`onChange` 和 config.subscribe 都收到 ConfigChange，通常选一种订阅，避免重复应用。

## 6. 快照、终端与通知

| 方法、路径 | 请求与返回 |
| --- | --- |
| POST `/snapshots` | 状态 JSON：`{kind:'state',state,metadata?,pluginId?,owner?,workspaceId?,lease?}`；页面 grant 自动固定 pluginId/owner=tabId；管理请求需有效租约和标签 |
| POST `/snapshots/preview` | `Content-Type:image/png` 二进制；管理请求另以 query 传 workspaceId/pluginId/tabId，以 X-SCWC-Lease 传租约；页面 grant 自动固定归属 |
| GET `/snapshots/:id`、POST `/snapshots/:id/delete` | 状态返回 JSON 与 checksum，预览返回 PNG；删除拒绝仍被工作区、收藏或历史引用的快照 |
| GET/POST `/terminals` | GET query workspaceId；POST `{workspaceId,lease,terminal:{id?,title,draft?,baseRevision?}}` |
| POST `/terminals/:id/close`、`/restore`、`/clear-output`、`/clear-history` | `{workspaceId,lease}`，忙终端拒绝；close 归档，restore 取消归档 |
| GET `/terminals/:id/output` | query `{workspaceId?,after?,limit?}`，limit≤500；返回 items 和 truncatedBefore；固定 public 流无须 workspaceId |
| POST `/commands/execute` | `{workspaceId,lease,terminalId,command,idempotencyKey}` → 202 execution；服务端分配 executionId |
| POST `/commands/complete` | `{workspaceId,lease,terminalId,command,cursor}` → UTF-16 范围和候选；同终端后续补全/HTTP断开/清单变化取消旧等待，无普通 RPC 截止时间 |
| POST `/commands/cancel` | `{workspaceId,lease,terminalId,executionId,coreBootId,force?}`；协作取消后仍忙则 needsForce/owners；force 明确影响整个宿主 |
| POST `/commands/input` | `{workspaceId,lease,terminalId,executionId,coreBootId,requestId,value}`；重复同一回复幂等，其他执行/旧启动输入拒绝 |
| GET `/notifications` | 共享通知分页 |
| POST `/notifications/ack`、`/delete` | `{ids}`；共享已读/删除 |
| POST `/notifications/publish` | 页面 grant；`{level,title,options?}`；来源和 tab/plugin 由后端赋值 |

状态≤256KiB，PNG≤2MiB，总状态25MiB、预览100MiB。配额不足拒绝新快照，不删除受保护数据；当前采用显式清理，没有自动 LRU 淘汰。工作区 JSON 校验失败直接拒绝并保留旧提交，不自动丢弃标签修复。

Web 终端不读取 CLI 状态，不启动终端扩展。每终端一个顶层执行；返回后还有任务句柄时保持 returned，真正空闲才 finished。同幂等键不重跑，重启标 interrupted。普通执行按注册的 system/originalName 拒绝核心 exit/restart，不能用命令别名前缀绕过。输入按 Web workspace 会话分发，与 CLI handler 共存；断线等待输入保留60秒，超时关闭输入并取消对应调用。

输出按50ms/32KiB调度、提交后推事件；输入、返回和完成事件前 flush。单条分块≤64KiB，待写2MiB，过大记录有明确截断标记；每流10000条/10MiB、总100MiB、7天。不会执行或转换日志中的 HTML/ANSI；安全显示由前端完成。终端输出、草稿和历史均独立于插件关闭标签历史。

插件 `onLoad` 的 logger 及调用内 logger 提供 `workbench.info/success/warn/error(title,{message?,dedupeKey?,target?:{pluginPath}}?)`；通知在没有浏览器时也保存。按来源与 dedupeKey 聚合，保留30天/1000条，速率每来源10条/秒、突发30，超限拒绝并记录宿主警告。旧 toWeb 仅进入采集响应，不重复写工作台通知。

## 7. 事件连接

POST `/stream-ticket`，管理请求 `{workspaceId?,lease?}` 或页面 grant 请求 `{}`，返回30秒一次性 ticket。连接 `/web/websocket/workbench?ticket=...`，握手 Origin 必须与签发 origin 一致。页面 ticket 也可一次性用于本插件 `/web/websocket/plugin/:safeId/:channel?site=...&ticket=...`，不能跨插件；旧插件 token 握手继续兼容。

连接后5秒内发送 `{type:'resume',coreBootId,positions:{[stream]:lastSeq}}`。事件含 version=1、eventId、coreBootId、stream、seq、type、entityId?、revision?、payload。目录/Job/工作区/历史/偏好/配置/通知/终端输出/执行/输入均有事件。普通事件保留2000条或2MiB；超范围或启动ID变化返回 connection.resync-required，再加载快照；持久输出另按 seq 补取。连接发送缓冲超过2MiB以1013断开并要求重新同步。

管理连接只接收目标工作区的执行、输入、布局与定向输出；公共输出共享。页面连接仅接收本插件 config.changed。HTTP 写入返回成功和事件推送都以持久提交结果为准。关闭订阅不会取消共享构建或正在运行的后端任务。
