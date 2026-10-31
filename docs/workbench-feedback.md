# 工作台任务与通知接口

插件前端通过 `scwcutils.logger` 和 `scwcutils.tasks` 使用。插件后端在 `onLoad(logger, context)` 中保存 `context.workbench`，即可在后续回调中长期使用其中的 `logger` 和 `tasks`；原来的 `logger.workbench.info/success/warn/error` 同样返回通知控制对象。`context.tasks` 仍是原有的调用生命周期接口。

核心后端通过 `projects/server/workbench/feedback.ts` 的 `createBackendFeedback()` 获取相同接口；核心前端通过 `WorkbenchStore.logger` 和 `WorkbenchStore.tasks` 使用。

```ts
// 插件后端：const { logger, tasks } = context.workbench;
// 插件前端：const { logger, tasks } = scwcutils;
const task = await tasks.create({ title: '导入文件', type: 'import', progress: null });
const notice = await logger.create({
  title: '正在导入',
  message: '等待文件读取',
  level: 'info',
  progress: null,
  autoRead: false,
  actions: [{ label: '取消', onClick: async () => { await task.cancel(); await notice.close(); } }],
});
await task.update({ phase: '解析', content: '正在处理第 5 个文件', log: { text: '文件已读取' } });
await task.setProgress(50);
await notice.setContent('正在导入', '已完成一半');
await notice.setProgress(50);
await task.succeed('导入完成');
await notice.update({ title: '导入完成', level: 'success', progress: 100 });
const state = await notice.getState(); // visible、seenAt、readAt
if (state.seenAt) await notice.markRead();
```

所有创建和控制方法均返回 Promise，应处理调用失败。进度使用 `0`～`100`；`null` 显示不确定进度的加载动画；`false` 隐藏加载条。正在加载的弹出通知不会自动消失，完成或隐藏加载条后恢复倒计时；也可调用 `close()` 同时移除弹出通知和通知中心记录。

通知支持 `update()`、`setContent()`、`setProgress()`、`setActions()`、`markRead(true/false)`、`getState()`、`isVisible()` 和 `close()`。操作按钮最多 4 个（包含旧 `target` 按钮），每个按钮提供 `label` 和 `onClick`；回调在创建它的页面或后端进程执行，更新按钮后旧操作失效。控件更新保留已读状态，`autoRead: false` 禁止聚焦或进入通知中心可视区域时自动标记已读，用户仍可主动标记已读。`visible` 表示通知中心中当前可见，`seenAt` 表示首次进入通知中心可视区域的时间，均不把弹出通知当作通知中心；窗口意外关闭后可见状态最多保留 20 秒。

需要在应用失焦时提醒用户的通知，可设置 `systemNotification: true`，默认关闭。此选项可在核心或插件的前后端使用，也可通过 `update()` 开启或关闭：

```ts
await logger.success('导入完成', {
  message: '文件已经保存',
  systemNotification: true,
});
```

系统通知统一由核心持久化和发布，前后端使用同一个 `systemNotification` 选项。发送方式保存在核心偏好 `systemNotifications` 中，提供三项：

| 发送位置 | 内核电脑 | 当前浏览器 |
| --- | --- | --- |
| 内核和非回环地址浏览器（初始选择） | 发送 | 仅在页面主机不是 localhost、*.localhost、127.0.0.0/8 或 ::1 等回环地址时发送 |
| 仅内核 | 发送 | 不发送 |
| 仅浏览器 | 不发送 | 发送，包含回环地址打开的页面 |

内核按通知 ID 和发布次数去重，每条消息只发送一次，与浏览器窗口数量无关。回环地址工作台上报聚焦和失焦，5 秒续约，20 秒过期；本地工作台聚焦时不发内核提醒，浏览器关闭或没有有效本地窗口时仍可发送。远程浏览器的聚焦状态不会压制内核电脑的提醒。浏览器通道仍通过可替换的 `ApplicationFocus` 判断自身聚焦，浏览器默认使用可见性与 `document.hasFocus()`。非回环地址并不等于另一台电脑：在内核电脑上通过局域网地址打开页面也会符合浏览器发送条件。

首次启动需要授权时，工作台在右下角显示提示。点击“允许”会开启核心配置，并在当前发送方式需要浏览器通道时直接申请浏览器权限；点击“拒绝”会关闭系统通知。核心保存开启状态和已决定标记，浏览器按 origin 保存自己的决定，后续启动不再主动提示。新远程浏览器仍需独立授权；允许或拒绝后不反复申请。已授予、已拒绝的浏览器权限不重复申请。设置保留“系统通知”项，按钮在“开启系统通知”和“关闭系统通知”间切换；关闭后立即撤销已有和等待中的提醒，应用内通知保留。开关与发送位置通过偏好事件同步，浏览器站点权限不会被应用开关撤销。浏览器权限被阻止时仍需在站点设置中手动允许。浏览器通道要求 HTTPS 或可信回环地址；普通 HTTP 局域网页面不能显示浏览器系统通知，但内核通道仍可工作。[浏览器通知权限](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)。

内核使用 `node-notifier` 的 macOS 通知中心、Windows Toast 或 Linux `notify-send`。macOS 在首次发送原生通知时可能再次出现系统权限提示；应用中的允许不代表已绕过系统授权。内核必须运行于登录用户的桌面会话，不能由 Windows SYSTEM 服务或无图形桌面的进程代替。发送失败记录核心日志并在工作台提示，不删除原通知。系统还需允许 SCWC/通知辅助应用发送横幅，并检查勿扰或专注模式。[原生通知库及平台限制](https://github.com/mikaelbr/node-notifier)。

内核图标源为 `projects/web/public/favicon.ico`。运行时提取其中最大的图像并转为 PNG，Windows 将其用作 Toast 图像；macOS 的图标来自应用包，因此内核在 `data/scwc/SCWC Notifications.app`（跟随 `SCWC_DATA_DIR`） 准备持久辅助应用，写入同源 ICNS 图标、设置稳定身份 `com.scwc.notifications`、本地签名并校验，再显式注册 Launch Services。不能仅从随机临时目录复制并签名后直接请求权限。辅助程序与图标摘要未变时复用现有应用，更新时在暂存目录构建、签名、验证后替换；已存在的非托管应用不会被覆盖。应用路径和标识跨内核重启保持稳定，系统权限仍由用户决定，已拒绝时需在“系统设置 → 通知 → SCWC”中允许。双发行构建将原始 favicon 复制为 `public/resources/notification.ico`，并完整携带原生辅助程序、相对资源和执行权限。以后替换源 favicon 并重新构建即可更换图标；操作系统显示的发送者名称、横幅布局和图标缓存仍由系统管理。

只处理实时发布，以及已知通知重新发布或从关闭变为开启系统提醒的更新；进度、内容、已读、可见状态更新和历史加载不反复提醒，开启开关或改变发送位置不补发旧通知。点击内核通知会定位最近的本地工作台；没有有效本地窗口时打开内核本机工作台并定位记录。标记已读、删除、关闭系统提醒选项或关闭服务均撤销相关系统提醒。

桌面应用有两个明确接入点：前端 `NotificationHost.kind = 'desktop'` 强制关闭浏览器通知通道；内核通过 `getWorkbench().systemNotifications.setHost(nativeHost, true)` 注入原生宿主并广播强制内核模式。`CoreNotificationHost` 提供 `supported()`、可异步的 `isFocused()`、`show()` 及 `activateNotification(id)`，`show()` 返回可关闭句柄，接收点击与失败回调。桌面宿主可用原生窗口焦点、系统通知、应用图标与窗口唤起替换辅助程序，无论偏好如何均由内核发送；设置展示“仅内核”并禁用发送位置选择。核心接口不依赖 Electron 或 Tauri。

任务支持 `update()`、`setContent()`、`setProgress()`、`succeed()`、`fail()`、`cancel()` 和 `getState()`，可设置标题、类型、阶段、正文、状态、错误及追加日志。状态包括 `queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`；已完成任务不能重新进入运行状态。任务创建和更新均不会自动打开窗口。状态栏任务按钮显示空闲、执行中或完成未读状态，打开“任务”窗口后标记当前完成任务已读。

```ts
const build = await tasks.start(pluginId, 'build-ui');
const state = await build.getState();
await build.cancel();
```

`tasks.start()` 运行现有的 `rescan`、`enable`、`disable`、`once-disable`、`reload`、`build-ui` 操作，状态由核心管理，控制对象可查询或请求取消；内容和进度的手动更新用于 `tasks.create()` 创建的任务。插件只能对自身执行这些操作，`rescan` 限核心使用，已进入执行阶段的插件生命周期操作不可取消。自定义任务的类型可使用相同名称，但不会隐式执行插件操作。

控制对象绑定创建它的插件宿主或页面文档，不能修改其他插件或其他文档创建的对象。页面任务运行时保护页面不被自动休眠；页面离开时请求释放自身对象。后端宿主退出或页面释放时，其未完成自定义任务标记失败，通知回调失效；核心重启后不会重放任务或恢复函数回调。重新加载的页面应创建新的控制对象。
