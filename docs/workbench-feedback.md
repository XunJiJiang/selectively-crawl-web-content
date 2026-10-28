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

任务支持 `update()`、`setContent()`、`setProgress()`、`succeed()`、`fail()`、`cancel()` 和 `getState()`，可设置标题、类型、阶段、正文、状态、错误及追加日志。状态包括 `queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`；已完成任务不能重新进入运行状态。任务创建和更新均不会自动打开窗口。状态栏任务按钮显示空闲、执行中或完成未读状态，打开“任务”窗口后标记当前完成任务已读。

```ts
const build = await tasks.start(pluginId, 'build-ui');
const state = await build.getState();
await build.cancel();
```

`tasks.start()` 运行现有的 `rescan`、`enable`、`disable`、`once-disable`、`reload`、`build-ui` 操作，状态由核心管理，控制对象可查询或请求取消；内容和进度的手动更新用于 `tasks.create()` 创建的任务。插件只能对自身执行这些操作，`rescan` 限核心使用，已进入执行阶段的插件生命周期操作不可取消。自定义任务的类型可使用相同名称，但不会隐式执行插件操作。

控制对象绑定创建它的插件宿主或页面文档，不能修改其他插件或其他文档创建的对象。页面任务运行时保护页面不被自动休眠；页面离开时请求释放自身对象。后端宿主退出或页面释放时，其未完成自定义任务标记失败，通知回调失效；核心重启后不会重放任务或恢复函数回调。重新加载的页面应创建新的控制对象。
