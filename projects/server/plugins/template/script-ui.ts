// 脚本/扩展配置协议显式使用 v2；内层 version: 1 是 JSON 内容格式版本。
export const scripts: SCWC.TScriptConfigV2 = {
  version: 'v2',
  title: '示例脚本',
  description: '这是一个示例脚本, 没有实际功能',
  // 这些控件只演示交互，无需等待完整抓取；v2 在整个 scripts 上声明采集要求。
  requireFullContent: false,
  content: {
    format: 'json',
    version: 1,
    root: {
      type: 'stack',
      direction: 'column',
      gap: 'medium',
      children: [
        { type: 'button', text: '示例按钮', events: { click: 'example()' } },
        {
          type: 'button',
          text: '测试 Button 控件',
          for: ['testToggle', 'testSelect', 'testInputText', 'testInputNumber', 'testCheckbox'],
          events: { click: 'testButton()' },
        },
        {
          type: 'toggle',
          name: 'testToggle',
          label: '测试 Toggle 控件',
          checked: false,
          for: 'testToggle',
          // 原 autoTrigger 改为显式 change 事件；关联字段可从 this.values 读取。
          events: { change: 'testToggle($for:testToggle)' },
        },
        {
          type: 'stack',
          direction: 'column',
          children: [
            { type: 'text', text: '测试 Select 控件' },
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
            {
              type: 'button',
              text: '触发 Select 控件',
              for: 'testSelect',
              events: { click: 'testSelect($for:testSelect)' },
            },
          ],
        },
        {
          type: 'stack',
          direction: 'column',
          children: [
            { type: 'text', text: '测试 Input text 控件' },
            { type: 'input', name: 'testInputText', value: 'default text' },
            {
              type: 'button',
              text: '触发 Input text 控件',
              for: 'testInputText',
              events: { click: 'testInputText($for:testInputText)' },
            },
          ],
        },
        {
          type: 'stack',
          direction: 'column',
          children: [
            { type: 'text', text: '测试 Input number 控件' },
            // v2 输入字段保存字符串，需要数字时在事件管道中转换。
            { type: 'input', inputType: 'number', name: 'testInputNumber', value: '42' },
            {
              type: 'button',
              text: '触发 Input number 控件',
              for: 'testInputNumber',
              events: { click: 'core:number.parse($for:testInputNumber)|testInputNumber($prev)' },
            },
          ],
        },
        { type: 'checkbox', name: 'testCheckbox', label: '测试 Checkbox 控件', checked: true },
        {
          type: 'button',
          text: '触发 Checkbox 控件',
          for: 'testCheckbox',
          events: { click: 'testCheckbox($for:testCheckbox)' },
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
