# JSON 设置布局与配置绑定

工作台的主侧栏、辅助侧栏及状态栏提示内容均可使用以下 JSON。`setting` 表示一个设置行，`group` 将多个设置行合成一个连续面板。

```ts
const content = {
  format: 'json',
  version: 1,
  root: {
    type: 'group',
    label: '常规',
    description: '显示在分组标题下方。',
    footer: '显示在整个分组下方。',
    children: [
      {
        type: 'setting',
        label: '启用功能',
        description: '显示在设置名称下方。',
        config: 'general.enabled',
        valueType: 'boolean',
        defaultValue: 'false',
      },
      {
        type: 'setting',
        label: '并发数量',
        config: 'general.concurrency',
        valueType: 'integer',
        min: 1,
        max: 10,
        defaultValue: '3',
      },
      {
        type: 'setting',
        label: '布局密度',
        config: 'appearance.density',
        options: [
          { value: 'compact', label: '紧凑' },
          { value: 'comfortable', label: '宽松' },
        ],
        defaultValue: 'compact',
      },
    ],
  },
} satisfies UIContent;
```

设置行左侧显示 label 和小字 description，控件在右侧垂直居中；空间不足时控件换行，仍然居右。checkbox 始终显示在文字左侧。控件、独立设置行及整个分组均为 8px 圆角，分组内的行没有间隙和单独圆角。

`config` 是当前插件的配置键；点号按字面处理。`valueType` 默认为 `string`，支持 `boolean`、`number`、`integer`。核心默认分别选择文本框、开关和数字输入框；设置 `options` 时选择下拉框。可通过 `control` 指定 `text`、`textarea`、`number`、`switch`、`checkbox`、`select`、`color` 或 `readonly`；布尔值使用 switch/checkbox。`min`、`max`、`maxLength` 和 options 在核心校验。

不需要自定义控制器或 events。原生 `change` 时自动保存（文本框提交编辑或失焦时，开关和下拉框切换时）；带 `validator` 的文本、密码、数字及多行文本控件在 `blur` 完整验证通过后保存，编辑期间只检查本地规则。数据库始终存储字符串。读取优先使用后端配置值及后端默认值，缺失时使用此行的 `defaultValue`。已注册的后端规范化、校验、只读约束和定义确认规则继续生效。后端更新会通知已打开的视图；本地尚未保存的草稿不被覆盖。同一键的并发更改会报冲突并保留草稿，刷新后重新编辑；其他键的更新不会阻止保存。

这些自动数据库绑定仅用于工作台 JSON 表面。用户脚本/浏览器扩展的站点配置仍使用其既有的脚本协议。

需要自定义控制器时不设置 `config`，在 `children` 中提供一个既有控件，继续使用 name、value/checked 和 events：

```ts
{
  type: 'setting',
  label: '自定义动作',
  description: '保留已有的控制器和事件处理方式。',
  children: [{ type: 'button', text: '运行', events: { click: 'myHandler()' } }],
}
```

`config` 不能与 `children` 或 `events` 同时声明。后端 `configuration.definitions` 也支持可选的 `label`、`description`、`footer`，用于核心配置页的分组标题、上方说明和下方说明；配置项的 control 另支持 checkbox。核心配置页继续通过“保存更改”批量提交。

在“页面信息 → 配置”中，配置定义直接按连续分组显示。需要在一个定义内划分多个组时，通过 `groups` 引用同一个 `items` 列表中的配置项 id：

```ts
{
  id: 'general',
  schemaVersion: '1',
  label: '常规',
  groups: [
    { id: 'tasks', label: '任务', description: '分组上方说明', itemIds: ['limit'] },
    { id: 'behavior', label: '行为', footer: '分组下方说明', itemIds: ['enabled'] },
  ],
  items: [
    { id: 'limit', key: 'general.limit', label: '数量上限', control: 'number', defaultValue: '3' },
    { id: 'enabled', key: 'general.enabled', label: '启用', control: 'switch', defaultValue: 'true' },
  ],
}
```

分组只控制布局，不复制配置值或改变配置键。组 id 不能重复，每个 `itemIds` 必须引用存在且尚未分组的配置项；未被引用的配置项显示为独立设置行。不提供 groups 的旧定义继续显示为一个分组。所有组共用原有的保存、重置、后端校验及冲突处理。
