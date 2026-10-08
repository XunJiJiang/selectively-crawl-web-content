# 插件页面构建

插件页面交付支持两种方式：

1. 提供完整构建产物，`ui.entry` 指向可读取的 HTML；核心直接加载，不要求 Vite 或 build:web。
2. 提供页面源码和 Vite 配置，在 package.json 保留 `scripts.build:web: "vite build --config vite.config.ts"`。HTML 缺失时核心自动构建，不要求在插件目录安装 Vite。

初始化顺序是导入插件入口 → 获取 ui.entry → 准备/构建页面 → onLoad → 注册命令、API、资源和页面。入口模块的顶层代码不能提前读取尚未生成的页面；此类读取应放在 onLoad 或 ui.html 中。页面构建期间暂停插件 startupTimeoutMs；构建有独立的五分钟截止时间。失败插件进入 inactivePlugins，其他插件继续加载。

## 命令

```text
plugin build-web <插件目录名>
```

该系统命令在直接核心和多窗口终端均可用，始终执行重新构建。它不重载插件后端、不重新执行 onLoad；前端重建后刷新页面。未激活插件修复并构建成功后，通过 restart/:r 重新激活；本功能不依赖单插件动态加载/卸载。

还可直接构建而不启动 HTTP 或 Redis：

```sh
bun run build:plugin-web --directory <插件目录>
./scwc --build-plugin-web <插件目录>
```

## 构建工具与依赖

SEA 内置 Vite、vite-plugin-monkey、esbuild，以及它们需要的原始模块和本机原生资源；无需部署机另装 Node/Vite。正常启动只释放核心资源，首次页面构建按需释放工具链/浏览器依赖，后续构建复用。源码模式需安装根工作区依赖（包含构建开发依赖）。额外 Vite 插件、预处理器或私有页面依赖由业务插件提供；核心不自动联网安装包。

`dependencies.ts` 是前端共享包与构建工具的明确白名单，包含 Lit、@lit/context、@lit-labs 系列、Zod、CodeMirror、Lezer 等。页面保留 `import ... from 'lit'` 以及包的正常子路径；构建先按插件位置解析，未找到白名单包时才使用核心目录。Node 配置加载也提供对应回退，解决外部目录没有 Vite 的情况。插件私有版本优先，core 固定版本只作为回退。

`scwc:deps` 的浏览器虚拟模块仍只导出 z；它与普通包名的共享机制不同。核心构建器自动配置其别名，且同时处理前端 Worker。直接使用本地 Vite 构建时仍需自己配置别名；贴纸提供了本地 shared/browser-dependencies.ts，因此其 Vite 配置不再依赖核心的相对目录。

## 配置边界

- build:web 作为声明解析，绝不交给 shell 执行。只支持直接的 vite build，可指定一个 root、--config/-c、--mode/-m、--outDir、--target、--sourcemap/inline/hidden、--emptyOutDir；其他参数写入 Vite 配置。任意 node/bun/npm 命令链不支持；已有完整产物的插件不受此限制。
- 配置采用 Node 原生加载，TS 配置只使用可擦除语法；运行时 enum、参数属性和装饰器配置需预先转为 JS。插件配置及 Vite 插件与后端一样是受信任代码。
- outDir 必须是插件内独立的产物目录，不能等于插件根或源码根。ui.entry 应指向该目录里的 HTML。base 由核心固定为当前目录名对应的 /web/page/plugin/<目录名>/。
- 构建在独立进程与临时产物目录进行。成功后替换正式目录；普通构建失败保留旧页面。同一插件的并发构建合并，所有构建串行排队，避免同时占用大量机器资源。
- 命令取消或核心退出会停止构建进程树。强制终止可能遗留 .scwc-web-build-* 临时目录，但不会把未完成产物发布为正式页面。
- 自动构建只检查 HTML 是否存在，不根据时间戳或核心依赖升级自动重新构建。交付预构建页面需包含其全部 JS/CSS/WASM/字体资源；升级共享浏览器依赖后使用构建命令重新生成页面。

## 验证

web-build.test.ts 覆盖外部目录没有 Vite/Lit/Zod、子路径/CSS/Worker、预构建页面、重复请求与失败保留旧产物，以及实际 SEA 的独立构建。process/loader.test.ts 验证构建先于 onLoad、启动超时暂停、不支持的脚本不执行和失败清理。全部使用临时插件与临时数据。
