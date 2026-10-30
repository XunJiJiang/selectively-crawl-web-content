# 插件声明式 UI 使用说明

后端入口为 `onLoad` 的 `context.workbench.ui`。完整示例位于 `projects/server/plugins/template/declarative-ui.ts`，包含主侧栏、辅助页、状态项、核心配置监听和前端页面标题监听。

主侧栏、辅助侧栏和状态栏悬浮提示共用 JSON 组件格式。Tabs 可嵌套，标签的 `children` 是普通组件数组；每个标签栏独立保存选中项，支持点击、左右方向键及 Home/End。核心“页面信息”（内部标识 `currentPage`）也由 JSON Tabs 渲染，配置分组使用内层 Tabs。

JSON 支持的 `stack`、`text`、`icon`、`image`、`button`、`input`、`textarea`、`select`、`checkbox`、`toggle`、`form`、`progress`、`badge`、`divider`、`tabs` 共用工作台基础样式。所有布局容器、表单、Tabs 及标签内容均由工作台滚动组件包裹，标签栏单独横向滚动，键盘切换会显示目标标签。`select` 使用已有的工作台上下文菜单，选中值仍参与字段采集、事件关联和草稿恢复。`stack` 的 row 方向是普通横向布局；固定属性列宽只用于核心页面信息。

普通插件 HTML 页面可以直接引用服务端提供的 `/web/page/resources/styles/json-ui.css`，实际文件位于 `projects/server/public/resources/styles/json-ui.css`。该文件与 JSON 渲染、声明式 HTML 沙箱使用同一份基础样式；声明式沙箱已自动加载，无需额外引用。样式仅作用于 `.ui-root` 内部，使用工作台主题变量并提供默认颜色，独立页面可在 `html` 设置 `data-theme="light-2026"` 选择浅色外观。

```html
<link rel="stylesheet" href="/web/page/resources/styles/json-ui.css">
<div class="ui-root" data-layout="column" data-gap="medium">
  <span class="ui-text ui-text-title">设置</span>
  <input name="query" placeholder="输入搜索词">
  <label class="ui-toggle"><input type="checkbox"><span>自动保存</span></label>
  <select name="mode"><option value="simple">简洁模式</option></select>
  <button type="button">保存</button>
</div>
```

基础控件使用原生 HTML 标签；布局使用 `data-layout="row|column"` 与 `data-gap="small|medium|large"`；文本使用 `ui-text` 和 `ui-text-title|muted|code|success|warning|error`；徽章使用 `ui-badge` 和对应的 `ui-badge-*`；Tabs 使用 `ui-tabs`、`ui-tab-list`、`ui-tab-panel` 以及标准 tab/tabpanel 角色。CSS 仅提供外观，HTML 中的滚动、下拉选择和交互逻辑仍由页面负责；HTML 接入滚动容器与上下文菜单组件留待后续实现。

状态栏按钮使用紧凑布局，不预留属性列或空错误区。悬停/点击提示层按内容高度显示，底部三角指向按钮，超出视口时内部滚动；右键使用工作台已有上下文菜单，支持子菜单、勾选和禁用状态，菜单 action 继续通过后端声明式处理器执行。

辅助侧栏的“页面信息”和插件自定义页标签位于标题栏内，样式与高度和中心标签栏一致；只有一个页面时显示 strong 标题。插件页标签使用插件名称，按 `package.json.scwc.ui.title` → 导出 `name` → `package.json.name` → 文件夹名称解析。“页面信息”宽度固定，插件页按文字所需宽度显示，不拉伸填满右侧空间；空间不足时收缩并显示省略号，标签栏不横向滚动，关闭按钮保持在右侧。只有已经提供 JSON/HTML 模板或内容提供器后，才能设置 `hideCurrentPage: true` 或调用 `setCurrentPageVisible(false)` 隐藏“页面信息”；无模板的隐藏请求会被拒绝。

```ts
const content = {
  format: 'json',
  version: 1,
  root: {
    type: 'tabs',
    label: '页面',
    tabs: [
      { id: 'overview', label: '概览', children: [{ type: 'text', text: '页面信息' }] },
      {
        id: 'settings',
        label: '设置',
        children: [
          {
            type: 'tabs',
            label: '设置分组',
            tabs: [
              { id: 'general', label: '常规', children: [{ type: 'input', name: 'query' }] },
              { id: 'advanced', label: '高级', children: [{ type: 'textarea', name: 'rules' }] },
            ],
          },
        ],
      },
    ],
  },
};
```

```ts
async function onLoad(logger, { workbench }) {
  const ui = workbench.ui;
  await ui.handlers.register('search', {
    async run(event, limit, label, query) {
      return { limit, label, query };
    },
  });
  await ui.registerMainSidebar({
    id: 'search', title: '搜索', icon: { kind: 'builtin', name: 'search' },
    content: {
      format: 'html', version: 1,
      html: `<input name="query"><button for="query" onclick="search($event, 123, 'abc', $for:query)">搜索</button>`,
    },
  });
}
```

- `search` 默认传入过滤后的 `$event`；`search()` 为零实参。关联值位于事件的 `value/values` 中，`$for:query` 可显式取得字段值。
- `a(...)|b($prev)` 串行传递返回值，最外层逗号分隔独立分支。没有返回值时不能引用 `$prev`；`null` 是合法值。
- HTML 和 JSON 数据字段支持 `${core:get('xxx')}`。模板调用须声明 `readOnly: true`。在 JS 反引号字符串中写声明式插值时使用 `\${...}`，避免被 JS 提前插值。
- `${watch:query()}` 监听命名字段。`${watch:core:config.read('key')}` 监听权威配置；`${watch:core:get('config.key')}` 可使用统一获取器。
- 后端处理器提供 `watch(args, emit)` 时，返回注销函数；处理器函数及订阅回调始终留在所属进程。

普通插件前端通过 `scwcutils.ui.handlers.register(name, definition)` 注册页面处理器，以 `ui:name(...)` 或 `watch:ui:name(...)` 引用。前后端处理器不能在同一管道或嵌套参数中传值。

插件卡片“配置”入口没有来源插件页面，前端调用统一显示 `<无数据，需要打开插件页面>`；不会借用其他同插件标签。核心“当前页面”由核心 JSON 模板提供，不依赖这些前端处理器。

`scwcutils.config.get/subscribe` 保留只读能力。订阅会提供初始快照；配置变化由主页面派发，暂停页面的通知等待恢复，发生回放缺口时以权威快照重新同步。

原有前端 `page.register/update`、`settings.register`、`config.set/reset` 和页面配置校验票据已移除。配置定义、校验和持久修改应移到插件后端。旧定义在后端重新确认前只读，旧 `page-required` 定义必须显式迁移。

核心“当前页面”编辑保留本地草稿，远端变更不会覆盖正在编辑的值。发生冲突后，可接受远端值，或保留草稿并以新版本重新校验。
