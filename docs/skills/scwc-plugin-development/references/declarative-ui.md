# 声明式 UI、表达式与输入校验

源码入口：`projects/shared/{declarative-ui,ui-expressions,ui-validation}.ts`、`projects/server/workbench/{ui-compiler,declarative-ui}.ts`，以及 `projects/web/src/components/{ui-renderer.js,declarative-view.ts,json-components.ts}`。脚本/扩展复用编译器但运行能力较少，见[脚本与配置](scripts-and-configuration.md)。

## 内容与贡献

工作台内容为 `{ format: 'json', version: 1, root }` 或 `{ format: 'html', version: 1, html }`。HTML 是经过清洗和受限表达式编译的声明，不是可执行插件页面；自定义脚本、任意样式、DOM 处理器与框架组件应放独立页面。脚本/扩展 v2 只支持 JSON。

当前 JSON 节点有 `stack/text/icon/image/button/input/textarea/select/checkbox/toggle/form/progress/badge/divider/tabs/setting/group`；属性按类型白名单验证，不能因 UINode 类型有索引签名就添加任意属性。需要新结构前读 `ui-compiler.ts` 的 `jsonHTML`。不往 JSON 填 class/style/raw HTML。tabs 使用 `{ id, label, children }[]`；group.children 只允许 setting，通用嵌套布局用 stack/tabs。

setting 有两种互斥用法：config 自动绑定（见下一参考），或 children 中恰好一个自定义控件。可声明 label/description；group 可声明 label/description/footer。具名字段应稳定且实例内唯一，name 只能是 1–64 位 ASCII 字母、数字、下划线、中划线，不能含点、空格或原型键。处理器名称允许点，例如 `demo.save`；配置键也可含点，它们与控件 name 不同。

后端从 `context.workbench.ui` 注册 handlers、主/辅助侧栏、状态栏、inspector 和静态资源。注册返回异步 handle，set 替换定义，侧栏 `setContent(content, { instanceId })` 可定向更新；使用宿主提供的身份。辅助栏 hideCurrentPage 必须有可用模板；inspector 由后端 provide() 返回属性，按需 `invalidate({ tabId })`，不从 iframe 注入页面属性或配置定义。

`transaction(async draft => ...)` 原子发布注册变更，不能嵌套；onLoad 中注册先暂存，加载成功后发布。失败保留旧定义。卸载先撤视图再释放被引用的 handlers/mounts/subscriptions；异步迟到注册也须释放。动态内容提供器和回调留在所属进程，只传内容/描述。

## 表达式规则

表达式是受限语言，不执行 JavaScript。工作台中的普通名称调用插件后端 handler，`ui:名称` 调用来源页面 handler，`core:名称` 调用核心白名单；`watch:` 订阅只读结果。使用普通 `run(...)` 方法获得宿主绑定的 this，箭头函数不提供该上下文。

| 写法 | 含义/约束 |
| --- | --- |
| `demo.save()` | 显式零实参调用 |
| 事件顶层 `demo.save` | 唯一允许省略括号的位置，隐式传 `$event` 一个参数 |
| `${demo.read()}`、`${watch:demo.read()}` | 模板求值/订阅；处理器声明 readOnly: true；模板、嵌套调用、validator 都必须有括号 |
| `$for:field-name` | 读取并验证具名字段；用事件节点 for 声明提交/关联字段 |
| `$event`、`$prev` | 事件快照、同管道上一步结果；第一步不能读 $prev，模板不能读这两者 |
| `$this` | 仅用于 validator，表示当前候选值 |
| `a()\|b($prev)` | 同域管道；前端与后端不能通过管道或嵌套实参互传结果；反斜杠用于md表格正确渲染，实际使用时不包含反斜杠 |
| `a(),ui:b()` | 独立分支，可分别执行两域；不共享 $prev |

workbench HandlerContext 包含 invocation、instanceId、workspaceId/windowId、source/sourceTabId、event、readValue 和 signal。handler 定义可声明 reads，并在 watch 中返回释放函数。前端 handler 不可用时模板会显示不可用状态，不能自动打开页面或从别的标签借状态。

常见工作台内置调用包括 `core:validate`、`core:value.read/write`、`core:config.bound.read/write`、`core:notification.show`；其余以 declarative-ui.ts 的 pureNames/coreNames/effectNames 为准。`core:config.bound.read(key, field, fallback)` 建立基线，配套 write 保留并发保护；不要绕开基线来“修复”冲突。

## 字段类型与校验

字段值只有 string、boolean、string[]。`inputType: 'number'` 仍以字符串保存；core:validate 只检查、不转换，业务需要数字时显式用 core:number.parse 等转换。

input/textarea 以及自动绑定 setting 支持 minLength/maxLength/min/max/pattern/patternMessage/validator/placeholder/disabled/readonly，input 另有 inputType/step。长度按 JS UTF-16 字符串长度；数值范围含边界；pattern 是正则源码字符串，以 u 模式对完整值匹配，不写 `/.../flags`。JSON/TS 字符串中的反斜杠须正确转义。范围矛盾、非法正则和未知属性在编译时拒绝；patternMessage 必须同时有 pattern。step 是控件属性，不替代业务整数/精度规则。

自定义 validator 必须是显式只读调用，例如 `validation.same($this, $for:password)`；目标 handler 声明 readOnly: true，异步也可。返回值严格为 `{ success: boolean, message?: string }`，不能返回 true、字符串或通知对象。不要与后端 configuration.validate 的 `true | string` 契约混淆。验证器不执行写配置、通知或其他副作用。

依赖字段按拓扑顺序验证，依赖环在编译时拒绝；依赖失败保留该字段的错误归属。密码一致性检查前，应给两字段都声明各自长度与格式规则，不能用“两个无效值相等”代替有效性。

当前时机与阻断行为：

1. 输入时运行本地规则；隐式自定义控制器校验等到 blur。不要为每次输入额外发验证请求。
2. blur 和显式业务事件执行完整验证；带 validator 的自动绑定 text/number/password/textarea 在 blur 验证后保存，其他自动绑定通常在 change 保存。显式声明的事件仍按声明执行，不假定所有 change 都只做本地检查。
3. 读取 $for、core:value.read、模板字段引用和 watch 消费，以及向字段回填之前都会再验证；失败阻止该次消费、业务处理、配置写入或前端交付。不要以为只验证过点击提交就足够。
4. 后端配置 normalize 后的回值还须符合字段规则；若保存已成功而后续回值验证失败，不会回滚已经保存的配置，不自动重试该写入。

宿主处理字段内联反馈、UIError.field、编辑序号与迟到结果；不要为字段错误改成原生气泡或强制全局弹窗。输入提示可依据标签/说明空间显示文案或仅图标，悬浮全文由共享 tooltip 提供，插件无需重做布局逻辑。

## 有界内容与验证

只传有限、无循环的普通 JSON。当前内容限 256 KiB、单值 64 KiB，其他节点/字段/绑定额度读 UI_LIMITS，不用拆分副作用绕过执行预算。资源通过 `ui.apis.mountStatic` 注册受控文件/目录，内容引用其挂载的 `/web/ui/assets/...` 路径，避免任意远程 URL 或文件路径。

按实际修改验证有效内容可编译、非法调用/控件名/依赖环被拒、模板不会执行副作用、错误归属正确且旧响应不清新错误。工作台需要前端 handler 时覆盖来源文档及验证确认流程；脚本配置还需按对应运行器单独验证。示例见 template 的 input-validation-ui.ts、declarative-ui.ts，测试见 ui-compiler.test.ts、ui-expressions.test.ts 及模板集成测试。
