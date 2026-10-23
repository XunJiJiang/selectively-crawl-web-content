# 滚动容器测试服务器

在仓库根目录执行：

```sh
node projects/shared/components/scroll-container/test-server/server.ts
```

打开 <http://127.0.0.1:4399/>。默认只监听本机，端口占用时直接报错，不自动换端口。按 Ctrl+C 停止。可通过 `--port 4400` 指定端口，`--help` 查看命令用法。使用仓库现有 Vite 依赖，无需额外安装。

页面展示：

- 横向、纵向独立的全部 `ScrollbarOptions`：`size`、`color`、`radius`、`opacity`、`fadeInDuration`、`fadeOutDuration`、`hideDelay`、`minThumbSize`、`placement`。
- `scrollBehavior`、`stepDistance`、`wheelDirection`、`shiftWheelDirection`，以及容器与内容的动态尺寸。
- 高频滚轮按帧累计：平滑模式直接应用本帧位移；跳跃模式按最小步长整步移动，余数跨帧保留，空闲 150ms 后丢弃。
- 40px 标签栏、双轴内容、占位模式、无溢出四个预设，以及 `::part` 外观覆盖。
- `content(updateMetrics)` 内部渲染回调、外部 `metrics` 的全部四个尺寸/位置字段、外部优先与旧内部回调失效。
- 真正只渲染可见行的虚拟列表、向内 `contentScroll` 回调和向外 `scroll` 事件计数。
- `scrollTo(options)`、`scrollTo(x, y)`、`refresh()`、`scrollState`、`scrollElement`，以及可操作的事件记录和当前参数示例代码。

页面直接导入相邻组件源码，修改组件、页面或样式后会热更新。测试服务器使用独立 Vite 实例，不加载工作台或 `projects/shared/vite.config.ts`，也不需要启动核心服务。
