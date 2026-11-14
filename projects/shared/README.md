# Shared

`@scwc/shared` 是独立的私有工作区包，为核心及插件提供共享组件、工具和类型；不发布到 npm。根目录提供两个公开入口：

| 入口 | 插件导入 | 内容 |
| --- | --- | --- |
| `frontend.ts` / `@scwc/shared/frontend` | `scwc:shared/frontend` | 后端入口的通用能力，以及表单组件、通知、滚动容器、浏览器配置/存储/日志、刷新规则、自定义元素注册、请求生命周期和 DOM 资源管理 |
| `backend.ts` / `@scwc/shared/backend` | `scwc:shared/backend` | cache、debounce、tryCatch、FetchError、补全解析、声明式 UI 校验与表达式、反馈客户端，以及响应、JSON、UI、通知和任务类型 |

```ts
// 插件前端
import { SCWCButton, SCWCScrollContainer, tryCatch, notify } from 'scwc:shared/frontend';
import type { SCWCButtonEventMap, ScrollState } from 'scwc:shared/frontend';

// 插件后端或 createPluginWorker 创建的 Node Worker
import { cache, tryCatch, UIError } from 'scwc:shared/backend';
import type { UIContent, ResponseData } from 'scwc:shared/backend';
```

前端入口会注册 `scwc-button/input/trigger/toggle/select/checkbox/notify/scroll-container`，通知首次调用时创建或复用页面挂载点。`@scwc/vite-plugin` 自动为每个 HTML 入口加载它；只使用组件标签时无需手工 import，调用工具或引用组件类时使用命名导入。前端入口需要 DOM，不能在 Node 或浏览器 Worker 中加载；Vite 的 Worker 构建不会自动注入它。前端配置与存储仍按当前页面 origin 隔离。

后端入口没有浏览器依赖，支持 Node 原生 strip-only TS。核心 SDK 在导入插件前注册 `scwc:shared/backend`，与 `scwc:deps`、`scwc:runtime` 使用同一钩子及 Worker 引导机制；源码、CJS bundle 与两种发行包复用同一入口。前端的虚拟入口由 Vite 解析到核心包，插件无需在自己目录安装 shared。

运行 `bun install` 链接工作区包。插件开发类型继续通过 `projects/server/plugin/sdk/modules.d.ts` 和 `projects/server/plugins/plugin-env.d.ts` 接入；前端入口同时引入 Vite 资源声明及组件标签类型。包内已有的工作台协议、布局和配置交付队列仍作为核心内部模块使用，未加入公开入口。

发行构建通过 `@scwc/vite-plugin` 的工作区依赖收集 shared 源码、CSS 及前端依赖；工具链在首次页面构建时释放。已有插件页面需执行 `plugin build-web <目录名>` 后刷新才能使用新增组件。


## 共享通知

Web 浮层、脚本通知和扩展网页外部通知共用 `notification.ts` 的卡片与 `notification.css` 外观。`NotifyController` 只管理计时、剩余时长、独立悬停/聚焦暂停、关闭和挂载生命周期，不依赖 DOM 或样式；扩展内部保留自己的卡片堆叠、历史和已读样式，复用此控制器。后续前端通知优先复用这些入口。

```ts
import { Notify, notify } from 'scwc:shared/frontend';

const notifications = new Notify();
const handle = notifications.success('采集完成', { description: '已保存 12 项', placement: 'tc' });
handle.update({ description: '已保存 15 项', progress: 100 });
await handle.markRead();
await handle.setProgress(false);
handle.close();
notify({ title: '后台处理中', progress: null, placement: 'bc' });
new Notify({ useCore: false }).info('仅在插件页显示', { placement: 'tc' });
```

位置支持 `tl/tr/tc/bl/br/bc`（左上、右上、顶部居中、左下、右下、底部居中）。支持 info/success/warn/error、正文、进度、按钮回调、点击和关闭回调；`duration` 单位为毫秒，0 表示持续显示，未完成进度会暂停自动关闭。程序调用 `close()` 不触发 `onclose`，自动隐藏和关闭按钮分别传 `auto/user`。需要独立样式时可只导入 `NotifyController`，通过 `set/pause/resume/close` 管理通知，并在宿主挂载/卸载时调用 `connect/suspend`，最终释放时调用 `dispose`。

核心插件页默认 `useCore: true`：嵌入工作台时在核心通知区显示，位置跟随核心页面（当前右下角），插件的 `placement` 被静默忽略。构造 `new Notify({ useCore: false })` 或对单条通知设置 `useCore: false` 可保留插件页内展示；独立打开页面时也在本页显示。SDK 另公开 `scwcutils.Notify/notify`。对象、回调、计时和状态由创建的插件文档管理，核心的展示和交互通过页面通道双向同步，文档销毁时释放。句柄还提供 `setContent/setProgress/setActions/markRead/getState/isVisible`，状态控制方法返回 Promise；`update/close` 保留同步布尔返回值。自动隐藏保留记录和句柄，显式关闭移除记录；`autoRead: false` 可交由插件主动管理已读。详见[工作台通知接口](../../docs/workbench-feedback.md)。

## 插件主动通知脚本和扩展

插件 `onLoad(logger, context)` 中的 `context.notifications` 可以长期持有，在定时器、后台任务或其他回调里独立调用：

```ts
await context.notifications.notify('https://example.com/article', {
  title: '后台处理完成',
  description: '可以继续下一步',
  type: 'success',
  scope: 'external',
  placement: 'bc',
});
```

核心按 HTTP(S) 网站 origin 分发，插件身份由宿主固定。`scope` 可选 `internal/external`，默认 `internal`。扩展内部使用原有样式；外部在对应网页显示共享通知，不需要打开扩展弹窗。脚本始终在网页显示并忽略 scope。旧 v1/v2 回调返回的 `{ type: 'notification', data: { type, message, scope? } }` 也支持范围设置，扩展本地可调用 `ExtensionPopup.notify(options)`。

脚本通过已有油猴 HTTP 配置轮询和独立游标接收主动通知，兼容页面 CSP；扩展使用配置同步签发的单次票据建立后台 WebSocket，关闭弹窗仍可接收，后台重启会恢复先前标签订阅。修改核心凭据会撤销旧连接，导航/关闭网页后释放对应订阅。外部显示需要扩展能够访问该网页；无法注入时通知仍保存在扩展未读历史中。内部通知在弹窗关闭时只保留历史和角标，重开不补播横幅。

通知日志为内存中的有界短期投递记录（最多 1000 项、15 分钟），用于连续轮询和握手间隙续接；首次连接不回放旧横幅，核心重启不保留此日志。通知正文均按纯文本渲染，跨进程接口不接受函数回调。
