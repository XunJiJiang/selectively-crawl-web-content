# 脚本、扩展版本和插件配置

根目录 `package.json.version` 是产品版本的唯一来源。所有 `package.json` 构建命令先执行 `projects/scripts/sync-versions.ts`，递归同步 `projects` 下工作区项目（含浏览器扩展）的包版本。`projects/server/plugins` 与 `projects/terminal/plugins` 的业务插件保留独立版本；三个内置特例 `projects/server/plugins/template`、`projects/terminal/plugins/template`、`projects/terminal/plugins/scwc` 随根版本同步，没有 version 时自动补齐。依赖、构建产物、隐藏目录及目录链接不参与同步。也可在根目录执行 `bun run sync:versions` 单独同步，版本一致时不重写文件。

油猴脚本和浏览器扩展在构建时读取**根目录** `package.json.version`，通过 `X-SCWC-Version` 请求头发送给核心。脚本安装元数据、扩展清单和 ZIP 名仍读取各自包版本，构建前同步保证它们与根版本一致。Web 与核心一起发布，不发送此请求头。没有版本头的既有 Web/旧客户端请求保持原入口行为；新增客户端均发送版本头。

每条 HTTP 路由通过 `routeVersion('3.2.0')` 固定其最低客户端版本，路由辅助函数的每次调用也显式记录版本。路由发生协议变更时更新该字面量，同时更新 `projects/server/router/version.ts` 的 `LATEST_ROUTE_VERSION`。比较采用语义化版本：等于或高于最新版本正常返回；客户端低于最新版本但达到路由要求时保留业务数据并返回 `version.status = "warning"`；低于路由要求时返回 HTTP 426，业务处理器不执行。无效版本返回 HTTP 400。版本信息同时放在 URL 编码的 `X-SCWC-Version-Notice` 响应头中。

警告首次出现时显示，可选择“当前版本不再提示”；选择按当前客户端版本和服务端最新路由版本保存。再次升级客户端或服务端要求变化时重新提示。错误不能通过该选项隐藏。

## 配置协议

`pluginConfig.scripts.version` **未声明时是 v1**，v1 的 `controls` 和通道触发方式继续保留。JSON 配置必须显式声明 `version: 'v2'`，其 `content` 使用与侧边栏、状态栏 tooltip 相同的 `{ format: 'json', version: 1, root }`。外层 v2 是脚本配置协议版本，内层 `version: 1` 是现有 JSON 内容格式版本。

配置响应的 `compatibleVersions` 和每个插件携带以下范围：

```json
{ "v1": "0.0.1-3.1.29", "v2": "3.2.0-*" }
```

这些范围标识配置所属的客户端协议代际，边界包含端点，`*` 没有上限。当前 3.2.0 客户端在支持 v2 的同时继续保留 v1 渲染器，因此仍可渲染旧插件返回的 v1 配置。未知或已移除的配置代际停止渲染，显示所需范围、当前客户端版本，并建议升级插件。旧核心未发送范围时使用已知代际范围兼容。

## v2 示例

```ts
pluginConfig: {
  scripts: {
    version: 'v2',
    title: '导出',
    refreshRule: '//',
    requireFullContent: true,
    content: {
      format: 'json', version: 1,
      root: {
        type: 'stack', direction: 'column',
        children: [
          { type: 'input', name: 'filename', value: 'article' },
          {
            type: 'button', text: '导出', for: 'filename',
            events: { click: 'core:string.trim($for:filename)|export($prev)' },
          },
        ],
      },
    },
    handlers: {
      export: {
        async run(filename) {
          // this.version === 'v2'; this.site、this.data、this.values、this.logger、
          // this.signal、this.tasks 均来自当前后端调用上下文。
          return {
            type: 'notification',
            data: { type: 'success', message: `已导出 ${filename}` },
          };
        },
      },
    },
  },
}
```

独立组使用 `stack`，分组页面使用 `tabs`（每项包含 `id`、`label`、`children`），可嵌套已有表单、文本、按钮、输入、选择等 JSON 控件。按钮显示内容使用 `text`。`content` 也可为接收当前 `ScriptContext` 的异步后端函数。

自定义控件声明在 `components` 中，由后端函数返回标准 JSON 节点，再经同一个编译器验证。引用格式为 `{ type: 'custom', component: 'editor', props: { ... } }`；函数签名为 `(props, context) => UINode | Promise<UINode>`。自定义函数、事件处理器与可执行程序均留在插件进程，不发送到浏览器。脚本配置不调用插件页面处理器，也不加载远程脚本或样式。

事件语法沿用现有受限表达式，包括 `$event`、`$for:字段`、`$prev`、管道及分支。模板只能调用声明了 `readOnly: true` 的后端处理器；脚本配置不支持 `ui:` 前端处理器及自定义 `watch:` 订阅；核心配置绑定的 watch 由核心按现有取值协议轮询。可用的计算处理器为 `core:string.trim/concat/lower/upper`、`core:json.parse/stringify`、`core:number.parse/add/multiply`、`core:boolean.parse`、`core:not`、`core:equal`、`core:default` 和 `core:value.read`。处理器可返回原有 notification 对象供客户端显示。

字段值继续与网站配置同步，v2 字段使用 `v2:字段名` 保存，多选值编码为 JSON 字符串。刷新会恢复已保存值。v1 触发请求携带 `version: 'v1'`（省略仍默认 v1）；v2 事件请求携带 `version: 'v2'`、后端签发的实例与绑定身份、事件身份及字段快照。后端仅执行已编译的绑定，按页面地址隔离实例，重复事件身份保持幂等。刷新后迟到的客户端响应被丢弃。事件每实例串行，队列最多 32 项，执行超时 10 秒并向处理器传递取消信号。

扩展的插件标签刷新只请求被点击的插件配置，不刷新其他插件内容；刷新不切换当前标签。当前标签显示刷新按钮，其他标签在悬停或键盘聚焦时显示，加载期间显示 loading 图标。


## 设置行、分组和配置作用域

脚本和扩展复用工作台的 `setting`、`group`、JSON 编译器、固定渲染器和共享样式。`setting.children` 可提供单个自定义控件；`config` 自动绑定不能同时声明 `children` 或 `events`。

```ts
{
  type: 'group', label: '常规', description: '分组上方说明', footer: '分组下方说明',
  children: [
    { type: 'setting', label: '全局名称', config: 'name', valueType: 'string' },
    { type: 'setting', label: '本站启用', description: '同 origin 的路径共享',
      config: 'enabled', configScope: 'site', valueType: 'boolean', defaultValue: 'false' },
    { type: 'setting', label: '数量', config: 'limit', valueType: 'integer', min: 1, max: 10 },
  ],
}
```

`configScope` 默认是 `plugin`，与工作台一致，读取插件全局配置数据库，保留字符串值、字符串默认值、后端定义规则与校验器、值和定义双 revision 并发校验。`site` 仅用于脚本/扩展，复用核心按 HTTP(S) origin 隔离的网站快照和已有同步通知协议，以 `v2:config:配置键` 保存，布尔控件仍存布尔值，数字输入仍存字符串。自动绑定字段不复制到普通 `v2:字段名` 草稿；自定义控件继续使用原字段存储和多选 JSON 编码。

`valueType` 支持 string、boolean、number、integer；默认生成文本框、开关或数字输入，提供 `options` 时生成下拉框。`control` 可显式选择 text、textarea、number、switch、checkbox、select、color、readonly；min、max、maxLength 和 options 在核心校验，数字不会因校验而改变持久化类型。

`configuration.definitions[].groups` 是全局配置定义的布局元数据，`itemIds` 只引用同一定义的权威 `items[].id`。它不等同于 JSON 节点 `group.children`，不会复制值或改键；重复组 id、重复归组和悬空引用仍由后端拒绝，未归组项独立显示，旧平铺定义兼容。

同一模板的刷新串行并合并重复通知，只发布最终模板。切换插件保留各自视图、标签和草稿；模板替换复用渲染器以保持焦点、选区与滚动。自动绑定在活动视图每四秒只读取值。过期实例的读取最多恢复一次，成功清除错误，持续失败停止自动轮询；提交事件不会自动重放。恢复模板时携带脏字段的旧基线，同键远端变更仍拒绝覆盖草稿。
