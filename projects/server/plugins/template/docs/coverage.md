# 模板接入覆盖与验收记录

日期：2026-10-30。以当前源码为准；“实现”不等于已经完成全部浏览器验收。未修改核心/SDK 源码，仅按用户授权重建 SDK 产物。所有演示有明确点击入口，加载不写配置、不弹通知、不启动业务任务。

测试编号：T1 真实 API/资源/反馈 IPC；T2 独立浏览器 SDK+Lit；T3 宿主状态/Fetch/DOM 资源；T4 真实 Socket；T5 声明式 HTTP/IPC/核心处理器/资源/回滚/释放；T6 配置 CRUD/双 CAS/页面拒写；T7 两页配置队列与页面处理器；T8 跨插件隔离；T9 核心配置表单与取消。均位于 `tests/integration.test.mjs`。Node 原生加载后端；JSDOM 与 MessageChannel 仅证明 DOM/桥接语义，不证明像素和完整工作台调度。

## 后端 SDK

| 接口 | 入口 / 实现 | 证据与边界 |
| --- | --- | --- |
| apis.mountStatic(file) / dispose | `/demo.svg`，`declarative-ui.ts`；辅助 HTML 单文件图片 | T5 网关真实读取；释放后 cap 失效 |
| apis.mountStatic(directory) / dispose | `/demo-assets`，主侧栏 UI/生命周期两张 image | T5 根层 `mark.svg` 与 `nested/mark.svg`，越界/错误 cap 拒绝；目录本身不映射 index 文件 |
| handlers.register / readOnly / run | demo.normalize/echo/null/literal/reader/progress/positive | T5 参数、同步/异步返回、null、核心 getter |
| reads / this.readValue | demo.capture，提交声明字段 | run 的 this 是核心上下文，reads 声明 query/memo/choice/checked/toggle；不占首个位置参数 |
| watch / dispose | demo.counter / demo.snapshot | T5 初值、更新、取消单表达式订阅、释放后监听归零；无轮询 |
| signal / cancel | demo.wait，名称/参数的异步取消按钮 | T9 等待期间释放实例，真实 IPC AbortSignal 取消 |
| registerMainSidebar | template-overview，静态 mainContent | T5 注册 JSON，真实浏览器显示四个 Tabs |
| main.set | UI main.set / 主侧栏 main.set | 同 id 更新标题/asset 图标/异步提供器；T5 取得异步内容 |
| main.setContent | UI main.content / 主侧栏 main.content | T5 全量更新；浏览器保持外层与内层选中标签 |
| main.setContent({instanceId}) | 主侧栏 target | T5 定向内容，instanceId 来自 HandlerContext；执行中换模板回执见下方缺口 |
| main.dispose | UI main.dispose | 可从普通页恢复；T5 全注销后贡献清空 |
| registerAuxiliarySidebar | template-details，异步提供器 | 与页面信息共存，JSON/HTML 切换；T5 实际编译两种格式 |
| aux.set | UI aux.json / UI aux.html | 同 id 标题/内容变化 |
| aux.setContent | UI aux.content | 合法 JSON 更新 |
| aux.setContent({instanceId}) | 辅助页“此实例定向更新” | 核心上下文实例；不接受前端伪造身份 |
| setCurrentPageVisible | UI hide / UI show | T5 合法模板前提；invalid 事务试图无内容隐藏并确认回滚 |
| aux.dispose | UI aux.dispose | 注销移除贡献，核心负责恢复页面信息 |
| registerStatusBar | template-state | id/ariaLabel/text/icon/alignment/priority/visible/disabled/events 全部声明 |
| status.set | UI tooltip / UI status.disabled / UI status.visible | 同一项 text/JSON/HTML 异步 tooltip 提供器；无第二项注册 |
| status.dispose | UI status.dispose | 无 setContent 方法；从普通页恢复 |
| inspector.register / provide | 页面信息→属性 | 只提供后端标题与扁平字符串属性，不伪造 PID/浏览器状态 |
| inspector.invalidate() | UI inspector | 后端属性变化后全量失效 |
| inspector.invalidate({tabId}) | 主侧栏 inspector.target | 只用核心 sourceTabId；HostUI 当前忽略 target，**不是精确 tab 失效** |
| inspector.dispose | UI inspector.dispose | T5 释放后可恢复 |
| transaction | 注册、全释放、UI invalid/reject.cycle/reject.cross | T5 非法隐藏/循环/跨域候选被拒，旧 registry 完整保留 |

`UI dispose` 在同一事务中先移除视图与 inspector 引用，再依次 dispose handlers/mounts；页面处理器的释放按钮也先移除后端模板引用。onUnload 回收 UI、配置订阅、原探针、Socket 定时器、反馈对象。

## 普通页 SDK 与配置

| 能力 | 实现 / 操作 | 验证 |
| --- | --- | --- |
| ui.handlers.register：事件 | template.record，前端当前页 +1 / 独立分支 | T7 参数与当前来源；另一页不含其状态 |
| ui.handlers.register：getter | template.selection；已有 template.title 保留 | 异步返回字符串，不传 DOM/函数/Error |
| ui.handlers.register：run+watch | template.selection / template.title | run 初值，页面状态/标题变更 emit，保存注销函数 |
| 页面 handler await dispose | 释放前端处理器 / 恢复声明式演示 | T7 临时 handler dispose 后不可调用；后端模板引用先移除 |
| config.get() | 读取完整配置基线 | 显示 values/effectiveValues/revision/schemaRevision/definitions/definitionSources |
| config.get(keys) | 读取选定键 | 显示完整返回形状，selected.values 是筛选结果；不宣称后端 get(key) 语义 |
| config.subscribe(keys,callback) | 指定 validation.note | T7 初值与后续更新，回调显示完整 change |
| config.subscribe(callback) | 全部配置 | 标明流来源；取消全部配置订阅/恢复配置订阅 |
| config.subscribe(undefined,callback) | undefined 键 | 同上，记录 pluginId/changedKeys/effectiveValues/revision/schemaRevision/originRequestId |
| 配置暂停/恢复与去重 | 两个同插件页面 | T7 两个真实 SDK 文档+核心 ConfigDispatchQueue，第二页 inactive 后恢复交付；不等同完整节能计时验收 |
| host.capabilities | 普通页统一模板接入 | 真实浏览器已显示 pageApiVersion=2、uiHandlers=true、configurationWrite=false |
| theme.mode/tokens/onChange | web/main.ts | 现有主题消费与注销保留；暗/亮完整视觉仍需核验 |
| page.onVisibility/onFocus | SDK 仍存在，页面通过 externalState 观察 | 未删除；T3 实际焦点/可见变化 |
| navigation.report/navigate/registerAdapter | 报告页面导航 / 导航到演示锚点 | adapter 用普通 history 更新当前文档，保存 dispose；不注入 inspector 属性 |
| search.register/dispose | 当前页面“模板参数/监听/配置/生命周期”四项 | 宿主搜索能力存在时注册，返回 cursor/total 并检查 signal；全工作台搜索手工入口为 F1 |
| lifecycle.register/checkpoint | 心跳、保存页面 checkpoint | 保留 suspend/resume、序列化/恢复，并保存页面演示状态和脏草稿；关闭保护有明确确认 |
| fetch/resource/websocket / tasks/logger | 原有面板 | T1–T4，原有保护、重放、取消、任务和通知能力保留 |
| 后端 configuration.definitions | configuration.ts | 两组，七种 control，description/defaultValue/policy/rules；当前旧 page-required 不新增 |
| configuration.normalize/validate | note trim、reject 拒绝 | T6 异步校验且值为字符串；policy=backend-required，其余 declarative |
| configuration.onChange | 后端 config.changes | 与 context.config.subscribe 各自记录 source，不将两类回调当成重复订阅 |
| context.config.get/list | 后端 config.get / 读取完整基线 | T6，显式值与默认值分开 |
| context.config.set/update | 后端 config.set/update | 仅 note/memo 业务键；调用方必须显式 baseRevision，不偷读最新 revision 掩盖冲突 |
| context.config.delete/reset | 后端 config.delete/reset | T6 删除显式值后回到默认值 |
| context.config.subscribe / stop | 后端 config.subscribe/unsubscribe | onUnload 取消；无页面写权限恢复 |
| 核心配置表单 save/reset/rebase/discard | 页面信息→配置 | T9 只通过核心生成绑定操作，双 CAS 拒绝、草稿保留和显式 rebase/discard |

普通页没有 page.register/update、settings.register、config.set/reset、页面 validate/validationTicket；测试明确断言旧接口不存在。旧 legacy-unverified/page-required 的迁移属于核心/既有数据治理，本模板后端以相同 template-validation id 升级 schemaVersion 并重新确认所属定义，不篡改其他插件定义。

## 统一语法

| 语法 | 可操作位置 / 证据 |
| --- | --- |
| 裸名称默认唯一 $event；显式 $event；空括号零参数 | 名称/参数前三个按钮、core→zero arguments；T5 |
| number/string/$for、单关联值/多关联值/元素自身 name | 显式参数、input/change、表单提交；values 附在事件，不额外追加未知位置参数 |
| a(...)\|b($prev)、逗号独立分支 | 同域异步链、独立前后端分支；T5 |
| $event/$prev/$for、同域嵌套 | core:value.write 中 core:string.upper；T5 |
| 单/双引号转义、数组/对象字面量 | core→escaped literals；T5 |
| 同步/异步返回、null/void | demo.normalize/wait/null/void；无返回值被 $prev 读取时 UI_NO_RETURN_VALUE |
| HTML/JSON ${...}、混排标量、显式 JSON 序列化 | 最近调用 json.stringify(watch:snapshot)、安全纯文本 `<img onerror=...>` |
| 纯表达式保持类型 | progress / checkbox menu checked；编译后的数据不是字符串强制转换 |
| readonly getter / core:get(handler) | 数据/监听 getter；T5 |
| watch:query / watch:demo.counter / watch:core:get / watch:core:config.read | 数据/监听；T5 初值和后端更新 |
| ui: 与 watch:ui: | 数据/监听及辅助页；真实来源前端值；T7 页面隔离 |
| 跨域链、嵌套跨域、core:ui: 拒绝 | UI reject.cross + negativePrograms；T5 实际拒绝链；其余由共享解析器契约核对，不假装已经点击不存在的非法线上模板 |
| 无来源 UI_UNAVAILABLE | T5 无 sourceTabId 事件；卡片配置入口的完整浏览器流程仍待验收，不借另一页状态 |
| click/input/change/submit/contextmenu/focus/blur/hover | JSON 表单、按钮；HTML input/右键/mouseenter/mouseleave；无 mousemove 连续上报 |

## JSON 组件（ui-content.ts）

| 组件 | 最小用法 |
| --- | --- |
| stack | 命名 detailSection、辅助 JSON 布局 |
| text | 数据读取、混排文本、安全字符串 |
| icon | 生命周期 tab 的 builtin 与 asset 各一个 |
| image | 挂载目录根层与嵌套 SVG |
| button | click / submit / for / name / disabled 状态由状态项及表单演示 |
| input | query，key/name/value/placeholder/events |
| textarea | memo |
| select | choice，选项对象和值 |
| checkbox | checked=true 与 change |
| toggle | toggle=false |
| form | queryForm，submit 采集声明字段 |
| progress | 纯表达式 number，后端计数驱动 0–1 |
| badge | 后端 watch 计数、tone=success |
| divider | 数据页分隔线 |
| tabs | 外层四页+内层两页，稳定 id/key；实际方向键切换及 setContent 后选中项保留 |

## 核心处理器逐项

除专用配置绑定外，均在 `coreExamples` 或主侧栏配置/核心、状态项中；T5 真正执行核心返回值，不复刻核心实现。

| 名称 | 入口 / 结果 |
| --- | --- |
| core:string.trim | trim/lower/upper / 同域异步链 |
| core:string.lower | trim/lower/upper |
| core:string.upper | trim/lower/upper、字段规范化 |
| core:string.toString | toString(123)，对象另用 JSON |
| core:number.parse | number.parse、无效数字拒绝 |
| core:boolean.parse | boolean.parse、无效布尔值拒绝 |
| core:json.parse | json.parse/stringify |
| core:json.stringify | json.parse/stringify、snapshot 明确序列化 |
| core:object.get | ['a','b'] 路径 |
| core:object.pick | ['a','b'] 键集合 |
| core:array.first | 嵌套数组取首项 |
| core:array.length | 首项数组长度 |
| core:default | null→fallback |
| core:validate | codec/min/max/maxLength/options 全规则 |
| core:value.read | query 字段读取 |
| core:value.write | query 字符串写入；错误类型拒绝；编辑序号由核心处理 |
| core:get | config.validation.note / inspector.page.title / demo.reader / 空键 |
| core:config.read | 配置监听和写基线 |
| core:config.write | config.read/write 按钮，显式先读基线；T6/T9 另验双 CAS |
| core:flow.stop | 停止分支，后续 record 不执行 |
| core:event.trigger | 命名事件目标；循环候选拒绝 |
| core:view.open | 打开本插件辅助页 |
| core:view.refresh | 刷新本插件主侧栏 |
| core:page.open | 打开所属插件相对根路径 |
| core:settings.open | 核心配置入口、状态菜单 |
| core:tooltip.open | 状态项 click |
| core:tooltip.pin | JSON/HTML 提示层“固定” |
| core:tooltip.close | JSON/HTML 关闭与菜单关闭 |
| core:menu.open | 状态项 contextmenu，原有菜单体系 |
| core:element.focus | 命名 query，非任意 selector |
| core:section.toggle | detailSection |
| core:scroll.to | detailSection |
| core:clipboard.writeText | 复制 query，必须真实用户激活；效果发出可测，权限成功不能以合成事件声明 |
| core:link.openExternal | https://example.com，必须明确点击 |
| core:notification.show | info/success/warning/error 四按钮，不在加载时运行 |
| core:inspector.config.save | 核心表单 submit，T9 |
| core:inspector.config.reset | 核心“重置默认值”，T9 |
| core:inspector.config.rebase | 核心保留草稿并重新校验，T9 |
| core:inspector.config.discard | 核心接受远端值，T9 |

## 传输接口覆盖

公共前缀 `/web/api/workbench`；普通页不能用 grant 调这些核心 UI 端点。

| HTTP | 接入证据 |
| --- | --- |
| GET /bootstrap | T5 capability，真实工作台启动 |
| GET /ui/registry | T5 三项快照/原子回滚/注销 |
| POST /ui/instances | T5/T9 真正创建各表面，租约绑定 |
| GET /ui/instances/:id/content | T5 main.set/target 后重编译 |
| POST /ui/instances/:id/data | T5 数据求值/前端标记 |
| POST /ui/instances/:id/subscriptions | T5 建立监听与初值 |
| DELETE /ui/instances/:id/subscriptions/:subscriptionId | T5 按 expressionBindingId 注销 |
| POST /ui/instances/:id/events | T5/T9 已编译 binding、过滤字段、eventId |
| POST /ui/instances/:id/events/continue | 独立前后端分支交给核心继续；浏览器桥接入口已有，专门 continuation 时序回归未在模板重写 |
| POST /ui/instances/:id/effects/ack | 核心 renderer 自动确认；无额外持久化承诺 |
| POST /ui/instances/:id/release | T5/T9 释放 |
| DELETE /ui/instances/:id | T5 第二种释放 |
| GET /inspector | 核心页面信息，由真实 UI 自动获取；后端 provide 仅字符串属性 |
| POST /inspector/config/update | 只由核心实例入口接收绑定；T9 核心生成 save 程序，不从普通页调用 |
| POST /inspector/config/reset | 同上，T9 reset |
| GET /plugins/:id/config | T6/T7 快照，普通页 grant 只读 |
| POST /plugins/:id/config/update | T6/T7 双 CAS 与权威更新 |
| POST /plugins/:id/config/reset | 后端 reset 与核心表单覆盖同一服务；独立 REST reset 未新增重复测试 |
| POST /plugins/:id/config/definitions | T6 页面授权403；工作台旧路径410按源码核查 |
| POST /plugins/:id/config/validation | 同上，不恢复票据 |
| GET /web/ui/assets/:pluginId/:owner/{path} | T5 真实 SVG/错误 cap/越界/释放；CSS/字体内容类型由核心管理，本模板没有另造字体资产 |

| IPC / 页面 / 渲染桥 | 验证方式 |
| --- | --- |
| Manifest.declarativeUI | T1/T5 真实隔离进程发布 handlers/views/mounts/inspector 描述 |
| ui.registry / ui.content | T5 原子变更与实例定向内容 |
| ui.watch.changed | T5 真实后端状态变化通知 |
| ui.invoke handler/content/inspector | T5/T9 真实 callback，不跨 IPC 传函数 |
| ui.invoke watch.start/watch.stop/cancel | T5 监听归零、T9 释放中止 |
| ui.handlers.changed / ui.value.changed | T7 当前文档注册元数据；真实浏览器前端 watch 更新 |
| 工作台→页面 ui.invoke | T7 来源页记录/另一页不借值；真实侧栏前端计数 |
| config.deliver / config.changed | T7 核心队列初值/暂停/去重；工作台真实配置通知 |
| ui.registry.changed / ui.content.changed / ui.data.changed / config.changed | T5 及工作台变更后重取，不复制消息分发器 |
| scwc-declarative-ui v1、nonce、MessagePort/source | 核心固定 HTML renderer 管理；模板只提供受限内容 |
| renderer init/updates/result/focus | JSON 受控渲染与 HTML 沙箱；源码保留 renderRevision 检查 |
| renderer fields/event/surface | 实际控件事件与悬浮/右键，字段含 editSequence；模板不造任意 AST 请求 |
| wb-declarative-view / ui-effect / ui-executed / ui-surface-action / ui-menu-close | 由核心组件消费；模板状态 tooltip/menu 贡献接入，未重建 renderer/menu |

## 实测与尚未完成的验收

- `bun run check` 通过；`bun run build:web` 通过，最终模板 JS 为 `index-DM9QAuZo.js`；`projects/webUtils` 的 `bun run build` 通过，新 SDK 为 `scwcutils.iife.mvtscw8s.js`。九项集成测试通过。构建仅有现有 transformWithEsbuild 弃用提示。沙箱回环 EPERM 后使用授权的临时集成服务；未启动另一套开发服务器，未停止用户 3200/3201 服务。
- 现有 3201 真实浏览器已验证：新 SDK 能力、普通页就绪、真实前后端计数变化、输入规范化、安全字符串作为文本、外/内层 Tabs、方向键与 setContent 保留选中项；text/JSON/HTML tooltip、JSON 固定、Esc/显式关闭、原生右键菜单的子菜单与禁用项。JSON 提示层直接渲染，HTML 提示层显示 about:srcdoc 沙箱文档。
- 最初的 page.register 错误来源是旧模板产物；旧注入 SDK 也滞后。已通过正规构建链更新，不补回旧方法。
- 核心 `HostUI.inspector.invalidate` 不消费 target；已给出有/无 tabId 用法，但精确 tab 失效尚不可声称完成。
- 核心在解析 tooltip 提供器之前转换 text 格式，异步提供器返回 text 会得到“声明式内容版本无效”。模板使用静态 text 与异步 JSON/HTML，三种格式均已实测，不修改核心。
- 在声明式事件本身内更新 registry/当前实例内容时，核心执行器的执行后 revision 校验可能返回 UI_STALE_RENDER，尽管句柄更新已生效；普通页面明确业务 API 更新是可观察成功路径。未用延时或吞异常伪造成功回执。
- 真实工作台刷新/贡献更新时曾出现“模板版本已变化”或“处理器执行超时”提示，重新创建侧栏或再次交互后主要示例可工作；与自动测试隔离环境不同。源码线索：execute 把 executionDeadline 保存在实例上，watch.start/stop 调用 remote 未传 invocation，默认 event 的计时分支可能沿用上次已过期 executionDeadline，而 data 的 readDeadline 在复制实例上更新。此为源码推断，需独立复现修复，未修改核心或隐藏错误。
- 完整暗/亮与窄栏长标题、HTML 右键坐标/边缘定位/鼠标移入、剪贴板/外链真实权限、卡片配置无来源流程，以及两页真实空闲暂停/恢复计时，不能仅凭自动测试宣布全部完成。模板已提供操作入口；核心/运行版本问题和未完成项保留在这里。

## 跨插件处理器检查（未修改核心）

结论：不能直接调用另一插件注册的声明式处理器。`DeclarativeUIService.validateCall` 只在当前 Registration.snapshot.handlers 查名称，`core:get` 也只查当前 instance.pluginId，`remote` 取相同 pluginId 的 invoke；HostUI 的 handlers Map 属于各自插件进程。点号是名称字符，不是“插件.方法”路由；冒号仅允许 core:/ui:/watch: 规定组合。普通页 ui: 又绑定当前来源 tab/frame。T8 注册 other 的 foreign.handler 后，caller 引用它得到 UI_HANDLER_NOT_FOUND。未增加跨插件路由、授权或共享注册表。
