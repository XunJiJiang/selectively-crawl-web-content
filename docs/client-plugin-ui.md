# 脚本、扩展版本和插件配置

油猴脚本和浏览器扩展在构建时读取**根目录** `package.json.version`，通过 `X-SCWC-Version` 请求头发送给核心。各工作区自己的包版本只用于原有安装包元数据。Web 与核心一起发布，不发送此请求头。没有版本头的既有 Web/旧客户端请求保持原入口行为；新增客户端均发送版本头。

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

事件语法沿用现有受限表达式，包括 `$event`、`$for:字段`、`$prev`、管道及分支。模板只能调用声明了 `readOnly: true` 的后端处理器；脚本配置不支持 `ui:` 前端处理器及 `watch:` 订阅。可用的计算处理器为 `core:string.trim/concat/lower/upper`、`core:json.parse/stringify`、`core:number.parse/add/multiply`、`core:boolean.parse`、`core:not`、`core:equal`、`core:default` 和 `core:value.read`。处理器可返回原有 notification 对象供客户端显示。

字段值继续与网站配置同步，v2 字段使用 `v2:字段名` 保存，多选值编码为 JSON 字符串。刷新会恢复已保存值。v1 触发请求携带 `version: 'v1'`（省略仍默认 v1）；v2 事件请求携带 `version: 'v2'`、后端签发的实例与绑定身份、事件身份及字段快照。后端仅执行已编译的绑定，按页面地址隔离实例，重复事件身份保持幂等。刷新后迟到的客户端响应被丢弃。事件每实例串行，队列最多 32 项，执行超时 10 秒并向处理器传递取消信号。

扩展的插件标签刷新只请求被点击的插件配置，不刷新其他插件内容；刷新不切换当前标签。当前标签显示刷新按钮，其他标签在悬停或键盘聚焦时显示，加载期间显示 loading 图标。
