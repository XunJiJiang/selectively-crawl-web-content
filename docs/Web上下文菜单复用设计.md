# Web 上下文菜单改造与复制复用设计

日期：2026-10-15。状态：实施前附加设计。本轮按整体设计任务交付此合同，尚未修改 sticker-management 或把组件复制进 Web；后续实施必须执行“源组件改造 → 原插件验证 → 复制 → 工作台验证”的顺序。

## 1. 当前实现的依赖与问题

指定复用目录：`projects/server/plugins/sticker-management/web/src/components/context-menu`。

| 对象 | 当前职责与依赖 |
| --- | --- |
| `sm-context-menu.ts` | 菜单、子菜单、复选项、输入项、快捷键文本、滚动、键盘焦点、原生 select 降级 |
| `sm-menu-select.ts` | 用同一菜单构建选择器，属于指定目录中的菜单配套组件 |
| `../../types.ts` | ContextMenuItem 联合类型、MenuPresentationMode；不能整体复制业务类型文件 |
| `../../shared/lit-events.ts` | emit，派发 bubbles/composed 自定义事件 |
| `../../shared/menu-presentation.ts` | 平台与 native/custom/auto 选择规则；auto 在 macOS 选择 native |
| `../../styles/index.ts` | 将插件整个 styles.css 注入 Shadow DOM，含菜单所依赖样式 |
| `../../styles/tokens.ts` | 主题 token 与控制样式；包含菜单所用变量 |
| `../icon/sm-icon.ts` | 图标组件，按需求不复制；工作台提供新实现的图标适配 |

`sm-context-menu` 的宿主是铺满视口的固定元素，render 返回菜单面板，面板区域之外实际命中宿主。当前外部调用在主界面、设置页、sm-menu-select 和 sm-editor-menu 上补 `@click` 关闭。部分普通项会 stopPropagation，但菜单空白处、禁用项、子菜单及 Shadow DOM 重定向都需要小心判断。

组件本身已有 `sm-menu-close` 事件用于 Escape；外部关闭和菜单选择仍由调用方管理。SmEditorMenu 已使用 `composedPath()[0] === currentTarget` 判断实际背景命中，不能退化为 `event.target === this`，因为 Shadow DOM 会将面板内点击重定向为宿主。

## 2. 源组件改造合同

### 2.1 显式的外部根点击回调

新增非 attribute 属性：

```ts
type RootClickHandler = (event: MouseEvent, close: () => void) => void;

@property({ attribute: false })
accessor rootClickHandler: RootClickHandler | undefined;
```

行为定义：

- 未提供 rootClickHandler：组件内部负责背景点击关闭，调用方不再需要 `@click=${closeMenu}`。
- 提供 rootClickHandler：仅对真正背景命中调用它，默认关闭不再执行；外部可决定何时调用 close。
- 将回调改为 undefined 后自动恢复默认行为；不使用字符串内联事件处理器。
- Escape、菜单选中、原生菜单选择等保持各自语义，不把所有 click 都当成根点击。

浏览器没有公开可靠的 API 枚举元素上所有 addEventListener 监听器，因此不能可靠检测一个调用方是否通过 Lit 的 `@click` 传入了处理器。这里把“外部传入根点击事件”落实为明确的 rootClickHandler 属性；迁移既有调用点时统一调整。原始 `@click` 仍是 DOM 事件监听方式，但不作为覆盖默认关闭的 API。

### 2.2 内部关闭与事件

新增统一 `requestClose(reason)`，供默认背景、Escape 和原生取消路径调用。关闭时立即使内部可见内容和全屏命中层失效，再发送一次 `sm-menu-close`，detail 至少包含 reason（backdrop/escape/native-cancel/programmatic）。调用方仍监听该事件清除自己的菜单状态。

关闭按一次打开周期幂等：同一次背景点击、Escape 后迟到的 blur 不得重复发关闭事件；断开连接清理 listener、滚动 timer、loading timer 与 native picker 状态。重新打开必须重置关闭标记、焦点、子菜单和 loading 状态。

对于外部控制的 x/y/items，不能只把 DOM 隐藏后让外部模型仍认为菜单打开；组件发送 close 使调用方清空 menu。既有条件渲染调用可在关闭事件后移除实例；若将来支持同实例反复打开，需提供显式 open/show 方法或 open 属性，避免“相同坐标相同 items”无法触发重开。

### 2.3 背景命中判断

在宿主上注册/移除一个内部 click listener。默认铺屏根就是宿主，真实背景命中以 `event.composedPath()[0] === this` 判断；若后续增加独立 backdrop 元素，仅允许该元素作为另一种背景命中。菜单面板、子菜单、滚动按钮、输入项、原生 select 的路径全部排除。

处理顺序示意：

```ts
private onRootClick = (event: MouseEvent) => {
  if (!this.isOpen || !this.isBackdropHit(event)) return;
  event.stopPropagation();
  const close = () => this.requestClose('backdrop');
  if (this.rootClickHandler) this.rootClickHandler(event, close);
  else close();
};
```

这段是拟实现伪代码，isOpen 等应接入组件实际状态。只监听 click，避免 pointerdown 立即关闭后同一次 click 穿透到底下按钮；拖动过程中不触发背景关闭。背景右键可 preventDefault 并关闭/替换菜单，面板内右键不意外触发后台页面操作。

菜单内点击空白区不关闭；展开子菜单不关闭；复选/输入项是否 keepOpen 由菜单模型和外部 dispatcher 决定。禁用项必须在 action dispatcher 再次检查 disabled，不能仅依赖 CSS 或 aria-disabled。

### 2.4 原生菜单路径

保留原组件的 native/custom/auto 选择，不把原生 select 的失焦简单等同于立即取消。showPicker、change、Escape、blur 可能有平台差异，需在实际浏览器测试；showPicker 不支持或拒绝时继续回退自绘菜单。

工作台默认使用 custom，保证子菜单、输入、快捷键文本和所有标签操作一致；用户可配置原生模式，但必须明确展示不支持项及降级方式。不能为了复用组件把工作台所有菜单强行限制为 select。

### 2.5 原插件调用点迁移

检查并更新以下已观察调用点：

1. `web/src/main.ts` 的主菜单实例。
2. `web/src/components/settings/sm-settings-view.ts` 的可见性菜单。
3. `web/src/components/context-menu/sm-menu-select.ts` 的选择器菜单。
4. `web/src/components/editor/sm-editor-menu.ts` 的编辑器菜单包装。

普通使用者移除冗余 `@click` 关闭，保留 `@sm-menu-close` 同步 owner 状态。确实要覆盖背景行为时传 `.rootClickHandler`，不继续猜测监听器存在。包装器自己的捕获型 outside pointerdown 需要核对职责，避免同一菜单双重关闭或抢先取消。

默认用法：

```ts
html`<sm-context-menu
  .x=${menu.x} .y=${menu.y} .items=${menu.items}
  @sm-menu-select=${selectMenuItem}
  @sm-menu-close=${closeMenu}
></sm-context-menu>`;
```

覆盖根点击的用法：

```ts
html`<sm-context-menu
  .x=${menu.x} .y=${menu.y} .items=${menu.items}
  .rootClickHandler=${(_event: MouseEvent, close: () => void) => {
    if (canDismissCurrentMenu()) close();
  }}
  @sm-menu-close=${closeMenu}
></sm-context-menu>`;
```

## 3. 修改完成后复制至工作台

目标建议 `projects/web/src/components/context-menu/`。直接复制指定目录中完成改造的菜单实现，保留菜单定位、滚动、子菜单、键盘和事件的核心行为；只做工作台命名、依赖与主题适配，不重新发明另一套菜单交互。

| 复制/适配项 | 处理 |
| --- | --- |
| 两个菜单组件 | 本地副本，组件 tag/class 导出改为工作台命名或明确封装，避免全局注册冲突 |
| 菜单相关类型 | 抽取为本地 menu-types.ts；不把贴纸业务对象带过来 |
| emit 与 presentation 纯函数 | 复制最小相关函数至本地 helper；平台行为保留测试 |
| 菜单 CSS | 从依赖的 styles.css/token/control 样式中提取实际菜单规则，保留组件内样式；不导入整个插件全局样式 |
| 主题变量 | 将菜单用到的 `--sm-*` 映射到工作台 `--wb-menu-*` 语义 token，保证浅/深/高对比一致 |
| 图标 | 适配工作台新设计的 `wb-icon`，使用现有图标资源；不复制 sm-icon 组件 |
| 事件 | 可保留源事件名并在 wrapper 中转成工作台命令；统一文件中说明映射，避免字符串散落 |
| 来源记录 | 新建本地 SOURCE.md，记录来源路径、源版本/提交、复制日期、根点击改造及后续适配 |

运行时禁止从 `projects/server/plugins/sticker-management` 导入代码或样式；插件可能未安装、被忽略、单独升级，核心 Web 构建必须独立成立。禁止为省事复制其他插件组件；图标、按钮、输入、弹窗、通知、设置、终端和布局均按工作台设计重新实现。

菜单本身只派发选择信息，owner 通过 CommandRegistry 执行 action 并决定 keepOpen。打开菜单时保存目标 tabId/groupId/terminalId 的快照；选择时再次验证目标仍存在。不能在菜单弹出后因焦点变化把“关闭右侧”误作用于另一个标签。

菜单只出现在宿主层，层级高于 iframe；全屏宿主命中层阻止点击漏给插件页面。坐标统一为宿主 viewport 的 clientX/clientY，插件页面请求宿主菜单时由已登记 iframe 矩形转换并夹紧。插件不得传任意 action 函数到宿主，只能请求允许的命令或已登记的菜单描述。

## 4. 验证与验收

源组件先验证以下契约，再复制；工作台副本至少运行同一套交互契约：

| 场景 | 预期 |
| --- | --- |
| 无任何外部根 click handler，点击真实背景 | 自动隐藏并发出一次 close；owner 清空状态 |
| 提供 rootClickHandler 且不调用 close | 只调用外部回调，保持菜单打开 |
| 外部回调调用 close | 关闭一次，不双发 |
| 点击普通项、复选项、输入框、空白、禁用项、子菜单 | 各自行为正确，不误判为背景；禁用 action 不执行 |
| Escape、上下左右、Enter | 保留键盘导航，关闭后恢复触发焦点 |
| 菜单滚动、边缘滚动、窗口 resize | 定位受限、子菜单不被裁切、timer 可回收 |
| 关闭后同位置重复打开 | 可正常重开，不残留 loading/子菜单状态 |
| 原生 picker 失败、选择、取消 | 不留全屏透明阻挡；自绘回退可用 |
| iframe 上方背景点击 | 不穿透触发插件页面按钮 |
| 组件 disconnect/reconnect | listener 不重复，timer 不泄漏 |
| 插件未安装时构建核心 Web | 不引用插件磁盘路径、业务类型或全局样式 |

这个改造是后续功能实现的明确前置项。本轮没有用“设计文档已完成”代替“源组件已修复/已复制”的状态，两者在实施记录中分别验收。
