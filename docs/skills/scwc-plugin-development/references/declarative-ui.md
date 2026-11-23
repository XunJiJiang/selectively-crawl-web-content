# 声明式 UI、表达式与输入校验

内容与表达式读 `projects/shared/{declarative-ui,ui-expressions,ui-validation}.ts`，编译与执行读 `projects/server/workbench/{ui-compiler,declarative-ui}.ts`，渲染读 `projects/web/src/components/{ui-renderer.js,declarative-view.ts,json-components.ts}`。脚本和扩展的宿主能力见[脚本与配置](scripts-and-configuration.md)。

## 内容与贡献

工作台内容支持 `{ format: 'json', version: 1, root }` 和 `{ format: 'html', version: 2, html }`。已有 HTML `version: 1` 仍可用。HTML 经清洗后使用受限表达式编译，自定义脚本与框架组件放在独立插件页面。

JSON 使用 `stack/text/icon/image/button/input/textarea/select/checkbox/toggle/form/progress/badge/divider/tabs/setting/group/tree`。按 `ui-compiler.ts` 的 `jsonHTML` 和树编译器选属性，`class/style/raw HTML` 不在白名单内。`tabs` 使用 `{ id, label, children }[]`，`group.children` 只放 setting，普通嵌套用 stack/tabs。

`setting` 使用 `config` 自动绑定或在 `children` 放一个自定义控件，两者互斥。行可设 `label/description`，组还可设 `footer`。控件 `name` 在实例内稳定且唯一，用 1–64 位 ASCII 字母、数字、下划线或中划线，并排除原型键。处理器名和配置键允许点，例如 `demo.save`。

后端从 `context.workbench.ui` 注册处理器、主或辅助侧栏、状态栏、inspector 和静态资源。注册异步返回 handle。`set` 替换定义，侧栏可用宿主给出的 `instanceId` 定向调用 `setContent`。辅助栏 `hideCurrentPage` 必须有可用模板。inspector 的 `provide()` 在后端返回属性，按需调用 `invalidate({ tabId })`。

状态栏提示只在锚点上方显示。JSON 提示最宽 `450px`，高度受上方可用空间限制。自动尺寸 HTML 在首次插值及测量期间保持隐藏，准备超过 500 ms 时显示加载提示。HTML 固定尺寸在 `tooltip` 同时提供正数 `width`、`height`，以 CSS 像素计入边框。模板示例见 `ui-content.ts`。

`transaction(async draft => ...)` 原子发布注册变更，禁止嵌套，失败保留旧定义。`onLoad` 注册暂存至加载成功。卸载先撤视图再释放处理器、挂载与订阅，异步迟到注册也须释放。内容提供器和回调留在注册进程。

## 表达式规则

表达式使用受限调用语法。普通名称调用后端 handler，`ui:名称` 调用来源文档 handler，`core:名称` 调用核心白名单。使用普通 `run(...)` 方法读取宿主绑定的 `this`。有副作用的处理器绑定到支持的用户事件，模板求值及订阅使用只读处理器。

- `demo.save()` 显式传零参数。仅事件顶层的裸调用 `demo.save` 隐式传一个 `$event`。
- `${demo.read()}` 求值，`${watch:demo.read()}` 订阅。两者使用 `readOnly: true` 的处理器。模板、嵌套调用与 validator 都写括号。
- `$for:field-name` 读取并验证具名字段，事件节点用 `for` 声明关联字段。`$this` 只在 validator 中取当前候选值。
- `a()|b($prev)` 在同一执行域传递上一步结果。首步没有 `$prev`。模板不读取 `$event` 或 `$prev`。输入实参和管道都限同域。
- `a(),ui:b()` 形成独立分支，可分别执行后端与前端，每个分支独立计算 `$prev`。

workbench HandlerContext 包含 invocation、instanceId、workspaceId/windowId、source/sourceTabId、event、readValue 和 signal。handler 定义可声明 reads，并在 watch 中返回释放函数。前端 handler 不可用时模板会显示不可用状态，不能自动打开页面或从别的标签借状态。

常用内置调用有 `core:validate`、`core:value.read/write`、`core:config.bound.read/write` 和 `core:notification.show`。其余见 `declarative-ui.ts` 的 `pureNames/coreNames/effectNames`。配置写入沿用配对读取建立的基线。

## JSON 树

用 JSON `type: 'tree'` 声明树，给实例内各树分配稳定且不重复的 `key/name`。节点 ID 在整树内唯一且稳定。`children` 缺省表示未加载，`[]` 表示已知为空。单选字段使用字符串，多选使用字符串数组。选择、焦点和展开独立，实例缓存不写入配置。

动态读取使用显式单调用，例如 `files.children($tree)`。读取控制器标记 `readOnly: true`，`$tree` 仅在树控制器和树事件中可用。分页返回 `{ items, nextCursor, version }`，每页最多 200 项，同一代分页保持版本一致。自定义行返回安全文本、图标、徽章及最多四个行内操作。搜索使用独立结果，避免覆写正常分支缓存。

动态移动按真实父级和兄弟 `beforeId` 定位，提供器校验预期版本并按 `operationId` 实现幂等。移动已保存而刷新失败时保留成功回执。readonly 保留浏览、展开和读取并冻结选择与移动，disabled 禁止用户操作。树行提示只使用显式 `tooltip`，同一树的行和工具栏分别成组。

工作台前端树控制器绑定来源文档，脚本与扩展用后端控制器。树端最低版本为 `3.4.0`。类型和限额见 `projects/shared/{tree,tree-compiler,tree-session}.ts`，可运行实现见 template 的 `tree-ui.ts)。[JSON 树接口与验证](../../../json-tree.md)

## 字段类型与校验

字段值为 `string`、`boolean` 或 `string[]`。`inputType: 'number'` 仍保存字符串，`core:validate` 保留原值。需要数字时显式用 `core:number.parse`。

`input/textarea` 和自动绑定 `setting` 支持 `minLength/maxLength/min/max/pattern/patternMessage/validator/placeholder/disabled/readonly`，`input` 另有 `inputType/step`。长度按 UTF-16，数值范围含边界。`pattern` 写正则源码字符串，宿主以 `u` 模式整值匹配。`patternMessage` 要求同设 `pattern`。编译拒绝非法范围、正则和未知属性。整数与精度约束在业务校验中声明。

自定义 validator 写显式调用，如 `validation.same($this, $for:password)`。目标 handler 声明 `readOnly: true`，可异步，返回 `{ success: boolean, message?: string }`。后端 `configuration.validate` 使用自己的 `true | string` 返回契约。

依赖字段先验证，失败归到该依赖字段，编译拒绝依赖环。模板的密码示例先分别验证两字段的长度和格式，再检查一致性。

1. 输入时运行本地规则。隐式自定义校验等到 blur。
2. blur 和显式业务事件执行完整验证。带 validator 的自动绑定 `text/number/password/textarea` 在 blur 验证后保存，其他自动绑定通常在 change 保存。显式事件按声明执行。
3. `$for`、`core:value.read`、模板引用、watch 和字段回填均重验值。验证失败阻止此次消费、业务处理、配置写入或前端交付。
4. 后端 normalize 后的回值也必须符合规则。回值验证失败保留已成功的写入，继续展示字段错误。

用 `UIError.field` 保留错误归属。宿主处理编辑序号、迟到响应和内联反馈，按可用空间显示说明或图标，并由共享提示展示全文。

## 有界内容与验证

只传有限、无循环的普通 JSON。当前内容限 256 KiB、单值 64 KiB，其他节点/字段/绑定额度读 UI_LIMITS，不用拆分副作用绕过执行预算。资源通过 `ui.apis.mountStatic` 注册受控文件/目录，内容引用其挂载的 `/web/ui/assets/...` 路径，避免任意远程 URL 或文件路径。

按改动验证编译、非法表达式或依赖环拒绝、字段归属及迟到结果。前端 handler 测来源文档和验证续接。脚本内容另走脚本运行器。示例见 template 的 `input-validation-ui.ts`，测试见 `ui-compiler.test.ts`、`ui-expressions.test.ts` 和模板集成测试。
