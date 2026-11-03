import { globalSettings, siteSettings } from './settings-ui.ts';

// 外层 v2 是脚本/扩展协议，内层 version: 1 是 JSON 内容格式。
export const scripts: SCWC.TScriptConfigV2 = {
  version: 'v2',
  title: '配置样例',
  description: '设置行、连续分组、全局与本站自动绑定，以及自定义控制器。',
  requireFullContent: false,
  content: {
    format: 'json',
    version: 1,
    root: {
      type: 'tabs',
      key: 'script-settings-tabs',
      label: '插件配置样例',
      tabs: [
        { id: 'global', label: '插件全局配置', children: globalSettings() },
        { id: 'site', label: '本站配置', children: siteSettings() },
        {
          id: 'custom',
          label: '自定义控制器',
          children: [
            {
              type: 'group',
              label: '自定义字段',
              description: 'setting.children 提供一个控件；由下方按钮触发业务处理器。',
              footer:
                '这些是按网站保存的交互字段，不是 config 自动绑定。Toggle 单独演示 change 事件。',
              children: [
                {
                  type: 'setting',
                  label: '测试 Toggle 控件',
                  description: '切换时立即触发后端处理器，并读取关联字段。',
                  children: [
                    {
                      type: 'toggle',
                      name: 'testToggle',
                      checked: false,
                      for: 'testToggle',
                      events: { change: 'testToggle($for:testToggle)' },
                    },
                  ],
                },
                {
                  type: 'setting',
                  label: '测试 Select 控件',
                  children: [
                    {
                      type: 'select',
                      name: 'testSelect',
                      value: 'option1',
                      options: [
                        { label: '选项 1', value: 'option1' },
                        { label: '选项 2', value: 'option2' },
                        { label: '选项 3', value: 'option3' },
                      ],
                    },
                  ],
                },
                {
                  type: 'setting',
                  label: '测试 Input text 控件',
                  children: [{ type: 'input', name: 'testInputText', value: 'default text' }],
                },
                {
                  type: 'setting',
                  label: '测试 Input number 控件',
                  description: '字段仍保存字符串，需要数字时在事件管道中转换。',
                  children: [
                    { type: 'input', inputType: 'number', name: 'testInputNumber', value: '42' },
                  ],
                },
                {
                  type: 'setting',
                  label: '测试 Checkbox 控件',
                  description: '勾选框始终显示在文字左侧。',
                  children: [{ type: 'checkbox', name: 'testCheckbox', checked: true }],
                },
              ],
            },
            {
              type: 'stack',
              direction: 'row',
              children: [
                { type: 'button', text: '示例按钮', events: { click: 'example()' } },
                {
                  type: 'button',
                  text: '测试 Button 控件',
                  for: [
                    'testToggle',
                    'testSelect',
                    'testInputText',
                    'testInputNumber',
                    'testCheckbox',
                  ],
                  events: { click: 'testButton()' },
                },
                {
                  type: 'button',
                  text: '触发 Select 控件',
                  for: 'testSelect',
                  events: { click: 'testSelect($for:testSelect)' },
                },
                {
                  type: 'button',
                  text: '触发 Input text 控件',
                  for: 'testInputText',
                  events: { click: 'testInputText($for:testInputText)' },
                },
                {
                  type: 'button',
                  text: '触发 Input number 控件',
                  for: 'testInputNumber',
                  events: {
                    click: 'core:number.parse($for:testInputNumber)|testInputNumber($prev)',
                  },
                },
                {
                  type: 'button',
                  text: '触发 Checkbox 控件',
                  for: 'testCheckbox',
                  events: { click: 'testCheckbox($for:testCheckbox)' },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  // 使用普通方法取得当前 ScriptContext；函数留在插件进程，不发送到浏览器。
  handlers: {
    example: {
      async run() {
        return { type: 'notification', data: { type: 'info', message: '你点击了示例按钮' } };
      },
    },
    testButton: {
      async run() {
        this.logger.info('Button 控件触发了');
        this.logger.info('相关值:', this.values);
        return { type: 'notification', data: { type: 'success', message: 'Button 控件触发了' } };
      },
    },
    testToggle: {
      async run(value) {
        const relatedValues = { testSelect: this.values.testSelect };
        this.logger.info('Toggle 控件触发了');
        this.logger.info('当前值:', value);
        this.logger.info('相关值:', relatedValues);
        return {
          type: 'notification',
          data: {
            type: 'success',
            message: `Toggle 控件触发了, 当前值: ${value}, 相关值: ${JSON.stringify(relatedValues)}`,
          },
        };
      },
    },
    testSelect: {
      async run(value) {
        const relatedValues = {
          testToggle: this.values.testToggle,
          testInputText: this.values.testInputText,
        };
        this.logger.info('Select 控件触发了');
        this.logger.info('当前值:', value);
        this.logger.info('相关值:', relatedValues);
        return {
          type: 'notification',
          data: {
            type: 'success',
            message: `Select 控件触发了, 当前值: ${value}, 相关值: ${JSON.stringify(relatedValues)}`,
          },
        };
      },
    },
    testInputText: {
      async run(value) {
        this.logger.info('Input text 控件触发了');
        this.logger.info('当前值:', value);
        return {
          type: 'notification',
          data: { type: 'success', message: `Input text 控件触发了, 当前值: ${value}` },
        };
      },
    },
    testInputNumber: {
      async run(value) {
        this.logger.info('Input number 控件触发了');
        this.logger.info('当前值:', value);
        return {
          type: 'notification',
          data: { type: 'success', message: `Input number 控件触发了, 当前值: ${value}` },
        };
      },
    },
    testCheckbox: {
      async run(value) {
        this.logger.info('Checkbox 控件触发了');
        this.logger.info('当前值:', value);
        return {
          type: 'notification',
          data: { type: 'success', message: `Checkbox 控件触发了, 当前值: ${value}` },
        };
      },
    },
  },
};
