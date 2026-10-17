# Web 插件工作台技术契约与后端补充

日期：2026-10-18。状态：后端已实施，前端 SDK/工作台 UI 待接入。实际后端的请求字段、错误、配额和实现差异以[Web 后端接入](Web后端接口.md)和[数据库](数据库.md)为准；本文件保留整体设计合同。现有实现依据见[主设计文档](Web插件工作台设计方案.md)。只约定功能、数据与交互边界，不规定组件具体尺寸或视觉样式。

## 1. 身份、所有权与状态模型

### 1.1 必须分开的身份

| 身份 | 生命周期 | 用途 |
| --- | --- | --- |
| installationId | 核心数据目录首次初始化生成，重启不变 | 区分两套 SCWC 安装，判断收藏地址是否允许按端口重新定位 |
| coreBootId | 核心每次启动生成 | 识别服务重启，旧执行及连接票据不能冒充当前状态 |
| pluginId | 当前配置插件目录中的目录标识 | 复用现有生命周期接口；持久化收藏、配置与页面定位 |
| 导出 `name` | 插件可选声明的唯一标识符 | 保留既有身份语义，不要求提供，也不作为新增标题字段；不替代目录 pluginId |
| safeId | 每次插件加载变化 | 仅当前 API/资源/WS 路由定位，不能作为收藏、配置或标签的持久身份 |
| workspaceId | 用户的一份工作区；可持久恢复 | 保存布局、分组和逻辑标签；同一份工作区同时只由一个窗口写布局 |
| clientWindowId | 浏览器文档每次连接生成 | 连接、焦点和 workspace 写租约；刷新时重新领取 |
| tabId | 逻辑标签创建至关闭；恢复关闭可复用未占用 ID | 同插件、同 URL 的不同页面实例仍各有身份 |
| frameEpoch | iframe 每次创建、文档导航或重新握手变化 | 拒收旧文档消息、旧配置回调和旧截图 |
| terminalId / executionId | 终端持久 / 每次执行唯一 | 日志、任务、交互输入准确归属，不与页面 tabId 混用 |

pluginId 当前是目录名。第一版维持此契约，不因导出 `name`、`package.json.name` 或展示标题相同而合并两个目录；目录重命名视为新插件，提供显式数据迁移/重绑定。标题和描述均为展示元数据，不参与权限、路由或配置命名空间。将来引入稳定 package 标识须有迁移合同，不能悄悄替换配置命名空间。

当前服务没有用户账户隔离，默认 profile 为单安装的 `local`。profileId 是偏好分区，不是授权凭证；客户端知道 ID 不能绕过鉴权。未来多用户功能需要另行引入账户与资源授权。

### 1.2 可持久化的页面与布局

```ts
type LayoutNode =
  | { kind: 'split'; id: string; axis: 'horizontal' | 'vertical'; ratio: number;
      first: LayoutNode; second: LayoutNode }
  | { kind: 'group'; id: string; tabIds: string[]; activeTabId: string | null;
      tabBarPosition: 'top' | 'bottom' | 'left' | 'right' };

interface WorkbenchLayout {
  schemaVersion: 1;
  mainSidebar: {
    side: 'left' | 'right'; visible: boolean; size: number;
    view: 'search' | 'pages' | 'bookmarks' | 'history' | 'plugins';
    openPagesRatio: number;
  };
  auxiliarySidebar: { visible: boolean; size: number };
  panel: {
    dock: 'bottom' | 'left' | 'right'; align: 'center' | 'full'; visible: boolean;
    width: number; height: number; activeView: 'output' | 'terminal';
    terminalListSize: number;
  };
  center: LayoutNode;
  focusedGroupId: string;
}

interface PluginTab {
  id: string;
  kind: 'plugin';
  pluginId: string;
  originalPluginTitle: string;
  originalPageTitle: string;
  customTitle: string | null;
  url: string;
  locator: { installationId: string; pluginId: string; path: string; search: string; hash: string };
  pinned: boolean;
  keepAlive: boolean;
  createdAt: string;
  lastFocusedAt: string;
  navigation: { entries: NavigationEntry[]; index: number };
  stateSnapshotId: string | null;
}

interface InternalTab {
  id: string;
  kind: 'internal';
  page: 'welcome' | 'settings' | 'keybindings' | 'search' | 'bookmarks' | 'history' | 'plugins';
  pinned: boolean;
  customTitle: string | null;
  createdAt: string;
  lastFocusedAt: string;
}

type WorkspaceTab = PluginTab | InternalTab;
```

实例是否加载、当前请求、脏标记、MessagePort、iframe DOM 和定时器放 `PageRuntime`，以 tabId 索引；不用 PluginTab 的持久记录冒充当前运行事实。分组归属只在树的 tabIds 中维护，避免双写 groupId 产生矛盾。

WorkbenchLayout 与逻辑标签一同保存在工作区快照。侧栏大小、底栏两种停靠方向下的大小、主侧栏内部划分、中心所有 split 的方向和 ratio 都必须保存，不只保存当前可见分组。size/width/height 是用户调整后的首选大小，不是本文规定的初始尺寸；隐藏区域仍保留最近大小。辅助侧栏位于主侧栏对侧，活动栏始终位于主侧栏左侧，位置从逻辑关系派生。

持久化布局校验：叶子 ID 唯一、标签最多属于一个组、activeTabId 必须在本组、至少一个组、树无环、深度和数量有界；方向、视图、停靠为白名单，大小为有限正数，分割比例在 (0,1) 内。无效数据先隔离备份，局部修复后回退默认组，标签不丢弃。批量操作以一个 reducer 事务提交，并形成一次工作区 revision。

渲染时依据当前可用空间约束实际大小；窄屏临时折叠、专注/最大化和菜单溢出都是派生状态，不能反写覆盖首选布局。空间恢复后使用保存值。拖动结束、停靠/显隐/分组变化自动保存；持续拖动可合并中间写入，不依赖 unload 最后保存。启动先恢复布局再创建可见 iframe，浏览器刷新和核心重启均适用，详见第 10 节。

`focusedGroupId` 与 `focusedPluginTabId` 分开：前者记录工作区激活组，后者为最近激活的插件页。`keyboardScope` 记录菜单、地址、iframe、终端等当前输入范围。内置标签激活时置浏览器操作为不适用，不意外操纵之前插件页。

### 1.3 多浏览器窗口

收藏、历史、通知和插件配置共享；每个浏览器窗口的分组/活动标签独立。新窗口领取新 workspaceId，可选择从既有工作区克隆。刷新通过 sessionStorage 中的 workspaceId 恢复；显式工作区链接可请求同一工作区。

浏览器复制标签可能复制 sessionStorage，因此由后端租约检测重复 workspaceId：新文档先尝试接管已断线的租约；仍有存活 owner 时生成新工作区并克隆，不让两个窗口互相覆盖布局。默认租约 30 秒、每 10 秒续期，重连有短暂宽限；布局写需要 revision 和 owner lease。浏览器关窗事件不作为唯一释放机制。

### 1.4 设置与独立快捷键设置

`settings` 和 `keybindings` 是两个不同的中心内置页面，不创建 iframe，各自在工作区内复用已打开的标签。设置页、活动栏和命令菜单都能打开快捷键设置；设置搜索命中该入口时跳转。两页的内容各自搜索，不接受主侧栏搜索对其内容的过滤。

CommandRegistry 为所有工作台可配置命令提供稳定 commandId、名称、说明、分类、平台默认绑定和允许上下文，包括主页面的搜索/菜单/活动栏、侧栏与底栏、标签/分组、导航、输出及终端命令。没有默认按键的命令也出现在快捷键设置页。内置输入编辑器中可配置的绑定通过适配器纳入同一清单，平台不可更改的浏览器行为只标注限制，不伪装成可改设置项。

偏好仅持久化覆盖项 `{commandId, platform, context, keys}`，以 profile revision 做 CAS；keys 为规范化按键序列，显式 null 表示取消绑定，删除覆盖项表示恢复默认。context 使用登记的上下文表达式，禁止执行任意脚本。显示有效值时合并默认与覆盖；插件/命令暂时不可用时保留覆盖并标记不可用，不自动套给其他命令。

快捷键页支持按名称、说明、commandId、组合键和上下文搜索，显示全部/已修改/未绑定项，录入和修改组合键、移除绑定、逐项/全部重置。冲突依据平台、按键和可同时生效的上下文判断，保存前显示受影响项；录键期间暂停普通命令分派，不抢占 IME 和浏览器保留键。修改通过校验并保存后立即更新 dispatcher、菜单与提示，失败显示未保存；跨窗口按 revision 同步，冲突不静默覆盖。

### 1.5 主题模式与菜单溢出

主题偏好为 `system | light-2026 | dark-2026`，system 分别映射到“2026 浅色/2026 深色”。主设计文档给出 VS Code Light 2026 / Dark 2026 的配色参考；本合同不固定色值、字体、间距或控件外形。外壳、Shadow DOM 菜单、内置设置页、输出和终端读取统一语义 token；SDK welcome 和后续 theme.changed 下发有效模式及允许的 token，插件可选择应用。

左上角不预留 logo/产品标题。顶级菜单按登记顺序尽量全部显示，按实际可用空间从末尾逐项移入“…”；只剩两个菜单加“…”时若仍不足，全部收入“…”。不显示一个菜单加“…”的过渡态。折叠/恢复只影响呈现，同一 commandId、快捷键和目标绑定不变；溢出结果不作为用户布局持久化。

## 2. 插件目录与 UI 能力探测

### 2.1 独立目录投影

新增 PluginCatalog，扫描已配置目录下直接子目录的 package.json，只读元数据，不导入插件、不执行 build 脚本。缺少 package、坏 JSON、坏 main、禁用原因均可形成诊断记录；现有 loadOne 对部分非法包只记日志，不能直接把它的数组当成完整目录。

```ts
interface PluginCatalogItem {
  pluginId: string;
  exportedName: string | null;
  packageName: string | null;
  title: string;
  description: string | null;
  presentation: {
    titleSource: 'export' | 'package-ui' | 'exported-name' | 'package-name' | 'directory';
    descriptionSource: 'export' | 'package-ui' | 'package-description' | null;
    exportState: 'current' | 'last-known' | 'unknown';
  };
  diagnostics: { code: string; message: string }[];
  version: string | null;
  enabled: boolean;
  runtime: {
    status: 'disabled' | 'starting' | 'ready' | 'unresponsive' | 'failed' | 'stopping' | 'stopped';
    pid: number | null;
    reason: string | null;
  };
  ui: {
    detection: 'declared' | 'runtime' | 'last-known' | 'unknown' | 'none';
    state: 'unknown' | 'none' | 'missing' | 'building' | 'ready' | 'error';
    entryUrl: string | null;
    buildCapability: 'supported' | 'absent' | 'unsupported';
    diagnostics: { code: string; message: string }[];
  };
  revision: number;
}
```

后端 runtime.status、runtime.pid 和 UI.state 是正交状态。构建中仍可有后端 ready；重建时有旧产物仍可打开旧页面。所有目录项都返回 runtime，包括 `ui.state=none` 的后端插件；只要进程存在就显示其实际 PID，不能以是否有 UI 作为显示条件。进程退出后清空当前 pid，旧 PID 只作诊断。API 不直接返回绝对磁盘路径、logger、handler 等进程内部对象。

### 2.2 新的可选静态元数据

现有 `SCWC.IHostedPluginHandler`（及继承它的公开插件类型）和隔离进程 Manifest 拟增加可选 `title?: string`、`description?: string`；现有导出 `name?: string` 继续表示插件唯一标识符，不改为必填展示名。宿主转交新字段，由 PluginCatalog 计算展示值，页面清单和管理清单复用同一解析结果。

插件 package.json 新增可选对象 `scwc.ui`，集中保存 UI 展示信息和静态页面提示，其中 `title`、`description` 均可省略。这里的 UI 展示信息也适用于无页面的后端插件；仅配置标题、描述不表示插件提供页面。现有入口导出的 `ui.entry` 合同不变：

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "description": "包级描述，可作为展示描述的降级值",
  "enabled": false,
  "main": "index.ts",
  "scwc": {
    "ui": {
      "title": "内容整理",
      "description": "浏览和整理收集的内容",
      "entry": "web/dist/index.html",
      "basePath": "/web/page/plugin/example-plugin/"
    }
  },
  "scripts": { "build:web": "vite build --config web/vite.config.ts" }
}
```

两处新增字段的解析顺序明确如下：

| 展示值 | 从高到低的候选 |
| --- | --- |
| title | 导出 `title` → `package.json.scwc.ui.title` → 导出 `name` → `package.json.name` → 插件所在文件夹名称 |
| description | 导出 `description` → `package.json.scwc.ui.description` → `package.json.description` → null（不显示描述） |

即先解析“新增标题/描述字段”（导出值优先，package 配置次之），再按用户要求降级到标识/包元数据。候选仅接受非空字符串，空白视为未提供，错误类型产生元数据诊断后继续降级；不从 README、命令说明、路径或插件分类猜测描述。无描述不显示占位文案。自动标签标题再按“自定义标签名 → 页面上报标题 → catalog.title”处理；展示标题重复不产生身份冲突。

静态扫描只读 package 字段，绝不为取导出字段而执行禁用或失败插件。已运行插件使用当前 manifest；未运行时仅可使用与包/入口指纹匹配的 last-known 导出元数据并标明来源，否则导出候选视为未知，按可获得的 package 字段与文件夹名降级。条目保留各候选来源和新鲜度供诊断，不能把已降级的旧 `IPluginMeta.name` 当成真实导出 name；Manifest 须分别保留原始可选导出值。启用/重载后重新解析并更新 catalog revision，不更换 pluginId。

静态 entry 约定为相对 package 所在目录；运行时旧 ui.entry 维持相对后端入口所在目录的现有规则。统一解析成真实绝对路径后比较，冲突时诊断，不把两种相对基准混为一谈。出于当前构建器合同，只接受现有受限 Vite 构建声明；脚本“存在”与“可执行”必须分别判断。

UI 入口探测单独处理：运行时有效入口声明权威高于静态提示；`scwc.ui` 只有 title/description 时仍不能据此确认页面存在。旧禁用插件没有静态入口声明时为 unknown；可以使用带版本指纹的最后已知能力帮助展示，但必须标明新鲜度，不承诺能打开。首次安装的旧禁用插件只能启用后完成运行时探测，不能通过正则/AST 猜 ui.entry，也不能为检测执行其入口。

目录扫描使用短期缓存与显式刷新；生命周期完成和构建发布后定点失效。文件监视作为加速信号，不代替服务端重查。包元数据指纹变化时 last-known 失效。

### 2.3 启用、停止、重启与构建

HTTP 操作调用现有 enablePlugin/disablePlugin/reloadPlugin/buildPluginWeb，并拟新增 onceDisablePlugin：临时停止当前后端而不写 enabled，下次核心启动仍按包中的 enabled 决定启用。临时停止继续卸载注册、终止宿主并清理连接，其状态为 stopped；持久禁用仍先保存 enabled=false，其状态为 disabled。保留同插件生命周期串行、目录 ID 校验、启用写回失败回滚与卸载清理规则。跨生命周期和构建操作需要共享插件操作锁，避免停止/删除与构建发布并发。

新增异步 Job：`queued/running/succeeded/failed/cancelling/cancelled`，记录 jobId、pluginId、类型、阶段、日志流、发起方与订阅者，HTTP 立即返回 202。重复点击携带相同 idempotencyKey，返回同一 Job。

构建继续全局串行、同目录合并，不能因 Web 新入口改成无界并发。现有 pending Promise 的取消信号来自首个调用方：若直接复用，首个页面离开可能取消其他订阅者的构建。因此取消要升级为 Job 所有权/订阅模型：关闭查看窗口只取消订阅；“取消构建”是显式共享任务操作，展示影响，核心退出才统一取消。

“启用时检查并构建”建议调整如下：

1. 宿主初始化取得 UI 声明，检测已发布产物；必要时沿用隔离构建器准备 UI。
2. UI 失败记录为 ui.error，并继续插件 onLoad 的后端启动机会；核心把 UI 能力与后端激活分别报告。
3. 插件自身 onLoad 如果依赖 UI 文件而失败，照常判后端失败，不伪造 ready。
4. enablePlugin 仅在后端成功并持久写 enabled 后返回成功；响应可带 UI 警告。构建失败不伪造“页面可打开”。
5. 重建成功刷新 handler 的 HTML 快照与 catalog revision；已有标签提示“新 UI 可用”，默认不自动刷新脏页。

这要求改动当前 host 的 prepare-web 初始化交互和 load.ts 的 ensurePluginWeb 失败传播，增加显式结果而非只在 Web HTTP 层 catch。原有启动测试须相应补充，验证后端/UI 分离不改变真正 onLoad 失败的处理。

插件停止时保留工作台逻辑标签，遮罩显示已停止并释放 iframe 连接；重启后重新取 safeId，旧 API/WS 连接不复用，按状态恢复协议重建。停止不删除配置、收藏或历史。

## 3. 后端模块和 HTTP API

建议新增以下服务，由 Web HTTP 和 CLI 适配器共用业务层：

```text
projects/server/workbench/
  catalog.ts              目录投影、UI 能力和诊断
  operations.ts           生命周期/构建 Job 与幂等
  workspace.ts            工作区、租约、收藏、统一关闭标签历史
  plugin-config.ts        独立配置 DB、定义与校验、revision
  page-sessions.ts        页面授权、实例归属和能力
  command-service.ts      核心命令执行、补全、取消、恢复状态
  invocation-broker.ts    CLI/Web 输入与输出归属
  notifications.ts        工作台通知入库与去重
  events.ts               事件序号、订阅、背压与补流
  storage/                迁移、事务、清理、快照与日志
projects/server/router/web/workbench/  HTTP 和 WS 适配
```

API 前缀统一为 `/web/api/workbench`，使用既有 `{success,message,data}` 响应；增加稳定 `code`、请求 ID、revision，错误不依赖解析中文 message。列表支持 cursor、limit、过滤条件；分页 cursor 绑定排序和过滤。

| 方法与相对路径 | 输入/结果 | 权限与一致性 |
| --- | --- | --- |
| GET `/bootstrap` | installationId、coreBootId、能力、目录/设置 revision、profile、租约 | 工作台鉴权，不返回插件 handler |
| GET `/plugins` | 完整 catalog 分页/筛选 | 支持 ETag；默认返回全部发现项 |
| POST `/plugins/rescan` | 返回扫描 Job | 只重读配置目录，不导入禁用插件 |
| POST `/plugins/:id/actions` | action=enable/disable/once-disable/reload/build-ui、幂等键 | 202 Job；禁止提交磁盘路径或任意命令 |
| GET `/jobs/:id` | 状态、阶段、日志 cursor | 可重连查询 |
| POST `/jobs/:id/cancel` | 预期 revision | 明确共享影响；可取消性由执行阶段决定 |
| POST `/url/resolve` | 完整 URL/相对路径、当前 pluginId | 返回插件、canonical URL 与诊断；不跟随外部 URL 抓取 |
| GET `/workspaces/:id` | 完整 WorkbenchLayout、标签、revision | 关闭历史另按 profile 统一查询；不含运行时对象 |
| POST `/workspaces/:id/save` | 快照、baseRevision、lease、幂等键 | CAS 冲突 409；保存完整结构 |
| POST `/workspaces/:id/close-tabs` | 已确认关闭的 tabIds、状态/预览引用、baseRevision、lease、operationId | 原子移除逻辑标签并仅为插件标签写关闭历史；重试不重复记录 |
| POST `/workspaces/:id/lease` | 领取/续期/释放 | 连接身份校验；重复窗口触发克隆 |
| GET/POST `/preferences` | 工作台偏好、主题模式、快捷键覆盖/重置 | 字段白名单、revision CAS、版本迁移；重置删除覆盖 |
| GET/POST `/bookmarks` | 搜索/创建收藏 | 精确 URL、稳定 pluginId、可选快照引用 |
| POST `/bookmarks/:id/update`、`/delete` | 更新、删除 | revision；删除不关闭标签 |
| GET `/history`、POST `/history/delete` | profile 内统一关闭标签列表、分页/筛选与清理 | closeId 稳定；不提供导航访问 append 入口 |
| POST `/history/restore` | closeIds 或关闭 batchId、目标 workspace/group、baseRevision、lease、operationId | 恢复原 URL/状态并标记 restoredAt，不产生新关闭记录 |
| GET `/plugins/:id/config` | 定义、覆盖值、有效值、revision | 绑定插件命名空间；值为字符串 |
| POST `/plugins/:id/config/definitions` | 注册/更新声明式定义 | page grant 或插件宿主身份；见第 5 节 |
| POST `/plugins/:id/config/update`、`/reset` | 批量字符串值/键、baseRevision | 原子校验、CAS、广播；reset 删除覆盖值 |
| POST `/page-sessions` | tabId、文档代次、已解析插件 URL | 签发短期页面 grant；绑定 workspace 与插件 |
| POST `/snapshots`、GET `/snapshots/:id`、POST `/snapshots/:id/delete` | 页面 JSON 状态或图片二进制 | 所属校验、大小限制、无任意远程图片抓取 |
| GET/POST `/terminals` | 查询/新建/保存元数据 | 独立 Web 终端身份 |
| POST `/terminals/:id/close`、`/clear-output`、`/clear-history` | 明确范围 | 忙终端需先处理执行；清理操作不混淆 |
| GET `/terminals/:id/output` | 按 seq 分页输出 | 支持范围与保留截断标记 |
| POST `/commands/execute`、`/complete`、`/cancel`、`/input` | 结构化请求 | 所属校验、幂等、任务状态由服务端维护 |
| GET `/notifications`、POST `/notifications/ack`、`/delete`、`/publish` | 列表、已读、删除、页面通知 | 来源由服务端赋值，publish 需页面 grant |
| POST `/stream-ticket` | 单次短期 WS ticket | 防止把长期 TOKEN 放 WebSocket URL |

第一版用 POST 承载写操作，兼容当前服务公开的 GET/POST/OPTIONS 方式；如果改用 PATCH/DELETE，应同步中间件和预检允许方法。新增工作台 API 的 JSON 限额建议 1MiB，图片上传单独二进制接口，不沿用全局 100MB JSON 上限。

### 3.1 连接和授权

工作台保留现有“先 loadLocalConfig，再创建布局”的启动顺序；后端实际监听端口来自服务而非旧配置。现有 local-config 同时检查请求 Host、Origin/Referer、socket 实际端口，前端也要求返回连接 origin 等于页面 origin，因此不能简单通过 Vite 反向代理它，更不能改写来源头绕过检查。

建议开发时也用核心的实际 origin 打开 `/web`：把当前“重定向到 Vite”改为核心仅代理工作台 HTML/构建资源到回环 Vite，API、插件页、资源和 local-config 继续由核心处理。Vite 的开发 base 调整为 `/web/`，HMR 使用独立 `/web/__vite_hmr` 升级路径，通过中心 UpgradeDispatcher 转发；不能把整个 `/web` 无差别代理回去。这样本机启动配置的安全条件保持一致，宿主与插件 iframe 也同源。

如保留直接访问 Vite 的可选调试模式，应使用显式手动连接配置和明确开发 origin 白名单，不让自动 local-config 向其他端口放宽发放主 TOKEN。两种开发入口要分别测试，不能假设生产 bootstrap 在代理下自然可用。

工作台管理 API 需要管理凭证和严格 Origin 检查，不能仅因 URL 位于 `/web/*` GET 就跳过鉴权。现有核心中间件对 `/web/api` 已保持鉴权，新增接口须置于这一边界内。`site` 是兼容来源参数，不是授权凭证；新增管理入口不以仅比较 hostname 的 isSameDomain 作为完整来源校验。

WebSocket 使用 POST 领一次性 ticket（建议 30 秒、绑定 origin/clientWindowId/能力），握手消费。只存内存、不进入收藏或输出。插件 scoped grant 仅允许本插件 API、配置、通知和页面状态操作，不允许启禁其他插件或创建命令执行。grant 失效后回宿主重新获取，不能把全局 TOKEN 通过 `*` 下发。核心鉴权层需新增独立 grant 验证分支，将票据绑定到精确路由、pluginId 和当前 safeId；不能把 grant 当成与主 TOKEN 等价的 Bearer。旧客户端的主 TOKEN 合同在兼容期保留。

当前同源插件是受信代码：能够访问同源浏览器资源。消息校验和 scoped grant 可防止误路由及陈旧实例，不构成恶意插件隔离。若将来支持不受信 UI，必须单独 origin、独立凭证和受限能力网关；同源 iframe 加 `allow-scripts allow-same-origin` 不能作为安全隔离保证。

### 3.2 事件流与升级路由

工作台 WS 路径建议 `/web/websocket/workbench`。当前 PluginWebSocketRegistry 对未匹配的 upgrade 会直接 404，不能简单新增第二个 server.on('upgrade')。应先设中心 UpgradeDispatcher，由它按路径唯一分派到工作台或插件 Registry，其余路径只拒绝一次。

```ts
interface WorkbenchEvent<T> {
  version: 1;
  eventId: string;
  coreBootId: string;
  stream: string;
  seq: number;
  type: string;
  entityId?: string;
  revision?: number;
  payload: T;
}
```

事件包括 catalog.changed、job.changed、workspace.changed、history.changed、preferences.changed、config.changed、notification.created/updated、terminal.output、execution.started/returned/finished、input.requested/closed、connection.resync-required。关闭标签和对应历史变更只能在同一事务提交后发布。

每个 stream 有单调 seq；终端输出 seq 持久化，实体变化用 revision。重连附各 stream 最后确认 seq，在保留范围内补流；超范围返回 gap 并加载快照，明确遗漏，不假装无丢失。coreBootId 变化时先同步快照，旧运行请求标记中断，不重放 execute。

输出批次建议每 50ms 或 32KiB 推送；单条文本上限 64KiB，超长按有序分块保存。连接有界发送队列建议 2MiB；慢客户端先收到 gap/resync-required，必要时断开重连。配置/任务完成事件不能越过对应已入库输出，协议确认与顺序不得因前端动画延迟改变。

### 3.3 页面路由与发布兼容

页面资源解析需统一为受管理 UI 根目录内的真实路径，解码和规范化后检查边界，已有文件也要防止符号链接逃逸；不因 URL 含 `/web/page/plugin/` 就允许任意磁盘访问。entry、静态产物、SPA 导航分别处理，保留插件现有 basePath 合同。

当前“末段不含点才回退 SPA”无法支持含点的合法路由。建议插件元数据明确 spa 与 assetPrefix，先命中真实静态文件，仅在声明为 SPA、请求接受 HTML 且不属于资源前缀时回退 entry；缺 JS/CSS/图片保持 404，不能错误返回 HTML。错误页携带受信 bootstrap 错误状态，供宿主区分业务 ready 与错误文档。

新 SDK 先向后兼容旧 fetch/resource/websocket，再逐步启用工作台桥接。引导、文档类型、SDK 协议版本与插件 UI 构建版本分开；协议不兼容时显示能力受限而非静默丢消息。发行构建继续把工作台与 webutils 产物纳入现有两种运行时打包流程，运行数据始终在 ENV_DIR，不写临时资源目录。

## 4. 插件页面 SDK 与实例桥接

### 4.1 启动握手

新增 `scwcutils.ready` Promise，插件在其完成后使用扩展能力。服务端将 SDK 引导放在应用脚本之前；对 HTML 使用可靠解析/插入方式，处理大小写、缺少 body、深链和 CSP，不继续仅替换小写 `</body>`。注入逻辑保持幂等。

1. 宿主注册 tabId、当前 URL、预期 pluginId、frameEpoch 和 iframe.contentWindow，获得绑定的 pageSession。
2. 子页 `hello` 只传协议版本、随机 documentNonce、SDK 版本和能力，不传主 TOKEN。
3. 宿主校验 event.source 为当前 iframe.contentWindow，event.origin 为预期精确 origin，URL 解析属于该插件；把当前文档 nonce 绑定到 frameEpoch。
4. 宿主使用精确 targetOrigin 发送 welcome，转交 MessageChannel 的 port；包含分配的身份、主题、可见性、能力、短期 grant 与配置 revision。
5. 子页只接受 parent 与预期 origin 的 welcome，绑定 nonce 和当前代次，回 ready；其余 RPC 通过专用端口。
6. 后续文档 load/pagehide、端口断开、导航或宿主重建使旧通道失效。每个新 document 必须重新握手；跨文档导航前由宿主发起时提前递增代次，不等 load 才清理旧能力。

未知 hello、旧 nonce、错 origin、错 source、失效 pageSession 直接拒绝。握手建议 5 秒后显示兼容模式而非永远遮挡页面；用户可重新握手或刷新。旧协议单独适配且不接受任意来源的配置消息；同页只由一个初始化状态机写入 fetch/resource/websocket，避免当前 load 与 message 的异步竞争。

postMessage 应检查发送者并指定精确 targetOrigin；函数和 DOM 节点不能通过 structured clone 传递。因此 SDK 的函数注册必须保留在页面，传输的是数据与回调 ID。[postMessage 依据](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)、[structured clone 依据](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)

### 4.2 RPC 信封与 API 范围

```ts
interface PageEnvelope {
  protocol: 'scwc-workbench';
  version: 1;
  kind: 'request' | 'response' | 'event' | 'cancel';
  requestId?: string;
  method: string;
  tabId: string;
  frameEpoch: string;
  sequence: number;
  payload: unknown;
}
```

身份由宿主绑定，不以插件自报 pluginId、tabId 作为授权。请求默认 5 秒，可取消；配置保存、状态保存各有独立期限；限制单帧并发 32、普通消息 256KiB、注册项 200、属性项 100，图片通过独立有界二进制传输。异步回调回传时再次检查代次、请求 ID、schemaRevision，不能写入后来激活的页面。

| 拟新增 SDK | 作用 |
| --- | --- |
| `ready`、`host.capabilities` | 完成初始化，协商宿主/独立页能力 |
| `page.register/update` | 标题、脏状态、只读属性、contextKey、页面能力 |
| `page.onVisibility/onFocus` | 工作台可见与输入焦点通知；区别于浏览器 document.visibilityState |
| `navigation.report/navigate/registerAdapter` | 路由变化、宿主导航、SPA 路由适配 |
| `settings.register/update/dispose` | 该实例动态注册配置展示定义及本地函数 |
| `search.register` | 可选注册该页面的异步分页搜索函数；返回释放句柄，主页面通过桥接调用并展示结果 |
| `config.get/set/reset/subscribe` | 有效字符串值、revision、CAS 与更新订阅 |
| `lifecycle.register` | suspend/resume/serialize/restore/canLeave/capturePreview 回调 |
| `activity.acquire/release` | 页面保活句柄、上传/播放/交互原因；句柄需释放，有诊断上限 |
| `logger.info/success/warn/error` | 向工作台发送通知，来源由宿主固定 |
| `requests.track` | 包装 SDK fetch 的请求状态；额外请求可显式登记 |
| `host.executeCommand` | 仅允许的工作台页面操作，例如打开另一个插件 URL；不执行后端命令 |

现有 `fetch/resource/websocket` 保留。fetch 使用授权适配并报告请求 ID、状态和时长；safeId 变化时重新获取，不把 safeId 放进持久记录。对动态函数只发 callbackId，并在文档销毁时释放 Map；禁止 Function.toString、eval、new Function。

### 4.3 独立浏览器页面

无 parent 的插件页通过独立适配器初始化基础连接和 scoped grant，继续支持 fetch/resource/websocket、后端配置和通知。工作台标签操作、焦点面板等 capability 为 false，调用返回明确 unsupported。插件使用 ready/capabilities 判断，不依赖一个隐藏的工作台存在。

独立页面可通过后端事件流接收配置更新；其配置与工作台内同插件共享。不会把 opener 当成可信 parent；外部打开默认 noopener，通信仍通过后端适配器。

### 4.4 可选页面搜索与分页

插件页面可在 ready 后调用 `scwcutils.search.register({ search })`，不调用则没有页面内容搜索能力。工作台握手以 `host.capabilities.search` 声明宿主支持注册与调用，页面是否已注册另行维护。独立浏览器页没有主页面搜索宿主，该 capability 为 false，注册返回明确 unsupported。函数保留在当前页面 callback Map，宿主得到 callbackId 与 registrationRevision，通过已有实例端口请求；不把函数源码、AbortSignal 或闭包传到父页面或后端。

```ts
interface PageSearchRequest {
  query: string;
  cursor: string | null; // 首批为 null，后续原样传回提供方的游标
  limit: number;
  signal: AbortSignal; // SDK 在页面本地创建，由 cancel 信封驱动
}

interface PageSearchResult {
  id: string; // 在该来源、该查询内稳定
  title: string;
  description?: string;
  url?: string; // 可选的本插件页面定位；缺省时定位来源标签
}

interface PageSearchBatch {
  items: PageSearchResult[];
  nextCursor: string | null; // null 表示结束，不能只按 items.length 推断
  total?: number; // 可选，仅供提示
}

type PageSearchHandler = (request: PageSearchRequest) => Promise<PageSearchBatch>;

interface PageSearchRegistration { dispose(): Promise<void> }
interface PageSearchAPI {
  register(options: { search: PageSearchHandler }): Promise<PageSearchRegistration>;
}

await scwcutils.ready;
const registration = await scwcutils.search.register({
  search: async ({ query, cursor, limit, signal }: PageSearchRequest): Promise<PageSearchBatch> => {
    // 插件可等待网络、数据库 API 或异步计算；示例代表插件自己的实现。
    return await searchPluginContent({ query, cursor, limit, signal });
  },
});
// 页面不再提供搜索时 await registration.dispose()。
```

每个文档代次最多一个注册；重新注册递增 registrationRevision、取消旧请求并释放旧回调。dispose、导航、端口断开、标签关闭和 iframe 卸载都解除能力。搜索期间临时保护来源不被自动休眠，结束后释放；已经休眠的页面不自动唤醒，只展示来源不可用或由用户显式唤醒后重试。没有 UI 的插件、未打开的插件和未接入 SDK 的页面仍可通过 catalog 元数据搜索，不会为业务内容搜索创建隐藏实例。

主页面的顶栏/主侧栏搜索与中心搜索页共用 SearchCoordinator：本地/后端元数据结果与在线页面结果分别聚合，默认选取本工作台已连接并注册搜索能力的页面，也可限定当前页面。一次查询生成 queryId 和来源快照；每个来源以 `(tabId, frameEpoch, registrationRevision)` 标识，同插件多标签不合并成一个来源。结果显示插件标题、来源页面及命中内容。

分页规则：

1. 每个来源单独保存当前 query、nextCursor、加载状态和已返回 ID；首批 cursor=null，加载更多原样传回该来源的游标，不能混用不同页面的游标。
2. 游标为提供方不透明值，须绑定该查询与其数据版本；数据变化导致游标失效时返回 stale_cursor，主页面提示从首批重试，不拼接不同数据版本。total 缺省时仍可正常分页。
3. 每来源同一 cursor 最多一个在途请求；结果以 `(来源, queryId, result.id)` 合并去重，重试不重复追加。同插件不同标签的同名结果保留来源，相关性由来源自身排序，宿主不比较不同插件自定义分数。
4. nextCursor=null 为结束；非空游标须推进。空结果但仍有下一页时保留“加载更多”，不无限自动拉取；重复游标/格式错误终止该来源本次分页并显示错误。
5. 关键词、来源范围或注册版本变化时取消旧查询并重置游标；切换焦点不把旧来源结果冒充新来源。清空/退出搜索、标签导航/关闭均发送 cancel。SDK 触发本地 signal.abort；即使插件忽略取消，宿主仍按 queryId、requestId、代次和注册版本丢弃迟到结果。

调用支持异步 Promise，使用独立可取消搜索期限（建议每批 10 秒），不要求同步完成。limit 建议默认 50、上限 100；响应仍受普通桥接单消息限额约束。一个来源失败或超时只影响自身，可用同一游标重试，其余来源继续展示。搜索结果是纯文本/受验证 URL，不接受 HTML 或任意 action 函数；URL 按第 6 节解析并限定本插件归属。点击结果由宿主导航/打开标签或聚焦来源，再执行离开检查。

注册、查询、游标和结果均为运行时数据，不写入收藏、关闭历史、布局或配置数据库；只有用户明确打开的页面参与工作区状态。设置与快捷键设置的搜索不通过此接口，也不作为插件搜索来源。

## 5. 插件配置：扁平字符串 KV 与动态 UI

### 5.1 存储语义与作用域

独立 SQLite 数据库已实现于运行时 data 目录的 `scwc/plugin-config.sqlite`，默认 `ENV_DIR/data/scwc/plugin-config.sqlite`。`SCWC_DATA_DIR` 可指定运行时 data 目录，相对路径按 ENV_DIR 解析；配置库始终位于其 scwc 子目录。数据库不能借用 Redis 缓存或现有终端状态，核心/页面关闭不清空。

业务值表只存字符串键和值：

```sql
CREATE TABLE config_values (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL CHECK(typeof(value) = 'text'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
CREATE TABLE config_revisions (
  plugin_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL
);
CREATE TABLE config_definitions (
  plugin_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  descriptor_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, definition_id)
);
```

定义是元数据，descriptor_json 只保存可验证的声明，不保存 JS 源码或闭包。配置值仍无嵌套对象、数组或数据库动态列。若插件想在某个值里存 JSON，那也是一个普通字符串，核心不自动展开。

示例键：`global.view.pageSize`、`resource.album_42.sort`、`instance.<tabId>.preview.mode`。点只用于约定和界面分组，数据库不按点拆层；`global.a` 与 `global.a.b` 可以并存。资源 contextKey 由插件提供稳定资源标识，不能默认用完整 URL 作为键，防止无界增长及 URL 变化丢配置。

插件共享配置以 pluginId 为命名空间，所有页面/窗口共享；同一资源的键可以被多个页面共同订阅；实例键仅该 tabId 使用。定义里明确 storageKey，宿主校验它属于当前插件及允许作用域；单个页面不能越权读取其他插件。

### 5.2 注册模型与函数边界

```ts
await scwcutils.ready;
const registration = await scwcutils.settings.register({
  schemaId: 'gallery.preferences',
  schemaVersion: '1',
  contextKey: 'album_42',
  items: [{
    id: 'pageSize',
    key: 'global.view.pageSize',
    label: '每页数量',
    description: '影响所有图库页面',
    control: 'number',
    defaultValue: '40',
    rules: { codec: 'integer', min: 10, max: 200 },
    validationPolicy: 'page-required',
    format: (raw: string) => `${raw} 项`,
    normalize: (input: string) => String(Number(input)),
    validate: (raw: string) => Number(raw) % 10 === 0 || '请输入 10 的倍数',
  }],
});
const current = await scwcutils.config.get(['global.view.pageSize']);
await scwcutils.config.set({ 'global.view.pageSize': '60' }, { baseRevision: current.revision });
scwcutils.config.subscribe(['global.view.pageSize'], (change) => {
  // 在插件自己的组件状态中应用 change.values；不再次写回同一个值。
});
// registration.update(...) 动态增删项；registration.dispose() 解除该实例展示注册。
```

这段 API 是设计示例，须在新增类型实现后使用。控件支持 text、textarea、number、switch、select、color、readonly；编辑器内部可以使用布尔/数值，但提交给 config API 的每个 value 必须显式编码为字符串。布尔约定 `'true'/'false'`；数值禁止 NaN、Infinity 与歧义格式；空字符串是有效值，reset 通过操作表达，不用 null 假装字符串。

format 仅影响显示；normalize 生成候选字符串；validate 返回 true 或错误文本。三个函数留在注册页面的 callback Map，由 SDK 提供 RPC 执行。声明式 rules 提交后端，后端始终重新校验，不依赖主页面已经显示“通过”。

任意自定义函数无法自动搬到服务端，需要明确的三种策略：

| validationPolicy | 权威校验 | 页面不在线时 |
| --- | --- | --- |
| declarative | 后端声明式规则；页面 validate 为交互预校验 | 可以编辑，界面注明额外页面提示不可用 |
| page-required | 后端基础规则 + 当前绑定页面回调的校验回执 | 需要原页面在线；不可用则只读/唤醒，不能跳过 |
| backend-required | 后端基础规则 + 插件隔离宿主配置验证 hook | 宿主可用即可；宿主停止则只读/等待启用 |

前端自定义约束若必须强制生效，应声明 page-required 或 backend-required。安全相关、跨页面一致的业务规则使用 backend-required；页面回执不是恶意客户端防线。

已提供 `onLoad` 的 `context.config` 字符串 CRUD 对象（详见[接口文档](Web后端接口.md#5-插件后端配置对象)），可长期持有，与页面共用持久值和订阅。另有插件后端可选 `configuration` 扩展，提供 canonical definitions、normalize/validate 和配置变化订阅。函数留在插件 host，manifest 只传能力及定义 ID；核心以受限 RPC 调用。旧插件无此扩展也能用声明式配置。

相同插件/键的多个页面必须注册兼容的默认值、codec、规则与 schemaVersion；冲突返回 definition_conflict，不以“最后聚焦页面”悄悄覆盖全局默认值。实例/资源特有条目使用不同 storageKey。默认值变化作为版本化定义更新，不覆盖已有用户值。

### 5.3 保存、重置与双向更新

写路径统一为：身份/作用域校验 → schemaRevision 校验 → normalize → 后端声明式规则 → 所需自定义验证 → SQLite 事务 CAS → 更新值和 plugin revision → 提交事务 → 广播 config.changed。

自定义验证在事务外进行，不能等待页面回调时持有 SQLite 写事务。验证票据绑定 pluginId、key/value 摘要、schemaRevision、baseRevision、frameEpoch 和一次性 nonce，建议 5 秒失效；进入事务重新检查这些版本，漂移就返回冲突并重新校验。禁止使用 A 页对旧值的通过结果保存 B 页的新值。

第一版采用每插件 revision，批量更新原子成功或失败。冲突返回当前 revision、变化键和值；前端对未改动键自动合并，正在编辑且两端同时变动的键要求选择覆盖或接受远端。revision 粒度偏保守但行为简单，后续可升级逐键版本。

reset 删除覆盖值，立即采用当前已发布定义的 defaultValue；同样递增 revision、记录变更和广播。默认值不复制成覆盖值，便于识别用户修改。服务端在新 key 首次定义前不能假造默认值，响应标记 undefined-definition。

配置变化事件包含 originRequestId、pluginId、changedKeys、effectiveValues、revision。页面、主界面、独立页面和插件后端都订阅同一个服务；接收方只应用新 revision，不将收到的值再次写回形成循环。断线后先取快照再追事件，重复事件可忽略。

动态增删项仅改变本实例展示 schema，使用递增 schemaRevision 完整替换或有序 patch。删除项不会删除用户值；隐藏项也不能隐式重置。插件升级时已存值不符合新规则，显示“旧值需修复”，不自动改写。主动清理弃用键需要显式迁移操作及可恢复备份。

限制建议：key 长 1–200 字符，value 最大 64KiB，每插件最多 2000 个覆盖键；拒绝控制字符和危险原型键构造，内部使用 Map，不把点分键展开到 JS 对象。只读定义由后端拒绝写入，界面禁用不是唯一防线。

## 6. 导航、URL、加载与网络观测

### 6.1 URL 归属

解析器使用 URL 对象，接受当前安装 origin 与 `/web/page/plugin/:pluginId/` 的明确路由。只解码插件路径段一次，拒绝编码分隔符、点点路径、凭据 URL 和非法插件 ID；按配置目录解析当前插件，不按名字包含关系匹配。服务端不根据用户输入外部 URL 发请求，不引入 SSRF 代理。

收藏保留完整的业务 URL，同时保存 locator。核心端口改变且 installationId 一致时，打开时依据 locator 生成新的运行地址；原始 savedUrl 保留作审计。不同安装不自动改 origin；跨插件重绑定由用户明确选择。`site` 等框架来源参数由请求适配器独立生成，不递归包裹整条父页 URL。

### 6.2 独立导航栈

每标签维护 `{entryId,url,title,stateRef,navigatedAt}` 与 index。新导航截断 forward，replace 只替换当前项；刷新不 push，后退/前进移动游标；加载失败保留目标与最近成功地址，明确显示失败，不能把错误页 URL 替换收藏目标。该栈只服务本标签后退/前进，导航确认不向全局关闭历史写记录。

**不通过 `iframe.contentWindow.history.back()` 实现标签内历史。** iframe 与父页面的原生会话历史可能共同线性化，简单回退可能影响其他分组或宿主。工作台按钮遍历自己的地址栈，SDK 的 router adapter 接收目标 URL 并按 replace 方式导航；跨文档使用 location.replace/重建文档，不重放任意 POST 或业务动作。[HTML 会话历史依据](https://html.spec.whatwg.org/multipage/browsing-the-web.html)

SDK 在应用代码之前安装 pushState/replaceState、popstate、hashchange 和 pageshow 观察；插件优先接入 router adapter。宿主控制跳转携带 navigationId，回报匹配后确认，防止 report 触发重复 push。恢复后保留工作台导航栈，浏览器原生历史不要求与之相同。

普通锚点可由 SDK 拦截并交给宿主；跨插件先解析。对未被观察的 location.assign、服务端重定向或应用自定义导航，在下一次 hello/ready 根据实际地址对齐；观察范围不完整的旧页面标记兼容模式。地址回报不替代服务端归属和源校验。

离开检查只在确有脏状态时触发；普通路由、关闭、刷新、插件跨页跳转和休眠都经过同一个 canLeave 合同。宿主最终关闭不必依赖 beforeunload，周期状态保存与 UI 操作事务更可靠。

### 6.3 加载与停止

加载状态：`idle/navigating/document-loaded/ready/stopping/stopped/error/bridge-unavailable`。每次 navigationId 与 frameEpoch 绑定；load 仅代表文档事件，ready 才表示 SDK 与应用认可可用。错误页注入受信 bootstrap 状态；入口缺失、插件停止等在发起导航前由 catalog 提供明确错误。

“停止加载”包括宿主可调用的同源 window.stop 或 SDK stop，以及该 navigationId 下 SDK 管理的 AbortController。它不代表能取消所有应用请求，更不取消已经在后端执行的业务任务；后端取消必须单独按 executionId/taskId 请求。不可访问或未接管时禁用停止并解释。[window.stop 依据](https://developer.mozilla.org/en-US/docs/Web/API/Window/stop)

### 6.4 网络状态的诚实范围

默认统计 SDK fetch 的请求数、成功/失败、时长及受管 WS 连接；不记录凭证、请求体或 URL 中敏感参数。原生 fetch/XHR、图片、Worker、跨域媒体不保证全部覆盖。额外提供 requests.track 接口供插件登记，诊断展示“已观测 N 个请求”，不能声称“浏览器所有网络请求”。

不全局劫持所有 fetch/XHR 来强行计算网络空闲；这可能改变插件行为。加载完成与网络空闲分开，持续轮询或 WS 不让刷新按钮永久变成停止。

### 6.5 统一关闭标签历史

历史仅保存已实际关闭的 `kind=plugin` 逻辑标签，所有插件、同 profile 的工作区共用一个列表。每条记录包含 `closeId, operationId, batchId, profileId, workspaceId, tabId, pluginId, closedAt, restoredAt`，以及关闭时的标题、精确 URL/locator、原组与顺序、标签状态、快照及预览引用。同一 URL 的独立实例或不同关闭时间各有记录，不按 URL 去重。

宿主先完成固定保护、脏页 canLeave 确认和有界状态/预览获取；仅把最终实际关闭的标签提交 `/workspaces/:id/close-tabs`。服务端验证 lease、baseRevision、标签归属与 operationId，在同一 SQLite 事务中移除逻辑标签、折叠分组、写入符合条件的关闭记录、前移 revision，再返回结果。`(operationId, tabId)` 唯一，HTTP 重试或事件重投不重复追加；部分标签取消关闭时只记录实际关闭部分。普通 `/save` 不允许绕过关闭事务删除既有插件标签。

离线关闭先把关闭意图、必要快照与新布局一起写入本地待同步日志，并显示未同步；重连使用同一 operationId 提交，CAS 冲突时保留本地记录并明确合并，不静默丢失关闭历史。不能靠浏览器 unload 或 iframe pagehide 判断用户已关闭逻辑标签。

打开、激活、导航、刷新、休眠/恢复、iframe 因故障重建、插件停止但标签保留，均不写关闭历史。内置设置、快捷键设置、搜索等标签和终端关闭也不写入；浏览器刷新/关窗后将恢复的标签不视为已关闭。终端执行的命令历史和终端归档是不同数据。

`GET /history` 按 profile 查询完整统一列表，默认关闭时间倒序，支持插件、工作区、时间、标题/URL 条件及游标分页。恢复操作可选单条或 batchId；恢复原 URL、标题、可恢复状态与分组顺序，原组缺失或来自其他工作区时使用当前组。未占用的 tabId 可复用，否则分配新 ID；原关闭记录标记 restoredAt，恢复不新增历史。再次关闭形成新的 closeId。“恢复最近关闭”从同一列表选择最近未恢复批次，不维护第二套最近关闭数据。

默认保留 90 天/10000 条，可配置；删除/范围清理/清空同步更新搜索投影和快照引用，仅清理无其他引用的预览。导航栈、收藏的最近打开时间和标签 lastFocusedAt 可保留各自用途，但不能生成浏览访问历史表。

## 7. 页面状态、预览与休眠

### 7.1 可恢复状态合同

插件通过 lifecycle.register 提供 canLeave、onSuspend、onResume、serialize、restore、capturePreview。serialize 返回 `{schemaVersion,pluginVersion,contextKey,revision,data}`，data 限制为 JSON，建议每页最多 256KiB；若编辑内容大，插件先自行存业务草稿，只返回 draftId。

状态 snapshot 包含 pluginId、tabId、URL、frameEpoch、schemaVersion、插件版本、保存时间、checksum 与 JSON 数据。主界面保存滚动位置等通用状态只作辅助；嵌套滚动、编辑器和复杂列表的恢复由插件控制。snapshot 不保存 access token、临时 grant、任意 DOM 或可执行函数。

建议插件在重要草稿变化时节流发送 state checkpoint；宿主约 2 秒合并持久化。不要只依赖关闭瞬间的 serialize，浏览器可能直接丢弃整页而不给最后保存机会。[生命周期依据](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

### 7.2 休眠事务

1. 调度器选择后台 LRU 页，重新检查可见性、dirty、保活句柄、执行/上传和恢复能力。
2. 分配 transitionId 并标记 hibernating；用户激活或状态变化能取消这次转换。
3. 调用 onSuspend/serialize，默认最多等待 2 秒；返回状态后核对 transitionId、frameEpoch、state revision。
4. 保存状态并收到后端或本地持久日志的明确成功回执；如需预览，有独立短期限，失败可跳过。
5. 再次检查页面仍后台、未出现新 dirty revision；随后关闭 port、取消受管请求、解除监听和引用，从实例池删除 iframe，标记 hibernated。
6. 若状态写失败、保存期间又有编辑、超时或用户切回，保留 iframe，发 resume，记录本次未休眠原因。后台保存回执晚到不能卸载已经重新激活的页面。

恢复时先显示最近预览 → 创建新 frameEpoch → 解析当前插件/safeId → 加载并握手 → 获取最新配置 → restore(snapshot) → 应用滚动 → ready。配置先于恢复传递，插件决定如何处理旧草稿与新配置冲突；恢复成功后才移除遮罩。

同时最多恢复两个后台实例，可见且聚焦的页优先。快照版本不兼容时保留旧快照，提供插件迁移回调、导出草稿、或明确选择重新加载；不能自动丢弃未保存草稿。旧后端任务通过 taskId 重新订阅，不从状态自动 execute。

### 7.3 截图与预览

浏览器没有把任意 iframe 直接转成可靠截图的通用页面 API。建议分层：

1. 插件提供 capturePreview：在插件内部使用适合其业务界面的渲染方式，返回 Blob 及实际 URL/时间/尺寸；优先遮蔽敏感控件。
2. 对支持的 DOM 可研究受限的 DOM 转图适配器，但需单独评估样式、字体、canvas、跨域媒体和虚拟列表，不能承诺像素完全一致；不作为首期必备依赖。
3. 无能力、超时或污染 canvas 时，保存“预览不可用”的元数据与通用插件占位图；标签关闭继续完成。

canvas 被跨域内容污染时导出可抛 SecurityError；大图优先 Blob 而非整块 dataURL。[canvas 导出依据](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL)

不使用 getDisplayMedia 在每次关闭时静默抓图，该 API 需要用户交互与每次选择/授权，不能作为自动关闭截图方案。[屏幕采集依据](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

预览使用 WebP/PNG，建议单张最大 200KiB；具体展示大小由后续 UI 设计确定。后端校验魔数、解码尺寸上限与归属，拒绝 SVG/HTML 上传，返回图片专用 Content-Type 和 nosniff。图片经受保护的工作台路由读取，不使用公开静态 data 目录。缩略图以内容摘要去重，引用计数清理；图片路径由服务端生成。

收藏创建、页面离开和有状态变化时可更新预览，但关闭截图仅绑定相同精确 URL 的收藏或本次关闭记录。图片失败不会破坏收藏文本记录；通知里不反复报每个预览失败，仅在详情展示原因。预览可关闭，并可按插件禁用。

## 8. Web 输出与命令终端

### 8.1 不能直接复用的部分

现有 `createCoreBridge` 假设 process.send、单 peer.sessionId、setLogSink 单消费者和 setInputHandler 单处理器。Web 版不启动第二个核心、不实例化 TerminalController，也不读 StateStore 的 CLI 状态。共享 parseAndRunCommands、completeCommand、TaskRegistry、commandSource 等纯能力；TTY 输入、Renderer、clipboard、global、terminal/plugin 均不进入 Web bundle。

### 8.2 执行与输入分发

提取 CommandService 与 InvocationBroker：CLI 适配器和 Web 适配器注册自己的 session；每次执行由服务端绑定 `{transport,sessionId,terminalId,executionId,parentExecutionId}`，再映射现有 windowId。客户端提交的窗口 ID 必须属于当前会话可操作的终端。

核心只安装一次输入 handler，由 Broker 按 invocation identity 路由。不可为每个 WebSocket 覆盖 setInputHandler。一个调用只有一个 next，回复必须带 requestId、executionId、terminalId、session 归属；过期输入、其他窗口的输入、旧 coreBootId 一律拒绝。重复 input reply 返回已处理结果，不重复消费。

日志入口改为多订阅分发：保留 CLI sink 行为，通过 Broker 路由定向调用日志；无调用身份的核心/插件生命周期日志进入公共输出。Web 公共输出可以订阅一份公共事件，但不能把 CLI 定向日志误记成某个 Web 终端。CLI 与 Web 各自 session 的 outputWindowId 不再由最近一次 hello 全局覆盖。

`setLogSink` 可保留兼容包装，底层增加 subscribe/unsubscribe；Web 持久化是独立订阅者。console fallback 是否输出由启动模式决定，不能因为有浏览器订阅就意外关闭本机控制台。订阅者断开只解除其订阅，不删除别的消费者。

### 8.3 提交、补全、取消与断线

execute 请求携带 terminalId、command 和 idempotencyKey，executionId 由服务端生成；响应确认“已接收”，结果走事件。持久化短期幂等收据：响应丢失后重试返回原执行，不再次执行。命令已经被接收但服务重启时，旧执行显示中断，绝不以重试为理由自动重跑。

每终端一个顶层执行；`returned` 可能仍有 TaskReporter 活动句柄，只有 returned 且 TaskRegistry 不忙才 finished。沿用当前任务取消和后台任务语义。停止终端按钮向 `/commands/cancel` 提交目标 terminalId、当前 executionId 与 coreBootId，等待输入也按该执行取消；服务端校验所属与当前执行，旧按钮动作不能取消后来启动的命令。停止保留逻辑终端、输出和草稿，空闲时不可用。关闭终端与强停插件是不同操作；协作取消失败时返回 needsForce 和受影响插件/执行清单，用户显式强停会影响该宿主其他窗口任务。

停止入口由当前未归档终端数量派生：只有一个时位于底部面板标签栏右侧操作区，仅在终端视图提供；多个时位于终端页内部右侧边栏的各终端标签右侧。数量变化时迁移入口，零终端时仅提供新建；点击前固定 terminalId/executionId，不根据随后变化的焦点重定向。该按钮位置不另存布局，终端列表大小仍按布局合同保存。

Web 普通命令包含核心命令与核心业务插件命令；没有终端扩展和全局冒号模式。核心 exit/restart 归独立生命周期通道，Web 普通 execute 拒绝其控制操作；命令发现清单明确标注命令来源和可用 capability，不靠文本前缀猜测权限。

补全复用 completeCommand，UTF-16 cursor/from/to，包含请求原文与版本。输入、光标、终端、清单或提交变化取消旧请求；补全无业务执行副作用，不创建业务任务，不采用 5 秒普通 RPC 期限。取消只释放等待，不要求插件立即停止计算；迟到结果按版本丢弃。

断网时服务端继续保存已经运行的任务与日志。重连用 terminalId/executionId 重新订阅；不提交离线命令队列。等待 next 的连接断开保留输入请求 60 秒重连宽限，超时以 closed 结束该输入并协作取消对应调用；不是把问题广播到任意打开的页面。没有等待输入的后台任务继续，直到完成或用户在恢复后取消。整个浏览器关闭与暂时断网难以区分，使用同一可配置策略。

输入编辑器草稿可持久化，正在等待的 next 回答草稿默认不持久化，以免保存敏感输入；输入请求与确认票据不在重启时恢复。终端命令历史只包含已提交命令文本，可单独清理，与全局关闭标签历史分开；敏感参数的历史处理由明确的用户设置/命令 metadata 决定。

### 8.4 输出存储与显示

公共输出为固定的不可删除逻辑流，底部输出页的卸载不删除流。终端关闭后将元数据归档，可从独立的终端归档入口恢复，不进入插件关闭历史列表；明确“删除终端及输出”才移除持久数据。新增日志不能发给后来复用名称或序号的终端，身份使用 UUID。

日志记录包含 streamId、seq、executionId、pluginId、level、timestamp、text。后端先入有界队列并按批提交 SQLite，再推送；退出时有界 flush，突发过载写明确截断标记。恢复只读已提交日志，不从 CLI data/terminal/state.json 导入。

建议每终端保留 10,000 行或 10MiB，Web 总输出 100MiB，保留 7 天（均可设置）。清理在事务批次执行，流起始 seq 变化时返回 truncatedBefore，前端不误以为当前第一页就是完整历史。

输出只解析白名单 ANSI SGR 到文本 span，禁止 HTML、OSC 命令、任意链接协议和控制序列注入。文本选择、软换行复制与原始导出分开处理；后台新增日志只增加未读数，不把用户从历史位置拉到底部。

## 9. 通知：后端 logger 与页面 logger

新增 `WorkbenchNotification`：id、source、pluginId、tabId?/executionId?、level、title、message、createdAt、updatedAt、readAt、dedupeKey?、count、actions。来源与时间由核心校正，客户端不能伪装 core 通知。

```ts
// 拟新增的插件后端 logger 能力；原 info/error 继续用于输出。
logger.workbench.success('处理完成', {
  message: '已整理 24 项内容',
  dedupeKey: 'organize:task-42',
  target: { pluginPath: '/collections/42' },
});

// 拟新增的插件页面能力，经绑定的宿主或独立页适配器入库。
scwcutils.logger.warn('存在重复内容', { message: '请检查收件箱', dedupeKey: 'duplicates' });
```

增加声明、bindLogger、host scopedLogger 与 plugin RPC notification.workbench 事件；核心从 PluginProcessClient 的实际 pluginId 赋来源，不相信 payload 自报。调用内 logger 固定执行身份，异步通知继续归原执行；onLoad 后独立通知归插件而非某个当前焦点页。

现有 `logger.toWeb` 的采集响应通知不改语义、不自动双发；新通知路径入持久 NotificationService 并推送给工作台。默认保留 30 天/1000 条；相同 dedupeKey 聚合，限流建议每插件每秒 10 条、突发 30，超限合并告知而非内存无限增长。

动作只能为允许的 workbenchCommandId 或已解析插件 URL，带标签目标时该标签若关闭则打开相应页面；不执行插件提供的 JS。已读状态默认 profile 共享，多窗口实时对齐；铃铛未读与 toast 是否显示独立，避免重复弹出。

## 10. 工作台持久化、恢复与清理

独立工作台 DB 建议 `ENV_DIR/data/web/workbench.sqlite`，新增可选 `SCWC_WEB_WORKBENCH_DB`；不依赖 SERVER_ROOT 的临时发行资源目录。启动检查目录可写、建立迁移表和安装 ID。`better-sqlite3` 已在依赖中；操作需分批，长导出/清理使用 worker 或分页，避免阻塞核心请求。

| 数据表/资产 | 主键与核心字段 | 保留/一致性 |
| --- | --- | --- |
| installation | installationId、schemaVersion | 长期稳定，不能每次重建 |
| preferences | profileId、key、value_json、revision | 包含主题模式和快捷键覆盖，重置删除覆盖；不存临时授权 |
| workspaces | workspaceId、profileId、name、layout_json、tabs_json、revision | 完整区域位置/显隐/大小、内部划分、中心树与比例、逻辑标签与导航；CAS 与租约 |
| bookmarks | bookmarkId、pluginId、url、locator_json、原始/自定义名、createdAt、previewId | 删除独立于标签 |
| closed_tabs | closeId、operationId、batchId、profileId、workspaceId、pluginId、tabId、closedAt、restoredAt、标签快照/引用 | 唯一关闭历史来源；默认 90 天/10000 条，按时间/插件/批次索引；不建 visits 或第二份最近关闭表 |
| snapshots | snapshotId、kind、owner、url、版本、checksum、payload/文件引用 | 状态与预览分开配额及引用 |
| terminals | terminalId、workspaceId、title、draft、history、archivedAt | 独立 Web 终端数据 |
| executions | executionId、terminalId、bootId、status、command、requestKey | 重启标中断；不恢复执行闭包 |
| output_records | streamId、seq、时间、级别、身份、text | 按流有序、有界、可补流 |
| notifications | notificationId、来源、正文、动作、已读、去重键 | 容量和期限清理 |
| operation_receipts/jobs | requestKey/jobId、状态、结果、创建时间 | 幂等窗口及任务追踪；历史 Job 有期限 |
| config_values 等 | 独立 plugin-config DB | 仅字符串业务 KV，见第 5 节 |

SQLite 启用 WAL、foreign_keys、busy_timeout（建议 3 秒），所有多行修改用事务。数据库迁移有 schemaVersion、事务与升级前健康备份；备份使用 SQLite backup API，不能只复制正在 WAL 写入的主文件。损坏主库隔离后尝试健康备份，不能覆盖最后健康备份。

布局/草稿建议 500ms 防抖；拖动结束、分割/移动组、区域停靠/显隐变化立即提交完整 WorkbenchLayout。普通调整自动持久化，“保存命名布局”只提供额外预设，不作为恢复当前布局的前提。收藏、配置、关闭事务、快捷键修改和执行收据不延迟到浏览器退出。隐藏/停靠时保留各方向的首选大小，窄屏产生的派生尺寸不覆盖存储值。

前端 IndexedDB 保存独立的待保存工作区草稿、关闭意图和最近健康快照，后端为权威；localStorage 只保存轻量 bootstrap/workspace 定位。刷新/重连先恢复所属工作区的侧栏、底栏和完整中心树，当前屏幕只做显示约束；核心重启后同样读取持久状态。离线编辑重连按 revision 合并或另存工作区，不能自动覆盖服务端更新；保存失败明确显示未保存并保留重试数据。

有两个独立数据库时不假装支持跨库原子事务：收藏关联预览、工作台显示配置等跨库引用允许短暂延迟。配置以其自己的 revision 为准，工作台恢复不回滚插件配置。清理只删除自己拥有的引用和无引用 blob，不能递归清空任意用户目录。

建议预览总量 100MiB、页面状态总量 25MiB，LRU 清理时优先未被收藏或打开标签引用的预览；无法保存新的受保护状态时停止自动休眠并提示空间不足，不删除未保存草稿换空间。数据导出默认不含主 TOKEN、grant、WS ticket 和输入回答。

## 11. 验证与实施检查清单

以下为后续实现的验收用例，本轮设计阶段未声称已通过应用测试。

| 范围 | 必测场景 |
| --- | --- |
| 布局/标签 | 嵌套分割、拖拽跨组不重载、空组折叠、固定批量保护、重复 URL 双实例、无效布局恢复 |
| 布局持久化 | 两侧栏和底栏位置/显隐/大小、主侧栏内部划分、中心多层方向与比例，刷新/重启恢复，窄屏不覆盖首选值，写入失败与 CAS 冲突 |
| 设置/快捷键/菜单 | 两个独立中心标签复用、设置跳转、全部主页面命令含未绑定项、搜索/改键/移除/重置、上下文冲突、跨窗口同步；菜单逐项溢出及两项加省略后全收起 |
| 主题与功能区域 | 2026 浅/深与跟随系统、菜单/内置页/终端共同适配、SDK 模式更新；活动栏在主侧栏左侧，左上角无 logo/标题；具体视觉另行验收 |
| URL/导航 | query 重复键、hash、中文/编码路径、跨插件、端口改变、外部地址、坏路径、两个 iframe 历史互不串扰 |
| SDK | 错 origin/source、旧代次、hello 重复、初始化竞争、深链早注入、端口关闭、独立页能力降级 |
| 页面搜索 | 未注册/独立页降级、异步首批/多页/无 total、空页带下一页、游标失效/重复、并发重试去重、多标签来源隔离、关键词变化/导航/关闭取消及迟到拒收、休眠不自动唤醒、单来源失败 |
| 目录/构建 | 标题五级/描述三级候选与空值降级、package 静态配置、仅展示元数据不代表有 UI、导出 name 可省略、无 UI 进程 PID；禁用不执行、坏包、缺入口/构建命令、构建取消/失败、临时停止不写 enabled |
| 关闭历史 | 导航/刷新/休眠/保留标签的插件停止均不写记录，内置页/终端不写记录；实际插件关闭统一列表、部分关闭、重试幂等、离线同步、原组丢失恢复、清理搜索与预览引用 |
| 配置 | 字符串类型强约束、同插件多页共享、资源隔离、动态字段、默认变化、CAS 冲突、required 回调离线、重置删除覆盖 |
| 终端 | CLI 与两 Web 窗口共存、日志与 next 隔离、returned 后仍 busy、过期输入、补全取消、强停影响、重连幂等；单/多终端停止入口切换与执行目标不漂移，归档不写插件历史 |
| 持久化 | 面板隐藏/重开保留输出、整页刷新、核心重启、断电最新提交边界、坏库备份、配额清理、无 CLI 状态访问 |
| 休眠 | 不可恢复/脏/保活页保护、serialize 超时、保存失败、保存中激活、迟到回执、恢复版本漂移、后端任务不重跑 |
| 通知 | 后端无人连接仍入库、页面来源不可伪装、去重限流、跨窗口已读、无 HTML 执行、toWeb 无重复 |
| 浏览器 | Chromium、Firefox、Safari 的快捷键/弹窗/剪贴板/iframe 行为人工验收，IME、键盘导航、缩放与窄屏 |
| 资源 | 20 个逻辑标签/多组切换，记录创建的 iframe 数量、受管轮询、监听和 port；输出洪流与慢 WS 客户端有界 |

首轮实现应先建设可注入时钟的状态机与纯 reducer，再验证真实浏览器中的导航、拖拽、输入和休眠。测试应覆盖契约与失败模式，不为每个图标按钮重复生成实现镜像测试。
