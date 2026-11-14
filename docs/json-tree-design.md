# JSON 树组件设计与实现契约

建议新增 `type: "tree"`，由共享树组件负责交互与虚拟渲染，由现有声明式 UI 运行器负责控制器调用、节点数据校验和事件分派。滚动直接复用 `SCWCScrollContainer`，JSON 宿主沿用 `WorkbenchScrollContainer` 的外观与滚轮策略。

本文保存实现所依据的完整设计。当前接口、宿主路径、验证结果与必要调整见 [JSON 树使用说明](json-tree.md)；类型以 projects/shared/tree.ts 为准。文中的“拟”描述原设计约束，不代表等待设计确认。

**1. 与现有系统的接合点**

已核对的源码事实：

| 现有部分 | 已有能力 | 本次需要补充 |
| --- | --- | --- |
| `projects/shared/declarative-ui.ts` | JSON UI、控制器、字段、事件、编译模型；字段值为 string / boolean / string[] | 树声明、节点及分页类型、编译后的树描述、树事件上下文 |
| `projects/shared/ui-expressions.ts` | 裸事件处理器自动接收 `$event`；显式参数、同域管道、前后端分支 | 树专属上下文参数 `$tree`；沿用既有解析与执行器 |
| `projects/server/workbench/ui-compiler.ts` | JSON 先转换成受限 HTML，再产出 SafeNode、字段和绑定 | 将树作为结构化组件编译，保留数据与程序的类型，不将整棵树展开成 HTML |
| `projects/web/src/components/ui-renderer.js` | 固定渲染器、字段快照、编辑序号、效果应用 | 组件字段适配器和树消息路由；现有 multiple 分支直接读取 selectedOptions，必须扩展 |
| `projects/web/src/components/json-components.ts` | JSON 宿主组件挂载、滚动和提示适配 | 树实例挂载、状态恢复、字段读写、销毁 |
| `projects/shared/components/scroll-container/` | 外部 metrics、逻辑范围、contentScroll、scrollTo、嵌套滚轮和生命周期 | 消费现有接口，无需重写滚动条 |
| `projects/server/workbench/declarative-ui.ts` | 所属实例、renderRevision、处理器版本、幂等事件、取消和前端续接 | 每实例 TreeSession、树读取/命令协议、增量数据与权限复核 |
| `projects/server/user-script/ui.ts` 与 `projects/shared/components/script-ui.ts` | 脚本和扩展复用 JSON 编译/渲染；独立后端执行器 | 接入同一树协议和校验模块；不能只完成工作台入口 |

工作台允许调用后端控制器，也允许依照现有来源页约束调用 `ui:` 前端控制器。脚本和浏览器扩展目前没有这条页面处理器通道，继续只接入其已有后端处理器；不得自动转借其他插件页面。

普通 JSON 视图均可使用树，包括侧栏、页面信息、JSON 提示内容和脚本/扩展视图。上下文菜单继续使用菜单项模型，不把一棵交互树塞进菜单项投影。HTML 沙箱暂不增加树标签。

**2. 外观与交互基准**

视觉参考 VS Code 的 Explorer / Tree View：紧凑单行、整行选中、折叠箭头、文件/目录图标、缩进导线、弱化描述、右侧悬停操作、清晰的焦点与拖放指示。加载子节点和稳定节点身份的分工参考其 [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)。

下列尺寸是本项目拟采用的默认值，并非声明所有 VS Code 视图都固定使用这些值：行高 22px、字号 13px、图标 16px、每层缩进 8px、箭头区域宽 16px。支持统一行高 22–40px 和缩进 8–24px；使用固定行高，超长文本省略并通过现有共享 tooltip 显示全文。

颜色使用工作台语义变量，增加树选中、失焦选中、悬停、焦点边框、匹配文字、拖入背景和插入线等变量。状态划分参考 VS Code 的 [List and trees 主题颜色](https://code.visualstudio.com/api/references/theme-color#lists-and-trees)；深浅主题和高对比状态都需验证。图标使用现有 `wb-icon`/内置 SVG 机制，兼容脚本严格 CSP。

| 用户操作 | 默认行为 |
| --- | --- |
| 单击叶子文字或行空白 | 聚焦并选择该行 |
| 单击分支文字 | 聚焦、选择并切换展开；Ctrl/Cmd/Shift 选择手势不切换展开 |
| 单击折叠箭头 | 只展开/收起，不改变选择 |
| 双击叶子或按 Enter | 触发 activate；业务打开行为由处理器决定 |
| 连续点击分支 | 默认每次 click 都切换展开状态，不受系统双击间隔限制；dblclick 仍分派事件，配置 doubleClick 时仅在 dblclick 切换 |
| 多选时 Ctrl/Cmd+单击 | 切换该节点是否选中 |
| 多选时 Shift+单击 | 按当前可见顺序选择锚点到目标区间；Ctrl/Cmd+Shift 为追加区间 |
| 右键已选中项 | 保留多选集合并聚焦该项；右键未选项先选择该项，再触发 contextmenu |
| 方向键上下、Home/End、PageUp/PageDown | 在可见行导航并保证焦点可见；普通导航更新选择，Ctrl/Cmd+导航只移动焦点，Shift 扩展选区 |
| 左方向键 | 已展开分支收起，否则定位父节点 |
| 右方向键 | 未展开分支展开，否则定位第一个可见子节点 |
| Space / Ctrl/Cmd+A | Space 选择或切换焦点项；全选只处理当前可见且可选择项 |
| Ctrl/Cmd+F / Esc | 树获得焦点时打开并聚焦搜索框；Esc 依次取消拖拽、清空搜索、关闭搜索框 |

多选使用 Explorer 式行选择，不默认显示复选框，也不做父子级联勾选。焦点、选择和展开是三个独立状态。父节点收起后，后代选择保留；隐藏的焦点回退到收起的父节点。行内操作按钮消费自己的点击，不同时触发行选择和节点 click。

**3. JSON 配置接口**

下面是契约草图，基于现有 UIValue、IconRef 和 UINode；不要求调用方在 JSON 中传入函数。

```ts
type TreeId = string; // 整个 tree 实例内唯一、非空、稳定；不使用数组下标或名称充当身份
type TreeProgram = string; // 现有受限事件程序
type TreeController = string; // 单个显式控制器调用；使用括号
type TreeValue = string | string[];

interface UITreeNode extends UINode {
  type: 'tree';
  name: string;                         // 整棵树唯一的表单字段名
  key?: string;
  label: string;                        // 可访问名称
  nodes?: TreeItem[];                   // 可选静态根节点；不提供时由 loadChildren 加载根
  loadChildren?: TreeController;
  renderNode?: TreeController;
  resolvePath?: TreeController;         // reveal 尚未加载的节点时使用
  selectionMode?: 'none' | 'single' | 'multiple'; // 默认 single
  value?: TreeValue;                    // 字面值，或现有 ${...} 模板返回对应类型
  defaultExpandedKeys?: TreeId[];
  disabled?: boolean | string;          // bool 或既有布尔模板
  readonly?: boolean | string;
  height?: number | 'fill';             // 默认 280px；fill 使用父容器分配高度
  rowHeight?: number;                   // 默认 22px
  indent?: number;                      // 默认 8px
  indentGuides?: 'none' | 'onHover' | 'always'; // 默认 onHover
  expandOn?: 'click' | 'doubleClick' | 'twistie'; // 默认 click
  search?: false | {
    visible?: boolean;                  // 默认 false，通过快捷键/查找按钮打开
    placeholder?: string;
    mode?: 'filter' | 'highlight';       // 默认 filter
    match?: 'fuzzy' | 'substring';       // 默认 fuzzy，不区分大小写
    debounce?: number;                  // 默认 150ms
    controller?: TreeController;        // 可选完整数据源搜索
  };
  dragDrop?: false | {
    mode?: 'reorder' | 'reparent';       // 默认 reorder，后者同时允许跨父级移动
    multiple?: boolean;                 // 默认 true
    move?: TreeController;              // 有动态数据源时必填，静态树可省略
  };
  virtual?: boolean | { overscan?: number }; // 默认开启，上下各预渲染 8 行
  nodeEvents?: Partial<Record<TreeNodeEventName, TreeProgram>>; // 所有节点的默认事件
  events?: Partial<Record<TreeEventName, TreeProgram>>;         // 整棵树的通知事件
}

type TreeNodeEventName =
  | 'click' | 'dblclick' | 'activate' | 'contextmenu' | 'focus' | 'blur';
type TreeEventName =
  | 'change' | 'expand' | 'collapse' | 'filter' | 'drop' | 'loadError';

interface TreeItem {
  id: TreeId;
  label: string;                        // 自定义渲染时仍用于搜索和可访问名称
  description?: string;
  tooltip?: string;
  icon?: IconRef;
  expandedIcon?: IconRef;
  hasChildren?: boolean;
  children?: TreeItem[];                // 静态/预加载的完整子列表
  disabled?: boolean;
  readonly?: boolean;
  selectable?: boolean;                // 默认 true
  draggable?: boolean;                 // 默认 true，但受 tree.dragDrop 限制
  droppable?: boolean;                 // 是否允许 into；默认取是否为分支
  data?: UIValue;                       // 交付给浏览器的业务元数据，不能包含秘密
  events?: Partial<Record<TreeNodeEventName, TreeProgram>>;
}
```

`search` 默认开启能力、隐藏输入框；显式 false 关闭。`dragDrop` 默认 false。无 `nodes` 且无 `loadChildren` 表示空树；`nodes: []` 是已知空根，不再自动加载根。静态根与动态后代可以混用。

`children` 缺省且 `hasChildren: true` 表示未加载分支；`children: []` 表示已加载为空。非空 children 可推导 hasChildren，互相矛盾的显式声明在校验时拒绝。分支未加载时保留箭头，失败时保留重试入口，不能把加载失败显示成空节点。

字段值：single 为节点 ID 或空字符串，multiple 为去重 ID 数组，none 不参与表单字段采集。多选数组按选择插入顺序保存，Shift 区间内按当前可见顺序追加，不因折叠或拖拽重新排序。`$for:files` 和 `core:value.read('files')` 得到此值。单选、多选类型不混用。

默认展开只应用于实例首次建立；同一 key 的正常更新保留用户展开状态。初始 value/defaultExpandedKeys 必须可在已知数据中解析，或由 resolvePath 受限解析；解析失败报告配置/字段错误，不能静默丢失指定值。远端删除已选节点时同步清理字段和选择；这属于数据协调，不自动执行用户 change 业务程序。

**4. 一份可评审的配置示例**

```json
{
  "type": "tree",
  "key": "workspace-files",
  "name": "files",
  "label": "项目文件",
  "loadChildren": "files.children($tree)",
  "renderNode": "files.render($tree)",
  "resolvePath": "files.path($tree)",
  "selectionMode": "multiple",
  "value": [],
  "height": 360,
  "rowHeight": 22,
  "indentGuides": "onHover",
  "search": {
    "mode": "filter",
    "match": "fuzzy",
    "controller": "files.search($tree)"
  },
  "dragDrop": {
    "mode": "reparent",
    "move": "files.move($tree)"
  },
  "virtual": { "overscan": 8 },
  "nodeEvents": {
    "activate": "files.open",
    "contextmenu": "files.menu($event)"
  },
  "events": {
    "change": "files.selectionChanged",
    "drop": "files.orderChanged($event)"
  }
}
```

工作台控制器继续通过 `ui.handlers.register(name, definition)` 注册。例如 files.children 注册为 readOnly，接收树请求，返回子节点页；files.move 注册为可写，验证业务权限和数据版本后提交移动。脚本/扩展在既有 `handlers` 中注册相同处理逻辑，调用参数一致，外围 ScriptContext 保持现状。

静态节点示例：

```json
{
  "type": "tree",
  "name": "target",
  "label": "选择目录",
  "selectionMode": "single",
  "value": "src",
  "nodes": [
    {
      "id": "src",
      "label": "src",
      "icon": { "kind": "builtin", "name": "folder" },
      "children": [
        {
          "id": "src-main",
          "label": "main.ts",
          "events": { "activate": "files.openMain" }
        }
      ]
    },
    { "id": "locked", "label": "不可选目录", "disabled": true }
  ]
}
```

**5. 控制器、返回类型与 `$tree`**

`$tree` 是本次新增的、仅在树绑定中可用的结构化参数，不是 JavaScript 变量。控制器函数可以读取接收到的普通对象属性；表达式语言本身仍不支持 `$tree.node.id`、任意成员访问、函数体或 eval。需要该 ID 时，在控制器函数内部读取 `context.node.id`。编译器为每个绑定标记合法上下文，其他组件使用 `$tree` 报错。

树读取控制器采用显式单调用，例如 `files.children($tree, $for:query)`，允许现有受限参数和同域嵌套只读调用；不使用事件分支或 watch。事件仍使用 parseProgram；两个入口复用相同的名称解析、参数求值、权限检查、取消和错误通道，不新增可执行脚本系统。

```ts
interface TreeContextBase {
  treeName: string;
  requestId: string;
  dataEpoch: string;              // 运行器的整树缓存代数
}

type TreeControllerContext = TreeContextBase & (
  | { kind: 'children'; parent: TreeItemSnapshot | null;
      cursor: string | null; limit: number; version: string | null }
  | { kind: 'render'; node: TreeItemSnapshot }
  | { kind: 'search'; query: string; cursor: string | null;
      limit: number; version: string | null }
  | { kind: 'resolvePath'; nodeId: TreeId }
  | { kind: 'move'; operationId: string; sourceIds: TreeId[];
      targetId: TreeId | null; position: 'before' | 'after' | 'inside';
      targetParentId: TreeId | null; beforeId: TreeId | null;
      expectedVersion: string }
);

interface TreeItemSnapshot {
  id: TreeId;
  parentId: TreeId | null;
  label: string;
  description?: string;
  hasChildren: boolean;
  disabled: boolean;              // 含祖先继承后的有效值
  readonly: boolean;
  data?: UIValue;
}

interface TreeChildrenPage {
  items: TreeItem[];
  nextCursor: string | null;      // null 表示该父节点的完整列表已到末尾
  version: string;                // 提供器的数据快照版本；一个 dataEpoch 内保持一致
}

interface TreeSearchPage {
  hits: { path: TreeItem[]; matchRanges?: [number, number][] }[];
  nextCursor: string | null;
  version: string;
}

interface TreePathResult {
  path: TreeItem[];               // 根到目标的路径；每项不携带 children
  version: string;
}

type TreeMoveResult =
  | { accepted: false; message?: string }
  | { accepted: true; version: string; invalidateParents: (TreeId | null)[] };
```

children 根请求的 parent 为 null。一次只请求一个父节点的直接子列表，响应可以附少量预加载后代，但受现有 JSON 深度与字节限制。分页游标由提供器拥有，运行器只接受已签发的游标；同页重复请求可合并，重复游标、跨页重复 ID 和版本不一致拒绝提交。

children/render/search/resolvePath 必须使用只读控制器；move 是唯一在此表中允许写入的调用。只读表示不能通过 UI 执行器产生业务写效果，插件函数也必须遵守其只读声明。取消信号仍使用现有 HandlerContext.signal / ScriptContext.signal，不序列化进 `$tree`。

若提供器数据变化，返回新 version 或调用 refresh 都会使旧 dataEpoch 失效。首次分页建立快照版本，后续不把不同快照页拼成一棵树。发现不一致时保留旧可读视图、结束本次合并并安排一次有界刷新，持续变化则显示可重试状态。

渲染控制器按节点版本缓存，输入不包含瞬时 hover/focus/selected 状态；这些状态由组件的样式和语义属性呈现，避免每次鼠标移动或选择都调用后端。

**6. 节点自定义渲染**

自定义的是一行内的内容区。折叠箭头、缩进、选中背景、焦点、拖放指示、虚拟定位与 ARIA 始终由树负责。

```ts
type TreeRowPart =
  | { type: 'text'; text: string; tone?: 'normal' | 'muted' | 'warning' | 'error' }
  | { type: 'icon'; icon: IconRef; label?: string }
  | { type: 'badge'; text: string; tone?: 'normal' | 'warning' | 'error' }
  | { type: 'stack'; direction: 'row'; gap?: number; children: TreeRowPart[] };

interface TreeRowView {
  content: TreeRowPart[];
  actions?: {
    id: string;
    label: string;
    icon: IconRef;
    disabled?: boolean;
    events: { click: TreeProgram };
  }[];
  tooltip?: string;
  ariaLabel?: string;
}
```

这是现有 JSON 图标、文本、徽标和横向布局语义的受限子集。行内操作使用独立 actions 区域，悬停或键盘聚焦时显示；支持键盘进入和退出操作区。初版不承载可变高输入表单、嵌套树、HTML、任意 CSS 或 DOM 返回值，以保持 Explorer 单行布局及虚拟列表坐标稳定。

无 renderNode 使用默认 label + description + icon 渲染。自定义渲染失效时回退默认行并显示错误提示，不影响展开和选择。默认渲染自动按 label 的匹配区间高亮；自定义行仍以原始 label/description 搜索，匹配样式由固定内容组件提供，不依赖读取自定义 DOM 文本。

首次进入视口按最多 32 个节点打包读取渲染结果，单次调用仍受执行步骤和字节预算约束；缓存键为 nodeRevision + rendererRevision + dataEpoch。滚动离开不撤销节点业务状态，只卸载行 DOM；取消尚未执行的渲染批次，并丢弃失效批次的迟到返回。自定义图标资源沿用现有资源挂载、URL 限制和 CSP。

**7. 事件契约与无括号调用**

| 写法 | 语义 |
| --- | --- |
| `files.open` | 与 `files.open($event)` 完全相同 |
| `files.open()` | 零位置参数 |
| `files.open($event, $for:files)` | 只传显式参数 |
| `files.prepare($event)\|files.open($prev)` | 同域管道，顺序等待 |
| `files.prepare\|files.open` | 两步都接收原始 $event，不隐式透传上一步返回值 |
| `files.changed,ui:files.changed` | 沿用既有独立分支与来源页约束；脚本/扩展不接受 ui: 分支 |

节点事件先执行树内建交互，再分派业务通知；不承诺异步返回 false 可以撤销已发生的选择或展开。需要阻止选择用 selectable/disabled，阻止移动用 move 的返回值。仅在 value 确实变化时触发 change；一次操作固定先提交选择和 change，再分派对应 click/contextmenu，处理器读到同一次不可变快照。

`TreeItem.events[event]` 覆盖对应 `nodeEvents[event]`；未定义的事件继承默认处理器。它们不会同时执行两次。整树 events 处理汇总通知，与节点事件是不同事件类型。

```ts
interface TreeEvent {             // 扩展现有 NormalizedUIEvent
  type: TreeNodeEventName | TreeEventName | 'action';
  name: string;
  value?: TreeValue;
  values?: Record<string, FieldValue>;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
  tree: {
    nodeId: TreeId | null;
    node: TreeItemSnapshot | null;
    selectedIds: TreeId[];
    focusedId: TreeId | null;
    expanded?: boolean;
    query?: string;
    actionId?: string;
    reason: 'pointer' | 'keyboard' | 'api' | 'retry';
    move?: { sourceIds: TreeId[]; targetParentId: TreeId | null; beforeId: TreeId | null };
    error?: { code: string; message: string };
  };
}
```

浏览器仅发送 treeId、nodeId、bindingId/actionId、选中 ID、修饰键和必要操作数据。运行器按当前实例中已经验证的节点与程序重建 TreeEvent，不能信任浏览器提交的 node.data、disabled、处理器名称或任意事件程序。坐标和原生 Event 留在浏览器；右键菜单定位由宿主处理。

动态加载返回的事件和 renderNode 返回的 action 程序也必须进入编译与注册表。使用运行器签发的稳定绑定 ID 分派，绑定随节点版本和缓存代数失效；不能让浏览器把新字符串作为程序发送执行。整棵树采用集中事件代理，避免为大量节点安装独立 DOM 监听器。

**8. 禁用与只读的明确边界**

| 能力 | 正常 | readonly | disabled |
| --- | --- | --- | --- |
| 显示内容、滚动和 tooltip | 允许 | 允许 | 允许 |
| 树内部键盘导航 | 允许 | 允许 | 整树退出 Tab 顺序；禁用节点允许被读出但不可操作 |
| 展开、收起、查询、只读懒加载 | 允许 | 允许 | 不响应用户操作 |
| 更改选择字段值 | 允许 | 禁止 | 禁止 |
| 拖拽/移动 | 按配置 | 禁止 | 禁止 |
| 自定义业务事件或行内操作 | 按注册能力 | 仅全部调用均声明 readOnly 的程序 | 禁止 |

tree 和祖先节点的 disabled/readonly 向后代合并，子节点不能覆盖为 false 重新开启。`selectable: false` 只禁止选择，该节点仍能展开和导航。readonly 不自动修改当前选择。

前端做即时交互限制，运行器收到命令时重新检查有效状态和绑定权限。单纯在 DOM 上设置 readonly 或 disabled 不构成权限边界。动态属性在请求期间变为只读/禁用时，重新校验后拒绝旧操作；已有外部业务写入若已经完成，不能声称可以撤销。

**9. 内部数据结构与状态归属**

```ts
interface NodeRecord {
  item: TreeItem;                       // 已校验；内部移除嵌套 children
  parentId: TreeId | null;
  childIds: TreeId[];
  nodeRevision: number;
}

interface ChildListState {
  ids: TreeId[];
  status: 'unloaded' | 'loading' | 'loaded' | 'error';
  complete: boolean;                    // loaded 与 complete 不等价
  nextCursor: string | null;
  generation: number;                   // 每个父节点的读取代数
  inFlightRequestId?: string;
  error?: { code: string; message: string };
}

interface TreeDataStore {
  dataEpoch: string;
  version: string | null;
  nodes: Map<TreeId, NodeRecord>;
  children: Map<TreeId | null, ChildListState>;
}

interface TreeViewState {
  expandedIds: Set<TreeId>;
  selectedIds: Set<TreeId>;
  focusedId: TreeId | null;
  rangeAnchorId: TreeId | null;
  query: string;
  queryGeneration: number;
  filterExpandedIds: Set<TreeId>;
  scrollAnchor: { id: TreeId; offset: number } | null;
  editSequence: number;
}

type VisibleRow =
  | { kind: 'node'; id: TreeId; parentId: TreeId | null; depth: number;
      index: number; posInSet: number; setSize: number | null }
  | { kind: 'loading' | 'retry' | 'more'; parentId: TreeId | null;
      depth: number; index: number };
```

插件/数据提供器拥有业务数据和持久排序。运行器 TreeSession 保存已验证的节点身份、父子关系、数据版本、动态事件绑定以及授权，不把浏览器缓存当成权威事实。浏览器保存数据副本和交互状态，负责及时选择、展开、过滤与可见行计算。字段值在收到用户事件时按既有 editSequence 同步，较早响应不能覆盖较新的选择。

loading/retry/more 是运行器辅助行，不是业务节点，不能被选中、提交或拖动。每个节点只允许一个父节点，拒绝重复 ID、循环和冲突父子关系。ID 不因重命名改变；组件 DOM ID 由内部映射生成，不直接使用业务 ID 拼接选择器。

普通模板刷新按稳定 tree key、name、数据源定义签名恢复交互状态；数据源配置改变、处理器注册版本改变或实例释放时更换 dataEpoch 并取消旧任务。页面重新创建时默认不持久化整棵树；脚本/扩展仅沿用现有字段保存机制保存选择值，不把节点缓存和函数程序存入配置。

**10. 完整数据流**

总体流向为：

```text
插件 JSON 声明 + 注册控制器
        ↓
compileUI：树描述 / 控制器 AST / 静态节点 / 字段 / 事件绑定
        ↓
TreeSession：实例权限、数据版本、节点注册表、增量协议
        ↕ 复用工作台 HTTP / 插件 IPC / 脚本事件传输
JSON 宿主适配器：校验消息、字段读写、树命令和结果
        ↕
TreeDataStore + TreeViewState
        ↓ 展开 + 过滤 + 原始兄弟顺序
VisibleRow[]
        ↓ ScrollState + 固定行高 + overscan
现有滚动容器中的有限行 DOM
        ↓ 点击 / 键盘 / 搜索 / 拖拽
本地交互状态 → 必要命令 / 规范化事件 → TreeSession → 控制器
```

初始化：编译器验证属性、唯一 name、程序及静态节点，产出一个 tree host 和结构化 CompiledTree 描述；前端二次校验后挂载共享树组件。静态根立即归一化；动态根发 children(parent=null) 读取。有效响应原子安装根数据，初始化字段和默认展开，逐层读取需要展开的分支，最终扁平化并渲染可见区域。

展开懒加载节点：先设置展开意图，插入同高 loading 行；以 instanceId + renderRevision + treeId + dataEpoch + parentGeneration + requestId 去重读取。运行器查找编译绑定和权威父节点，构造 `$tree`，调用只读控制器；返回经结构、字节、身份、版本和事件程序校验后一次提交。前端核验同组身份再合并，移除 loading，保留滚动锚点。收起时取消该分支读取并使 generation 失效；提供器忽略取消也不能把迟到结果写回来。失败保留 retry 行，只重试该父节点；下一次展开或点击重试产生新 requestId。

选择与表单：本地以有效权限和 selectionMode 计算新 ID 集，更新字段适配器并增加 editSequence，随后采集该事件真正依赖的字段。运行器复核 ID、类型、禁用/只读和树版本，重建 `$event`，执行现有事件程序。控制器写回字段时仍经过字段校验；没有更高编辑序号才能覆盖本地值。重复点击同一选中值不重复触发 change；单纯滚动不发字段事件。

程序化修改字段：继续使用 core:value.write，不另建一套选择写入接口。运行器验证新值的 ID 可解析、节点可选且类型匹配，前端通过树字段适配器写入；程序写值默认不合成用户 change，防止控制器回环。

自定义渲染：可见行请求缺失的渲染缓存 → 宿主合并批次 → 运行器构造逐节点只读上下文 → 控制器返回 TreeRowView → 编译/校验内容和 action 绑定 → 带 nodeRevision 的响应回前端 → 只替换行内容区。行被复用给另一 ID 后，旧响应不可进入新行。

刷新：调用 tree.refresh 对目标父列表增加 generation，保留旧内容并显示刷新状态。成功后原子替换子列表，清理已删除节点的后代、事件绑定、选择和焦点。无法证明新旧页同版本时更换整树 dataEpoch；滚动按首个仍存在的锚点 ID 加行内偏移恢复，锚点消失则找最近存活祖先/相邻项并钳制。

销毁：取消 children/search/render/move 的待交付操作、释放 action 注册、帧任务、观察器、滚动监听与 tooltip；释放 TreeSession，后续回包一律忽略。已提交的业务写入仍由提供器的 operationId 保证幂等，销毁不意味着业务事务已回滚。

**11. 搜索过滤与懒加载的组合**

本地搜索默认匹配所有已加载节点的 label/description，包括已经加载但目前折叠的后代；filter 模式显示命中节点及其祖先路径，highlight 模式保持原布局并标出命中。匹配不按分数重排兄弟节点，保留原始顺序。

搜索产生独立 filterExpandedIds，不改用户 expandedIds。清空查询恢复搜索前的展开和滚动锚点；选择保留。焦点因过滤不可见时暂存原焦点，在结果内选首个合适焦点，退出搜索后优先恢复仍存在的原焦点。

不自动递归拉取未知子树。仅本地搜索且仍有未知分支时显示“仅搜索已加载节点”；零命中表达为“已加载内容中无匹配项”。配置 search.controller 后，请求完整数据源搜索，返回包含祖先路径的 hits，组成独立搜索投影；该投影不是任何父节点的完整 children 列表，不能覆写常规缓存。每次输入变更增加 queryGeneration、取消旧请求，旧查询结果绝不合并到新查询。

远端命中路径也通过运行器节点校验并保存来源/version。允许选择命中项，选中的少量节点作为 pinned 身份保留。退出搜索时按需使用 resolvePath 和 children 物化所需祖先路径；路径证明不代表已知其全部兄弟。搜索投影和正常树只在同版本下共享节点元数据，不能合并不同版本。

初版有非空查询时禁止拖拽排序，并显示明确提示，避免隐藏兄弟和未完整结果使插入位置含糊。搜索输入聚焦时，方向键和全选首先服务输入框；向下进入结果列表再由树接管键盘。

**12. 拖拽排序与持久化**

拖拽使用同一树内的稳定 ID。多选拖拽时只取最外层被选节点：父节点已选则不重复移动其后代；移动顺序按实际树的前序排列。拖动禁用/只读节点、目标为自身或后代、跨树、过滤中拖动，以及超过配置能力的跨父级移动都拒绝。

行上部/下部显示 before/after 插入线，中部仅在 droppable 分支上显示 inside 背景。悬停 650ms 展开目标分支；靠近视口上下边缘时通过现有 scrollTo 和统一帧调度自动滚动。离开/取消清理计时器。视觉坐标用于本地命中，业务协议传 parentId + beforeId；beforeId 是移除 sourceIds 后的目标列表锚点，null 表示末尾，不能把过滤后的可见下标当成真实索引。

提交过程：

1. 浏览器发送 drop 命令及 operationId、来源/目标 ID、数据基线；进入 pending 状态，显示放置指示，保持原顺序。
2. 运行器复核实例、节点归属、权限、循环、目标锚点与数据版本，并把目标规范化。
3. 完全静态树由 TreeSession 原子调整父子顺序；其持久化若有需要由应用在通知中显式完成。有动态来源时必须调用 move 控制器，控制器在业务存储中执行校验、CAS 和原子移动。
4. 动态 move 返回 accepted/version/invalidateParents。运行器至少使所有来源父列表和目标父列表失效，不信任遗漏的列表；合并分支读取并交付同版本新顺序。版本改变同时使旧分页与读取失效。
5. 前端保留选择、焦点与滚动锚点，清理 pending，发送一次 drop 成功通知。重复 operationId 返回同一提交回执，不重复移动。

拒绝或提交前错误保持原顺序，显示原因。提交已成功但刷新失败时显示“移动已保存，列表待刷新”，恢复只读可见内容并提供刷新；不能显示“已回滚”，也不能自动重放 move。提交过程中禁止第二次结构修改，但滚动和普通读取可以继续。提供非拖拽的 tree.move 控制器入口，让菜单/按钮或辅助技术执行相同操作。

**13. 虚拟列表与现存滚动容器**

先按展开、过滤与稳定兄弟顺序得到 VisibleRow[]，再计算虚拟窗口。状态始终放在 Store 中，不能挂在可回收行元素上。

```text
scrollHeight = visibleRows.length × rowHeight
start = max(0, floor(scrollTop / rowHeight) - overscan)
end = min(rowCount, ceil((scrollTop + clientHeight) / rowHeight) + overscan)
rowTop = row.index × rowHeight
```

树仅向现有容器的外部 metrics 提交逻辑 scrollHeight；从 contentScroll/scrollState 读取实际位置，只有 reveal/恢复锚点才通过 scrollTo 设置位置。不同时使用外部 metrics 和内部 updateMetrics，也不在每次渲染回写旧 scrollTop。行使用逻辑 rowTop 定位，让原生视口完成一次位移，不能再手工减一次 scrollTop。

尺寸变化通过 ResizeObserver 独立重算窗口：现有容器的 scroll 只保证位置改变时通知，不能把滚动事件当成唯一尺寸来源。隐藏 Tabs/零高视图暂停测量和预取，重新显示后 refresh 并恢复锚点。默认横向不滚动、单行省略；树内部只保留一个实际纵向滚动容器，外层页面滚动在边界继续按已有逻辑承接。

DOM 数量约等于可见行数 + 两侧 overscan；布局/滚动 O(窗口行数)，结构或过滤变化的扁平化 O(已加载节点数)。首版用纯函数 + 迭代遍历，避免深层递归栈溢出。全局展开默认只展开已加载分支，不递归请求整个远端数据源；用户真正展开一个未加载节点时才读取。

可访问性采用树容器单一 Tab 入口和 aria-activedescendant；可见业务行设置 treeitem、level、selected、expanded、disabled、posinset，已知完整兄弟数才填确定 setsize，未知时使用未知值。焦点导航先滚动并渲染目标，再更新 active descendant，确保引用的元素存在；用户手动滚远时额外保留至多一条焦点行，辅助行不伪装成业务 treeitem。加载、错误和移动结果用 live region 简短通知。

**14. 程序化接口**

通过既有 core: 命名空间加入以下树操作，目标必须是当前实例已注册的 tree name；不接受 DOM selector：

| 调用 | 语义 |
| --- | --- |
| `core:tree.expand(name, id)` | 展开指定节点，必要时只读加载 |
| `core:tree.collapse(name, id)` | 收起指定节点 |
| `core:tree.expandAll(name)` | 展开当前已加载分支，不无限拉取远端 |
| `core:tree.collapseAll(name)` | 收起全部分支 |
| `core:tree.reveal(name, id)` | 通过已知路径/resolvePath 展开祖先并滚动定位，不隐式选择 |
| `core:tree.refresh(name, parentId)` | null 刷新根，ID 刷新该分支；刷新不重执行业务事件 |
| `core:tree.filter(name, query)` | 设置搜索词，执行相同搜索流程 |
| `core:tree.move(name, sourceIds, target)` | 使用与拖拽相同的校验与提交过程 |
| `core:value.read(name)` / `core:value.write(name, value)` | 沿用字段接口读写选择 |

UI 视图命令返回既有客户端效果回执，不传 DOM。需要得到业务写结果的 move 则由运行器等待提交，产生明确成功/拒绝结果。所有程序化命令与鼠标操作执行同样的 readonly/disabled 和版本检查；树命令不会递归触发同名业务事件程序，避免循环。

共享前端组件可以额外提供对应 imperative API，JSON 宿主不向插件暴露组件实例。纯状态算法与 DOM/网络独立，组件通过适配器提出 children、render、search、move 请求。

**15. 编译、传输及配额设计**

CompiledUI 新增可选 trees 描述数组，SafeNode 中只保留受控 host 标记。CompiledTree 包含 hostNodeId、稳定 treeId、字段元信息、选项、静态数据和编译绑定。不能直接允许任意自定义元素标签绕过 JSON 白名单。树数据节点不按每个子项展开进普通 SafeNode 的 2000 节点预算，而有独立、有界的数据预算；静态总声明仍受既有 256KiB 限制。

拟新增 TreeRequest/TreeResponse 判别联合，按 children/render/search/path/command 分类；消息共用 instanceId、renderRevision、treeId、dataEpoch、requestId，分支读取增加 generation，搜索增加 queryGeneration，行渲染增加 nodeRevision。增量响应仅含目标分支/批次，不随每次轮询或输入回传整棵树。

接口骨架如下。身份封套中的全部字段均原样回绑；实际所属窗口、站点、来源页、处理器版本来自已认证实例，不能由请求覆盖。

```ts
interface TreeEnvelope {
  instanceId: string;
  renderRevision: number;
  treeId: string;
  dataEpoch: string;
  requestId: string;
}

type TreeRequest = TreeEnvelope & (
  | { kind: 'children'; parentId: TreeId | null; generation: number;
      cursor: string | null }
  | { kind: 'render'; nodes: { id: TreeId; revision: number }[] }
  | { kind: 'search'; query: string; queryGeneration: number;
      cursor: string | null }
  | { kind: 'path'; nodeId: TreeId }
  | { kind: 'command'; operationId: string; command: TreeCommand }
);

type TreeCommand =
  | { type: 'expand' | 'collapse' | 'reveal'; nodeId: TreeId }
  | { type: 'expandAll' | 'collapseAll' }
  | { type: 'refresh'; parentId: TreeId | null }
  | { type: 'filter'; query: string }
  | { type: 'move'; sourceIds: TreeId[]; targetParentId: TreeId | null;
      beforeId: TreeId | null; expectedVersion: string };

interface TreeFieldAdapter {
  readValue(): TreeValue;
  writeValue(value: TreeValue): void;    // 运行器已校验的字段回填，不合成用户事件
  focus(): void;
  captureState(): TreeViewState;
  restoreState(state: TreeViewState): void;
  dispose(): void;
}
```

TreeResponse 为同身份封套加 `kind` 与成功/错误联合：children 返回已校验子页、父列表 generation；search 返回查询代数与搜索页；render 返回逐 ID/nodeRevision 的行内容和签发的 action 绑定；path 返回校验后的路径；command 返回 accepted、operationId 及必要 patch。结构 patch 至少支持原子 upsert、替换指定父列表、删除子树与失效父列表；同一 patch 的校验全部通过才提交，随后统一协调字段/焦点/滚动锚点。服务端增量序号按 TreeSession 单调递增，乱序响应不能倒退已提交的结构；互不冲突的读取按各自父列表 generation 接收，不能仅凭请求开始时间丢弃其他分支。错误包含 code、message、可选 nodeId/retryable，不携堆栈或私密业务数据。

TreeFieldAdapter 由 JSON 组件层注册给固定渲染器：优先通过适配器读取/写入树字段，普通原生控件保持原路径。状态捕获只在同一稳定树身份下恢复，反序列化后的 ID 必须与新数据协调；组件释放时撤销适配器，防止重建后残留字段读取闭包。

工作台在现有 UI 实例路由增加 trees 请求入口，复用身份与来源页桥；脚本/扩展在现有 v2 事件传输增加明确的 tree 请求分支，保留实例/站点检查和相同返回契约。读取请求不能伪装成普通写事件，也不触发 requireFullContent 采集；move 和业务事件按既有写事件语义处理。兼容性通过明确 tree 协议能力/最低客户端版本检查；旧客户端得到升级提示，不尝试误渲染新的组件模型。

新增树请求仍受既有单值 64KiB、内容/消息约束与 10 秒调用预算约束，不能因虚拟化而扩大所有 UI 的全局限制。拟采用独立初值如下，实施时用真实浏览器验证其性能：

| 资源 | 拟定限制 |
| --- | --- |
| 每页子节点/搜索命中 | 最多 200 项，规范化单次数据负载不超过 48KiB，计入行自定义内容与事件 |
| 单次自定义渲染 | 最多 32 行，同时服从现有步骤与总字节预算 |
| 每树已加载业务节点 | 最多 10000 个、16MiB 数据缓存；每实例合计最多 20000 个、32MiB |
| 每树选中 ID | 最多 500 个，并服从字段 64KiB 限制；超限明确提示，不能静默截断 |
| 动态树逻辑层级 | 最多 128 层；静态声明仍服从既有 JSON 深度限制 |
| 读取并发 | 每树最多 4 个；同一父节点/同一游标合并；实例合计最多 8 个 |
| 自定义行内容 | 最多 32 个内容项、4 层嵌套；最多 4 个行内动作 |
| 动态程序注册 | 相同程序按树内 AST 去重；每树最多 512 个不同程序；不能变成每行独立 watch |

原事件程序 steps/参数数量等限制继续生效。达到缓存上限时优先释放未展开、未选中、无焦点的完整分支缓存，前后端通过释放确认同步撤销相关绑定；活跃状态超过上限则明确拒绝继续装载，不逐出正在使用的节点。虚拟化解决 DOM 数量，不宣称业务数据可以无限留在内存。

读取可以取消并按新身份重新请求，写操作只按同 operationId 查询回执或让用户再次明确发起，不能自动重放。渲染错误、加载错误、数据冲突与不支持能力分别使用可区分错误码，不把所有问题展示成空树。

**16. 拟实施模块与验收条件**

实现分为共享类型和纯状态算法、共享树组件、JSON 编译与运行器协议、工作台/脚本/扩展适配、template 演示和完整验证。拟新增目录为 `projects/shared/components/tree/`，树协议与纯校验放 shared 下供两种后端执行器共用，避免各入口产生不同语义。

必须验证的用户场景：

| 场景 | 通过条件 |
| --- | --- |
| 快速展开→收起→再次展开 | 不重复装载，不接受旧响应，不意外重新展开 |
| 子节点分页与刷新 | 不拼接不同 version；空列表、失败、尚未完成分页可区分 |
| 单选/多选和懒加载 | 字段类型一致；修饰键、区间锚点、隐藏选择、删除后的协调正确 |
| readonly/disabled | 鼠标、键盘、行内动作、程序化命令及伪造请求都执行同样限制 |
| 裸事件与管道 | handler、handler()、handler($event)、$prev 与前后端边界符合现有语义 |
| 自定义行 | 返回安全子集；异步旧渲染不污染复用行；按钮不重复触发行事件 |
| 搜索 | 包含已加载折叠后代；未知范围提示正确；远端旧查询丢弃；清空后恢复展开 |
| 多节点拖动 | 祖先去重、稳定顺序、真实插入锚点；不允许形成循环 |
| 移动后刷新失败 | 正确报告已保存待刷新，不假装回滚或重复提交 |
| 虚拟列表 | 10000 已加载节点时 DOM 仍受视口约束；滚动、缩放、隐藏再显示、焦点和锚点不跳变 |
| 多入口 | 工作台、脚本浮窗和浏览器扩展运行相同数据/选择/加载用例，前端处理器只在支持的来源页工作 |
| 生命周期 | 模板/处理器变化、实例过期、卸载和断连后，不存在迟到写回与悬挂监听 |

测试采用纯算法测试、DOM 交互测试、真实运行器/IPC 集成与浏览器视觉验证。截图需覆盖深色、浅色、焦点/失焦选中、加载失败、搜索高亮和拖放反馈。DOM 夹具不能代替滚动和像素排版验证；性能结果在实现后实测，不在设计阶段承诺未验证的帧率。

评审时最需要确认的默认语义为：Explorer 行多选、只读冻结选择但保留浏览、固定行高、自定义渲染限定行内安全内容、搜索不递归拉取未知分支、搜索中禁止拖动、动态排序通过控制器提交。这些均是本草案建议，可在实现前调整。
