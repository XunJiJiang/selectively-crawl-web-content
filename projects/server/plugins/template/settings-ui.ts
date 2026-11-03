import type { UINode } from '../../../shared/declarative-ui.ts';

// JSON group.children 是渲染布局；后端 configuration.definitions.groups 仍以 itemIds 引用 items。
/** 工作台、脚本和扩展共用现有 configuration.items 的全局键，不复制配置值。 */
export function globalSettings(): UINode[] {
  return [
    {
      type: 'group',
      key: 'global-content',
      label: '内容与数量',
      description: '插件全局配置：与工作台配置页共用同一份数据。',
      footer: '修改后自动保存；数字在插件配置数据库中仍保存为字符串。',
      children: [
        {
          type: 'setting',
          name: 'plugin.note',
          label: '验证说明',
          description: '保存时去除首尾空格；包含 reject 会被后端拒绝。',
          config: 'validation.note',
          configScope: 'plugin', // 默认作用域；这里显式写出以便与 site 对照。
          valueType: 'string',
          maxLength: 120,
        },
        {
          type: 'setting',
          name: 'plugin.memo',
          label: '备注',
          description: '多行文本，上限 500 字。',
          config: 'validation.memo',
          control: 'textarea',
          maxLength: 500,
        },
        {
          type: 'setting',
          name: 'plugin.limit',
          label: '数量上限',
          description: '只能保存 1–10 之间的整数。',
          config: 'validation.limit',
          valueType: 'integer',
          min: 1,
          max: 10,
        },
      ],
    },
    {
      type: 'group',
      key: 'global-appearance',
      label: '开关与外观',
      description: '开关居右，checkbox 始终位于文字左侧。',
      children: [
        {
          type: 'setting',
          name: 'plugin.enabled',
          label: '启用验证',
          config: 'validation.enabled',
          valueType: 'boolean',
        },
        {
          type: 'setting',
          name: 'plugin.confirm',
          label: '勾选验证项',
          description: '示例：checkbox 搭配标题和下方说明。',
          config: 'validation.confirm',
          valueType: 'boolean',
          control: 'checkbox',
        },
        {
          type: 'setting',
          name: 'plugin.mode',
          label: '布局密度',
          config: 'validation.mode',
          options: [
            { value: 'compact', label: '紧凑' },
            { value: 'comfortable', label: '舒适' },
          ],
        },
        {
          type: 'setting',
          name: 'plugin.color',
          label: '主题色',
          config: 'validation.color',
          control: 'color',
        },
      ],
    },
    {
      type: 'setting',
      name: 'plugin.contract',
      label: '页面接口版本',
      description: '未放入 group 的独立设置行；只读值由后端定义提供。',
      config: 'validation.contract',
      control: 'readonly',
    },
  ];
}

/** 工作台的显式控制器写法：自己声明控件和事件，核心仍负责配置基线、校验和持久化。 */
export function controllerSettings(): UINode[] {
  return [
    {
      type: 'group',
      key: 'controller-settings',
      label: '自定义控制器',
      description: '显式声明控件与事件；说明由 demo.normalize 控制器合并连续空白。',
      footer: '修改后保存到同一份全局配置，可在自动绑定页和“页面信息 → 配置”中查看。',
      children: [
        {
          type: 'setting',
          label: '验证说明',
          description: '去除首尾空格、合并连续空白；包含 reject 时仍由后端拒绝。',
          children: [
            {
              type: 'input',
              name: 'controller.note',
              maxLength: 120,
              value: "${watch:core:config.bound.read('validation.note','controller.note','')}",
              events: {
                change:
                  "core:string.trim($for:controller.note)|demo.normalize($prev)|core:validate($prev,{codec:'string',maxLength:120})|core:config.bound.write('validation.note','controller.note',$prev)|demo.record($prev)",
              },
            },
          ],
        },
        {
          type: 'setting',
          label: '数量上限',
          description: '显式解析并校验整数，再保存配置和记录控制器调用。',
          children: [
            {
              type: 'input',
              name: 'controller.limit',
              inputType: 'number',
              min: 1,
              max: 10,
              value: "${watch:core:config.bound.read('validation.limit','controller.limit','3')}",
              events: {
                change:
                  "core:validate($for:controller.limit,{codec:'integer',min:1,max:10})|core:string.toString($prev)|core:config.bound.write('validation.limit','controller.limit',$prev)|demo.record($prev)",
              },
            },
          ],
        },
        {
          type: 'setting',
          label: '勾选验证项',
          description: '自定义 checkbox 的 change 事件，控件在文字左侧。',
          children: [
            {
              type: 'checkbox',
              name: 'controller.confirm',
              checked:
                "${core:boolean.parse(watch:core:config.bound.read('validation.confirm','controller.confirm','false'))}",
              events: {
                change:
                  "core:validate($for:controller.confirm,{codec:'boolean'})|core:string.toString($prev)|core:config.bound.write('validation.confirm','controller.confirm',$prev)|demo.record($prev)",
              },
            },
          ],
        },
      ],
    },
    { type: 'text', text: '最近控制器调用：${core:json.stringify(watch:demo.snapshot())}' },
  ];
}

/** site 仅面向脚本/扩展，按 origin 保存，不进入插件全局 configuration.items。 */
export function siteSettings(): UINode[] {
  return [
    {
      type: 'group',
      key: 'site-preferences',
      label: '本站配置',
      description: '同一 origin 的页面、脚本和扩展共享；其他网站分别保存。',
      footer: '切换路径不切换配置。布尔控件保存布尔值，数字输入仍保存字符串。',
      children: [
        {
          type: 'setting',
          name: 'site.enabled',
          label: '本站启用',
          config: 'enabled',
          configScope: 'site',
          valueType: 'boolean',
          defaultValue: 'true',
        },
        {
          type: 'setting',
          name: 'site.prefix',
          label: '本站前缀',
          description: '最多 24 字，与其他网站的前缀相互独立。',
          config: 'prefix',
          configScope: 'site',
          defaultValue: '采集',
          maxLength: 24,
        },
        {
          type: 'setting',
          name: 'site.scale',
          label: '本站倍率',
          description: 'number 示例：允许 0.25–4 之间的小数。',
          config: 'scale',
          configScope: 'site',
          valueType: 'number',
          defaultValue: '1',
          min: 0.25,
          max: 4,
        },
        {
          type: 'setting',
          name: 'site.limit',
          label: '本站数量',
          config: 'limit',
          configScope: 'site',
          valueType: 'integer',
          defaultValue: '3',
          min: 1,
          max: 10,
        },
        {
          type: 'setting',
          name: 'site.format',
          label: '本站格式',
          config: 'format',
          configScope: 'site',
          defaultValue: 'markdown',
          options: [
            { value: 'markdown', label: 'Markdown' },
            { value: 'text', label: '纯文本' },
          ],
        },
      ],
    },
  ];
}
