---
name: scwc-plugin-development
description: 为 Selectively Crawl Web Content 开发或维护 projects/server/plugins 下的插件，包括服务端处理、浏览器脚本控制器和插件独立 Web 页面；不用于修改核心项目。
---

# SCWC 插件开发

本 skill 只服务于插件目录 `projects/server/plugins/*` 内的工作：插件后端入口、插件控制器，以及挂载到主页面中的独立 Web 页面。除非开发者明确要求，不要修改 `projects/server`、`projects/web`、`projects/user-script` 或 `projects/shared` 的核心实现，也不要把本 skill 安装到全局目录。

## 开始前必须确认的事实

先阅读当前仓库根目录的 `README.md`、`projects/server/plugins/plugin-env.d.ts`、`projects/server/plugins/template/index.ts` 和 `projects/server/plugins/template/web/index.html`。当这些文件没有说明某个行为时，继续查看对应源码；本 skill 的源码核实参考见 [references/runtime-contract.md](references/runtime-contract.md)。不要仅凭 README 的旧示例推断运行时行为。

根据任务需要再读取：

- 服务端接口或加载问题：`projects/server/plugin/load.ts`、`projects/server/router/plugin.ts`、`projects/server/router/web/api/load.ts`、`projects/server/router/web/page/index.ts`、`projects/server/router/index.ts`。
- 控制器交互问题：`projects/user-script/src/layouts/hooks/plugins.ts`、`projects/user-script/src/api/plugins.ts`、`projects/user-script/src/layouts/content-plugin.ts`。
- 插件页面通信问题：`projects/webutils/lib/index.ts`、`projects/webutils/lib/utils/fetch.ts`、`projects/web/src/layouts/content.ts`。

## 插件目录与入口

每个插件是一个独立目录，至少包含 `package.json` 和 `main` 指向的 `.ts`/`.js` 入口。推荐 TypeScript、ES module 和严格类型检查；模板的 `tsconfig.json` 可作为起点，并确保 `files` 包含 `../plugin-env.d.ts` 和 `../../plugin/sdk/modules.d.ts`。独立目录开发可显式引用核心工作区中的这两份文件；核心工作区需安装其类型依赖，无需发布 SDK npm 包。

```text
projects/server/plugins/my-plugin/
├── package.json
├── index.ts
└── web/                 # 可选：插件独立页面及其资源
    └── index.html
```

入口应默认导出符合 `SCWC.IPluginHandler` 的对象。使用类型约束，优先 `satisfies SCWC.IPluginHandler`，不要通过 `as any` 绕过类型错误。`SCWC` 是 `plugin-env.d.ts` 声明的命名空间，不要把它当作普通运行时模块导入；应沿用模板的类型可见性配置。

入口文件导入项目文件时，始终写完整文件名和后缀，包括 `index.ts`，例如 `./utils/index.ts`，不要省略后缀或 `index`，除非该插件已有明确且一致的格式化/模块解析约定。

`package.json` 至少应有：

```json
{
  "name": "my-plugin",
  "type": "module",
  "main": "index.ts",
  "enabled": true,
  "link-with": ["https://example.com"],
  "commandName": "my-plugin"
}
```

其中 `name` 缺省时运行时使用目录路径；`main` 缺失、入口不存在/不是 `.js` 或 `.ts`、默认导出不含函数 `onRequest`，插件会进入未激活列表。`enabled: false` 会跳过加载。`commandName` 可选，每个插件最多注册一个一级命令；命令名只使用字母、数字、`-`、`_`，并避免系统命令名。

`link-with` 不是正则表达式：当前实现支持普通前缀匹配、`*` 通配符和以 `!` 开头的否定模式；空数组表示匹配所有网址。需要复杂匹配时先阅读 `projects/server/router/utils/path.ts`（或其导出实现），并用少量明确规则验证正例和排除例。

## 默认独立进程与第二版契约

所有启用插件默认在独立 Node 子进程中执行。package.json 的 runtime 与入口的 apiVersion 都可以省略，默认分别为 process 和 2；runtime 也可仅设置 startupTimeoutMs/requestTimeoutMs/shutdownTimeoutMs（100–600000 毫秒的整数）。显式不支持的模式或版本会激活失败，不回退到核心进程。enabled: false 仍跳过加载。

默认使用 `satisfies SCWC.IPluginHandler`、TPluginApi、TPluginAddApi、TPluginRequestContext、TPluginResource；它们都表示可序列化第二版契约。IProcessPluginHandler 与 TProcess* 为兼容别名；Hosted 类型只供核心生成代理，不用于插件。

普通 API 接收 context.request（method/url/params/query/headers），不能使用 Express req/res。资源 handler 校验票据后返回文件或小响应描述；WebSocket 使用 connectionId/request/query 和本地 send/broadcast/close，没有真实 socket/clients。前端 scwcutils 和 URL 不变。

生命周期、命令、控件和抓取签名保持兼容。注入缓存由核心按插件目录名隔离，只传可序列化值/Buffer/bigint，不传 Readable 或函数。createRetryGet 自定义类在宿主本地创建；其流式响应留在宿主消费，不走 IPC 缓存。完整限制见 projects/server/plugin/process/README.md。后端修改应运行 `npx vitest run projects/server/plugin/process`；HTTP/WebSocket 验证需要本机临时端口，数据使用临时媒体库。

## 命令行配置

`pluginConfig.command` 用于向服务端命令行注册插件命令；只有同时设置 `package.json.commandName`，该配置才会占用一级命令。一个插件只能注册一个一级命令；多个插件使用同名命令时，运行时会为冲突命令加上插件 ID 前缀。配置字段如下：

- `execute(logger, options, unusedArgs, originArgs)`：没有匹配到子命令时执行的主处理函数。`options` 是带解析后 `value` 的选项数组，`unusedArgs` 是未使用的非选项参数，`originArgs` 是包含一级命令在内的原始参数数组；函数可同步或异步。
- `description`：命令帮助文本。
- `subCommands`：子命令数组，每项包含 `name`、可选的 `description`/`exampleUsage` 和必需的 `execute`；例如输入 `my-plugin sync` 时执行 `sync.execute`。
- `options`：命令选项定义，每项包含 `name`，可选 `alias`、`description`、`required`、`defaultValue`。用户可使用 `--name=value` 或别名 `-x=value`；未提供非必填项时使用 `defaultValue`，否则运行时默认值为 `false`。
- `exampleUsage`：展示给用户的完整用法示例。

命令处理函数只依赖声明的 `TLogger`（`info`、`pathInfo`、`warn`、`error`），不要在命令回调中使用 `logger.toWeb`。命令选项和未使用参数都来自用户输入，执行文件、网络或数据操作前必须自行校验。

## 后端实现边界

- `onLoad(logger, context)` 可选且可异步。可保存 `context.createRetryGet(...)` 、 `context.LimitPromise` 和 `context.cache` 等工具到模块作用域，供其他外部模块使用。
- `onRequest(context, logger)` 必须实现且可异步。`context.data` 是 `SCWC.TDataItem[]`；`context.site` 至少有 `url`、`rootUrl`、`origin`、`pathname`。抓取请求的 logger 额外有 `toWeb(message, type?)`，用于把通知返回给浏览器；控制器/API 触发的 logger 没有 `toWeb`，必须返回类型为 `notification` 的结果。
- 可以使用注入的 `utils.writeData` 保存抓取结果，使用 `writeDataURL` 单独保存 data URL/图片链接，使用 `fetchImage` 获取图片，使用 `strValidation` 清理文件名，使用 `convertToCN` 做汉字转换。文件路径由插件负责规划，先保证目录存在语义和可恢复性，不要把用户输入未经校验地拼接成任意路径。
- `onUnload(logger, { isRestart })` 可选。释放定时器、连接和临时资源；根据 `isRestart` 区分重启与真正退出。
- 依赖选择应优先使用核心 [共享 SDK](../../../projects/server/plugin/sdk/README.md)：通过 `scwc:deps` 导入明确开放的 Axios/Chalk/Zod/SQLite/Trash/File Type，可在任意插件目录及 SEA 中使用，不重复安装。普通包名仍由 Node 解析，根 dependencies 不等于共享白名单；其他根依赖只有在路径允许时才可直接复用。需要不同版本或未共享的依赖时由插件提供，并记录原因；安装位置仍遵循下方确认规则。
- 插件 Worker 使用 `scwc:runtime` 的 createPluginWorker，确保钩子在 Worker 内注册；RpcPeer、PluginProcessError 和 PluginRequest 也从此入口获取，不通过相对路径导入核心源码。直接运行插件或创建普通 Node Worker 需要自行注册 SDK。共享依赖按进程/Worker 独立实例，不经 IPC 传递函数。
- `scwc:deps` 是 Node 虚拟模块，浏览器不能直接加载。前后端共享 Zod 模型时，Vite alias 指向核心 plugin/sdk/browser.ts（只导出 z）；Node 依赖不能进入页面。开发声明与运行时版本须一致，详见共享 SDK README。

## 浏览器脚本控制器

在 `pluginConfig.scripts` 中提供 `title`、可选 `description` 和 `controls`。`controls` 可是静态数组，也可是接收 logger/site 并返回数组的函数；动态形式适用于按 URL 或页面状态生成控制器。每个控制器必须有唯一且稳定的 `channel`，建议只使用不含冒号的短标识，因为服务端会拼成 `plugin:<pluginName>:<pluginId>:<channel>`。

支持的 `type`：`button`、`toggle`、`select`、`input:text`、`input:number`、`checkbox`。`options` 中按控件类型设置 `defaultValue`；`select` 还必须提供 `options: [{ label, value }]`。可用选项包括：

- `requireFullContent`：默认 `true`；要求所有被捕获元素成功后才允许触发。
- `relatedChannel`：要读取的其他控制器通道列表；服务端回调收到的 `relatedValues` 会使用原始短通道名。
- `autoTrigger`：非按钮控件值改变后是否自动触发，默认 `false`。

控制器 `trigger(logger, context)` 收到 `data`、当前 `value`、`relatedValues` 和完整 `site`（包括 `host`、`hostname`），应返回或异步返回 `{ type: 'notification', data: { type, message } }`。异常由服务端转为 500；成功消息由浏览器脚本显示。不要依赖未声明的控件字段，也不要把浏览器端传来的值当作已验证的业务数据。

## 独立 Web 页面

在插件对象中配置 `ui: { entry: './web/index.html', api: [...], resources: [...] }`；`entry` 可为绝对路径，也可相对插件目录，推荐放在 `projects/server/plugins/<plugin>/web/`。主页面通过 `/web/api/pages` 获取有 `ui.entry` 的插件，并把页面放入 iframe。页面 HTML 会被服务端原样读取，并在 `</body>` 前注入最新的 `scwcutils` IIFE；静态资源按 entry 所在目录提供。

创建新的插件 Web 页面建议使用 Vite 构建，使用 Lit 开发，将 Vite `base` 设置为 `/web/page/plugin/<pluginDir>/`，其中 `<pluginDir>` 必须替换为插件所在目录的实际文件夹名称，不能使用 `package.json.name` 或任意显示名称。这样构建产物中的脚本、样式和其他资源会指向插件页面的挂载路径。页面资源不要依赖开发服务器的绝对根路径；构建后检查 HTML 中的资源 URL 与服务端静态资源路由一致。

插件页面与插件后端通信时，结构化请求默认使用 `window.scwcutils.fetch` ↔ `ui.api`。需要给媒体或其他资源元素提供可直接加载的响应时，使用 `ui.resources` ↔ `window.scwcutils.fetch.resource(url)`；不要把资源响应塞进普通 JSON API。除非开发者主动要求采用其他通信方式，否则插件前端不要使用原生 `window.fetch`、`XMLHttpRequest` 或自行实现的 HTTP 客户端来绕过这些通道；插件后端也不要创建独立 Express/Koa/Fastify 应用、调用 `listen()`、占用额外端口或启动独立 HTTP 服务器。插件页面应复用核心服务提供的认证、路由和转发能力。

`window.scwcutils` 的类型来自 `projects/webutils/lib.d.ts`，且该声明只在 `projects/server/plugins/*/web` 生效。建议页面使用 TypeScript，并把构建/类型检查纳入插件自己的配置；`tsconfig.plugin-web.json` 只负责仓库级类型检查，当前包含 `webutils/lib.d.ts` 和所有插件 `web/**/*`。

`scwcutils.fetch(url, options?)` 会把请求转发给当前插件的后端 API。`url` 可写 `/api/status` 或 `api/status`；请求最终带有插件 `safeId`、当前页面的 `site` 查询参数，以及主页面配置中的 Bearer token。返回值是服务端包装对象 `{ success, message, data }`，不是 handler 的裸返回值。页面应处理 HTTP 错误、`success: false` 和业务数据错误，不要把 token 硬编码到页面。

`window.scwcutils.resource(url)` 返回一个字符串 URL，而不是发起请求；将它用于 `<img src>`、`<video src>`、`<audio src>`、`<source src>`、`<link href>` 或其他需要浏览器直接加载资源的属性。该 URL 指向 `/web/resource/plugin/<safeId>/...`，并附带当前页面的 `site` 查询参数。资源 URL 不会像 `fetch` 请求那样自动携带 Bearer header，因此不要在资源接口中暴露仅凭 URL 即可访问的敏感数据；需要鉴权或一次性授权时，在资源 URL 的查询参数中设计短期、可验证的票据并在 handler 中校验。

在 ui.resources 中，每项提供 path 和 handler(data, context)。data 是查询参数，context.request 是可序列化请求数据。handler 必须返回 `{ kind: 'file', path: absolutePath, contentType?, downloadName?, headers? }` 或 `{ kind: 'response', status, body?, headers? }`；核心完成实际 HTTP 响应、Range、背压和断开清理。媒体票据仍先在插件内校验，不直接接受浏览器指定的任意文件路径，也不把大型媒体内容装入普通 API 或 IPC。

ui.api 可以是数组或接收 add 的注册函数。handler 接收请求体和 context.request，GET 接口从 request.query 取参数；异常仍使用 success/message 外层包装，并通过进程代理保留 status。进程不可用/超时/过载/消息过大分别返回 503/504/429/413。通信消息限制 16 MiB；超时不代表写操作已取消或回滚，不自动重试写请求。增加页面交互时使用窄范围 ui.api 和 scwcutils，不另建服务器。

## 实现与验证习惯

1. 先复制/参考 `projects/server/plugins/template`，为插件建立独立 `package.json`、入口和可选 `web/`。
2. 用 `SCWC` 类型约束对象；优先 `satisfies SCWC.IPluginHandler`，不要通过 `as any` 绕过类型错误。
3. 为 URL 匹配、数据转换、控制器相关值和 API handler 编写小而明确的测试或最小手工验证；特别验证 `link-with` 的否定规则、空数组、重复 channel 和页面 API 的错误响应。
4. 运行与改动相称的检查：至少执行 `npx tsc -b tsconfig.json --pretty false` 或项目现有等价检查；若页面有独立构建，再运行其构建命令。修复插件自身的错误，不要为了通过检查放宽核心 tsconfig。
5. 启动服务后建议开发者使用 `plugin ps`/`plugin ls` 检查插件是否激活；打开匹配网址，确认控制器配置、抓取通知、控制器触发、插件页面 iframe、静态资源、`window.scwcutils.fetch` → `ui.api` 通信，以及 `window.scwcutils.resource` → `ui.resources` 的普通和流式响应都可用，并确认插件没有监听额外端口。
6. 变更完成后复查 git diff，确认只改动开发者要求的插件文件和仓库内 skill 文件，没有生成全局安装或直接修改核心实现。
7. 有任何需要安装的依赖，先检查根目录是否已有相同依赖；若需要安装，请告知开发者，由开发者判断安装在根目录还是插件目录，如果有版本和兼容性要求或必须安装在插件目录，请在告知时说明原因。不要在插件目录安装与根目录相同的依赖，除非有明确理由。
8. 开发前先阅读当前插件或核心项目目录下的 docs/map.md，确认插件的功能和约束，并在实现中遵守约束；如果约束不够明确，先与开发者沟通再实现。
9. 开发完成后需要根据本次的实现和交付情况更新 docs/map.md，补充插件的新增功能，约束和注意事项；如果项目的功能或约束与 docs/map.md 冲突，先与开发者沟通再更新。

当 README、模板、声明与源码仍有冲突时，以当前源码的可观察行为为准，并在实现或交付说明中指出该冲突；不要把推测写成插件契约。
