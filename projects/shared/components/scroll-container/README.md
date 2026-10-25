# scwc-scroll-container

独立的 Lit 滚动容器。提供组件、测试和独立参数演示页，未注册到共享组件总入口。工作台通过 `projects/web/src/components/scroll-container.ts` 适配默认外观与按行滚动；插件页面不受该适配影响。

```ts
import '.../shared/components/scroll-container/index.ts';

html`<scwc-scroll-container
  style="width: 100%; height: 40px"
  .horizontal=${{ size: 5, color: '#888', radius: 3, opacity: 0.6 }}
  wheel-direction="horizontal"
  shift-wheel-direction="horizontal"
  scroll-behavior="instant"
  step-distance="60"
  @scroll=${(event) => console.log(event.detail.scrollLeft)}
>
  <div style="display: flex; width: max-content">...</div>
</scwc-scroll-container>`;
```

宿主须获得明确的可用宽高（也可由 flex/grid 分配）。内容默认使用 slot；原生视口保留触摸、键盘和浏览器滚动能力。导出的 `SCWCScrollContainer` 可直接创建实例；`scrollElement` 获取视口，`scrollState` 获取只读状态，`scrollTo({ left, top, behavior })` 或 `scrollTo(x, y)` 设置位置，`refresh()` 主动测量。

## 选项

`horizontal`、`vertical` 分别接收以下对象；长度单位为 px，时间单位为 ms。修改对象时请赋予新对象以触发 Lit 更新。

| 字段            | 默认值       | 含义                                                    |
| --------------- | ------------ | ------------------------------------------------------- |
| size            | 4            | 轨道及滑块厚度                                          |
| color           | currentColor | 滑块颜色                                                |
| radius          | 3            | 滑块圆角                                                |
| opacity         | 0.5          | 显示时的透明度，范围 0–1                                |
| fadeInDuration  | 80           | 淡入时间                                                |
| fadeOutDuration | 400          | 淡出时间                                                |
| hideDelay       | 600          | 最后活动后等待多久开始淡出                              |
| minThumbSize    | 20           | 最小滑块长度，最终不超过轨道                            |
| placement       | overlay      | overlay 悬浮；gutter 在溢出时占位，隐藏动画期间保留占位 |

只有溢出的方向绘制滚动条。指针在容器内、正在拖拽或滚动条拥有键盘焦点时保持显示；该轴的视口/内容尺寸变化、该轴滚动也会重新显示。离开或活动停止后按该轴的 hideDelay 和 fadeOutDuration 淡出。拖拽不修改光标。支持 Home/End、PageUp/PageDown 和对应方向的箭头键。系统减少动态效果偏好会关闭淡入淡出及平滑滚动。

`wheelDirection` / `wheel-direction` 默认为 `auto`，`shiftWheelDirection` / `shift-wheel-direction` 默认为 `horizontal`；均支持 `auto`（保留双轴）、`horizontal`、`vertical`、`none`。`none` 阻止这类滚轮滚动；Ctrl/Meta+滚轮继续交给浏览器缩放。嵌套滚动时，已消费的滚轮不会重复消费，到边界后允许祖先处理。

`scrollBehavior` / `scroll-behavior` 为 `smooth`（默认）或 `instant`。滚轮增量先按像素/行/页归一化并逐轴累加，再在浏览器动画帧中统一更新位置。平滑模式每帧直接应用累计位移，不为每次滚轮事件启动过渡动画。

跳跃模式以 `stepDistance` / `step-distance`（默认 40px）为最小移动单位：累计距离达到几倍步长，本帧就一次移动几步；余数保留到后续输入继续累加。连续 150ms 没有新输入视为停止，未达到一步的余数丢弃，不影响下一次手势。双轴分别累计，反向输入按带符号的距离抵消；到边界时钳制位置并丢弃向外的余数。步长设为 0 时不量化，直接按帧应用原始距离。

主动调用 `scrollTo` 仍可用 behavior 覆盖默认模式；离散的平滑定位使用浏览器原生动画。主动定位、开始拖拽、切换滚轮配置或断开组件会清除待处理的滚轮位移。滚动条拖动始终直接跟随指针。

## 虚拟内容与事件

`ScrollMetrics` 使用逻辑内容坐标：`scrollWidth`、`scrollHeight` 决定滚动范围和滑块长度，`scrollLeft`、`scrollTop` 决定位置。省略尺寸时测量 DOM；所有位置自动限制在有效范围。虚拟尺寸通过不可见的范围元素建立原生滚动范围，虚拟内容应自行按逻辑位置排版。

```ts
let updateMetrics: UpdateScrollMetrics | undefined;

html`<scwc-scroll-container
  style="height: 300px"
  .content=${(update) => {
    updateMetrics = update;
    return html`<my-virtual-list></my-virtual-list>`;
  }}
  .contentScroll=${(state) => virtualList.onScroll(state)}
  @scroll=${(event) => onOuterScroll(event.detail)}
></scwc-scroll-container>`;

// 内部在尺寸或位置需要更新时调用；请勿在 content 渲染函数执行期间调用。
updateMetrics?.({ scrollHeight: 100000, scrollTop: 1200 });
```

`content` 是可选渲染函数，参数是稳定的 `UpdateScrollMetrics` 更新函数；内部更新为部分合并。普通 slot 用法也可使用 `contentScroll`。实际位置发生变化时，同一份只读 `ScrollState` 会通过冒泡且穿透 Shadow DOM 的 `scroll` CustomEvent 向外发送，同时交给 `contentScroll`。范围变化导致位置钳制也发送事件，单纯尺寸变化不发送滚动事件。

外部传入 `.metrics=${{ scrollHeight: 100000, scrollTop: 1200 }}` 后优先采用外部值，`content` 的参数变为 `undefined`，已保存的内部更新函数也被忽略。外部对象更新时应用其位置；用户随后仍能滚动并发送事件，尺寸观察不会把位置锁回旧值。移除外部值（设为 `undefined`）恢复 DOM 测量和内部更新模式，旧内部尺寸不会复用。

可通过 `::part(frame/viewport/content/horizontal-track/horizontal-thumb/vertical-track/vertical-thumb)` 定制外观。容器和插槽后代由 ResizeObserver 与 MutationObserver 跟踪，更新合并到动画帧；断开连接时清理观察器、拖拽监听和定时器。

## 测试

仓库根目录运行 `node node_modules/vitest/vitest.mjs run --config projects/shared/vite.config.ts`，或通过根测试配置运行 `--project shared`。共享测试配置位于 `projects/shared/vite.config.ts`，组件测试文件保留在当前目录。

## 参数演示页

运行 `node projects/shared/components/scroll-container/test-server/server.ts`，打开 <http://127.0.0.1:4399/>。支持 `--port` 指定端口。网页提供全部参数的实时调节、动态尺寸、虚拟滚动、内外控制优先级、事件和公开方法示例，详见 [测试服务器说明](./test-server/README.md)。
