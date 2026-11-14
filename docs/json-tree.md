# JSON Tree

JSON UI 支持 `type: "tree"`，由共享树宿主负责行布局、焦点、选择、展开、搜索、拖放和虚拟列表；声明式运行器负责控制器调用、字段校验、事件绑定和权限复核。工作台、用户脚本浮窗与浏览器扩展使用同一份共享状态算法和 TreeSession。

完整接口、数据流和验收契约保存于 [设计文档](json-tree-design.md)。公开类型从 `scwc:shared/backend` 或 `scwc:shared/frontend` 导出；前端组件为 `JSONTree`。最低支持版本为 3.4.0。

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
  "search": { "visible": true, "controller": "files.search($tree)" },
  "dragDrop": { "mode": "reparent", "move": "files.move($tree)" }
}
```

节点必须使用整棵树内稳定且唯一的 `id`。`children` 缺省表示分支尚未加载，`children: []` 表示已加载为空，分页、加载失败和重试分别由运行器状态表示。静态根可以和动态后代混用；没有 `nodes` 和 `loadChildren` 的树是已知空树。

节点和 `renderNode` 返回的 `TreeRowView` 均可设置 `tooltip`；行视图中的值优先，空字符串可关闭节点提示。两者都未设置时不显示提示，也不从名称或描述生成提示。首次悬停 1 秒后显示，移出后保留 100ms；同一棵树的行项目为一组，在提示关闭前移入组内其他项或重新进入原项，立即切换。工具栏四个按钮另为一组，不同树彼此隔离。提示与树行等高，依次尝试右侧、左侧、下侧、上侧、当前位置，最终位置受视口约束。

共享 `SCWCTooltip` 的 `group` 属性（或 `attachTooltip` 的同名选项）指定分组，未设置时归入默认组。`triggers` 支持 `hover`、`click`、`contextmenu` 组合，属性示例为 `triggers="hover click contextmenu"`；默认悬停触发，点击和右键触发时立即打开并聚焦固定。提示内容被点击或聚焦后也会固定，同组切换继承固定状态，其他组悬停不替换固定提示；Esc、外部点击或显式 `close()` 可关闭。出现与消失延迟固定，不提供配置项。自定义表面可把事件交给 `trigger()`，普通 DOM 源通过 `bindTo()` 或 `attachTooltip()` 绑定。

`selectionMode` 为 `none`、`single` 或 `multiple`，默认 `single`。单选字段是字符串，多选字段是字符串数组；多选使用 Ctrl/Cmd 切换和 Shift 区间选择，不生成隐藏 option。选择、焦点和展开状态彼此独立：背景表示选中，描边表示当前焦点。`readonly` 保留浏览、展开、搜索和只读加载，但冻结选择与移动；因此点击只读节点时焦点描边会移动，选中背景仍保留在原节点。`disabled` 使树退出 Tab 顺序并拒绝所有用户操作。祖先的限制向后代合并，运行器会再次检查浏览器提交的请求。

动态控制器通过受限表达式调用。读取控制器接收结构化 `$tree` 上下文，后端函数从 `context` 中读取节点、分页游标、数据版本和请求身份。`$tree` 只在树控制器或树事件中有效，不支持 `$tree.node.id` 之类的任意成员访问。`handler`、`handler()`、管道、`$prev` 和 `$event` 继续沿用既有表达式语义；浏览器只能提交已签发的 binding ID，不能提交新的程序文本。

## 控制器返回值

- `loadChildren`：`{ items, nextCursor, version }`。每页最多 200 个节点；同一树代数中分页版本必须一致。
- `renderNode`：安全的 `TreeRowView`，只允许 text、icon、badge、横向 stack 和最多四个行内 action。返回值不会执行 HTML、JavaScript 或 CSS。
- `search.controller`：返回包含祖先路径的独立搜索投影，不覆写普通 children 缓存。
- `resolvePath`：返回从根到目标节点的无 `children` 路径。
- `dragDrop.move`：返回 `{ accepted, version, invalidateParents }`。请求含真实父节点、兄弟 `beforeId`、期望版本和幂等 `operationId`。

控制器的 `readOnly` 声明在编译、宿主执行和运行器收到请求时都检查。读取取消使用现有 `AbortSignal`；实例、模板、处理器或数据代数改变后，迟到结果会被丢弃。

## 搜索、拖放与虚拟化

本地搜索只覆盖已加载节点，并明确显示范围；未知子树不会因为搜索而递归加载。远端搜索拥有独立查询代数和游标，旧查询结果不能合并。清空搜索会恢复搜索前的展开状态和滚动锚点；非空查询禁止排序拖放。

拖放按真实父列表和兄弟锚点计算，过滤后的可见行下标不会进入协议。父节点已选时，多节点拖动只移动最外层节点；自身、后代、只读、禁用和不完整目标都会被拒绝。写入成功后若刷新失败，界面报告“移动已保存，列表待刷新”，不会假装回滚或自动重复写入。

树使用现有 `SCWCScrollContainer` 的外部 metrics。行高固定为 22–40px，默认 22px；默认缩进 8px；默认两侧各预渲染 8 行。DOM 行只覆盖视口窗口，状态保存在 `TreeDataStore` 和 `TreeViewState` 中。树容器使用 `role="tree"`、`aria-activedescendant`、`treeitem`、层级、选中、展开、禁用和集合位置属性。

## 宿主接入

工作台通过 `/web/api/workbench/ui/instances/:id/trees` 及 `/trees/continue` 复用实例租约、来源页和处理器注册代数。脚本和扩展通过 v2 JSON 事件通道发送 `treeRequest` 与 `tree` 事件；脚本没有前端处理器通道，因此只使用后端控制器。模板核心示例的 `tree-ui.ts` 提供了真实分页、失败重试、搜索、自定义行、行操作和持久 move 控制器，主侧栏和脚本配置页都使用这些处理器。

树缓存不写入脚本或工作台配置，只保存选择字段。模板、处理器和实例释放时会取消读取、释放行 action、观察器、滚动监听和提示；已提交的业务移动由提供器的 `operationId` 回执保证幂等。

## 验证

共享纯算法和运行器测试位于 `projects/server/workbench/tree.test.ts` 与 `tree-integration.test.ts`；组件 DOM 测试位于 `projects/shared/components/tree/tree.test.ts`。它们覆盖分页版本、重复 ID、取消竞态、选择范围、真实锚点、循环拒绝、readonly、动态 action、移动幂等、缓存淘汰、程序化选择解析和脚本/工作台共享语义。10000 节点的 DOM 用例断言视口仅保留有限行及额外的一条焦点行；这不表示已测量 10000 节点下的真实浏览器帧率。

`node projects/browser-extension/scripts/tree-smoke.ts` 使用真实 template 进程、HTTP、工作台、原生 Chromium 扩展 popup 和脚本产物。需先构建 Web、用户脚本及扩展，并在桌面用户上下文运行。脚本使用隔离的数据库、Chrome profile 和演示排序文件，产出深浅主题、搜索、加载错误和拖放反馈截图到 `dist/browser-extension/previews/tree/`。GM 通道由测试桥模拟；此检查不等同于在 Tampermonkey/Greasemonkey 中安装验证。Firefox、Safari、真实屏幕阅读器和操作系统级拖放尚未验证。

设计稿中的协议字段和资源上限已落入 `projects/shared/tree.ts`、`tree-model.ts`、`tree-compiler.ts` 与 `tree-session.ts`。实现中保留普通 JSON 编译链兼容性，树节点只通过受控 host 进入 `CompiledUI`，没有扩大任意自定义标签白名单。

## 演示与实现调整

工作台活动栏选择 template 的“模板验证”，进入“JSON 树”；脚本浮窗和扩展的插件页选择 template“配置样例”，进入同名页签。页面包含静态多选、动态分页、单选、只读和禁用五棵树。动态列表有 600 个文件，每页 120 项；“加载错误与重试”分支每个树代数首次读取故意失败。动态 move 控制器先校验版本、真实父级及锚点，再原子保存到 template 的 `data/tree-demo.json`；测试可通过 `SCWC_TEMPLATE_TREE_DEMO_FILE` 隔离该文件。

实现增加 `cancel` 请求分支，取消仅影响读取交付，不宣称回滚业务写入。`core:value.write` 解析未知节点后先交付路径补丁，再回填选择，不隐式聚焦或展开。一次请求共用 64 步调用预算，读取最多 10 秒；忽略 AbortSignal 的提供器不能无限占用运行器槽位。无 `nodes/loadChildren` 时根列表已知为空。

同版本父列表刷新保留仍存在的已加载后代；版本改变时使后代列表失效，并有界读取原已展开分支。整树刷新会取消旧读取，分支 generation 和整树结构 generation 共同阻止旧结果回写。达到缓存配额时优先释放不含展开、选择或焦点的完整分支；删除补丁同时撤销其事件绑定，活跃集合仍超限则明确报错。
