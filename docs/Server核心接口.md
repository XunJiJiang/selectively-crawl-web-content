# SCWC Server 核心接口

> 核对日期：2026-10-18。范围为 `projects/server` 核心提供的 HTTP、静态页面及 WebSocket 承载契约。
> 不记录 `projects/server/plugins/` 内任何具体插件的业务接口、私有资源或消息格式。`projects/server/plugin/`（单数）是核心基础设施，本文只说明其通用挂载边界。

本文以源码当前行为为准；终端 IPC 单独见 [终端与服务数据交互](./终端与服务数据交互.md)，存储见 [核心数据流与存储](./核心数据流与存储.md)。

新增 `/web/api/workbench` 的目录/Job、工作区/租约、收藏/关闭历史、配置、页面授权、快照、Web终端、通知与事件接入，完整字段和示例见 **[Web 后端接口](Web后端接口.md)**。该前缀采用精确同源管理鉴权与1MiB JSON限制，不适用下文旧接口的 site/hostname 规则；页面 grant 也可受限调用本插件 API。配置库位置与表结构见[数据库](数据库.md)。

## 1. 地址、通用鉴权与响应

### 1.1 基础地址

默认访问地址为 `http://localhost:3200`。`PORT`/`--port` 指定起始端口，`PORT_SEARCH_RANGE`/`--port-range` 指定最大递增偏移，默认最多向后查找 20 个端口。仅端口占用会尝试下一端口；应使用启动日志、终端 `ready.port` 或本机启动配置返回的实际端口。

JSON 请求使用 `Content-Type: application/json`，Express JSON 解析上限为 `100mb`。插件调用还受 16 MiB IPC 单消息限制，不能把 HTTP 上限理解为插件可处理的载荷上限。

### 1.2 普通接口鉴权

`/api/*` 和 `/web/api/*` 请求必须满足：

1. 查询参数 `site` 存在，通常为 `encodeURIComponent(window.location.href)`。
2. 至少有 `Origin` 或 `Referer`；两者都有时使用 `Origin` 做普通鉴权比较。
3. 所选来源与查询 `site` 的 URL **hostname 相同**。此处不比较协议或端口，不是严格的同源检查。
4. 服务启用 token 时，携带 `Authorization: Bearer <TOKEN>`。

未配置或空的 `TOKEN` 会生成随机 UUID；环境值为字面字符串 `null` 时才关闭 token 校验。关闭后仍执行来源与 `site` 检查。不要将真实 token 写入文档或提交的示例。

| 失败条件 | HTTP 状态 | 响应 |
| --- | --- | --- |
| 缺来源、缺查询 `site` 或 hostname 不匹配 | 400 | `{ "success": false, "message": "验证不通过" }` |
| 缺 `Authorization` | 401 | `{ "success": false, "message": "缺少 Authorization 头" }` |
| Bearer 类型或 token 不匹配 | 403 | `{ "success": false, "message": "无效的 token" }` |

`GET /web` 及 `/web/*` 除 `/web/api` 与其子路径外跳过上述通用检查；`/web/local-config` 有独立严格校验，WebSocket 也有独立握手校验。

普通 CORS 中间件返回 `Access-Control-Allow-Origin: *`，公布方法 `GET,POST,OPTIONS` 和请求头 `Content-Type, Authorization`；`OPTIONS` 返回 200。CORS 放行不代替鉴权。

### 1.3 当前存在两类 JSON 响应

```ts
// 采集、页面发现、启动配置、通用插件 API 包装
{ success: boolean, message: string, data?: unknown }

// 用户脚本控件配置与触发
{ code: number, message: string, data?: unknown }
```

普通鉴权失败始终使用第一种格式，控件接口在进入业务处理后使用第二种。客户端应同时检查 HTTP 状态和对应业务字段。未知路由、JSON 解析错误及未捕获异常没有统一的核心 JSON 错误包装，不保证响应可直接 `res.json()`。

## 2. 核心接口目录

| 方法 | 路径 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/metadata/scrape` | 分派页面采集数据 | 普通鉴权 |
| GET | `/api/plugin/config` | 返回站点匹配的浏览器控件 | 普通鉴权 |
| POST | `/api/plugin/toggle` | 触发一个浏览器控件 | 普通鉴权 |
| GET | `/web/api/pages` | 获取已加载插件的页面目录 | 普通鉴权 |
| GET | `/web/api/safeId/:pluginDir` | 获取当前加载实例的 safeId | 普通鉴权 |
| GET | `/web/local-config` | 获取本机同源启动配置 | 独立校验 |

`/api/plugin/config`、`/api/plugin/toggle` 虽然名称包含 plugin，但路由、校验与分派由核心实现，属于本接口文档范围。具体插件动态注册的业务路径不在此枚举。

## 3. POST /api/metadata/scrape

查询参数 `site` 用于普通鉴权；JSON 正文中的 `site` 用于业务匹配。当前实现没有检查这两个值相等，客户端应始终发送同一个页面 URL。

```json
{
  "site": "https://example.com/articles/1",
  "data": [
    {
      "label": "标题",
      "value": "示例文章",
      "images": []
    }
  ]
}
```

| 字段 | 约束 |
| --- | --- |
| `site` | 必填，合法 URL |
| `data` | 必填数组，可为空 |
| `data[].label` | 必填字符串 |
| `data[].value` | 必填字符串 |
| `data[].images` | 必填字符串数组；可包含图片 dataURL 或 URL，路由不逐项验证其内容 |

匹配依据为已加载插件的 `linkWith`：空规则匹配全部；普通规则使用 URL 前缀匹配，也支持 `*` 和 `!` 规则。规则由 `matchLink()` 按其实现顺序处理，不能当作无序的独立允许/拒绝集合。

匹配回调顺序执行。至少一次调用正常返回时，HTTP 200：

```json
{
  "success": true,
  "message": "success",
  "data": [
    {
      "pluginInfo": { "name": "example-plugin" },
      "info": "处理完成",
      "type": "success"
    }
  ]
}
```

`type` 为 `success | error | warn | info`，通知来自处理回调的 `toWeb()`；数组可以为空。`success: true` 不等价于“已写入数据库”或“全部插件都成功”。

| 情况 | HTTP 状态与内容 |
| --- | --- |
| 正文校验失败 | 400，`{ success: false, message: '请求体格式错误', data: [] }` |
| 没有正常完成的匹配调用 | 200，`{ success: false, message: '没有处理这个网址的插件', data: ['没有处理这个网址的插件'] }` |
| 单个匹配插件抛错 | 核心记录错误并继续下一个；若所有匹配调用都抛错，也进入上一行响应 |

调用示例（token 为占位变量）：

```bash
curl 'http://localhost:3200/api/metadata/scrape?site=https%3A%2F%2Fexample.com%2Farticles%2F1' \
  -H 'Origin: https://example.com' \
  -H "Authorization: Bearer ${SCWC_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data '{"site":"https://example.com/articles/1","data":[{"label":"标题","value":"示例文章","images":[]}]}'
```

## 4. GET /api/plugin/config

查询 `site` 必须是合法 URL。核心读取站点匹配插件的静态或动态控件，只返回具有脚本标题且控件非空的配置；某个插件读取失败会被记录并跳过。

HTTP 200 响应示例：

```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "id": "example-directory",
      "title": "示例工具",
      "description": "示例工具",
      "controls": [
        {
          "type": "button",
          "label": "处理",
          "channel": "plugin:example-plugin:example-directory:run",
          "options": { "relatedChannel": [] }
        }
      ]
    }
  ]
}
```

空结果为 `data: []`。无效 `site` 的业务响应为 HTTP 400、`{ code: 400, message: 'site 参数必须是有效的 URL' }`；通用鉴权可能在此之前先拒绝请求。

控件类型为 `button | toggle | select | input:text | input:number | checkbox`，具有 `label`、完整 `channel`，以及可选 `options`：

| 选项 | 含义 |
| --- | --- |
| `requireFullContent` | 用户脚本是否要求所有选择器有效，客户端缺省为 true |
| `relatedChannel` | 请求触发时需要携带的其他控件通道；响应已加完整命名空间 |
| `autoTrigger` | 非按钮控件变更后是否自动触发，客户端缺省为 false |
| `defaultValue` | `string | number | boolean | null` |
| `options` | select 的 `{ label, value }[]`，value 为字符串或数字 |

核心移除 `trigger` 和内部 `script-config-symbol`，不通过 JSON 传输函数。description 未提供时使用 title。前端选项的缺省行为不等于服务端对触发请求施加了相同限制。

## 5. POST /api/plugin/toggle

```json
{
  "type": "click",
  "channel": "plugin:example-plugin:example-directory:run",
  "id": "example-directory",
  "context": {
    "site": "https://example.com/articles/1",
    "data": [],
    "value": null,
    "relatedValues": {}
  }
}
```

| 字段 | 当前运行时约束 |
| --- | --- |
| `type` | 必填字符串；客户端发送 `click/change`，服务端没有枚举校验，也未用它分派 |
| `channel` | 必填字符串，格式 `plugin:<name>:<id>:<channel>` |
| `id` | 必填字符串，对应配置响应中的插件目录标识 |
| `context.site` | 必填字符串；当前未用 URL schema 校验，后续会构造 URL |
| `context.data` | 必填采集项数组，结构同采集接口 |
| `context.value` | 必填 `string | number | boolean | null`；按钮按调用约定传 null |
| `context.relatedValues` | 必填对象，值只允许上述标量或 null |

服务端以正文 `id` 和 channel 内的插件 `name` 选择插件，当前没有使用 channel 内的 `id` 再校验，也没有重新按站点规则限制该次触发。应原样使用配置接口返回的 id/channel。关联通道会被解析为内部通道名，无效格式被忽略。

成功 HTTP 200：

```json
{
  "code": 200,
  "message": "插件通道触发成功",
  "data": {
    "type": "notification",
    "data": { "type": "success", "message": "处理完成" }
  }
}
```

外层 `data` 是回调结果，核心不再做响应 schema 校验；上例为用户脚本期望的通知结构。

| HTTP 状态 | 业务错误 |
| --- | --- |
| 400 | `code: 400`，`请求体格式错误` 或 `无效的 channel 格式` |
| 404 | `code: 404`，`未找到插件: <id>` 或 `未找到插件项: <channel>` |
| 500 | trigger 抛错时 `code: 500, message: '插件通道触发失败'` |

`context.site` 不是合法 URL、动态控件查询抛错等发生在 trigger 的局部捕获之外，可能进入 Express 默认错误处理，不能保证是上述 JSON 格式。

## 6. Web 发现接口

### 6.1 GET /web/api/pages

返回当前已加载且声明了 `ui.entry` 的插件；不会列出尚未加载或禁用的目录。需要查询 `site`、来源头和 Bearer token。

```json
{
  "success": true,
  "message": "获取插件页面信息成功",
  "data": [{ "dir": "example-directory", "pluginId": "example-directory" }]
}
```

`dir` 取插件目录末段，用于页面地址；空列表正常返回 `[]`。

### 6.2 GET /web/api/safeId/:pluginDir

路径参数按插件目录末段匹配，比较时 trim；并非插件展示名。需要普通鉴权。

```json
{
  "success": true,
  "message": "获取插件 safeId 成功",
  "data": { "safeId": "<本次加载生成的UUID>" }
}
```

未找到时 HTTP 404、纯文本 `not found`。safeId 每次加载生成，重载后必须重新查询；它不是 token，也不是可长期持久化的业务 ID。

## 7. GET /web/local-config

这个接口提供当前启动的 `{ host, port, token }`，不要求普通 Bearer 或查询 `site`，但必须同时满足以下独立校验：

- 配置的 `HOST` 是回环主机，对端连接地址也是回环地址。
- 请求 Host 和协议构成的 origin 等于服务 `HOST` 配合实际 socket 端口形成的 origin。
- 请求头 `X-SCWC-Local-Config: 1`。
- 至少一个 `Origin/Referer`，所有已给出的来源都必须与服务严格同源。
- 若提供 `Sec-Fetch-Site`，必须为 `same-origin`。

HTTP 200：

```json
{
  "success": true,
  "message": "success",
  "data": { "host": "http://localhost", "port": "3200", "token": "<当前TOKEN>" }
}
```

host 不含端口，port 是字符串，来自 `req.socket.localPort`，token 可以为空字符串。拒绝时 HTTP 403：`{ success: false, message: '仅允许本机同源页面加载配置' }`。

响应设置 `Cache-Control: no-store`、`Vary: Origin, Referer, Sec-Fetch-Site` 并移除通配 CORS 来源头。Web 客户端采用同源请求、禁止重定向、3 秒超时；失败保留原配置。开发模式从核心 /web/ 打开，工作台资源代理到回环 Vite，local-config 保持由核心同源处理；直接访问 Vite 仍需手动配置连接。

## 8. 页面和静态资源

以下为 GET 路由，不使用普通 Bearer 校验。

| 路径 | 当前行为 |
| --- | --- |
| `/web`、`/web/`、`/web/index.html` | prod 返回核心 Web 入口；dev 同源代理到回环 Vite /web/ |
| `/web/assets/*` | prod 返回构建资源；dev 同源代理到 3201 对应资源 |
| `/web/page/plugin/:pluginDir` | 返回已加载插件页面，在 head 最前注入 scwcutils；未知插件404，UI不可用503并带 data-scwc-error |
| `/web/page/plugin/:pluginDir/*` | 从页面入口目录提供资源；缺失且末段不含点时按 SPA 深链回退 HTML，缺失文件返回 404 文本 |
| `/web/page/lib/scwcutils.iife.<标记>.js` | 按文件名中的 36 进制时间戳选择最新库；请求中的标记不锁定版本；没有可用库时 404 |
| `/web/page/resources/*` | 提供核心公共静态资源；路径分段含 `..` 时 400 `invalid path`，不存在时 404 `not found` |
| `/web/page/worry/404`、`/web/page/worry/500` | 对应状态码的 HTML 错误页；其他 worry ID 重定向到 404 |

页面、发现和启动配置路由在 dev/prod 都挂载；只有 Web 主入口及 assets 根据模式切换。未识别 mode 不会进入上述 prod/dev 主入口分支。

## 9. 动态扩展承载边界

本节只记录核心统一容器，不定义或枚举任何具体插件接口。

| 通路 | 核心挂载前缀 | 通用契约 |
| --- | --- | --- |
| HTTP API | `/web/api/plugin/:safeId/<注册路径>` | 普通鉴权；核心将结果包装为 `{ success: true, message: '请求成功', data }`；错误返回失败包装与对应状态 |
| 文件/媒体资源 | `/web/resource/plugin/:safeId/<注册路径>` | 资源仅注册 GET，跳过普通 Bearer；鉴权票据须由资源处理器验证；可返回文件或普通响应描述符 |
| WebSocket | `/web/websocket/plugin/:safeId/<注册通道>` | 独立握手鉴权，真实 socket 保留在核心；消息体由通道定义 |

HTTP API 出错时，`PluginProcessError` 使用其 status，其他错误为 500，响应为 `{ success: false, message: '请求失败: ...' }`。资源错误尚未发送响应头时才写错误 JSON；资源可以有自定义状态和 Content-Type。safeId 未注册时继续路由查找，最终通常为 404，不保证 JSON。

WebSocket 需要查询 `site` 和来源头 hostname 匹配，启用 token 时通过查询参数 `token` 验证。无路径/通道返回握手 404、站点校验失败 400、token 不符 401。该握手不走普通 HTTP 鉴权中间件。

字符串和 Buffer 直接作为 WebSocket 内容发送，其他对象由核心 JSON 序列化。`onConnect` 失败会以 1011 关闭连接；消息回调失败记录日志。卸载/重载移除旧 safeId 的通道并终止其现有连接。

浏览器工具库在插件页面同源地址上拼接这些 URL：API 自动加 Bearer，resource URL 不携带核心 token，WebSocket 用查询 token。工具库不会自动给媒体 URL 生成业务票据，也不会在插件重载后自动更新旧 safeId。

## 10. 源码定位

| 内容 | 实现 |
| --- | --- |
| 通用鉴权、采集 | [router/index.ts](../projects/server/router/index.ts)、[url.ts](../projects/server/utils/url.ts)、[匹配规则](../projects/server/router/utils/index.ts) |
| 浏览器控件 | [router/plugin.ts](../projects/server/router/plugin.ts)、[共享控件类型](../projects/shared/types/plugin.d.ts) |
| 页面发现与动态路由 | [web/api/index.ts](../projects/server/router/web/api/index.ts)、[web/api/load.ts](../projects/server/router/web/api/load.ts) |
| 启动配置与静态页面 | [local-config.ts](../projects/server/router/web/local-config.ts)、[web/index.ts](../projects/server/router/web/index.ts)、[page/index.ts](../projects/server/router/web/page/index.ts) |
| WebSocket 与资源传输 | [websocket.ts](../projects/server/router/web/websocket.ts)、[resource.ts](../projects/server/plugin/process/resource.ts) |
| 浏览器调用方 | [crawl.ts](../projects/user-script/src/api/crawl.ts)、[plugins.ts](../projects/user-script/src/api/plugins.ts)、[Web 启动配置](../projects/web/src/api/local-config.ts)、[webutils fetch](../projects/webutils/lib/utils/fetch.ts) |
