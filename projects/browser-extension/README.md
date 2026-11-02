# SCWC 浏览器扩展

在浏览器工具栏的原生弹窗中采集当前网页。使用 Lit，复用 `projects/web` 的主题、`wb-scroll-container`、`wb-context-menu` 和 `wb-menu-select`；页面内只显示临时选择高亮，没有拖动窗口或最小化按钮。SCWC 工作台等普通 HTTP(S) 页面同样可以打开使用。

## 构建与安装

仓库根目录执行：

```sh
bun run build:extension
bun run check:extension
cd projects/browser-extension
bun run test
```

输出位于 `dist/browser-extension/`：

| 目录 / ZIP                             | 用途                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `chromium/`、`scwc-chromium-1.0.0.zip` | Chrome 120+、Edge、其他支持 MV3 的 Chromium 浏览器                     |
| `firefox/`、`scwc-firefox-1.0.0.zip`   | Firefox 桌面版 140+；采用事件后台页和 Firefox 数据传输声明             |
| `safari/`、`scwc-safari-1.0.0.zip`     | Safari 18+ 的 WebExtension 转换源包，需要 macOS/Xcode 转换、签名及验证 |

Chrome 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，指定 `chromium/`。Edge 对应 `edge://extensions`。固定工具栏图标后，点击即可打开。

核心运行后，可执行 `server install-extension`，或在 Web 快速访问中输入 `>`，选择“安装浏览器扩展”。核心读取运行机器的系统默认 HTTP 浏览器关联，选择 Chromium 或 Firefox 产物，仅打开普通 HTTP 安装向导。请在向导中点击“复制管理页地址”，粘贴到浏览器地址栏并按 Enter，再按向导提供的目录加载扩展。浏览器可能忽略从外部启动参数传入的内部管理页地址，因此不再直接唤起 `chrome://extensions/`。Web 入口也作用于核心所在机器，并立即显示进度、错误或超时提示。

默认浏览器为 Safari 时，当前源包缺少签名容器应用，命令会发送通知、Web 会弹出警告，并说明替代步骤；不会另行启动 Chrome。默认浏览器无法识别、产物缺失或系统启动失败时也会明确报告。唤起成功只表示操作系统已接收请求，不表示扩展已安装。

内置 Node 和外置 Node 两种核心发行 ZIP 均自动携带 `browser-extension/`，含已解压目录、ZIP 和说明文件。请完整解压并保留它；浏览器会持续从该目录加载扩展，不能只保留核心可执行文件，也不要在安装后删除或改名此目录。该目录不在 SEA 的临时 runtime 中，重启核心不会使安装路径失效。

Firefox 在 `about:debugging#/runtime/this-firefox` 中临时加载 `firefox/manifest.json`；普通正式版长期安装需要 Mozilla 签名，ZIP 本身不是已签名的 XPI。

Safari 在 Mac 上使用 Xcode 的 Safari Web Extension Converter，例如：

```sh
xcrun safari-web-extension-converter dist/browser-extension/safari --project-location dist/safari-xcode --app-name SCWC
```

然后在生成的 Xcode 项目中选择团队、运行容器应用并启用扩展。Safari 源包不能直接当作 Safari 安装包使用；本次 Windows 环境没有验证 Safari/Firefox 真机行为。

需要运行本次代码对应的 SCWC 核心。旧核心没有扩展来源支持，会拒绝请求。在“设置”中填写核心地址、端口和 TOKEN，点击“保存并连接”，只授权对应核心主机。端口另填，地址示例为 `http://localhost`；远程核心建议使用 HTTPS。

## 使用方式

1. 打开需要采集的 HTTP(S) 网页，点击扩展图标。
2. 点击“选择网页元素”。弹窗关闭，在网页中点击元素；按 Esc 可取消。
3. 再次点击扩展图标，编辑描述和前缀，可选择父元素或撤销父级，然后确认添加。
4. 抓取项可直接修改选择器、描述和前缀，右键或“⋯”菜单支持上移、下移、删除和网页高亮；也可手工添加选择器。
5. 点击“采集并发送”。任一选择器失效时阻止普通采集并显示具体项；空列表仍按原协议发送空数组。文字前缀、图片提取复用 user-script 的实现。
6. “插件”页按网址加载核心控件，支持按钮、输入、数字、复选框、开关、菜单选择、关联通道和防抖自动触发；保留后端声明的各插件 URL 增量刷新行为。

原生弹窗点击外部会自动关闭，这是浏览器的行为；扩展不会强行重开。浏览器内部页、扩展商店等浏览器禁止注入的页面无法采集。选择器与原脚本相同，作用于顶层文档，不跨越跨域 iframe 或 Shadow DOM。

## 存储和同步

- 使用扩展独立的 `storage.local`，不访问目标网站的 `localStorage`。连接默认值和外观使用 `scwc.extension.settings.v1`；网站配置按 `scwc.extension.site.v1:<origin>` 保存，同一 origin 的不同路径共享，网站之间隔离。
- 与 user-script 共用核心的 `userscript-config.sqlite` 和现有版本 1 快照协议。抓取项、控件值、插件页签、配置和展开偏好可同步；扩展本地模型不保存 `window.pos`、`window.minimized`。核心在事务中保留这两个字段已有值，首次创建时使用脚本默认值。
- 弹窗打开时先按修改日期同步，随后每 4 秒检查一次；输入立即交给后台落盘。关闭弹窗停止轮询，离线编辑在下次打开时重试。没有浏览器云同步，也不会自动导入各网站原有的油猴本地数据；先让油猴数据同步到核心，再用扩展连接同一核心即可迁入。
- 本地存储写失败会显示提示；网络失败保留本地数据。网络请求最长 25 秒，避免 MV3 后台挂起；核心操作已经执行但回执丢失时，请先核实结果再重试。
- 卸载扩展会删除浏览器中的本地副本；核心已同步的数据不受影响。开发版、更换安装目录或商店版可能使用不同扩展 ID，不应依赖它们共享本地存储。

## 权限与核心兼容

安装时只申请 `activeTab`、`scripting`、`storage`，不申请全部网页的长期访问权限。核心主机属于可选授权，用户主动连接时申请；WebExtensions 主机匹配模式按协议和主机授权，不能限定端口。

后台只接受扩展弹窗的核心请求；网页选择脚本只能报告当前标签的选择结果，无法获取核心令牌。Chromium 还将 `storage.local` 限制在可信扩展上下文。

核心仅对现有四个采集/配置路径允许 `chrome-extension:`、`moz-extension:`、`safari-web-extension:` 来源，仍执行现有 Bearer 鉴权与 HTTP(S) site 校验。配置 Socket 票据绑定请求者精确来源。插件配置增加等价 POST 查询入口，因为 Chrome 扩展后台 GET 没有 Origin；原油猴 GET 入口保留。

## 验证

`bun run test` 覆盖本地并发保存、网站隔离、远端裁决、上传期间编辑保护、选择/父级/撤销/Esc、文本提取和失效选择器。核心测试还覆盖扩展鉴权、精确来源票据、配置共享以及浮窗字段保留。

Windows 上可执行真实 Chrome 冒烟测试：

```sh
node projects/browser-extension/scripts/smoke.ts
```

先运行构建。可用 `SCWC_CHROME_BINARY` 指定兼容 Chrome 的可执行文件。测试使用隔离浏览器 profile、临时 HTTP 夹具和扩展副本；只给测试副本预授予夹具主机权限，不自动确认真实用户的授权框。验证工具栏弹窗、关闭重开选择、父级/撤销、扩展落盘、核心同步、插件加载及采集，并将截图保存到 `dist/browser-extension/previews/`。不接触用户的日常浏览器 profile。

上架前还需手工验证主机授权框、Firefox 和 macOS Safari。发布与商店条件见 [PUBLISHING.md](PUBLISHING.md)，隐私说明见 [PRIVACY.md](PRIVACY.md)。

`node projects/browser-extension/scripts/installer-smoke.ts` 使用真实工作台、HTTP 接口和独立 Chrome profile 验证快速访问 Enter 执行、暂停状态下的安装请求、进度反馈、普通 URL 启动的向导正文和复制按钮。先构建 Web 页面；测试使用独立数据库并替换系统安装器，不打开用户日常浏览器或资源管理器。
