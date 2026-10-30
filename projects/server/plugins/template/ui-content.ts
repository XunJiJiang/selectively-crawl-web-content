import type { UIContent, UINode, StatusBarDefinition } from '../../../shared/declarative-ui.ts';

export const ids = { main: 'template-overview', aux: 'template-details', status: 'template-state' };
const text = (value: string): UINode => ({ type: 'text', text: value });
const button = (label: string, click: string, extra: Partial<UINode> = {}): UINode => ({
  type: 'button',
  text: label,
  events: { click },
  ...extra,
});

// These are real bound programs, also consumed by boundary tests and the coverage table.
export const coreExamples: [string, string][] = [
  [
    'trim / lower / upper',
    "core:string.trim(' AbC ')|core:string.lower($prev)|core:string.upper($prev)",
  ],
  ['toString', 'core:string.toString(123)'],
  ['number.parse', "core:number.parse('12.5')"],
  ['boolean.parse', "core:boolean.parse('false')"],
  ['json.parse / stringify', `core:json.parse('{"a":[1,2]}')|core:json.stringify($prev)`],
  ['object.get', "core:object.get({a:{b:'ok'}}, ['a','b'])"],
  ['object.pick', "core:object.pick({a:1,b:2,c:3}, ['a','b'])"],
  ['array.first / length', 'core:array.first([[1,2],3])|core:array.length($prev)'],
  ['default(null)', "core:default(null, 'fallback')"],
  ['validate', "core:validate('3', {codec:'integer',min:1,max:10,maxLength:2,options:['3','4']})"],
  [
    'value.read / write',
    "core:value.read('query')|core:value.write('query', core:string.upper($prev))",
  ],
  ['get(config)', "core:get('config.validation.note')"],
  ['get(inspector)', "core:get('inspector.page.title')"],
  ['get(reader)', "core:get('demo.reader')"],
  ['get(empty)', "core:get('')"],
  [
    'config.read / write',
    "core:config.read('validation.note')|core:config.write('validation.note', $for:query)",
  ],
  ['null return', 'demo.null()'],
  ['zero arguments', 'demo.record()'],
  ['escaped literals', String.raw`demo.echo('it\'s', "a\"b", [1,null], {a:'b'})`],
];
export const negativePrograms = [
  'demo.echo()|ui:template.record($prev)',
  'demo.echo(ui:template.selection())',
  'ui:template.record()|demo.echo($prev)',
  'core:ui:template.selection()',
];
export function mainContent(note = '静态 JSON 来源'): UIContent {
  return {
    format: 'json',
    version: 1,
    root: {
      type: 'tabs',
      key: 'demo-tabs',
      label: '模板接入示例',
      tabs: [
        {
          id: 'arguments',
          label: '名称 / 参数',
          children: [
            text(note),
            { type: 'badge', text: '后端 ${watch:demo.counter()}', tone: 'success' },
            text('最近调用：${core:json.stringify(watch:demo.snapshot())}'),
            {
              type: 'form',
              name: 'queryForm',
              events: { submit: 'demo.capture' },
              children: [
                {
                  type: 'input',
                  key: 'query',
                  name: 'query',
                  value: '  hello   world  ',
                  placeholder: 'query',
                  events: {
                    input: 'demo.record',
                    change: 'demo.record',
                    focus: 'demo.record',
                    blur: 'demo.record',
                  },
                },
                { type: 'textarea', name: 'memo', value: '备注' },
                {
                  type: 'select',
                  name: 'choice',
                  value: 'a',
                  options: [
                    { value: 'a', label: '选项 A' },
                    { value: 'b', label: '选项 B' },
                  ],
                  events: { change: 'demo.record' },
                },
                {
                  type: 'checkbox',
                  name: 'checked',
                  checked: true,
                  label: 'checkbox',
                  events: { change: 'demo.record' },
                },
                { type: 'toggle', name: 'toggle', checked: false, label: 'toggle' },
                { type: 'button', text: '提交声明字段', submit: true },
              ],
            },
            button('裸名称（唯一参数 $event）', 'demo.record', { for: 'query' }),
            button(
              '显式 $event + 多关联字段',
              "demo.echo($event,123,'abc',$for:query)|demo.record($prev)",
              { for: ['query', 'memo'] },
            ),
            button(
              '同域异步链',
              "core:string.trim($for:query)|demo.normalize($prev)|core:value.write('query',$prev)",
              { for: 'query' },
            ),
            button(
              '独立前后端分支',
              "demo.record($event),ui:template.record($event,123,'abc',$for:query)",
              { for: 'query' },
            ),
            button('合法嵌套触发', "core:event.trigger('eventTarget','click')"),
            button('事件目标', 'demo.record', { name: 'eventTarget' }),
            button('停止分支', "core:flow.stop()|demo.record('不应执行')"),
            button('无返回值（预期拒绝 $prev）', 'demo.void()|demo.record($prev)'),
            button('异步取消（等待中从普通页释放演示）', 'demo.wait()|demo.record($prev)'),
            button('循环触发模板（预期拒绝注册）', "demo.manage('reject.cycle')"),
            button('跨域管道（预期拒绝注册）', "demo.manage('reject.cross')"),
            text('纯文本：${demo.literal()}'),
          ],
        },
        {
          id: 'data',
          label: '数据 / 监听',
          children: [
            text('字段：${watch:query()}'),
            text("后端 getter：${demo.reader()} / ${core:get('demo.reader')}"),
            text('后端 counter：${watch:demo.counter()}'),
            text("配置 get：${watch:core:get('config.validation.note')}"),
            text("配置 read：${watch:core:config.read('validation.note')}"),
            text('前端标题：${watch:ui:template.title()}'),
            text('前端 getter：${ui:template.selection()}'),
            text('前端 watch：${watch:ui:template.selection()}'),
            button('后端计数 +1', "demo.manage('bump')"),
            button('前端当前页 +1', "ui:template.record('increment')"),
            { type: 'progress', value: '${demo.progress()}' },
            { type: 'divider' },
            {
              type: 'tabs',
              label: '嵌套标签（方向键/Home/End）',
              tabs: [
                { id: 'one', label: '第一项', children: [text('更新内容保留稳定 key/id')] },
                { id: 'two', label: '第二项', children: [text('只调用只读处理器')] },
              ],
            },
          ],
        },
        {
          id: 'core',
          label: '配置 / 核心',
          children: [
            ...coreExamples.map(([label, program]) =>
              button(label, `${program}|demo.record($prev)`, { for: 'query' }),
            ),
            button('无效数字', "core:number.parse('oops')"),
            button('无效布尔值', "core:boolean.parse('yes')"),
            button('字段写入类型错误', "core:value.write('checked','true')"),
            button('打开辅助页', `core:view.open('auxiliarySidebar','${ids.aux}')`),
            button('刷新主侧栏', `core:view.refresh('mainSidebar','${ids.main}')`),
            button('打开插件页面', "core:page.open('')"),
            button('核心配置入口', 'core:settings.open()'),
            button('聚焦 query', "core:element.focus('query')"),
            button('折叠命名区域', "core:section.toggle('detailSection')"),
            button('滚动到命名区域', "core:scroll.to('detailSection')"),
            {
              type: 'stack',
              name: 'detailSection',
              visible: true,
              children: [text('受控命名区域；不接受任意选择器')],
            },
            button('复制 query（真实点击）', 'core:clipboard.writeText($for:query)', {
              for: 'query',
            }),
            button('打开外链（真实点击）', "core:link.openExternal('https://example.com')"),
            ...['info', 'success', 'warning', 'error'].map((level) =>
              button(`通知 ${level}`, `core:notification.show('模板 ${level}','${level}')`),
            ),
          ],
        },
        {
          id: 'lifecycle',
          label: 'UI / 生命周期',
          children: [
            { type: 'icon', icon: { kind: 'builtin', name: 'beaker' }, label: '内置图标' },
            { type: 'icon', icon: { kind: 'asset', path: '/demo.svg' }, label: '资源图标' },
            { type: 'image', src: '/demo-assets/mark.svg', alt: '目录根层资源' },
            { type: 'image', src: '/demo-assets/nested/mark.svg', alt: '目录嵌套资源' },
            ...[
              'main.set',
              'main.content',
              'target',
              'aux.json',
              'aux.html',
              'aux.content',
              'hide',
              'show',
              'invalid',
              'inspector',
              'inspector.target',
              'tooltip',
              'status.disabled',
              'status.visible',
              'status.dispose',
              'aux.dispose',
              'main.dispose',
            ].map((action) => button(action, `demo.manage('${action}')`)),
            text('注销主侧栏后，从普通插件页“恢复声明式演示”恢复；不重新启动服务。'),
          ],
        },
      ],
    },
  };
}

export function auxiliaryContent(format: 'html' | 'json'): UIContent {
  if (format === 'json')
    return {
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        children: [
          text('辅助页 JSON · ${watch:demo.counter()}'),
          text('${watch:ui:template.selection()}'),
          button('此实例定向更新', "demo.manage('target')"),
          button('恢复页面信息', "demo.manage('show')"),
          button('切换 HTML', "demo.manage('aux.html')"),
        ],
      },
    };
  return {
    format: 'html',
    version: 1,
    html: `
    <style>
      section { font: 14px/1.5 system-ui; font-family: var(--font-sans); color: #ddd; color: var(--text-primary); background: #181a20; background: var(--surface-2); padding: 12px; border: 1px solid #555; border-color: var(--border-default); border-radius: 4px; }
      h3 { margin: 0 0 8px; } p { margin: 8px 0; } button,input { font: inherit; color: inherit; background: #25272b; background: var(--surface-4); border: 1px solid #555; border-color: var(--border-default); border-radius: 4px; padding: 6px; margin: 4px; max-width: 100%; }
      button:focus,input:focus { border-color: #38bdf8; border-color: var(--border-focus); } button:disabled { opacity: .5; } img { width: 32px; height: 32px; } pre { white-space: pre-wrap; }
    </style>
    <section name="htmlSection" onmouseenter="demo.record" onmouseleave="demo.record">
      <h3>辅助页 HTML</h3><img src="/demo.svg" alt="单文件挂载">
      <p>配置：\${watch:core:config.read('validation.note')}</p>
      <p>前端标题：\${watch:ui:template.title()}</p><p>前端状态：\${watch:ui:template.selection()}</p>
      <pre>\${demo.literal()}</pre>
      <input name="htmlQuery" value="HTML 字段" oninput="demo.record" onchange="demo.record" onfocus="demo.record" onblur="demo.record">
      <button for="htmlQuery" onclick="demo.echo($event,123,'abc',$for:htmlQuery)|demo.record($prev)" oncontextmenu="demo.record">HTML 参数 / 右键</button>
      <button onclick="demo.manage('target')">此实例定向更新</button>
      <button onclick="demo.manage('aux.json')">切换 JSON</button>
      <button onclick="demo.manage('show')">恢复页面信息</button>
    </section>`,
  };
}
export function statusDefinition(
  mode = 0,
  count = 0,
  disabled = false,
  visible = true,
): StatusBarDefinition {
  const contents = [
    { format: 'text' as const, text: `文本提示 · 后端计数 ${count}` },
    {
      format: 'json' as const,
      version: 1 as const,
      root: {
        type: 'stack',
        children: [
          text('JSON 提示 · ${watch:demo.counter()}'),
          button('固定', 'core:tooltip.pin()'),
          button('关闭提示层', 'core:tooltip.close()'),
        ],
      },
    },
    {
      format: 'html' as const,
      version: 1 as const,
      html: '<p>HTML 提示 · ${watch:demo.counter()}</p><button onclick="core:tooltip.pin()">固定</button><button onclick="core:tooltip.close()">关闭提示层</button>',
    },
  ];
  return {
    id: ids.status,
    ariaLabel: '模板验证状态',
    text: `模板验证 \${watch:demo.counter()}`,
    icon: { kind: 'builtin', name: 'info' },
    alignment: 'left',
    priority: 10,
    visible,
    disabled,
    events: { click: 'core:tooltip.open()', contextmenu: 'core:menu.open()', hover: 'demo.record' },
    tooltip: {
      width: 300,
      // Core currently normalizes text before resolving a provider. Keep text static;
      // JSON/HTML still demonstrate async providers without changing core code.
      content:
        mode % 3 === 0
          ? contents[0]
          : async (context) => {
              context.signal.throwIfAborted();
              return contents[mode % 3];
            },
    },
    contextMenu: [
      {
        kind: 'item',
        id: 'settings',
        label: '打开配置',
        icon: { kind: 'builtin', name: 'settings' },
        action: 'core:settings.open()',
      },
      {
        kind: 'checkbox',
        id: 'checked',
        label: '计数为正',
        checked: '${demo.positive()}',
        action: "demo.manage('bump')",
      },
      {
        kind: 'submenu',
        id: 'more',
        label: '更多',
        children: [
          { kind: 'item', id: 'format', label: '切换提示格式', action: "demo.manage('tooltip')" },
          {
            kind: 'item',
            id: 'unavailable',
            label: '禁用项',
            disabled: true,
            action: 'demo.record',
          },
        ],
      },
      { kind: 'separator' },
      { kind: 'item', id: 'close', label: '关闭提示层', action: 'core:tooltip.close()' },
    ],
  };
}
