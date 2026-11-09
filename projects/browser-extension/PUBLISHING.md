# 发布建议与商店条件

建议采用“商店作为正式安装入口，发行包附带 ZIP 供开发、离线使用和版本配套”的双轨方式。两种核心发行包自动携带扩展目录与未签名 ZIP；构建不会自动上传商店。可先进行内测，稳定后提交商店。

`server install-extension` 与 Web 快速访问的“安装浏览器扩展”均会识别核心机器的默认浏览器，仅打开安装向导。向导提供管理页地址、目录和复制按钮；用户将管理页地址粘贴到地址栏后确认加载。Chrome/Chromium 仍需启用开发者模式，不能视为静默安装；官方 Chrome 从 137 起也移除了普通构建中的 `--load-extension` 入口，参见 [Chromium 官方公告](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY)。当前 Firefox 包走临时调试安装；Safari 源包缺少签名容器应用时显示通知说明，参见 [Apple 分发要求](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)。

## Chrome Web Store

发布前需要：

1. Google 开发者账号，接受开发者协议、支付一次性注册费，并启用两步验证。费用以实际注册页面显示为准；[注册说明](https://developer.chrome.com/docs/webstore/register)、[两步验证要求](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)。
2. 可审核的 MV3 ZIP，`manifest.json` 位于 ZIP 根目录，版本合法、图标齐全；本项目提供对应 Chromium ZIP。所有可执行代码随包提供，不从核心下载和执行脚本；[提交步骤](https://developer.chrome.com/docs/webstore/publish)。
3. 商店名称、简短及详细介绍、分类、语言、128×128 图标、功能截图和支持链接，按开发者控制台的最新尺寸要求准备图片；截图应使用实际网页和非敏感测试数据。
4. 明确单一用途、各项权限理由和数据用途声明，提供公开的隐私政策 URL。此扩展会向用户配置的核心传输网页内容、URL、控件值与配置，不能勾选“完全不传输数据”；[项目政策](https://developer.chrome.com/docs/webstore/program-policies/policies)。
5. 可复现的审核步骤：说明外部 SCWC 核心是必需依赖，提供核心版本、启动步骤、测试插件及无敏感数据的示例页；需要凭据时提供专用审核凭据。不可假定审核人员的 localhost 已运行核心。准备最简核心演示或完整视频有助于解释完整流程，但不能保证审核通过。
6. 核验 Firefox/Safari 之外的目标 Chromium 浏览器、授权拒绝/撤销、核心离线、网页导航、失效选择器、卸载重装与扩展升级。商店审核通过后才可正式安装和自动更新。

Chrome 的普通 Windows/macOS 用户不能把随包提供的 CRX 当作通用安装器直接安装。自行托管的企业分发需要相应策略；开发者可使用“加载已解压”。因此仅附包会增加安装和更新负担，[官方分发说明](https://developer.chrome.com/docs/extensions/how-to/distribute)。

| 方式           | 优点                                                 | 代价                                                       |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 商店           | 安装与更新方便，稳定安装 ID，适合普通用户            | 开发者注册、审核和持续合规维护；受商店访问条件影响         |
| 发行包附带 ZIP | 与核心版本明确配套，便于内测和离线部署，无需先等审核 | 需解压并启用开发者模式，手工更新，目录和扩展 ID 管理更复杂 |

正式版在商店说明最低核心版本；扩展版本统一跟随根目录 `package.json.version`，每次发布前提高根版本，构建命令自动同步扩展及其他工作区项目的包版本。业务插件保留独立版本，两个 template 和内置终端 scwc 插件随根版本。发行包中的 ZIP 应保持为与源码相同的可复现构建；不要在其中预写个人 TOKEN。商店为主、附包为辅时无需把核心运行资产塞入浏览器扩展。

## Firefox 与 Safari

Firefox ZIP 使用独立事件后台清单，面向桌面 140+，声明 `websiteContent`、`browsingActivity` 的必需数据传输用途。上架或自行分发给普通用户仍需 Mozilla 签名；临时调试安装不是长期分发方案。参见 [Firefox 数据传输声明](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。

Safari ZIP 是转换源包。需要 Mac、Xcode、Safari 测试以及容器应用和扩展的签名，正式分发需选择 Apple 支持的分发路径；App Store 发布还需相应 Apple Developer 账号。当前不建议宣称 Safari 已正式支持，完成转换和真机测试后再发布。[Apple Safari Web Extension 文档](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)。

扩展的存储独立性与原生弹窗关闭行为可查 [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)、[Popup 文档](https://developer.chrome.com/docs/extensions/develop/ui/add-popup)。
