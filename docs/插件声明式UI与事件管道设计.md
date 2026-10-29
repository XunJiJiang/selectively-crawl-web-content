# 插件声明式 UI、模板处理器与当前页面设计

状态：待用户审核，未实施。设计修订日期：2026-10-29；原有源码核查日期：2026-10-28。本文统一采用带参数和返回值的处理器、`${}` 模板与 `watch:` 监听语法，不再区分事件处理器、管道函数和数据获取函数。

## 1. 目标与范围

插件后端注册 UI、静态资源及处理器；核心负责校验、模板编译、实例归属、处理器调度和资源服务；工作台前端负责受限渲染、交互采集、监听分发及核心 UI 效果执行。插件普通前端页面可通过 webutils 注册当前页面的 `ui:` 处理器，但不能修改辅助侧栏定义、配置定义或持久配置。

| 区域 | 数量限制 | 内容 |
| --- | --- | --- |
| 主侧边栏 | 每插件最多一个自定义页 | JSON 或 HTML；活动栏增加入口 |
| 辅助侧边栏 | 每插件最多一个自定义页；工作台当前最多一个自定义页 | 与内置“页面信息”合计最多两个页签；两个页签放在 `.sidebar-header` 内，不再另占一行；只有一个页面时显示 strong 标题 |
| 底部状态栏 | 每插件最多一个状态项 | 专用 JSON 配置、资源图标或核心预设图标 |
| 状态项提示层 | 每状态项一个 | 文本、JSON 或 HTML；可点击聚焦固定 |
| 状态项右键菜单 | 每状态项一个 | 专用 JSON；条目共用事件管道 |

辅助侧栏不汇总所有插件的自定义页面。默认跟随中心当前插件标签选择所属插件；显式打开某插件辅助页时，可在当前窗口暂时选择该插件上下文，下一次中心标签切换恢复跟随。辅助栏始终只包含“页面信息”和该上下文插件的一个自定义页。内置页显示名由“当前页面”改为“页面信息”，内部 `currentPage` 标识保持不变。

提供自定义模板且未隐藏“页面信息”时，标题栏只显示这两个标签及“隐藏辅助侧栏”按钮，不再显示 strong 元素。标签复用中心区域的样式与选中态；所有 `.sidebar-header` 使用中心标签栏的 `--wb-tab-bar-height` 高度。“页面信息”按固定四字文本和内边距确定宽度，不参与收缩；插件页标签按文字与内边距所需宽度显示，不拉伸填满右侧空间，仅在空间不足时收缩并显示省略号，保留完整 title 提示，禁止横向滚动。多余空间留空，关闭按钮固定在标题栏右侧。

自定义辅助页标签及单页 strong 标题使用当前插件名称，不使用贡献定义的 title；名称优先级为 `package.json.scwc.ui.title` → 导出的 `name` → `package.json.name` → 插件文件夹名称。空白名称跳过，导出的 `title` 不参与该优先级。

插件可在自己的辅助页定义中设置 `hideCurrentPage: true`，并在运行时修改。隐藏前必须已经提供合法 JSON/HTML 模板，或已注册返回该模板的内容提供器；注册、set、setContent 与 setCurrentPageVisible 均维持此条件，拒绝无模板隐藏并保留上一有效定义。核心还校验直接注册的快照，不能跳过 SDK 绕过限制。该设置只作用于当前显示该插件辅助页的上下文，不永久改变工作台全局偏好，也不能隐藏其他插件上下文的页面。隐藏后只显示自定义页及插件名称 strong 标题；没有自定义辅助页时显示“页面信息”strong 标题。注销、停用、重载失败或插件不可用时恢复内置页，整个辅助栏仍可由用户折叠。

本轮只修改设计文档，不实现功能、不删除运行代码、不安装依赖。下文的重构和删除清单在设计获准后的实施阶段执行。

## 2. “当前页面”源码核查结果

当前实现并非全部由后端提供。不能因为某个值最终经 HTTP 或数据库返回，就把原本由插件前端任意提供的数据认定为后端来源。

| 当前内容或能力 | 当前来源与代码证据 | 目标处理 |
| --- | --- | --- |
| 插件标题、说明、版本、PID、后端状态、UI 构建状态 | [catalog.ts](../projects/server/workbench/catalog.ts)、核心插件加载状态 | 保留，由核心后端投影提供 |
| 配置值、默认值、定义、双 revision | [page-inspector.ts](../projects/web/src/components/page-inspector.ts) 的 `load()` 请求后端；[plugin-config.ts](../projects/server/workbench/plugin-config.ts) 保存 | 值继续由后端保存；定义与校验只允许插件后端提供 |
| 插件属性 | webutils `page.register/update` 的 `properties` → [frames.ts](../projects/web/src/workbench/frames.ts) 的 `r.properties` → inspector | 删除前端注入通道；改为插件后端属性提供器 |
| 页面标题 | webutils 的注册、ready 或导航上报可影响标签标题，inspector 使用 `titleOf(tab)` | inspector 改读后端明确提供的标题；不借用 iframe 上报标题 |
| 页面状态、SDK 请求数、累计请求数、保活原因、编辑状态 | inspector 直接读取 `FramePool.runtimes`；部分值来自 iframe 消息 | 从“当前页面”移除；不能将 SDK 自报统计改名为后端统计 |
| 桥接、恢复、搜索能力与部分错误 | iframe 生命周期/搜索注册及前端 FrameRuntime | 从“当前页面”移除；后端确知的会话、进程错误另行展示并准确命名 |
| 配置定义注册与替换 | [webUtils/lib/workbench.ts](../projects/webUtils/lib/workbench.ts) 的 `settings.register()`，返回的 `update()` | 删除 SDK 接口、消息与对应页面授权写入口 |
| 配置修改与重置 | webutils 的 `config.set/reset` | 删除 SDK 写能力，并在服务端拒绝页面授权调用这些写入口 |
| 配置页面校验 | inspector 向 iframe 请求 `config.validate`；webutils 本地 normalize/validate 后申请票据 | 删除整条前端校验链，只保留声明式校验与插件后端校验 |

具体核查入口：

- [page-inspector.ts](../projects/web/src/components/page-inspector.ts)：`load/save/control/render`，当前同时依赖 `store`、`pool` 和 iframe 校验。
- [webUtils/lib/workbench.ts](../projects/webUtils/lib/workbench.ts)：`page.register/update`、`settings.register`、`config.set/reset`、`config.validate` 请求处理。
- [workbench-protocol.ts](../projects/shared/workbench-protocol.ts)：`PageRegistration` 含 `title/dirty/contextKey/properties/capabilities`。
- [frames.ts](../projects/web/src/workbench/frames.ts)：`page.update`、`requests.changed`、`activity.*`、`search.changed` 等消息处理。
- [工作台路由](../projects/server/router/web/workbench/index.ts)：`config/definitions`、`config/validation`、`config/update`、`config/reset`。
- [page-sessions.ts](../projects/server/workbench/page-sessions.ts)：当前对配置路径及其子路径整体放行；需改成按方法与路径的明确权限表。

### 2.1 删除与保留边界

实施时删除：

1. webutils 的公开 `page.register/update`，以及作为属性注入协议的 `PageRegistration`。
2. webutils 的 `settings.register` 及其 `update/dispose`，本地配置 normalize/validate 注册表、页面校验处理和票据申请。
3. webutils 的 `config.set/reset`。保留并明确支持只读 `config.get/subscribe`：允许设置配置监听，由工作台主页面通过 webutils 向活跃插件页面通知，向不活跃页面排队，恢复后发送，详见第 2.3 节。
4. 父页面接收 `page.update.properties` 等 inspector 内容注入的逻辑，以及 inspector 对 FramePool 的读取和 `settings-changed` 订阅。
5. 页面授权下的配置定义注册、校验票据及配置写权限；仅删除 SDK 方法不足以关闭能力。
6. `page-required` 新定义及对应前端校验分支。旧数据采用后述显式迁移，不静默降级校验。

webutils 的导航、关闭保护、暂停恢复、搜索、活动和请求生命周期机制可以继续服务其原有功能，但这些浏览器状态不再成为“当前页面”的展示数据。若删除 `page.update.dirty` 影响关闭保护，需改用现有 `lifecycle.canLeave`/快照保护流程验证行为，不以新的 inspector 元数据通道恢复它。普通中心标签的导航显示与 inspector 的后端投影分开。

普通插件页面目前处在受信的同源环境。本次删除保证 SDK、协议及受限授权接口不再提供该能力，不把它宣称为对受信插件任意浏览器代码的完整隔离。

### 2.2 新的后端投影

新增 `GET /web/api/workbench/inspector?workspaceId=...&tabId=...`。核心核验窗口、工作区、标签归属，再汇总自身状态和所属插件后端提供器；返回单一版本化快照。插件卡片配置入口无来源 tab 时，按核心注册表验证所选插件并返回其配置/元数据，页面专属定位留空，不伪造页面上下文。

```ts
interface InspectorSnapshot {
  version: 1;
  pluginId: string | null;
  tabId: string | null;
  coreBootId: string;
  ownerEpoch: string | null;
  revision: number;
  generatedAt: string;
  page: {
    title: string;
    entryUrl: string | null;
    // URL 为核心解析的入口/受理目标，不声称是 iframe 实时地址。
  };
  plugin: {
    title: string;
    description: string | null;
    version: string | null;
    pid: number | null;
    runtimeStatus: string;
    uiBuildStatus: string;
  } | null;
  properties: { key: string; label: string; value: string }[];
  config: ConfigSnapshot;
  diagnostics: { code: string; message: string; source: "core" | "plugin-backend" }[];
}
```

标题优先为核心保存的用户自定义标题，其次为插件后端提供的页面标题、后端插件标题。不能从 `document.title` 或由 iframe 导航上报写入的旧字段回填。后端不能确知的页面状态留空或不显示，不能伪造“休眠”“有未保存更改”等结论。

插件可通过 `ui.inspector.register({ provide(context) })` 注册一个只读属性提供器，提供当前资源的标题和键值属性。上下文由核心绑定，只包含所属插件、窗口、工作区、标签和核心解析的页面定位。提供器不能替换核心 PID、版本、进程状态，不能提供前端校验器或 HTML。`invalidate({ tabId? })` 通知核心重新取数，`dispose()` 注销。

配置定义继续由插件后端的 `configuration.definitions/normalize/validate/onChange` 提供。内置配置编辑器仍可让用户编辑草稿，但保存、重置和所有权威校验都在核心/插件后端完成。网页草稿和按钮状态属于前端交互状态，不属于权威展示数据。

### 2.3 配置监听、广播与恢复队列

webutils 提供 `config.subscribe(keys, listener)`，返回注销函数；`keys` 为当前插件被授权读取的配置键集合，省略时监听该授权范围内全部配置。订阅返回初始快照及后续变更，监听不能注册配置定义、提交值、替换侧栏内容或参与权威校验。原有调用形式如需兼容，由 SDK 适配为同一订阅协议。

1. 核心后端在配置事务成功后发布 `config.changed`，携带插件身份、`coreBootId`、数据 revision、schemaRevision 和变更键；校验失败不广播成功变更。
2. 工作台主页面维护配置事件游标和每个插件页面的派发状态，向所有活跃插件页面通过各自 webutils 桥通知；每页仅收到其授权范围内的配置。没有匹配监听的页面可只更新 SDK 的只读缓存，不执行业务回调。
3. 不活跃包括暂停、休眠、桥尚未 ready 或暂时断连。主页面为每页保存有序的待派发队列，不为推送强行唤醒页面。队列归属绑定窗口、tabId、插件 ownerEpoch 和页面 frameEpoch，不能串给同插件的其他标签。
4. 同一页面恢复并完成握手/授权后，先同步配置监听与已确认 revision，再按版本顺序发送积压，之后接入实时通知。webutils 按版本去重、确认接收；重复派发不重复触发回调，恢复期间新变更继续排队。
5. 队列有界。溢出、回放缺口、核心重启或 schema 变化无法连续回放时，留下明确的 `resync-required` 标记；恢复时先发送权威快照和版本，再接后续增量。不能悄悄漏发，也不能承诺重建每一次历史中间值。
6. 页面销毁或插件重载清理旧队列和订阅；新文档取得当前快照，不继承旧文档业务回调。队列只恢复配置通知，绝不重放 click/submit 或持久配置写操作。

配置监听同样驱动声明式模板的 `watch:` 绑定。主页面向普通插件页面发通知、模板更新已订阅的显示值，是同一权威配置变更的两个消费路径，不把插件前端回报当作配置事实。

## 3. 后端公开接口

以下为拟新增契约。`context.workbench.ui` 随所属插件进程注入，插件可以长期持有。普通插件页面的 `handler.ui` 继续承担原有页面入口；仅注册新侧栏/状态项不要求额外提供中心 HTML 入口。

```ts
type JsonValue = null | boolean | number | string | JsonValue[]
  | { [key: string]: JsonValue };
type EventProgram = string;
type FieldValue = string | boolean | string[];
type TemplateExpression = string; // 经模板解析器校验的单个 ${expression}
type TemplateValue<T> = T | TemplateExpression;

interface Disposable { dispose(): Promise<void> }
interface PluginUI {
  apis: {
    mountStatic(
      path: string,
      source: { file: string } | { directory: string },
    ): Promise<Disposable>;
  };
  handlers: {
    register(name: string, definition: HandlerDefinition): Promise<Disposable>;
  };
  registerMainSidebar(def: SidebarDefinition): Promise<SidebarHandle>;
  registerAuxiliarySidebar(def: AuxiliaryDefinition): Promise<AuxiliaryHandle>;
  registerStatusBar(def: StatusBarDefinition): Promise<StatusBarHandle>;
  inspector: {
    register(def: InspectorProvider): Promise<InspectorHandle>;
  };
}

interface HandlerDefinition {
  readOnly?: boolean; // 模板求值/监听只允许只读处理器；默认 false
  reads?: string[]; // 额外允许采集的当前实例命名值
  run(this: HandlerContext, ...args: JsonValue[]):
    JsonValue | void | Promise<JsonValue | void>;
  watch?(this: HandlerContext, args: JsonValue[], emit: (value: JsonValue) => void):
    (() => void) | Promise<() => void>;
}
interface HandlerContext {
  invocation: "event" | "render" | "watch";
  eventId?: string;
  instanceId: string;
  windowId: string;
  workspaceId: string;
  source: { kind: UISurface; viewId: string; name?: string };
  sourceTabId: string | null;
  event?: NormalizedUIEvent;
  // 仅访问参数引用、reads、for 及静态嵌套触发所允许的值。
  readValue(name: string): FieldValue;
  signal: AbortSignal;
}

type UIContent =
  | { format: "json"; version: 1; root: UINode }
  | { format: "html"; version: 1; html: string };
type TooltipContent = UIContent | { format: "text"; text: string };
type ContentSource<T> = T | ((context: RenderContext) => T | Promise<T>);
type IconRef =
  | { kind: "asset"; path: string }
  | { kind: "builtin"; name: string };

interface SidebarDefinition {
  id: string;
  title: string;
  icon: IconRef;
  content: ContentSource<UIContent>;
}
interface AuxiliaryDefinition extends SidebarDefinition {
  hideCurrentPage?: boolean; // 默认 false
}
interface SidebarHandle extends Disposable {
  set(def: SidebarDefinition): Promise<void>;
  setContent(content: UIContent, target?: { instanceId: string }): Promise<void>;
}
interface AuxiliaryHandle extends Disposable {
  set(def: AuxiliaryDefinition): Promise<void>;
  setContent(content: UIContent, target?: { instanceId: string }): Promise<void>;
  setCurrentPageVisible(visible: boolean): Promise<void>;
}
interface StatusBarHandle extends Disposable {
  set(def: StatusBarDefinition): Promise<void>;
}
interface RenderContext {
  pluginId: string;
  instanceId: string;
  windowId: string;
  workspaceId: string;
  viewId: string;
  tabId: string | null;
  sourceTabId: string | null; // 当前贡献明确绑定的普通插件页面，不能猜选
  signal: AbortSignal;
}
interface InspectorProvider {
  provide(context: {
    pluginId: string;
    windowId: string;
    workspaceId: string;
    tabId: string | null;
    locator: { path: string; search: string; hash: string } | null;
    signal: AbortSignal;
  }): {
    title?: string;
    properties: { key: string; label: string; value: string }[];
  } | Promise<{
    title?: string;
    properties: { key: string; label: string; value: string }[];
  }>;
}
interface InspectorHandle extends Disposable {
  invalidate(target?: { tabId: string }): Promise<void>;
}
```

`RenderContext` 由核心提供当前实例身份与工作区定位，不暴露 DOM；`InspectorProvider` 的输入输出由第 2 节投影约束。`UISurface` 为 `mainSidebar/auxiliarySidebar/statusBar/tooltip/contextMenu/currentPage`。

`run` 的位置参数就是模板调用的实参，`this` 由调度器绑定为上下文，不占用第一个参数；函数留在注册进程/文档，不跨 IPC 传输。`watch` 是同一处理器可选的变更订阅能力，不是另一种管道函数。只读处理器须返回显式 JsonValue；监听建立时原子取得初值/版本和订阅，避免初读与订阅之间丢更新。没有可用变更源的处理器不能假装支持持续监听，应返回明确诊断。

不再需要为固定参数设计 alias/preset：直接在模板中写 `core:value.write('query', $prev)` 或 `core:view.open('auxiliarySidebar', 'details')`。这里后端 SDK 的变量 `ui` 与表达式中的 `ui:` 命名空间不同，后者专指普通插件前端当前页面。

`set` 为完整替换，省略的可选字段被清除；更新成功后原子发布，新定义无效则保留原版本。`setContent` 默认更新该贡献全部实例，指定实例时只更新该实例；动态内容提供器在打开、刷新或失效通知时执行，不因鼠标移动反复执行。

`onLoad` 中的资源、处理器和 UI 注册暂存，全部校验后一次发布。运行期需要同时替换处理器和引用它的 UI 时使用拟新增 `ui.transaction(async draft => ...)`，整批校验成功后切换版本；不允许出现 UI 引用了尚未发布处理器的中间状态。已被活动绑定引用的处理器不能单独注销；须在同一事务移除或替换引用。

## 4. JSON、状态项与菜单结构

每个组件使用独立的严格 Schema，未知字段拒绝，不接受任意标签名或 JS 表达式。输入 Schema 在明确许可的数据值字段接受模板字符串，求值后的 Schema 再验证真实类型；不能先用纯 boolean/number Schema 拒绝尚未求值的 `${}`。本文列出首版组件及其允许属性，实施时应生成对应 TypeScript 判别联合和 Zod 校验器。

| type | 主要属性 | 事件 |
| --- | --- | --- |
| stack | key、direction、gap、children | — |
| text | key、text、tone | — |
| icon | key、icon、label | click |
| image | key、src、alt | click |
| button | key、name、for、text、icon、disabled | click、contextmenu |
| input | key、name、value、inputType、placeholder | input、change、focus、blur |
| select | key、name、value、options | change |
| checkbox / toggle | key、name、checked、label | change |
| form | key、name、children | submit |
| progress | key、value；null 表示不定进度 | — |
| badge | key、text、tone | — |
| divider | key | — |

`events` 统一是事件名到 `EventProgram` 字符串的映射。`key` 用于稳定 DOM 更新；`name` 用于逻辑值/触发寻址，两者不混用。布局使用主题令牌和受限数值，不开放覆盖工作台外层布局的属性。

```ts
interface StatusBarDefinition {
  id: string;
  ariaLabel: string;
  text?: string;
  icon?: IconRef;
  alignment?: "left" | "right";
  priority?: number;
  visible?: TemplateValue<boolean>;
  disabled?: TemplateValue<boolean>;
  events?: {
    click?: EventProgram;
    contextmenu?: EventProgram;
    hover?: EventProgram;
  };
  tooltip?: { content: ContentSource<TooltipContent>; width?: number };
  contextMenu?: MenuItem[];
}
type MenuItem =
  | { kind: "item"; id: string; label: string; icon?: IconRef;
      disabled?: TemplateValue<boolean>; action: EventProgram }
  | { kind: "checkbox"; id: string; label: string; checked: TemplateValue<boolean>;
      disabled?: TemplateValue<boolean>; action: EventProgram }
  | { kind: "submenu"; id: string; label: string; children: MenuItem[] }
  | { kind: "separator" };
```

状态栏本体只接受此配置和图标，不接受任意 HTML/组件树。图标支持 JPG/JPEG、PNG、WebP、SVG；SVG 经核心过滤并作为图片显示。核心提供 `loading/syncing/pulsing` 等预设动态图标，动画跟随减少动态效果偏好。插件状态项在独立贡献区排序、截断和溢出，不挤走核心导航、任务与通知入口。

菜单 label 为纯文本，菜单项 ID 在菜单内唯一。菜单点击、勾选变化统一进入事件管道，不把菜单父子层级传给插件。右键时立即显示已注册菜单，同时可分派 contextmenu 程序，不等待后端往返后再定位菜单。

## 5. 统一处理器与模板表达式

所有处理器都视为可接收参数、返回值的函数。`|` 只表示调用链的执行顺序；不再注册 `kind: "event" | "pipe"`，也没有单独的“管道函数”类型。事件调用、链式调用、数据读取和模板求值使用同一套名称解析和参数语法。

### 5.1 名称、命名空间与执行位置

基础名称符合 `^[A-Za-z0-9_.-]{1,64}$`，区分大小写；点仅为名称字符，不表示任意对象属性访问。注册表使用 Map，不做 Unicode 归一化或模糊匹配。插件注册基础名称，命名空间由核心解析，插件不能注册冒号名称冒充核心。

| 表达式名称 | 来源/含义 | 执行或订阅位置 |
| --- | --- | --- |
| xxx | 所属插件后端注册的处理器 | 插件后端，经核心调度 |
| core:xxx | 核心提供的后端处理器 | 核心后端 |
| ui:xxx | 当前明确绑定的插件普通前端页面注册的处理器 | 该页面，经 webutils 调度 |
| watch:xxx | name 为 xxx 的值通道，或插件后端注册的同名只读数据通道 | 实例值存储或所属插件后端 |
| watch:core:xxx | 持续监听核心处理器的返回值 | 核心后端变更源 |
| watch:ui:xxx | 持续监听当前插件前端页面处理器的返回值 | 该页面的 webutils 变更源 |

不存在 `core:ui:xxx` 或 `watch:core:ui:xxx`，也不递归叠加任意前缀。核心不提供前端处理器命名空间；核心固定渲染桥及 UI 效果执行器不是 `ui:` 处理器。

### 5.2 事件调用、参数与链式组合

```html
<button for="query" onclick="xxx">默认传入 $event</button>
<button for="query" onclick="xxx($event)">显式传入事件</button>
<button for="query" onclick="xxx($event, 123, 'abc', $for:query)">显式参数</button>
<button for="query"
  onclick="core:string.trim($for:query)|query.normalize($prev)|jobs.search($prev),metrics.clicked($event)">
  搜索
</button>
```

`onclick="xxx"` 是 `xxx($event)` 的简写，默认第一个且唯一的位置参数为过滤后的事件；关联字段值附在该事件中，不另插入不确定数量的参数。`xxx($event)` 的 `$event` 同样附带 `for/name` 对应的值。`xxx()` 明确表示零实参；写出参数列表后只传所写参数，不隐式补入 `$event` 或 `$prev`。上述规则也适用于 `core:`、`ui:` 及 JSON 的 events/action。

| 参数 | 语义 |
| --- | --- |
| $event | 核心规范化的交互事件，含自身/for/表单关联值；不含原生 Event 或 DOM |
| $prev | 当前链前一个处理器的返回值；第一步、其他分支及独立模板求值中不可用 |
| $for:name | 通式为 `$for:<name>`，获取当前实例对应 name 元素的值；无须在触发元素 for 中再次列出，但须被静态编译进采集集合 |
| 字面量 | 字符串、有限数字、true、false、null，以及只含合法值的受限数组/对象 |
| 处理器调用 | 可嵌套同一执行域的只读调用；先求实参再调用外层，不得借此跨前后端传值 |

不采用字符串替换、eval 或 Function。实现独立词法/语法解析器，区分括号深度、字符串和转义：参数逗号不是分支分隔符，字符串内的 `|`、`,`、`${` 不被误拆。字符串支持单/双引号及明确的 JSON 风格转义；拒绝任意 JS、赋值、运算符、属性链、下标执行、箭头函数、动态函数名或动态命名空间。语法类似 Vue 模板的调用形式，不执行 Vue 或通用 JavaScript。

```ebnf
program  = chain, { ",", chain } ;
chain    = invocation, { "|", invocation } ;
invocation = handler | call ;
call     = handler, "(", [ argument, { ",", argument } ], ")" ;
argument = literal | "$event" | "$prev" | "$for:", name | call ;
handler  = name | "core:", name | "ui:", name
         | "watch:", name | "watch:core:", name | "watch:ui:", name ;
```

空白仅允许在词法边界，名称内部不允许；数组/对象的内部成员递归遵循 argument，静态对象键不得包含原型危险片段。`|` 优先于最外层的 `,`。空程序/分支/步骤、`||`、`a,,b`、尾随分隔符和不平衡括号均拒绝。

确定语义：

1. `|` 从左到右串行等待 Promise 完成；返回值保存为 `$prev`，只有下一步显式引用时才作为其参数。裸名称即使位于后续步骤也仍传 `$event`，不再隐式透传上一步值。
2. 最外层 `,` 表示从左到右串行执行独立分支，各自获得事件/命名值初始快照的副本，不继承上一分支结果。`$prev` 每个分支重新开始。
3. `null` 是合法结果。无返回值调用产生内部的“无返回值”状态，不自动透传输入；下一步若引用它的 `$prev` 则报 `UI_NO_RETURN_VALUE`。未引用时可继续，模板/监听中无返回值也报错。该内部状态不作为 JSON 数据传输。
4. 每分支命名值工作副本可被明确的写值处理器更新；后续 `$for:name` 及嵌套触发读取该工作副本，其他分支仍从事件原快照开始。`$event` 保持本次触发的不可变快照。
5. 仅传受限 JsonValue；函数、Buffer、DOM、Error、循环引用、BigInt、NaN、Infinity 均拒绝。返回字符串不会再次被解释为模板或处理器名称。

### 5.3 前后端调用链边界

`core:` 与无前缀的插件后端处理器属于后端执行域，可在一条链里传递 `$prev`；`ui:` 属于绑定页面的前端执行域，可在该页面内部组成调用链。**后端处理器与前端处理器不能通过管道传递数据**：一条 `|` 链不能混用两域，嵌套实参调用、watch 值作为实参等也不能绕过这条限制。

```text
core:string.trim($for:query)|jobs.search($prev)          # 合法：核心后端 → 插件后端
ui:selection.read()|ui:selection.format($prev)          # 合法：同一页面前端
jobs.search($for:query)|ui:render($prev)                # 拒绝：后端 → 前端
ui:selection.read()|jobs.search($prev)                 # 拒绝：前端 → 后端
jobs.search(ui:selection.read())                       # 拒绝：嵌套调用跨域
```

独立逗号分支可以分别属于两域，但不能共享返回值、分支工作副本或 watch 结果；它们只各自接收经过绑定许可的原始事件和字段快照。普通 `$for` 字段采集不等于把 `ui:` 返回值送到后端；由前端处理器返回值派生的数据不能自动回填后端分支的字段快照。不同执行域的独立展示插值可共存于同一页面，不能嵌套成跨域实参。

后端链由核心 Node 执行器持有，核心计算在核心运行，插件调用经 IPC；中间值不交给浏览器再请求下一步。前端链由核心固定桥路由到绑定普通插件页面，其结果只用于该前端链/展示。两者分别校验执行域和版本，前端结果不能成为后端授权、权威校验或配置写入依据。

### 5.4 HTML 与 JSON 的 `${}` 模板

```html
<p>当前值：${core:get('xxx')}</p>
<p>配置：${watch:core:config.read('xxx')}</p>
<input name="query" value="${core:get('config.query')}">
<p>输入预览：${watch:query()}</p>
<p>页面选中项：${watch:ui:selection.read()}</p>
```

模板可调用有返回值的处理器，如 `${core:get('xxx')}`；核心等待异步返回并写入绑定位置。普通调用为一次求值，重新渲染/显式失效时可重新求值；`watch:` 建立持续订阅，值变化时只更新依赖位置。渲染/监听仅允许声明 `readOnly: true` 的处理器，不能在渲染时保存配置、弹通知或反复启动业务。事件语法可调用同一处理器，模板无需另定义数据函数。

JSON 先解析为合法 JSON，再在 Schema 明确允许的数据值字段中识别 `${}`，支持嵌套数组/对象中的相应值；对象键、type/key/name/for、处理器名、事件程序和能力标识不通过插值动态生成。

```json
{
  "type": "stack", "key": "preview", "direction": "column",
  "children": [
    { "type": "text", "key": "value", "text": "当前值：${core:get('xxx')}" },
    { "type": "input", "key": "query", "name": "query", "value": "${core:default(watch:core:config.read('query'), '')}" },
    { "type": "progress", "key": "progress", "value": "${watch:core:get('jobs.progress')}" }
  ]
}
```

JSON 字符串恰好为一个 `${expression}` 时保留其返回类型，再按目标字段 Schema 校验，例如 progress.value 可以得到 number/null；与文本混排时按明确的标量文本规则转换，对象/数组须显式 `core:json.stringify(...)`。HTML 文本始终通过 textContent 写入，属性按目标类型校验并安全设置；不将返回值解释为 HTML、CSS、事件或第二轮模板。HTML 布尔属性按布尔值绑定，不能把字符串 `"false"` 当作真。

模板中只能使用单个受限 argument 表达式，也接受裸 `watch:xxx` 作为 `watch:xxx()` 的简写；不支持任意脚本或通过插值拼接事件程序，链式组合用于事件程序。`$event` 仅在事件调用上下文存在，`$prev` 仅在链的后续步骤存在，不能在初始渲染时读取；`$for:name` 可在当前实例命名值已初始化后用于模板，持续更新应使用对应 watch。声明式模板中的字面 `${` 用 `\${` 转义；若模板写在 JS/TS 反引号字符串中，还需按宿主字符串规则转义，避免提前被 JS 求值。

异步结果绑定实例、渲染版本、参数快照和求值代数；参数变化后丢弃旧结果。加载、无值、失败分别表示，不将失败静默变成空串。返回 null 为合法无值，显示为空文本；监听失败显示明确诊断并允许显式重试，不重复执行有副作用调用。

### 5.5 `watch:` 通道与生命周期

- `watch:xxx` / `watch:xxx()` 持续监听当前绑定域中 name 为 xxx 的元素值；首次返回当前值，之后 input/change 更新实例值存储时发布，响应式更新依赖显示。
- 非 DOM 数据可由所属插件后端将只读处理器及其 watch 能力发布为名为 xxx 的通道。`${watch:xxx('xxx')}` 中前一个 xxx 为通道名，字符串 `'xxx'` 为筛选参数，例如配置键；此配置通道必须接入核心权威配置变更源。同一作用域元素通道与后端通道重名时拒绝绑定，不能靠运行时优先级猜来源。
- 配置页面推荐使用明确的核心通道 `${watch:core:config.read('xxx')}`，也可使用 `${watch:core:get('config.xxx')}`。`${watch:core:xxx(...)}` 监听核心只读处理器的返回值，不是轮询或把名字解释成 DOM 选择器。
- `${watch:ui:xxx(...)}` 订阅当前页面提供器；同一处理器的 `run` 提供初值，`watch` 发布后续值。订阅身份包含实例、来源页面代数、处理器版本、名称和解析后的参数。
- watch 嵌在同域只读调用实参中时，更新触发外层只读表达式重新求值，例如 `core:default(watch:core:config.read('query'), '')`。事件程序中显式调用 watch 取得该绑定当前监听值，订阅仍归实例/绑定持有，不能每次点击额外遗留一个订阅。
- 相同订阅可在实例内复用并引用计数；参数依赖变化先释放旧订阅，再建立新订阅，迟到通知不得覆盖新值。循环依赖在编译/运行时拒绝，不能靠持续回写让模板无限更新。
- 实例关闭、内容替换、提供器注销、页面销毁、插件停用或重载清理订阅。暂停时保留必要恢复身份，恢复后重建快照及订阅；配置通知按第 2.3 节排队。除配置外的数据源若不能连续回放，恢复时读取新快照，不冒充每次历史变更都已交付。

### 5.6 webutils 前端处理器与无页面情况

拟新增当前页面接口，注册名称不带命名空间，调用时使用 `ui:` / `watch:ui:`：

```ts
await scwcutils.ui.handlers.register('selection.read', {
  readOnly: true,
  run() { return currentSelection; },
  watch(args, emit) {
    return subscribeSelection(emit); // 返回注销函数；函数始终留在当前页面
  },
});
```

该接口只发布当前普通插件页面的处理器及其监听能力，不能提供侧栏 HTML/JSON、inspector 属性或配置定义，不能替代已删除的 `page/settings/config` 写接口。前端返回值是页面来源数据，必须与后端权威数据区分。注册名、只读标记、版本和可调用元数据经 webutils 发送，函数不跨 MessagePort。

从中心插件页面打开辅助页时，贡献明确绑定该 tabId/frameEpoch；同插件多个标签各有自己的前端处理器，不能互相借用。通过主菜单栏“插件”页面的插件卡片“配置”按钮打开辅助侧栏时，即使后台保留了其他同插件标签，也不自动借用它们，`sourceTabId = null`。

没有对应普通插件前端页面时，所有 `ui:xxx` 和 `watch:ui:xxx` 调用/监听均不生效，统一返回字面字符串 **`<无数据，需要打开插件页面>`**；模板以安全纯文本显示，HTML 不将尖括号当标签。即使同链前一步没有返回值，缺失页面分支也优先返回此统一占位，不求取不存在的页面实参/回调。占位属于带 unavailable 状态的显示结果，不可作为业务数据继续进入后续步骤；终止该前端分支，不提交效果，也不排队待页面打开后重放。

页面打开后须通过明确的上下文绑定并重新求值/订阅，旧占位调用不会补执行。已有页面暂时暂停时，监听可等待恢复并重取初值；交互调用应提示页面未就绪，不偷偷在其他页面执行。只有配置通知适用恢复队列，业务调用不自动排队重放。

## 6. name / for 值关联与触发

```html
<label for="query-input">关键词</label>
<input id="query-input" name="query" value="" />
<button name="searchButton" for="query"
  onclick="jobs.search($event, $for:query)">搜索</button>
```

- `input.name="query"` 声明命名值，`button.for="query"` 将其当前值附入 `$event.value`，并在 `$event.values.query` 中保留名称。不能再把按钮默认首参直接改成该字符串。
- 没有 for 的输入组件将自身 name/value 附入 `$event`；没有关联字段的按钮只有过滤后的事件元数据；form submit 附带该表单显式命名字段的扁平映射。
- `name` 在实例绑定域内唯一，采用基础名称字符集；`key` 仅用于稳定渲染。不同实例不能互读，不通过 DOM 选择器找字段。
- `for` 支持单名称及 ASCII 空白分隔多名称；JSON 可用字符串或名称数组。单来源时 `event.value` 为标量；多来源/表单时仅使用 `event.values` 映射，不插入多个位置参数。
- `$for:query` 直接获取 query 元素的值；显式引用即编译为读取依赖。文本/number 输入保持字符串，checkbox/toggle 为布尔值，多选为字符串数组，数字转换由处理器显式执行。
- 重复 name、缺失引用、非值组件引用及跨实例引用在编译时拒绝；不以重复 name 隐式形成分组。
- 值变化先更新实例存储和元素 watch，再受理 input/change；事件及命名值快照取自本次触发时刻，不因后端等待改变。值变更不自动点击关联按钮。
- 原生 label.for 仍指向 HTML id，用于可访问性；只有 button 等交互组件的 for 表示值关联。

采集集合为自身值、for、表单字段、显式 `$for:`、处理器 reads 和静态嵌套触发的依赖并集。浏览器仅发送许可字段及编辑序号；核心按绑定重建事件、拒绝多余字段，不为方便读取整个页面。

使用 `core:value.write('query', $prev)` 主动更改命名值，使用 `core:event.trigger('searchButton', 'click')` 触发目标的已编译程序。目标名称和事件必须是编译时常量；核心根据绑定表构造事件并在相同执行域执行，不向浏览器派发原生事件绕回执行器。跨执行域嵌套触发同样拒绝。

写值更新分支工作副本并提交有编辑序号保护的客户端效果；实际应用后发布该元素的 watch 更新，但默认不自动触发 input/change。需要业务触发时显式调用 trigger；编译检查循环及展开步骤，运行时限制深度/总步骤。不能通过写值监听循环绕过限额。

## 7. HTML 事件属性与模板的安全编译

支持 `onclick/oninput/onchange/onsubmit/oncontextmenu/onmouseenter/onmouseleave/onfocus/onblur`，属性值是第 5 节的受限事件程序。`onclick="xxx($event, 123, 'abc', $for:query)"` 是合法处理器调用，不作为浏览器内联 JavaScript 执行。

```html
<!-- 提交形态 -->
<button for="query" onclick="core:string.trim($for:query)|jobs.search($prev)">搜索</button>
<p>${watch:core:config.read('xxx')}</p>
```

编译顺序：

1. 后端在禁用脚本、自动资源加载的惰性环境解析原始 HTML；从未插入活动 DOM。
2. 提取允许事件属性，实体解码后用专用解析器解析名称、参数和链；可接收等价 `data-ui-*`，同事件两种属性并存时拒绝。
3. 在许可文本/属性或 JSON 数据字段解析 `${}`，建立调用、监听和参数依赖；不在未知属性、style、script、事件程序中做字符串替换。
4. 删除全部原生 `on*`；onload/onerror 等自动执行事件不绑定并产生明确诊断。DOMPurify、标签属性白名单、CSS/资源/SVG 策略继续生效。
5. 编译 name/for、采集集合、处理器/表达式/监听绑定及执行域。后端名称须已注册；`ui:` 绑定可在来源页面存在后按其注册版本激活，无页面时使用统一占位。
6. 保存不可由插件伪造的绑定表，输出安全 DOM 描述和绑定 ID。语法/引用/域错误拒绝整次更新并保留上一有效版本。
7. 核心固定渲染桥创建节点并监听交互，异步模板值经过目标字段校验后设置；最终 DOM 无任何原生事件属性，不将返回字符串再作为 HTML 注入。

`onclick="return false"`、任意赋值/函数定义等被语法拒绝。`alert(1)` 或 `fetch('/x')` 在语法层面只是普通名称调用，只有所属插件确实注册同名处理器才可执行；名称不存在即拒绝，绝不调用浏览器全局函数。URI、CSS 和资源属性中的模板结果仍需经过第 10、11 节策略，不能通过插值绕过静态资源权限。

hover 在 JSON 中使用 hover，HTML mouseenter/mouseleave 归一为 enter/leave；不发送连续 mousemove。输入法组合结束前不执行未完成 input 程序；高频 input 可合并，change/submit 按提交语义执行。

## 8. 核心处理器与数据获取

`core:` 全部是核心后端处理器。下表改为显式调用签名，参数直接来自编译后的模板实参；不再使用 alias 固定参数或隐式唯一 input。`watch:` 只对只读且有变更源的调用有效。

| 调用形式 | 返回值/约束 |
| --- | --- |
| core:string.trim(value) / lower(value) / upper(value) | string → string；类型不符报错，不隐式转换 |
| core:string.toString(value) | 标量 → string；对象/数组须显式 JSON stringify |
| core:number.parse(value) | string → 有限 number；严格完整解析，不接受空串/Infinity |
| core:boolean.parse(value) | string/boolean → boolean；只接受约定 true/false |
| core:json.parse(text) / stringify(value) | 有界 JsonValue / 确定性字符串；拒绝主动内容 |
| core:object.get(object, path) / pick(object, keys) | 值/对象；path 为受限段数组，拒绝危险原型段 |
| core:array.first(array) / length(array) | 值/number；空数组 first 返回 null |
| core:default(value, fallback) | 仅 null 使用 fallback，false/0/空串保留 |
| core:validate(value, rules) | 通过则返回同一 value；rules 为静态声明式规则 |
| core:flow.stop() | 正常结束当前分支的控制标记，可继续后续独立分支；不作为模板数据 |
| core:value.read(name) | 当前分支允许采集的命名值；模板直接读取也可用 `$for:name` |
| core:value.write(name, value) | 校验类型、更新工作副本、排队写值效果，返回 value |
| core:event.trigger(name, eventType) | 执行当前域目标绑定，返回其最后分支最后一步的返回值；无值仍遵守统一规则 |
| core:get(key) | 通过核心后端数据接口获取已授权数据，见第 8.1 节 |
| core:config.read(key) | 当前插件权威字符串值或 null，支持 watch |
| core:config.write(key, value) | value 必须为字符串；双 CAS、定义与后端校验后保存，返回已保存字符串 |
| core:notification.show(message, level) | 排队核心通知效果，message 为纯文本，返回 null |
| core:inspector.config.save(event) / reset(event) | 仅核心当前页面模板绑定可调用；返回新配置快照，见第 13.3 节 |

表中简写 `lower(value)` 等仍须写完整命名空间，例如 `core:string.lower($prev)`、`core:json.stringify($prev)`、`core:array.length($prev)`。原 `core:input` 不再需要，事件使用 `$event`，前一步结果使用 `$prev`。`core:pipe` 若作为某个核心普通处理器的名称被注册，调用也只遵循统一规则，如 `core:pipe($prev, $for:query, 123, 'abc')`；不保留特殊管道函数注册能力。

插件自定义处理器同样接收位置参数并返回值：

```ts
await ui.handlers.register('query.normalize', {
  readOnly: true,
  run(value) {
    if (typeof value !== 'string') throw new Error('需要字符串');
    return value.replace(/\s+/g, ' ');
  },
});
await ui.handlers.register('jobs.search', {
  async run(query, limit, label) {
    return startSearch(query, limit, label, this.signal);
  },
});
// onclick="core:string.trim($for:query)|query.normalize($prev)|jobs.search($prev, 123, 'abc')"
```

### 8.1 `core:get` 与后端数据接口

新增核心后端 `POST /web/api/workbench/ui/instances/:id/data`，由工作台主页面代表已编译表达式发起，包含 expressionBindingId、渲染/处理器版本和允许的字段快照。接口从绑定表解析 `core:get` 等只读调用，校验身份与数据访问范围，不接收浏览器临时提供的任意函数名或表达式文本。

`core:get('xxx')` 返回核心登记键 xxx 的数据；`core:get("")` 返回当前绑定明确声明的默认数据集，没有默认数据集则返回 null，不表示读取全部系统数据。键是数据注册表中的逻辑名称，不能解释成任意 URL、磁盘路径、SQL、JS 属性链或其他插件的数据选择器。后端可将插件只读提供器映射到其授权键，函数仍在原后端执行。

内置键包括 `config.<key>`、`inspector.page.title`、`inspector.plugin.pid` 等；由注册表明确解析，配置 key 中的点仍是字面键，不能按 JS 原型路径解析。获取器返回有界 JsonValue，响应另携带数据 revision/schemaRevision 等控制元数据；模板求值取得的是业务值。持久配置仍是字符串，不因 JSON 模板支持而自动转成数字/对象。

`${core:get('xxx')}` 进行一次获取；`${watch:core:get('xxx')}` 在键有变更源时持续获取最新返回值。监听接口复用绑定授权，经工作台事件连接发送订阅 ID、版本和有界值或失效通知；大值失效后重新取数。快照与订阅须有一致版本边界，重连时按游标回放或明确重同步，不靠任意轮询模拟可靠监听。

### 8.2 核心 UI 效果的显式参数

以下调用在核心后端处理参数/权限，随后提交客户端效果；返回值为明确的 null，不隐式透传任何参数。需要继续使用业务值时下一步应显式引用 `$event` / `$for:name`，或将效果放在独立分支。

| 调用 | 效果 |
| --- | --- |
| core:view.open(location, viewId) / refresh(location, viewId) | 打开本插件贡献；refresh 只刷新声明式 UI |
| core:page.open(path) | 打开所属插件普通页面相对路径 |
| core:settings.open() | 打开所属插件配置辅助页 |
| core:tooltip.open() / pin() / close() | 操作所属状态项提示层 |
| core:menu.open() | 打开所属已注册菜单 |
| core:element.focus(name) | 聚焦当前实例命名组件 |
| core:section.toggle(name) / scroll.to(name) | 操作当前实例受限目标，不接受选择器 |
| core:clipboard.writeText(text) | 写入字符串；仍要求原始用户交互及浏览器权限 |
| core:link.openExternal(url) | 经校验的 HTTP/HTTPS URL；仍要求原始用户交互 |

客户端按 effectId 去重，并校验实例、渲染版本、字段编辑序号；迟到写值不能覆盖请求期间的新输入。效果确认独立于处理器返回值，不把浏览器结果注入后端链。剪贴板/弹窗因激活过期被拒绝时只报告效果失败，不重跑程序。

`core:event.trigger(...)` 不产生新的用户激活，hover、嵌套触发和效果确认不能提升权限。前端验证可信交互关联和浏览器当前激活状态，不相信请求自报布尔值。首版不提供 eval、任意 fetch、shell、任意终端命令或跨插件调用。

## 9. 事件、编译绑定与执行回执

```ts
interface NormalizedUIEvent {
  type: 'click' | 'contextmenu' | 'hover' | 'input' | 'change'
    | 'submit' | 'focus' | 'blur' | 'menu-select';
  phase?: 'enter' | 'leave';
  name?: string;
  value?: FieldValue;
  values?: Record<string, FieldValue>;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}
interface CompiledCall {
  handlerId: string;
  source: 'core' | 'plugin' | 'ui' | 'element'; // 内部来源分类，非新增公开前缀
  mode: 'call' | 'watch';
  arguments: ArgumentNode[]; // 字面量/event/prev/field/同域只读调用的 AST
}
interface CompiledProgram {
  version: 1;
  handlerRegistryRevision: number;
  branches: { domain: 'backend' | 'frontend'; steps: CompiledCall[] }[];
}
interface EventBinding {
  bindingId: string;
  instanceId: string;
  renderRevision: number;
  programId: string;
  eventType: NormalizedUIEvent['type'];
  captureNames: string[];
  association: { kind: 'none' | 'self' | 'for' | 'form'; names: string[] };
  sourceTabId: string | null;
  sourceFrameEpoch: string | null;
}
interface UIEventRequest {
  version: 1;
  eventId: string;
  instanceId: string;
  renderRevision: number;
  bindingId: string;
  fields: Record<string, { value: FieldValue; editSequence: number }>;
  event: NormalizedUIEvent;
}
interface UIExecutionReceipt {
  eventId: string;
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'unavailable';
  completedBranches: number;
  result?: JsonValue; // 最后分支最后一步有返回值时；中间值不公开
  effects: ClientEffect[];
  error?: { code: string; branch: number; step: number; message: string };
}
```

后端保留权威程序/表达式绑定；前端只拿到绑定 ID、允许采集字段和执行域信息。前端链所需的编译描述通过专用桥下发，并绑定来源页面及注册版本，不能作为普通页面自选后端程序的入口。请求不允许携带自选 program、函数名、自由实参、pluginId 或目标实例；参数 AST 中的常量由后端编译，动态字段按许可快照求值。

`event.name/value/values` 由核心按绑定重建，避免 fields 与 `$event` 内容矛盾；无字段事件拒绝多余 fields。逻辑 name、字段名、菜单 ID 是扁平标识，不传 DOM、元素层级、完整属性、HTML、原始 Event、composedPath、选择器或坐标。弹层测量和菜单定位只留在工作台。

`ClientEffect` 包含 effectId、实例、渲染版本、明确类型及合法参数；写值另带 fieldName/editSequence。插件返回普通对象不能让前端执行命令；效果由核心专门通道校验，确认回执不能修改业务结果或配置版本。

### 9.1 错误、顺序、取消与副作用

- 同实例交互默认排队串行；执行前重新核验实例、插件代数和处理器版本。读取/监听有独立有界调度，避免长期订阅占满事件队列。
- input 可合并未开始项；click/submit 不合并、不盲目重放。读取/监听恢复与业务动作重放严格分开。
- 一步失败停止该分支及后续分支，准确报告 branch/step；无来源页面时按第 5.6 节返回统一占位和 unavailable 状态，不再调用该分支。
- 分支成功后提交其核心 UI 效果；失败分支未提交效果丢弃。处理器可能已有外部副作用，不能宣称执行链是跨业务事务或能够自动回滚。
- eventId 有界去重并绑定请求摘要；相同 ID 不同输入拒绝。重启或来源页面代数变化不重放结果未知的业务调用。
- 超时/取消停止后续步骤并发出 AbortSignal，不证明已经运行的插件代码没有副作用；切换或卸载实例丢弃迟到结果/效果。
- 后端及前端链分别保留域内中间值，跨域组合在编译时拒绝，运行时再检查；中间值不默认记录或持久化。
- 诊断仅记录位置、名称、耗时、错误码和大小，不泄漏表单值、堆栈、磁盘路径或票据。

## 10. 静态资源与路径解析

插件通过 `ui.apis.mountStatic()` 挂载文件或目录，返回可注销句柄。函数、文件定位等保留在插件后端，资源字节通过核心资源服务发送；不开放任意上游 URL 代理。

```ts
await ui.apis.mountStatic("/assets", {
  directory: fileURLToPath(new URL("./assets/", import.meta.url)),
});
```

插件只写挂载路径，核心生成：

```text
/web/ui/assets/{encodeURIComponent(pluginId)}/{ownerEpoch}/assets/icons/logo.svg
  ?cap={resourceTicket}&v={contentHash}
```

| 位置 | 插件写法 | 解析 |
| --- | --- | --- |
| JSON 的 src、icon.path、样式表等资源字段 | /assets/icons/logo.svg | 插件挂载根目录 |
| HTML 的 src、srcset、stylesheet href | assets/icons/logo.svg | 插件挂载根目录 |
| HTML style/style 标签内 URL | /assets/images/banner.webp | 插件挂载根目录 |
| 外部 CSS 的 url()/@import | ../images/banner.webp | 相对该 CSS 的挂载目录 |
| 本地锚点 | #details | 当前内容内部目标 |
| 文本、处理器名、配置 key、普通业务值 | jobs/refresh | 原样保留 |

递归处理所有由 JSON Schema 声明为资源/URL 类型的字段，包括 tooltip、菜单图标、嵌套组件；不能把任意字符串都当作路径拼接。核心页面 path 则交给已有插件页面 URL 解析器，不套用静态资源网关。

路径先按 URL 规则规范化再检查挂载边界；开头 `/` 为插件根目录；目录内部正常 `../` 可以解析，越出根目录、编码绕过、反斜杠歧义、跨插件前缀拒绝。目录挂载检查真实文件路径与符号链接边界。HTML base 标签无效，不改变解析规则。

资源只允许声明的静态类型，禁止 JS、模块、Wasm、HTML 文档作为可执行嵌入资源；图片/CSS/字体等按用途校验实际内容与 MIME，其他文件只通过明确的下载能力提供。拒绝资源响应跳转，核心控制响应头，不透传插件任意 CSP、Cookie 或跳转头。

DOM 资源不能自行带 Bearer，使用短期只读票据，绑定插件、ownerEpoch、实例和资源范围。注销或重载撤销；资源票据不能访问事件或配置 API。CSS 的嵌套资源由核心重写并附加正确票据；字体只在该资源端点允许无凭据跨源读取，不放宽业务 API 的 CORS。票据续期由工作台完成，原 URL 中不包含全局 Token。

## 11. HTML、CSS、SVG 与沙箱策略

HTML 使用现有 DOMPurify；后端 DOM 解析使用现有 jsdom，关闭脚本执行与自动资源加载。CSS 使用新增直接依赖 css-tree 构建、遍历和重写 AST。css-tree 是解析工具，不自动构成安全策略；出现 Raw/无法可靠解析的片段按失败关闭处理。

| 内容 | 策略 |
| --- | --- |
| HTML | 正向标签/属性白名单；过滤 script、iframe、object、embed、base、跳转 meta、可执行 URL、未知自定义元素等 |
| 原生事件属性 | 仅在惰性解析中提取允许的声明式程序；最终全部删除原生 on* |
| data-ui 属性 | 按专用 Schema 校验，最终绑定以核心表为准，不能当成任意能力入口 |
| CSS | 白名单属性/规则；解析全部 URL 上下文，包括 image-set 字符串、font-face、import；拒绝主动内容与外部网络地址 |
| CSS 变量 | 核心主题变量及受限类型变量；不允许用未验证 Raw、自定义变量或 attr() 绕过 URL 校验 |
| SVG | 服务端过滤脚本、事件、foreignObject、外部引用和主动动画；按图片显示，不直接注入主页面 SVG DOM |
| JSON | 严格 Schema、纯文本节点、受控组件；不能通过 props 接收事件函数、任意 HTML 或自定义 CSS；在宿主组件 Shadow DOM 内直接渲染 |

style 属性与 style 标签的合法内容转成核心生成的样式规则，不在活动文档保留未经验证的内联 CSS。外部 CSS 的所有依赖同样经过网关，限制体积、import 深度和循环；缺失资源返回资源错误，不回退成插件 HTML 页面。

渲染方式由核心编译结果中的 `format` 标记决定，不能由插件指定绕过模式。JSON 组件在宿主组件的 Shadow DOM 内直接渲染，沿用核心主题与 flex 高度分配，不使用 iframe，也不等待 iframe 握手。后端编译器与前端渲染入口共同校验组件/属性白名单，禁止脚本、原生 on*、自定义元素、任意 HTML/CSS；插值通过 textContent 或受控属性赋值，图片只能使用核心资源服务。Shadow DOM 负责样式和节点作用域隔离，不作为脚本安全边界。事件仍只发送绑定 ID、过滤事件和字段快照，处理器权限、执行域与后端校验不变。

HTML 模板继续使用独立核心渲染入口的沙箱 iframe。只允许核心固定渲染/事件桥脚本执行，插件提交内容不能提供或引入 JS。使用 `sandbox="allow-scripts"`，不授予 allow-same-origin、表单导航、弹窗和顶层导航；CSP 限制脚本为核心版本/nonce，禁用 eval、网络连接、嵌套页面和非网关资源。

沙箱 opaque origin 的握手不能只检查 origin=null：父页面必须核验 event.source、随机一次性握手标识、协议版本，再建立专用 MessagePort。iframe 不持有工作台 Token。安全 DOM 描述通过端口发送，渲染器用受控节点/属性创建，不直接把原始 HTML 交给 unsafeHTML/innerHTML。

## 12. tooltip、右键菜单和焦点

| 状态/操作 | 行为 |
| --- | --- |
| 悬停状态项 | 延迟显示预览，不抢焦点；可分派 hover.enter |
| 鼠标进入 tooltip | 保持显示，允许跨越状态项到浮层的间隙 |
| 未固定且离开两者 | 延迟关闭；hover.leave 只发一次 |
| 点击状态项 | 打开、聚焦、固定 tooltip，同时受理注册的 click 程序 |
| 点击 tooltip 内部 | 固定并高亮边框；保留被点击控件焦点 |
| 固定后移开、滚动、内容更新 | 保持显示与固定状态 |
| 再次点击自身 | 保持，不作为开关关闭 |
| 点击外部 | 关闭；点击另一个状态项可固定新提示层 |
| 右键状态项 | 关闭提示层，在指针位置打开已有的 wb-context-menu；复用子菜单、勾选、禁用、键盘与关闭行为，不把菜单放进 tooltip |
| 插件停用、注销或实例释放 | 关闭并清理 |

所属菜单算同一逻辑交互区域，点击自己的菜单不误判为外部点击。固定期间悬停其他状态项不替换当前提示层。每窗口同一时间最多固定一个，位置钳制在视口内，超长内容内部滚动。

状态项使用独立的紧凑行布局，不套用属性行的固定首列宽度或底部间距；按钮填满状态项可用高度，空错误区不占空间。提示层使用核心主题和边框，按内容高度调整并受视口限制，底部增加指向按钮中心的小三角。HTML 提示层在沙箱内测量内容，通过现有受控消息通道上报高度，不授予父页面读取沙箱 DOM 的权限。

右键菜单由核心已编译的菜单节点、绑定及数据更新投影到已有上下文菜单组件，保留子菜单和字段状态。点击菜单项仍发送原绑定 ID、过滤事件及字段快照，经原实例/工作区权限和处理器链执行；不在浏览器直接求值插件的 action 字符串。菜单打开、取数或动作失败时显示工作台通知，关闭菜单恢复状态项焦点。

提供 Esc 作为键盘主动关闭方式；`core:tooltip.close()` 是明确的程序关闭。二者不受“鼠标移开不消失”限制。状态项的本地固定行为由核心立即执行，后端处理器不必为固定提示层绕一圈；显式 close 效果仍可随后关闭。

纯文本预览使用 tooltip 语义，含可聚焦内容或固定后的交互层使用非模态 dialog 语义。内容更新按稳定 key 保留焦点、草稿、滚动和固定状态；不因更换字符串整层重建。

## 13. 身份、API 与完整数据流

```ts
interface UIIdentity {
  pluginId: string;
  coreBootId: string;
  ownerEpoch: string;
  instanceId: string;
  renderRevision: number;
  handlerRegistryRevision: number;
  sourceTabId: string | null;
  sourceFrameEpoch: string | null;
  frontendHandlerRevision: number | null;
}
```

所有权来自认证会话与核心实例表，不相信请求自报 pluginId。资源、处理器、提供器和 UI 句柄绑定 ownerEpoch；前端处理器另绑定明确的 sourceTabId/frameEpoch 和注册版本。不能将同插件其他页面当作当前页面，也不能用旧代数继续更新新实例。

| 核心接口 | 职责 |
| --- | --- |
| GET /web/api/workbench/ui/registry | 贡献元数据、模板及处理器版本 |
| POST /web/api/workbench/ui/instances | 创建所属窗口/工作区实例，绑定来源页面或明确无来源 |
| GET /web/api/workbench/ui/instances/:id/content | 安全内容、表达式/监听绑定及渲染版本 |
| POST /web/api/workbench/ui/instances/:id/events | 按绑定调度事件；后端链留在后端，前端链经专用桥到对应页面 |
| POST /web/api/workbench/ui/instances/:id/data | 执行已编译的后端只读表达式，包括 core:get |
| POST /web/api/workbench/ui/instances/:id/subscriptions | 建立已编译后端监听，返回订阅身份及初始版本 |
| DELETE /web/api/workbench/ui/instances/:id/subscriptions/:subscriptionId | 注销监听；实例释放自动清理 |
| POST /web/api/workbench/ui/instances/:id/effects/ack | 独立效果确认，不改写处理器返回值 |
| DELETE /web/api/workbench/ui/instances/:id | 释放实例、调用与订阅 |
| GET /web/api/workbench/inspector | 核心当前页面模板的数据投影；也可按插件上下文取得无 tab 的配置投影 |
| POST /web/api/workbench/inspector/config/update 或 reset | 核心模板保存/重置处理器的内部接口，核验目标与双 CAS |
| GET /web/ui/assets/:pluginId/:ownerEpoch/*path | 专用只读资源票据 |

普通插件页面 grant 只能访问明确授权的只读配置/监听及自身前端处理器注册桥，不能调用 UI 注册、inspector 属性写入、配置定义/校验票据/配置写接口。数据与订阅接口由工作台按实例绑定使用，不能因为某表达式是只读就向所有普通页面 grant 整体开放。旧路由亦须按方法/路径收紧，不放行整个 config 子树。

### 13.1 注册、模板及资源

1. 插件 onLoad 注册静态资源、统一处理器、侧栏、状态项及可选后端 inspector 提供器；不注册 pipe 类型或参数预设。
2. 核心校验所有权、数量、名称、资源、模板参数/依赖及域边界，成功后原子发布版本。
3. 工作台打开贡献时申请实例；从中心插件页面打开则绑定该来源页面，从插件卡片打开配置则明确无来源。
4. 核心编译 HTML/JSON、事件和 `${}`，建立值采集及监听表并保留内容格式；工作台将 JSON 安全节点直接交给受控组件渲染器，将 HTML 安全节点交给沙箱，资源均经过受限服务。
5. 普通插件页面独立通过 webutils 注册 `ui:` 处理器。绑定激活时比对页面与注册版本，没有页面的调用返回统一占位，不影响后端模板数据。
6. 模板普通表达式按需求值，watch 先建立版本一致的初始快照和订阅，更新只触及依赖节点；后台 set/invalidate 仍按版本重新获取内容。
7. 配置变更同时驱动后端 watch 和主页面 webutils 派发；活跃页接收通知，不活跃页进入恢复队列，不以页面回报更新后端事实。

### 13.2 一次后端调用链

以下是第 14 节搜索程序的执行顺序。

1. 渲染桥提交 bindingId、query 命名值及过滤后的点击事件。
2. 核心验证身份、版本和去重，从字段快照构造 `$event`，求得 `$for:query`。
3. 核心执行 `core:string.trim($for:query)`，得到返回值。
4. 核心将该值作为 `query.normalize($prev)` 的实参，经 IPC 调用所属插件后端。
5. 将新返回值传给 `core:value.write('query', $prev)`，更新分支工作副本并登记效果，再传给 `jobs.search($prev, 123, 'abc')`。
6. 独立分支 `metrics.clicked($event)` 收到最初事件快照，不能读取搜索分支的 `$prev`。
7. 核心返回最终回执及已提交效果，渲染桥按编辑序号安全更新字段。处理器中间值未交回浏览器。

前端调用链则由绑定普通插件页面的 webutils 执行，例如 `ui:selection.read()|ui:selection.format($prev)`，前端返回值不接入上述后端步骤。不会通过先交给主页面再转发后端的方式绕过域边界。

### 13.3 “当前页面”改为核心 JSON 模板

“当前页面”使用与插件贡献相同的 JSON 组件编译、`${}`、watch、事件参数和稳定节点更新机制。**JSON 模板由核心提供**，插件只能通过后端 inspector/配置提供器提供经过约束的数据，不能替换该模板。`page-inspector.ts` 保留实例切换和薄宿主职责；界面结构、标签和控件由声明式 JSON 在组件内直接渲染，不使用 iframe；薄宿主、渲染组件和内容容器通过 flex 逐层分配剩余高度，避免内容存在但容器高度塌陷。

核心页面信息保持原有信息层级：辅助侧栏按第 1 节显示内嵌页签或单页 strong 标题；模板在上方显示标签 ID、插件 ID、页面标题和说明，下面使用“属性 / 配置 / 诊断”主 Tabs。属性行保留标签和值的两列布局，配置项保留分组背景、间距和表单控件样式；配置定义按分组构造嵌套 Tabs。标签栏使用与工作台一致的高度、边框、文字和选中态，内容区域在标签栏下方独立滚动。

所有模板数据由 `core:get(...)`、`core:config.read(...)` 或其 `watch:core:` 形式取得，操作使用核心后端处理器；不使用 `ui:` / `watch:ui:`，也不引入 `core:ui:`。因此从插件卡片“配置”按钮打开时，无普通插件页面也能显示后端属性并编辑允许的配置。

核心模板结构示意（实际配置标签及字段依据后端定义生成）：

```json
{
  "format": "json",
  "version": 1,
  "root": {
    "type": "stack",
    "key": "current-page",
    "children": [
      { "type": "text", "key": "inspector-instance", "text": "${core:get('inspector.tabId')} · ${core:get('inspector.pluginId')}" },
      { "type": "text", "key": "page-title", "text": "${watch:core:get('inspector.page.title')}" },
      {
        "type": "tabs",
        "key": "current-page-tabs",
        "label": "当前页面信息",
        "tabs": [
          { "id": "properties", "label": "属性", "children": [{ "type": "stack", "key": "page-properties", "children": [] }] },
          {
            "id": "config",
            "label": "配置",
            "children": [{
              "type": "tabs",
              "key": "config-groups",
              "label": "配置分组",
              "tabs": [{ "id": "general", "label": "常规", "children": [{ "type": "input", "name": "config.example" }] }]
            }]
          },
          { "id": "diagnostics", "label": "诊断", "children": [{ "type": "text", "text": "诊断内容由核心根据当前插件状态生成。" }] }
        ]
      }
    ]
  }
}
```

核心根据后端配置定义、属性列表和诊断生成重复字段/行的组件节点，每项使用稳定 key；结构仍是核心 JSON 模板，不接收插件提供的任意 HTML，也不需要额外开放任意循环/JS。定义变化时原子重编译字段结构，普通值变化由 watch 更新相应绑定。`data-ui-key` 由核心编译器生成，仅用于稳定节点标识。

编辑控件维护本地字符串草稿。未编辑字段随 watch 更新；已编辑字段保留草稿，远端值变化时标记冲突并提供用户明确处理，不能直接覆盖。读取快照时将配置数据/schema 双 revision 绑定到本实例编辑会话；保存由核心模板绑定的处理器提交 `$event.values` 和该会话基线，重置按相同目标/基线校验。`core:inspector.config.save/reset` 只向核心模板专属绑定开放，普通插件不能靠写同名事件调用冒充核心编辑器。普通 `core:config.write` 也必须使用其绑定读取基线进行双 CAS，无基线先明确读取，不能自动拿最新版本掩盖冲突。

保存链路：模板 submit → 核心事件绑定 → inspector 专用接口 → 核验窗口/工作区/插件和可选标签 → 双 CAS → 声明式规则 → 插件后端 normalize/validate → 事务内再次 CAS → 持久化 → config.changed → watch 更新投影，并通过主页面向各插件页面通知/排队。

成功保存后更新基线、清除对应草稿；校验失败/冲突保留草稿并显示后端可公开诊断。不请求 iframe 校验、不接受前端 validationTicket、不从 FrameRuntime 补齐属性。插件后端离线时仅按配置定义允许的离线规则编辑，backend-required 明确报不可用。配置监听与前端页面是否打开无关。

## 14. 统一模板注册示例

以下为拟议 SDK 示例，函数全部留在插件后端；不涉及实际业务实现。处理器直接接收参数，不声明 event/pipe，不使用 alias。

```ts
import { fileURLToPath } from 'node:url';

async function onLoad(logger, context) {
  const ui = context.workbench.ui;
  await ui.apis.mountStatic('/assets', {
    directory: fileURLToPath(new URL('./assets/', import.meta.url)),
  });
  await ui.handlers.register('query.normalize', {
    readOnly: true,
    run(value) {
      if (typeof value !== 'string') throw new Error('关键词必须是字符串');
      return value.replace(/\s+/g, ' ');
    },
  });
  await ui.handlers.register('metrics.clicked', {
    run(event) {
      logger.info('搜索按钮被触发');
      return null;
    },
  });
  await ui.handlers.register('jobs.search', {
    async run(query, limit, label) {
      // 仅演示位置参数和返回值；真实任务可通过既有任务系统启动。
      return { query, limit, label };
    },
  });

  const program = "core:string.trim($for:query)|query.normalize($prev)|core:value.write('query', $prev)|jobs.search($prev, 123, 'abc'),metrics.clicked($event)";
  await ui.registerMainSidebar({
    id: 'overview', title: '采集任务',
    icon: { kind: 'asset', path: '/assets/icons/logo.svg' },
    content: {
      format: 'json', version: 1,
      root: {
        type: 'stack', key: 'main', direction: 'column', gap: 'medium',
        children: [
          { type: 'input', key: 'q', name: 'query', value: '' },
          { type: 'text', key: 'preview', text: '当前输入：${watch:query()}' },
          { type: 'button', key: 'search', name: 'searchButton', for: 'query',
            text: '搜索', events: { click: program } },
          { type: 'button', key: 'details', text: '详情',
            events: { click: "core:view.open('auxiliarySidebar', 'details')" } },
        ],
      },
    },
  });

  await ui.registerAuxiliarySidebar({
    id: 'details', title: '采集详情', hideCurrentPage: false,
    icon: { kind: 'builtin', name: 'info' },
    content: {
      format: 'html', version: 1,
      // 反引号里的 \${ 留给声明式模板解析器；${program} 由此处 JS 拼入静态程序。
      html: `
        <link rel="stylesheet" href="/assets/styles/panel.css">
        <p>配置关键词：\${watch:core:config.read('query')}</p>
        <label for="details-query">关键词</label>
        <input id="details-query" name="query" value="">
        <p>输入预览：\${watch:query()}</p>
        <button name="searchButton" for="query" onclick="${program}">搜索</button>
        <p>前端选中项：\${watch:ui:selection.read()}</p>
      `,
    },
  });

  await ui.registerStatusBar({
    id: 'summary', ariaLabel: '采集任务状态',
    text: '关键词：${watch:core:config.read(\'query\')}',
    icon: { kind: 'asset', path: '/assets/icons/logo.svg' },
    tooltip: {
      width: 320,
      content: {
        format: 'json', version: 1,
        root: { type: 'text', key: 'latest', text: "当前配置：${watch:core:config.read('query')}" },
      },
    },
    contextMenu: [
      { kind: 'item', id: 'details', label: '打开详情',
        action: "core:view.open('auxiliarySidebar', 'details')" },
      { kind: 'item', id: 'settings', label: '插件配置', action: 'core:settings.open()' },
    ],
  });
}
```

JSON 事件与 HTML 完全等价：

```json
{
  "type": "button", "key": "search", "name": "searchButton", "for": "query",
  "text": "搜索",
  "events": {
    "click": "core:string.trim($for:query)|query.normalize($prev)|core:value.write('query', $prev)|jobs.search($prev, 123, 'abc'),metrics.clicked($event)"
  }
}
```

输入为 `"  待   处理  "` 时，搜索分支依次得到 `"待   处理"`、`"待 处理"`，更新本分支 query，并调用 `jobs.search('待 处理', 123, 'abc')`。独立 metrics 分支收到的 `$event.value` 仍是初始原文，不继承搜索返回值。所有后端处理器间数据流留在后端。

辅助页的 `watch:ui:selection.read()` 只有绑定页面按第 5.6 节注册同名处理器才生效；插件卡片入口没有来源页面时显示 `<无数据，需要打开插件页面>`，核心配置监听和后端处理器仍可独立使用。“当前页面”核心模板不使用这个前端监听。

## 15. 生命周期、持久化与迁移

- 工作区只保存稳定的 `{ kind: "core" | "plugin", pluginId?, viewId }` 选择引用、尺寸、位置和辅助上下文模式；不保存 HTML、回调、票据、ownerEpoch、实时订阅或调用中间数据。
- 工作区 layout schema 升级，旧主侧栏字符串枚举转为 core 引用，旧辅助栏默认选择“当前页面”。
- 新插件代数可重新注册同一稳定 id。停用、退出或崩溃时撤销所有事件、资源、提供器、监听和句柄，清理旧页面配置派发队列；恢复后重新注册并读当前快照，不重跑旧业务事件。
- 断网时保留显示内容，禁用依赖后端的动作；仍在线的绑定页面可按权限执行域内前端动作，本地 tooltip 固定与关闭仍可使用。重连重新同步版本、数据和监听，不能补发失去确定结果的 click/submit。恢复配置通知遵循有界队列/重同步协议，不等同于补执行业务动作。
- 页面导航或销毁令 `ui:` 注册和 `watch:ui:` 订阅失效；新文档注册后重新绑定，不转移旧函数。不活跃但仍存活的页面恢复时，先同步配置积压/快照，再恢复依赖这些值的页面监听，避免先显示旧配置。
- 旧配置定义没有可靠来源标记，不能默认认定来自后端。迁移增加定义来源/后端确认元数据，旧定义标记为 legacy-unverified；保留原始值，待所属插件后端重新明确声明后恢复其编辑入口。
- 旧 page-required 定义在迁移前保持只读并显示需迁移，不能自动转成 declarative 或 backend-required。重新声明必须提供匹配的后端校验与新 schema 版本。
- 删除前端写能力、引入模板与前端处理器属于 SDK/声明式协议破坏性变化，应升级能力/协议版本；旧 event/pipe/alias 定义需显式迁移为位置参数及 `$prev`，不能用新解析器静默改变旧程序含义。旧客户端明确报不支持，服务端不能继续放行旧写权限。
- 重新生成受影响 webutils 和工作台产物，更新插件 SDK 类型与开发文档；不直接手工修改生成的压缩 bundle。

## 16. 建议的首版限额与错误码

以下为待审默认值，可在实施前调整，不视为已生效配置。

| 对象 | 限额 |
| --- | --- |
| 单份原始 UI 内容 | 256 KiB，按 UTF-8 字节；核心生成绑定元数据另受有界限制 |
| 单份组件/HTML 内容 | 2000 节点、深度 20、512 个绑定、256 个命名值 |
| 处理器名称 | 1–64 ASCII 字符 |
| 单程序 | 4096 字节、8 分支、每分支 16 步 |
| 单次调用参数 | 最多 16 个；嵌套调用/参数深度 8；表达式受同一大小限制 |
| 模板/监听 | 每实例最多 512 个表达式、128 个活跃订阅；依赖变化合并更新 |
| 每页配置派发队列 | 最多 256 项或 256 KiB；超过任一上限改为明确重同步，按当前快照恢复 |
| 嵌套触发 | 深度 8；每事件所有分支/嵌套累计最多 64 步 |
| 事件请求、单调用实参总量与返回值 | 各最多 64 KiB；字段值与对象另做类型、深度校验 |
| 单实例执行 | 1 个执行中、32 个排队；高频 input 合并尚未开始项 |
| 执行时间 | 单事件总预算 10 秒；长业务通过现有任务系统启动并及时返回 |
| 去重 | 每窗口会话最多 1024 个回执，保留 5 分钟；进行中项目另受并发限额 |
| CSS | 单文件 256 KiB、依赖总量 512 KiB、import 深度 4，拒绝循环 |
| 菜单 | 最多 100 项、深度 4 |

主要错误码：`UI_QUOTA_EXCEEDED`、`UI_INVALID_CONTENT`、`UI_INVALID_PROGRAM`、`UI_INVALID_EXPRESSION`、`UI_INVALID_HANDLER_NAME`、`UI_HANDLER_NOT_FOUND`、`UI_HANDLER_IN_USE`、`UI_UNKNOWN_VALUE`、`UI_INVALID_VALUE_TYPE`、`UI_NO_RETURN_VALUE`、`UI_PREV_UNAVAILABLE`、`UI_CROSS_DOMAIN_PIPE`、`UI_WATCH_UNSUPPORTED`、`UI_WATCH_CYCLE`、`UI_FRONTEND_UNAVAILABLE`、`UI_STALE_INSTANCE`、`UI_STALE_RENDER`、`UI_STALE_HANDLERS`、`UI_EVENT_ID_CONFLICT`、`UI_EXECUTION_FAILED`、`UI_EXECUTION_TIMEOUT`、`UI_TRIGGER_CYCLE`、`UI_RESOURCE_DENIED`、`UI_EFFECT_REJECTED`、`CONFIG_RESYNC_REQUIRED`、`INSPECTOR_BACKEND_UNAVAILABLE`、`CONFIG_BACKEND_REQUIRED`。无来源页面的 `UI_FRONTEND_UNAVAILABLE` 仍返回规定的统一占位文本。

编译时计算静态分支、嵌套实参调用及 trigger 的展开步骤，已知超出 64 步直接拒绝注册；运行时保留同一总计数。监听本身不占长期事件执行槽，每次更新的求值使用独立有界预算，不能以持续订阅绕过限额。

错误返回程序位置和可公开消息，不把后端堆栈、磁盘路径、票据、字段值或内部异常直接暴露给 UI。

## 17. 实施位置与验收

拟新增：统一处理器注册与按域调度服务、后端调用链执行器、参数/模板 AST 编译器、数据获取/监听服务、配置派发恢复队列、静态资源网关、核心当前页面 JSON 模板及投影服务、共享协议/Schema、前端声明式渲染桥与状态项提示层控制器。具体拆分在实施时按现有职责确定。

主要修改现有边界：

- `projects/server/types/plugin-process.d.ts`、`plugins/plugin-env.d.ts`、SDK 导出：新能力与删除的页面写能力类型。
- `projects/server/plugin/process/host.ts`、`client.ts`、`protocol.ts`：统一处理器、位置参数/返回值、只读订阅及 UI 事件 IPC，函数不越 IPC。
- `projects/server/workbench/workspace.ts`、配置服务、页面授权与工作台路由：布局、投影、后端配置与授权迁移。
- `projects/web/src/components/page-inspector.ts`：改为核心 JSON 模板薄宿主，数据/事件/监听走统一模板能力；保留本地草稿和冲突处理，不读取 FramePool 数据。
- `projects/web/src/layouts/root.ts`、`workbench/store.ts`、布局模型：动态主视图、最多两项辅助视图、状态贡献区和事件结果。
- `projects/webUtils/lib/workbench.ts`、共享页面协议和相关测试：删除 page/settings/config 写入口及校验链；保留只读配置订阅，新增主页面配置通知/恢复确认、当前页面前端处理器及监听桥。
- SDK/工作台生成产物、发行资源清单和插件开发说明：通过正常构建更新。

验收至少覆盖：

1. 多插件切换仍最多两个辅助页；隐藏范围正确；注销或失败恢复“当前页面”。
2. iframe 无法注入 inspector 属性/配置，旧 SDK 与手写 HTTP 不能绕过页面授权；webutils 只读配置监听可用，不能据此取得配置写权限。
3. “当前页面”实际加载核心 JSON 模板，通过 core:get/watch:core 与核心事件处理器工作；不使用 ui:/watch:ui: 或 FrameRuntime 数据。从插件卡片打开且无前端页面时仍可显示后端数据/编辑允许的配置。
4. 裸名称默认 `$event`、空括号零参数、显式事件与自定义参数、参数内逗号/引号/竖线、嵌套调用、分支顺序、`$prev`、null/无返回值、类型错误及触发符合本文，无 event/pipe 分类或 alias 前置要求。
5. name/for 单值、多值、自身值、表单、显式 `$for:name`、元素 watch、跨实例隔离、label 语义和迟到写值保护；默认首参始终是附带关联值的过滤事件，不发送元素层级。
6. HTML/JSON 插值、单表达式类型保留、异步返回、嵌套数据字段、目标 Schema、转义、恶意返回字符串、实体编码和动态资源均校验；最终 DOM 无原生 on*，JS/CSS Raw/SVG 等不能绕过。
7. core:/插件后端链仅在后端传中间值，ui: 链仅在绑定页面执行；混合链、跨域嵌套/监听实参和嵌套触发拒绝。无来源页的 ui:/watch:ui: 全部返回 `<无数据，需要打开插件页面>`，不借用其他同插件标签、不排队补执行业务；重载/旧绑定/超时/去重正确。
8. tooltip 固定、外部点击、菜单、键盘、焦点、更新与视口边界；状态图标四类资源及核心 loading。
9. 资源票据隔离、撤销、续期、CSS 相对依赖、MIME、重定向和符号链接边界；无全局 Token 泄漏。
10. 旧配置来源和 page-required 安全迁移、布局迁移、停用/重载、断线重连与原有页面关闭保护。
11. 配置事务成功后通知所有活跃插件页面；不活跃页面有序排队、恢复握手后派发。覆盖恢复中并发变更、去重确认、溢出/缺口重同步、跨插件授权及旧页面代数队列清理。
12. `${core:get('xxx')}`、`${watch:xxx('xxx')}`、`${watch:core:xxx(...)}`、`${watch:ui:xxx(...)}` 的初值、返回值、更新、参数变化、注销/重连和循环依赖；核心配置 watch 不依赖插件前端打开。远端更新保留脏草稿，保存/重置遵守双 revision 冲突处理。

本次文档编写不运行这些实现测试，也不声称相关功能已经可用。

## 18. 新依赖与安装

需要用户在仓库根目录新增以下直接依赖，本文编写阶段未安装、未修改 package.json 或锁文件：

```sh
bun add 'css-tree@^3.2.1'
bun add -d @types/css-tree
```

- `css-tree`：运行时直接依赖，用于 CSS AST 解析、遍历、URL 重写与语法检查。当前锁文件和 node_modules 中已有 3.2.1 传递依赖，但本功能将直接 import，必须显式声明，不能依赖其他包恰好带入。
- `@types/css-tree`：开发依赖，用于 TypeScript 类型检查；当前 css-tree 包未内置类型声明。
- 复用现有 `dompurify`、`jsdom`、`zod`、`lit`、Node crypto 与现有 IPC/WebSocket，不新增 JS 求值器、表达式引擎、管道执行依赖或 SVG 优化器。安全策略由核心实现，不能把 CSS 解析成功等同于过滤安全。

依赖安装后，正式实施仍等待本设计获准。

## 19. 外部技术依据

- [CSSTree 官方说明](https://github.com/csstree/csstree)：AST、walker、generator、lexer；容错 Raw 节点不能作为已验证内容放行。
- [CSSTree 解析接口](https://github.com/csstree/csstree/blob/master/docs/parsing.md)：stylesheet 与 declarationList 等解析上下文。
- [DefinitelyTyped 的 css-tree 声明](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/css-tree)：独立类型包。
- [DOMPurify 安全边界](https://github.com/cure53/DOMPurify/wiki/Security-Goals-%26-Threat-Model)：HTML 清洗不承担 CSS 安全策略。
- [OWASP XSS 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)：HTML、URL、CSS 按上下文处理，CSP 作为纵深防护。
- [MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)：沙箱与同源权限组合的边界。
- [WAI Tooltip Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)：含可聚焦元素的提示层采用非模态 dialog 语义。
