# SCWC 插件运行契约（源码核实）

这份参考只在需要确认边界行为时读取。它记录当前仓库源码，而不是对未来版本的承诺。

## 加载与匹配

- `projects/server/plugin/load.ts` 启动时扫描 `projects/server/plugins` 的直接子目录，只处理有 `package.json` 的目录。
- 入口由 `package.json.main` 解析；存在且扩展名为 `.js`/`.ts` 才尝试加载。加载器使用 CommonJS `require`，只有模块带 `__esModule` 且有 `.default` 时才取默认导出。
- 默认导出必须有函数 `onRequest`，否则进入 `inactivePlugins`。`enabled: false` 也直接进入未激活列表。
- 成功加载后，服务端按顺序尝试注册命令、调用 `onLoad`、注册 `ui.api`。
- `projects/server/router/utils/path.ts` 的 `matchLink`：普通模式按前缀匹配；含 `*` 的模式转换成从字符串开头匹配的正则；`!` 是否定；一个否定通配符命中时返回不匹配；`link-with: []` 在调用方被当作匹配全部。
- `pluginConfig.command` 只有在 `package.json.commandName` 存在时才会注册；每个插件只能注册一个一级命令。`execute` 收到 logger、已解析选项数组、未使用参数和原始参数；选项解析支持 `--name=value`、别名和默认值。命令名冲突时会自动添加插件 ID 前缀。

## 抓取与控制器

- `/api/metadata/scrape` 对所有匹配插件依次调用 `onRequest`，并把 `toWeb` 收集成响应中的通知。一个插件失败不会阻止后续匹配插件尝试。
- `/api/plugin/config` 返回给浏览器脚本的控制器会去掉 `trigger`，并把 channel 改写为 `plugin:<name>:<pluginId>:<channel>`；`relatedChannel` 也会被改写。触发时服务端再解析回原始短 channel。
- `/api/plugin/toggle` 通过 `pluginId`、插件 `name` 和短 channel 定位控制器；`relatedValues` 只保留能解析完整 channel 的项。
- 控制器触发的 logger 类型只有 `TLogger`，没有 `toWeb`。回调结果由浏览器脚本按 `notification` 结构处理。

## 页面与 API

- `/web/page/plugin/:pluginDir` 按插件目录 basename 查找页面；`ui.entry` 相对路径是相对于插件入口文件所在目录（通常是插件目录）。找不到插件、entry 或文件时重定向到 404 页面。
- 页面响应会在第一个 `</body>` 前插入 `/web/page/lib/scwcutils.iife.<timestamp>.js`。若尚未构建该库，则不注入。
- `/web/page/plugin/:pluginDir/*path` 从 entry 所在目录拼接并发送静态资源；插件页面资源应因此使用相对引用。
- `registerPluginApi` 为每个 API 增加 `/<safeId>` 前缀，最终由 `/web/api/plugin/<safeId>/...` 暴露。API handler 的返回值被包装为 `{ success: true, message: '请求成功', data }`；抛错返回 HTTP 500、`{ success: false, message }`。
- `projects/webutils/lib/utils/fetch.ts` 从页面 pathname 的第 5 段取得插件目录，先请求 `/web/api/safeId/:pluginDir`，再把调用路径转为 `/web/api/plugin/:safeId/<path>?site=<current URL>`。配置由父页面 `postMessage` 传入；没有父页面时从共享 localStorage 配置初始化。
- 插件页面与插件后端的默认通信契约是 `window.scwcutils.fetch` → `ui.api`。除非开发者主动要求其他方案，不使用原生 `fetch`/`XMLHttpRequest` 绕过转发，也不为插件创建独立 HTTP 服务或监听额外端口。
- 主页面 `projects/web/src/layouts/content.ts` 使用 iframe 挂载插件页面，并在 iframe load 后发送 `scwc-plugin-config` 和 `scwc-plugin-hinder` 消息。插件页面不要假设能直接访问主页面 DOM；只依赖声明的 `window.scwcutils` 和标准 Web API。

## 保存数据与路径

`projects/server/utils/writeData.ts` 的当前行为：

- `writeData(dirPath, data)` 自动创建目录和 `images/`，向 `data.json` 追加一项；已有文件必须为空或根元素为数组，否则返回 `false`。
- 当 data 是带 `images` 字段的 DataItem 数组时，会把每个 data URL/图片 URL 写入 `images/`，并在 JSON 中保存生成的文件路径。
- `writeDataURL` 支持 `data:image/<ext>;base64,...` 和 `http(s)` 图片 URL；字符串参数作为目录，函数参数可按 `{ fullname, filename, ext, datePrefix }` 生成最终路径。返回最终保存的相对路径或 `false`。
- 实现使用同步文件系统调用和插件进程权限。插件应使用稳定、明确的目录，清理文件名并避免让外部输入决定任意绝对路径。
