/** A portable example: all implementation callbacks stay in this plugin process. */
export async function registerDeclarativeDemo(ui: SCWC.ILoadContext['workbench']['ui']) {
  await ui.handlers.register('demo.normalize', {
    readOnly: true,
    run(value) {
      if (typeof value !== 'string') throw new Error('需要字符串');
      return value.replace(/\s+/g, ' ');
    },
  });
  await ui.inspector.register({
    provide() {
      return { properties: [{ key: 'handlers', label: '声明式处理器', value: '独立后端进程' }] };
    },
  });
  const program =
    "core:string.trim($for:query)|demo.normalize($prev, 123, 'abc')|core:value.write('query', $prev)";
  await ui.registerMainSidebar({
    id: 'template-overview',
    title: '模板验证',
    icon: { kind: 'builtin', name: 'beaker' },
    content: {
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        direction: 'column',
        gap: 'medium',
        children: [
          { type: 'input', name: 'query', value: '' },
          {
            type: 'button',
            name: 'normalize',
            for: 'query',
            text: '规范化输入',
            events: { click: program },
          },
          { type: 'text', text: '输入预览：${watch:query()}' },
          { type: 'text', text: "配置：${watch:core:config.read('validation.note')}" },
          {
            type: 'button',
            text: '打开辅助页',
            events: { click: "core:view.open('auxiliarySidebar', 'template-details')" },
          },
        ],
      },
    },
  });
  await ui.registerAuxiliarySidebar({
    id: 'template-details',
    title: '模板详情',
    icon: { kind: 'builtin', name: 'info' },
    content: {
      format: 'html',
      version: 1,
      html: `
      <h3>模板详情</h3>
      <p>配置：\${watch:core:config.read('validation.note')}</p>
      <p>前端页面标题：\${watch:ui:template.title()}</p>
      <button onclick="core:page.open('')">打开插件页面</button>
    `,
    },
  });
  await ui.registerStatusBar({
    id: 'template-state',
    ariaLabel: '模板验证状态',
    text: '模板验证',
    icon: { kind: 'builtin', name: 'info' },
    tooltip: {
      content: {
        format: 'html',
        version: 1,
        html: `<p>配置：\${watch:core:config.read('validation.note')}</p><button onclick="core:tooltip.close()">关闭提示层</button>`,
      },
    },
    contextMenu: [
      { kind: 'item', id: 'template-settings', label: '打开配置', action: 'core:settings.open()' },
    ],
  });
}
