import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { defaultSiteData } from '../../shared/userscript-config.ts';
import { ScriptUIRuntime } from '../../server/user-script/ui.ts';
import type { ScriptConfigV2, ScriptContext } from '../../shared/script-ui.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const rootVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const scriptUI = new ScriptUIRuntime();
const configRequests = new Map<string, number>();
const jsonConfig: ScriptConfigV2 = {
  version: 'v2',
  title: 'JSON 插件',
  content: {
    format: 'json',
    version: 1,
    root: {
      type: 'tabs',
      tabs: [
        { id: 'edit', label: '编辑', children: [{ type: 'custom', component: 'editor' }] },
        { id: 'about', label: '说明', children: [{ type: 'text', text: '后端生成的 JSON 配置' }] },
        {
          id: 'layout',
          label: '设置布局',
          children: [
            {
              type: 'group',
              label: '常规',
              description: '分组上方说明',
              footer: '分组下方说明',
              children: [
                {
                  type: 'setting',
                  label: '文本',
                  description: '较长的说明在窄屏上应换行且保持控件右齐',
                  children: [{ type: 'input', name: 'layout-text', value: 'draft' }],
                },
                {
                  type: 'setting',
                  label: '数量',
                  children: [
                    { type: 'input', inputType: 'number', name: 'layout-number', value: '3' },
                  ],
                },
                {
                  type: 'setting',
                  label: '开关',
                  children: [{ type: 'toggle', name: 'layout-toggle', checked: true }],
                },
                {
                  type: 'setting',
                  label: '勾选',
                  description: '勾选框始终在文字左侧',
                  children: [{ type: 'checkbox', name: 'layout-check' }],
                },
                {
                  type: 'setting',
                  label: '模式',
                  children: [
                    { type: 'select', name: 'layout-mode', options: ['a', 'b'], value: 'a' },
                  ],
                },
                {
                  type: 'setting',
                  label: '颜色',
                  children: [
                    { type: 'input', inputType: 'color', name: 'layout-color', value: '#38bdf8' },
                  ],
                },
                {
                  type: 'setting',
                  label: '备注',
                  children: [{ type: 'textarea', name: 'layout-memo', value: 'long content' }],
                },
                { type: 'setting', label: '只读', children: [{ type: 'text', text: '只读配置' }] },
                ...Array.from({ length: 8 }, (_, i) => ({
                  type: 'setting',
                  label: `更多设置 ${i + 1}`,
                  children: [{ type: 'input', name: `layout-extra${i}`, value: '' }],
                })),
              ],
            },
            {
              type: 'button',
              key: 'layout-save',
              text: '保存',
              for: 'layout-text',
              events: { click: 'submit($for:layout-text)' },
            },
            { type: 'icon', icon: { kind: 'builtin', name: 'settings' } },
          ],
        },
      ],
    },
  },
  components: {
    editor: () => ({
      type: 'stack',
      children: [
        { type: 'input', name: 'q', value: 'article', placeholder: '导出名称' },
        {
          type: 'button',
          text: '执行管道',
          for: 'q',
          events: { click: 'core:string.trim($for:q)|submit($prev)' },
        },
      ],
    }),
  },
  handlers: {
    submit: {
      run(value) {
        return {
          type: 'notification',
          data: {
            type: 'success',
            message: `JSON ${value} / ${this.data.length} items / ${this.version}`,
          },
        };
      },
    },
  },
};
function scriptContext(url: string, data: SCWC.TDataItem[] = []): ScriptContext {
  const site = new URL(url);
  return {
    version: 'v2',
    site: {
      url,
      rootUrl: site.origin,
      origin: site.origin,
      pathname: site.pathname,
      host: site.host,
      hostname: site.hostname,
    },
    data,
    values: {},
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      pathInfo: () => undefined,
    },
  };
}
const fixture = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    assert.equal(request.headers['x-scwc-version'], rootVersion);
    console.log('HTTP', request.method, url.pathname, request.headers.origin);
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = body ? JSON.parse(body) : {};
    response.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/sync')) {
      response.end(JSON.stringify({ success: true, data: { snapshot: input.snapshot } }));
    } else if (url.pathname.endsWith('/config')) {
      const pluginId = url.searchParams.get('pluginId');
      if (pluginId) {
        await delay(250);
      }
      for (const id of pluginId ? [pluginId] : ['demo', 'json']) {
        configRequests.set(id, (configRequests.get(id) ?? 0) + 1);
      }
      const jsonPlugin =
        pluginId === 'demo'
          ? undefined
          : {
              id: 'json',
              version: 'v2',
              title: 'JSON 插件',
              description: '分组布局、自定义控件与后端管道',
              controls: [],
              ui: await scriptUI.render(
                jsonConfig,
                scriptContext(url.searchParams.get('site') ?? ''),
              ),
              compatibleVersions: { v1: '0.0.1-3.1.29', v2: '3.2.0-*' },
            };
      response.end(
        JSON.stringify({
          code: 200,
          data: [
            {
              id: 'demo',
              title: '测试插件',
              description: '浏览器集成验证',
              controls: [
                {
                  type: 'select',
                  label: '导出格式',
                  channel: 'format',
                  options: {
                    options: [
                      { label: 'Markdown', value: 'md' },
                      { label: '纯文本', value: 'text' },
                    ],
                    defaultValue: 'md',
                  },
                },
              ],
            },
            ...(jsonPlugin ? [jsonPlugin] : []),
          ].filter((plugin) => !pluginId || plugin.id === pluginId),
          activeIds: ['demo', 'json'],
          updatedIds: pluginId ? [pluginId] : ['demo', 'json'],
        }),
      );
    } else if (url.pathname.endsWith('/event')) {
      assert.equal(input.version, 'v2');
      const { id: _, data, ...event } = input;
      response.end(
        JSON.stringify({
          code: 200,
          data: await scriptUI.event(
            event,
            scriptContext(url.searchParams.get('site') ?? '', data),
          ),
        }),
      );
    } else {
      response.end(
        JSON.stringify({ success: true, message: '采集成功', data: ['浏览器集成验证成功'] }),
      );
    }
  } else {
    response.setHeader('content-type', 'text/html');
    if (url.pathname === '/strict') {
      response.setHeader(
        'content-security-policy',
        "script-src 'self'; connect-src 'none'; font-src 'none'; img-src 'none'",
      );
    }
    response.end(
      '<!doctype html><meta charset="utf-8"><title>采集测试页</title><article id="article"><h1>网页采集测试</h1><p id="text">Hello <b>SCWC</b></p></article>',
    );
  }
});
await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixturePort = (fixture.address() as { port: number }).port;
const site = `http://localhost:${fixturePort}/article`;
const profile = await fs.mkdtemp(path.join(root, 'node_modules/.tmp/scwc-browser-smoke-'));
// 仅测试副本预授予隔离 HTTP 夹具权限；产品包仍使用 optional_host_permissions 的用户确认。
const testExtension = path.join(profile, 'test-extension');
await fs.cp(path.join(root, 'dist/browser-extension/chromium'), testExtension, { recursive: true });
const testManifest = JSON.parse(
  await fs.readFile(path.join(testExtension, 'manifest.json'), 'utf8'),
);
testManifest.host_permissions = ['http://127.0.0.1/*'];
await fs.writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(testManifest));
const executable =
  process.env.SCWC_CHROME_BINARY ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let socket: WebSocket | undefined;
const pending = new Map<
  number,
  { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
>();
let next = 0;
async function cdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('CDP 尚未连接或已经断开');
  }
  const id = ++next;
  const timer = setTimeout(() => {
    pending.get(id)?.reject(new Error(`CDP 超时：${method}`));
    pending.delete(id);
  }, 15000);
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
  }
}
try {
  let active = '';
  for (let i = 0; i < 100; i++) {
    try {
      active = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      break;
    } catch {
      await delay(100);
    }
  }
  if (!active) {
    throw new Error('Chrome 未启动远程调试');
  }
  const [port, endpoint] = active.trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.bindingCalled' && message.params.name === 'scwcGM') {
      const request = JSON.parse(message.params.payload);
      void fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.data,
      })
        .then(async (response) => {
          const result = {
            status: response.status,
            statusText: response.statusText,
            responseText: await response.text(),
            responseHeaders: 'content-type: application/json',
          };
          await cdp(
            'Runtime.evaluate',
            {
              expression: `globalThis.scwcGMReplies.get(${request.id})?.onload(${JSON.stringify(result)}); globalThis.scwcGMReplies.delete(${request.id})`,
            },
            message.sessionId,
          );
        })
        .catch((error) => console.error('GM bridge', error));
    }
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(JSON.stringify(message.error)));
      } else {
        request.resolve(message.result ?? {});
      }
    }
  };
  await new Promise<void>((resolve, reject) => {
    if (!socket) {
      return;
    }
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('CDP 连接失败'));
  });
  const extension = await cdp('Extensions.loadUnpacked', { path: testExtension });
  const id = String(extension.id);
  const created = await cdp('Target.createTarget', { url: site });
  await delay(300);
  const tabTargets = (await cdp('Target.getTargets', {
    filter: [{ type: 'tab', exclude: false }, { exclude: true }],
  })) as { targetInfos: { targetId: string; url: string }[] };
  const tabTarget = tabTargets.targetInfos.find((target) => target.url === site);
  assert.ok(tabTarget, '必须创建目标网页标签');
  await cdp('Extensions.triggerAction', { id, targetId: tabTarget.targetId });
  await delay(600);
  const targets = (await cdp('Target.getTargets')) as {
    targetInfos: { targetId: string; url: string }[];
  };
  const popup = targets.targetInfos.find(
    (target) => target.url === `chrome-extension://${id}/index.html`,
  );
  assert.ok(popup, '工具栏图标必须打开扩展弹窗');
  const attached = await cdp('Target.attachToTarget', { targetId: popup.targetId, flatten: true });
  let session = String(attached.sessionId);
  async function evaluate(expression: string) {
    const response = await cdp(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      session,
    );
    if (response.exceptionDetails) {
      throw new Error(JSON.stringify(response.exceptionDetails));
    }
    return (response.result as { value: unknown }).value;
  }
  async function waitForPopup() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("!!document.querySelector('scwc-extension')?.snapshot")) {
        return;
      }
      await delay(100);
    }
    throw new Error('扩展弹窗未完成初始化');
  }
  await waitForPopup();
  const config = defaultSiteData().config;
  config.api.host = 'http://127.0.0.1';
  config.api.port = String(fixturePort);
  await evaluate(
    `document.querySelector('scwc-extension').config=${JSON.stringify(config)}; document.querySelector('scwc-extension').saveConnection()`,
  );
  assert.equal(await evaluate("document.querySelector('scwc-extension').connected"), true);
  assert.equal(await evaluate("document.querySelector('scwc-extension').plugins.length"), 2);
  await evaluate("document.querySelector('scwc-extension').page('start')");
  await cdp('Target.closeTarget', { targetId: popup.targetId });
  const pageAttached = await cdp('Target.attachToTarget', {
    targetId: created.targetId,
    flatten: true,
  });
  await cdp(
    'Runtime.evaluate',
    { expression: "document.getElementById('text').click()" },
    String(pageAttached.sessionId),
  );
  await delay(200);
  await cdp('Extensions.triggerAction', { id, targetId: tabTarget.targetId });
  await delay(500);
  const reopened = (
    (await cdp('Target.getTargets')) as { targetInfos: { targetId: string; url: string }[] }
  ).targetInfos.find((target) => target.url === `chrome-extension://${id}/index.html`);
  assert.ok(reopened);
  session = String(
    (await cdp('Target.attachToTarget', { targetId: reopened.targetId, flatten: true })).sessionId,
  );
  await waitForPopup();
  assert.equal(
    await evaluate("document.querySelector('scwc-extension').context.draft.selector"),
    '#text',
  );
  await evaluate("document.querySelector('scwc-extension').alterSelection('parent')");
  assert.equal(
    await evaluate("document.querySelector('scwc-extension').context.draft.selector"),
    '#article',
  );
  await evaluate("document.querySelector('scwc-extension').alterSelection('undo')");
  await evaluate(
    "document.querySelector('scwc-extension').draftLabel='正文'; document.querySelector('scwc-extension').draftPrefix='> '; document.querySelector('scwc-extension').addSelection()",
  );
  await evaluate("document.querySelector('scwc-extension').submit()");
  assert.equal(
    await evaluate("document.querySelector('scwc-extension').notifications.records.at(-1).message"),
    '浏览器集成验证成功',
  );
  const stored = await evaluate('chrome.storage.local.get(null)');
  const saved = JSON.stringify(stored);
  assert.ok(saved.includes('#text'));
  assert.ok(!saved.includes('minimized'));
  assert.ok(!saved.includes('"pos"'));
  await fs.mkdir(path.join(root, 'dist/browser-extension/previews'), { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium.png'),
    Buffer.from(String(screenshot.data), 'base64'),
  );
  assert.equal(
    await evaluate(
      "document.querySelector('scwc-extension').shadowRoot.querySelector('footer').getBoundingClientRect().bottom <= innerHeight + 1",
    ),
    true,
    '底栏必须始终位于弹窗内',
  );
  await evaluate(`(async () => {
    const app = document.querySelector('scwc-extension');
    app.itemMenu(new MouseEvent('contextmenu', {clientX:440,clientY:300}),0);
    await app.updateComplete;
    const menu = app.shadowRoot.querySelector('wb-context-menu'); await menu.updateComplete;
    menu.shadowRoot.querySelector('[data-menu-id="highlight"]').click();
    await app.updateComplete;
  })()`);
  assert.equal(await evaluate("document.querySelector('scwc-extension').menu"), null);
  await evaluate(`(async () => {
    const app = document.querySelector('scwc-extension'); app.panel='plugins'; await app.updateComplete;
    const select = app.shadowRoot.querySelector('wb-menu-select'); await select.updateComplete;
    select.shadowRoot.querySelector('button').click(); await select.updateComplete;
    const menu=select.shadowRoot.querySelector('wb-context-menu'); await menu.updateComplete;
    menu.shadowRoot.querySelector('[data-menu-id="menu-select:text"]').click();
    await app.saveTail; await app.updateComplete;
  })()`);
  assert.equal(
    await evaluate(
      "document.querySelector('scwc-extension').snapshot.data.controls.find(item => item.pluginId === 'demo' && item.channel === 'format').value",
    ),
    'text',
  );
  const pluginShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium-plugins.png'),
    Buffer.from(String(pluginShot.data), 'base64'),
  );
  await evaluate(`(async () => {
    const app = document.querySelector('scwc-extension'); app.activePlugin='json'; await app.updateComplete;
    const view = app.shadowRoot.querySelector('scwc-script-ui'); await view.updateComplete;
    const input = view.shadowRoot.querySelector('input'); input.focus(); input.value='  browser  '; input.dispatchEvent(new Event('input',{bubbles:true}));
    await app.saveTail; view.shadowRoot.querySelector('button:not([role="tab"])').click();
  })()`);
  for (let i = 0; i < 50; i++) {
    if (
      await evaluate(
        "document.querySelector('scwc-extension').notifications.records.some(item => item.message === 'JSON browser / 1 items / v2')",
      )
    ) {
      break;
    }
    await delay(100);
  }
  assert.equal(
    await evaluate(
      "document.querySelector('scwc-extension').notifications.records.some(item => item.message === 'JSON browser / 1 items / v2')",
    ),
    true,
    JSON.stringify(
      await evaluate(
        "({notifications:document.querySelector('scwc-extension').notifications.records,error:document.querySelector('scwc-extension').shadowRoot.querySelector('scwc-script-ui')?.shadowRoot.querySelector('#error')?.textContent})",
      ),
    ),
  );
  const jsonRequests = configRequests.get('json');
  await evaluate("document.querySelector('scwc-extension').refreshPlugin('demo'); true");
  await delay(30);
  assert.equal(
    await evaluate(
      "!!document.querySelector('scwc-extension').shadowRoot.querySelector('.spinning')",
    ),
    true,
  );
  await delay(400);
  assert.equal(configRequests.get('json'), jsonRequests);
  assert.equal(await evaluate("document.querySelector('scwc-extension').activePlugin"), 'json');
  await evaluate(`(async () => {
    const app=document.querySelector('scwc-extension'); const view=app.shadowRoot.querySelector('scwc-script-ui');
    view.shadowRoot.querySelector('[data-ui-tab-trigger="layout"]').click();
    await app.updateComplete;
  })()`);
  assert.equal(
    await evaluate(
      `document.querySelector('scwc-extension').shadowRoot.querySelector('scwc-script-ui').shadowRoot.querySelectorAll('.ui-scroll-panel').length`,
    ),
    0,
  );
  await evaluate("document.body.style.width='320px'");
  await delay(100);
  assert.equal(
    await evaluate(`(() => {
    const root=document.querySelector('scwc-extension').shadowRoot.querySelector('scwc-script-ui').shadowRoot;
    const row=root.querySelector('.ui-setting'), copy=row.querySelector('.ui-setting-copy').getBoundingClientRect(), control=row.querySelector('.ui-setting-control').getBoundingClientRect();
    const checkbox=root.querySelector('.ui-setting-checkbox');
    return control.top >= copy.bottom && control.right <= row.getBoundingClientRect().right && checkbox.querySelector('.ui-setting-control').getBoundingClientRect().right <= checkbox.querySelector('.ui-setting-copy').getBoundingClientRect().left;
  })()`),
    true,
    '窄屏控件换行、右齐且 checkbox 左置',
  );
  await evaluate(
    `(() => { const app=document.querySelector('scwc-extension'); const scroll=app.shadowRoot.querySelector('.main-scroll'); scroll.scrollTo({top:99999,behavior:'instant'}); })()`,
  );
  await delay(100);
  assert.equal(
    await evaluate(
      `(() => { const app=document.querySelector('scwc-extension'), button=app.shadowRoot.querySelector('scwc-script-ui').shadowRoot.querySelector('[data-ui-key="layout-save"]'); return button.getBoundingClientRect().bottom <= app.shadowRoot.querySelector('footer').getBoundingClientRect().top; })()`,
    ),
    true,
    '分组底部的保存按钮可滚动到达',
  );
  const narrowShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium-json-narrow.png'),
    Buffer.from(String(narrowShot.data), 'base64'),
  );
  await evaluate("document.body.style.width='480px'");
  const jsonShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium-json.png'),
    Buffer.from(String(jsonShot.data), 'base64'),
  );
  await evaluate(
    "document.documentElement.dataset.theme='light-2026'; document.querySelector('scwc-extension').panel='capture'; document.querySelector('scwc-extension').updateComplete",
  );
  const lightShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium-light.png'),
    Buffer.from(String(lightShot.data), 'base64'),
  );
  // 用真实布局、鼠标和滚轮验证通知，避免 JSDOM 的零尺寸掩盖堆叠错误。
  await evaluate(`(async () => {
    document.documentElement.dataset.theme='dark-2026';
    const center=document.querySelector('scwc-extension').notifications;
    for (const item of center.records.filter(item => item.visible)) center.dismiss(item.id);
    for (let i=1;i<=12;i++) {
      const id=center.add('通知第 '+i+' 条：采集任务已完成'+(i%3===0?'。不同高度的通知卡片也应使用相同的展开区域，超出区域的真实通知需要逐渐压缩并叠放。':''), ['info','success','warn','error'][i%4]);
      center.pause(id,'focus');
    }
    await center.updateComplete;
  })()`);
  await delay(300);
  const notificationState = () =>
    evaluate(`(() => {
    const app=document.querySelector('scwc-extension'), center=app.notifications, root=center.shadowRoot;
    const viewport=root.querySelector('.toast-scroll'), bounds=center.getBoundingClientRect();
    const cards=[...root.querySelectorAll('.toast')], front=cards.filter(card=>card.dataset.edge==='visible');
    const selected=front.at(-1).getBoundingClientRect();
    return {
      expanded:center.expanded, above:center.above, below:center.below,
      visible:front.length, cards:cards.length,
      bottomGap:innerHeight-cards.at(-1).getBoundingClientRect().bottom,
      scrollTop:viewport.scrollState.scrollTop, maxScrollTop:viewport.scrollState.maxScrollTop,
      zeroBar:viewport.vertical.size===0 && viewport.horizontal.size===0,
      fakePile:!!root.querySelector('.pile'),
      x:selected.x+selected.width/2, y:selected.y+selected.height/2,
      width:bounds.width, top:bounds.top
    };
  })()`) as Promise<{
      expanded: boolean;
      above: number;
      below: number;
      visible: number;
      cards: number;
      bottomGap: number;
      scrollTop: number;
      maxScrollTop: number;
      zeroBar: boolean;
      fakePile: boolean;
      x: number;
      y: number;
      width: number;
      top: number;
    }>;
  let notifications = await notificationState();
  assert.equal(notifications.visible, 1);
  assert.equal(notifications.cards, 12);
  assert.equal(notifications.fakePile, false);
  assert.equal(notifications.zeroBar, true);
  assert.ok(Math.abs(notifications.bottomGap - 8) < 1);
  assert.equal(
    await evaluate(
      `document.querySelector('scwc-extension').shadowRoot.elementFromPoint(2,150)?.localName === 'scwc-extension-notifications'`,
    ),
    false,
    '透明滚动驱动器不能遮挡页面',
  );
  await evaluate(`document.querySelector('scwc-extension').notifications.writes`);
  await delay(100);
  assert.equal(
    await evaluate(`(async()=>{
    const center=document.querySelector('scwc-extension').notifications;
    return await chrome.action.getBadgeText({})===String(center.records.filter(item=>!item.read).length);
  })()`),
    true,
    '原生角标等于持久未读数量',
  );
  assert.deepEqual(await evaluate('chrome.action.getBadgeBackgroundColor({})'), [26, 44, 51, 255]);
  assert.deepEqual(await evaluate('chrome.action.getBadgeTextColor({})'), [255, 255, 255, 255]);
  async function notificationShot(name: string) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
    await fs.writeFile(
      path.join(root, 'dist/browser-extension/previews/' + name + '.png'),
      Buffer.from(String(shot.data), 'base64'),
    );
  }
  await notificationShot('chromium-notifications-stacked');
  await cdp(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: notifications.x, y: notifications.y },
    session,
  );
  await delay(300);
  notifications = await notificationState();
  assert.equal(notifications.expanded, true);
  assert.ok(notifications.visible >= 3 && notifications.visible <= 6);
  assert.ok(notifications.above > 0);
  assert.equal(notifications.below, 0);
  await notificationShot('chromium-notifications-expanded');
  await evaluate(`(() => {
    const center=document.querySelector('scwc-extension').notifications, root=center.shadowRoot;
    globalThis.notificationScrollSamples=[];
    root.querySelector('.toast-scroll').addEventListener('scroll', event=>{
      if (!event.detail) return;
      const error=Math.max(0,...[...root.querySelectorAll('.toast')].map(card=>{
        const rendered=new DOMMatrixReadOnly(getComputedStyle(card).transform), target=new DOMMatrixReadOnly(card.style.transform);
        return Math.abs(rendered.m42-target.m42);
      }));
      notificationScrollSamples.push(error);
    });
  })()`);
  await cdp(
    'Input.dispatchMouseEvent',
    { type: 'mouseWheel', x: notifications.x, y: notifications.y, deltaX: 0, deltaY: -700 },
    session,
  );
  await delay(450);
  notifications = await notificationState();
  assert.ok(notifications.below > 0);
  assert.equal(
    await evaluate(
      `notificationScrollSamples.length>0 && Math.max(...notificationScrollSamples)<0.01`,
    ),
    true,
    '卡片必须逐帧跟随滚动位置，不得由CSS过渡追赶',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('scwc-extension').notifications.shadowRoot.querySelector('.toast')).transitionProperty`,
    ),
    'none',
  );
  await notificationShot('chromium-notifications-scrolled');
  const oldPosition = notifications.scrollTop;
  const lowerTransforms = await evaluate(
    `Object.fromEntries([...document.querySelector('scwc-extension').notifications.shadowRoot.querySelectorAll('.toast[data-edge="below"]')].map(card=>[card.dataset.id,card.style.transform]))`,
  );
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 5 }, session);
  await delay(300);
  notifications = await notificationState();
  assert.equal(notifications.expanded, false);
  assert.equal(notifications.scrollTop, oldPosition);
  assert.deepEqual(
    await evaluate(
      `Object.fromEntries([...document.querySelector('scwc-extension').notifications.shadowRoot.querySelectorAll('.toast[data-edge="below"]')].map(card=>[card.dataset.id,card.style.transform]))`,
    ),
    lowerTransforms,
  );
  await evaluate(
    `document.querySelector('scwc-extension').notifications.add('新通知自动回到底部')`,
  );
  await delay(300);
  notifications = await notificationState();
  assert.equal(notifications.scrollTop, notifications.maxScrollTop);
  assert.equal(notifications.below, 0);
  await evaluate(`(async () => {
    const app=document.querySelector('scwc-extension');
    [...app.shadowRoot.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='通知').click();
    await app.updateComplete;
  })()`);
  await delay(100);
  assert.equal(
    await evaluate(`(() => {
    const history=document.querySelector('scwc-extension').notifications.shadowRoot.querySelector('.history');
    return Math.abs(history.scrollState.maxScrollTop-history.scrollState.scrollTop)<2 && history.querySelector('.notification:last-child').textContent.includes('新通知自动回到底部');
  })()`),
    true,
    '通知历史打开时定位最新消息',
  );
  await notificationShot('chromium-notifications-history');
  const filterPosition = (await evaluate(`(() => {
    const root=document.querySelector('scwc-extension').notifications.shadowRoot;
    const buttons=[...root.querySelectorAll('.history-filters button')], rects=buttons.map(button=>button.getBoundingClientRect());
    if (!buttons.every(button=>getComputedStyle(button).backgroundColor==='rgba(0, 0, 0, 0)')) throw Error('筛选按钮默认应无背景');
    if (rects[1].left-rects[0].right<7 || rects[2].left-rects[1].right<7) throw Error('筛选按钮应相互间隔');
    buttons[1].focus();
    if (getComputedStyle(buttons[1]).backgroundColor==='rgba(0, 0, 0, 0)') throw Error('聚焦按钮应显示背景');
    buttons[1].blur();
    if (getComputedStyle(buttons[1]).backgroundColor!=='rgba(0, 0, 0, 0)') throw Error('失焦按钮应恢复透明背景');
    return {x:rects[0].x+rects[0].width/2,y:rects[0].y+rects[0].height/2};
  })()`)) as { x: number; y: number };
  await cdp(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: filterPosition.x, y: filterPosition.y },
    session,
  );
  assert.equal(
    await evaluate(`(() => {
    const buttons=[...document.querySelector('scwc-extension').notifications.shadowRoot.querySelectorAll('.history-filters button')];
    return getComputedStyle(buttons[0]).backgroundColor!=='rgba(0, 0, 0, 0)' && buttons.slice(1).every(button=>getComputedStyle(button).backgroundColor==='rgba(0, 0, 0, 0)');
  })()`),
    true,
    '只有hover或聚焦的筛选按钮显示背景',
  );
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 5 }, session);
  await evaluate(`document.querySelector('scwc-extension').notifications.writes`);
  await delay(100);
  assert.equal(
    await evaluate(`(async()=>{
    const center=document.querySelector('scwc-extension').notifications;
    return center.records.some(item=>item.read) && center.records.some(item=>!item.read) && await chrome.action.getBadgeText({})===String(center.records.filter(item=>!item.read).length);
  })()`),
    true,
    '只将可视历史标为已读，并同步角标',
  );
  await evaluate(`(async()=>{
    const center=document.querySelector('scwc-extension').notifications;
    [...center.shadowRoot.querySelectorAll('.history-filters button')].find(button=>button.textContent.trim()==='已读').click();
    await center.updateComplete;
  })()`);
  assert.equal(
    await evaluate(
      `!document.querySelector('scwc-extension').notifications.shadowRoot.querySelector('.notification[data-read="false"]')`,
    ),
    true,
  );
  await evaluate(`(async () => {
    const app=document.querySelector('scwc-extension'), center=app.notifications;
    center.shadowRoot.querySelector('.notification:last-child .close').click();
    await center.writes;
    app.panel='capture';
    for (const item of center.records.filter(item=>item.visible)) center.dismiss(item.id);
    await app.updateComplete;
  })()`);
  // Execute the installed userscript bundle with a GM network bridge; the page itself has no network/font grants.
  await cdp(
    'Page.navigate',
    { url: `http://localhost:${fixturePort}/strict` },
    String(pageAttached.sessionId),
  );
  await delay(200);
  const pageSession = String(pageAttached.sessionId);
  await cdp('Runtime.addBinding', { name: 'scwcGM' }, pageSession);
  const scriptSnapshot = {
    version: 1,
    website: `http://localhost:${fixturePort}`,
    updatedAt: new Date().toISOString(),
    data: defaultSiteData(config),
  };
  scriptSnapshot.data.plugin = { expanded: true, activeTab: 'json' };
  scriptSnapshot.data.window.pos = { x: 8, y: 8 };
  scriptSnapshot.data.window.minimized = false;
  await cdp(
    'Runtime.evaluate',
    {
      expression: `localStorage.setItem('__scwc_website_config__',${JSON.stringify(JSON.stringify(scriptSnapshot))}); globalThis.unsafeWindow=window; globalThis.scwcGMReplies=new Map(); let gmId=0; globalThis.GM_xmlhttpRequest=options=>{const id=++gmId;scwcGMReplies.set(id,options);scwcGM(JSON.stringify({id,url:options.url,method:options.method,headers:options.headers,data:options.data}));return {abort(){scwcGMReplies.delete(id)}}};`,
    },
    pageSession,
  );
  const bundle = await fs.readFile(path.join(root, 'dist/user-script/scwc.user.js'), 'utf8');
  const injected = await cdp('Runtime.evaluate', { expression: bundle }, pageSession);
  assert.ok(!injected.exceptionDetails, JSON.stringify(injected.exceptionDetails));
  const scriptRoot = `document.querySelector('scwc-layout-root').shadowRoot.querySelector('scwc-layout-content').shadowRoot.querySelector('scwc-layout-content-plugin').shadowRoot`;
  for (let i = 0; i < 60; i++) {
    const value = await cdp(
      'Runtime.evaluate',
      {
        expression: `${scriptRoot}?.querySelector('scwc-script-ui')?.shadowRoot?.querySelector('input')?.value`,
        returnByValue: true,
      },
      pageSession,
    );
    if ((value.result as { value?: string })?.value) {
      break;
    }
    await delay(100);
  }
  await cdp(
    'Runtime.evaluate',
    {
      expression: `${scriptRoot}.querySelector('scwc-script-ui').shadowRoot.querySelector('[data-ui-tab-trigger="layout"]').click()`,
    },
    pageSession,
  );
  await cdp(
    'Emulation.setDeviceMetricsOverride',
    { width: 320, height: 580, deviceScaleFactor: 1, mobile: false },
    pageSession,
  );
  await delay(100);
  const scriptCheck = await cdp(
    'Runtime.evaluate',
    {
      expression: `(() => {const root=${scriptRoot}.querySelector('scwc-script-ui').shadowRoot; const row=root.querySelector('.ui-setting'), copy=row.querySelector('.ui-setting-copy').getBoundingClientRect(), control=row.querySelector('.ui-setting-control').getBoundingClientRect();return {wrap:control.top>=copy.bottom, svg:!!root.querySelector('wb-icon')?.shadowRoot.querySelector('svg'), panels:root.querySelectorAll('.ui-scroll-panel').length};})()`,
      returnByValue: true,
    },
    pageSession,
  );
  assert.deepEqual((scriptCheck.result as { value: unknown }).value, {
    wrap: true,
    svg: true,
    panels: 0,
  });
  for (const theme of ['dark-2026', 'light-2026']) {
    await cdp(
      'Runtime.evaluate',
      {
        expression: `document.querySelector('scwc-layout-root').setAttribute('data-theme','${theme}')`,
      },
      pageSession,
    );
    const color = await cdp(
      'Runtime.evaluate',
      {
        expression: `getComputedStyle(document.querySelector('scwc-layout-root')).getPropertyValue('--surface-1').trim()`,
        returnByValue: true,
      },
      pageSession,
    );
    assert.equal(
      (color.result as { value: string }).value,
      theme === 'light-2026' ? '#f5f6f7' : '#0a0d12',
    );
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, pageSession);
    await fs.writeFile(
      path.join(root, `dist/browser-extension/previews/userscript-${theme}.png`),
      Buffer.from(String(shot.data), 'base64'),
    );
  }
  console.log(
    'PASS: Chromium popup, selection/reopen, persistence, root version header, v1/v2 JSON, targeted tab refresh/loading, crawl, menus, themes, bounded real notification stacks, retained scroll on collapse, new-message follow, native unread badge, visible-history reads and filters',
  );
} finally {
  try {
    await cdp('Browser.close');
  } catch {
    child.kill();
  }
  socket?.close();
  child.kill();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  // 保留隔离 profile 供排障；位于已忽略的 node_modules/.tmp，不接触用户浏览器配置。
}
