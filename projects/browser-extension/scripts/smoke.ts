import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { defaultSiteData } from '../../shared/userscript-config.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const fixture = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
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
          ],
          activeIds: ['demo'],
          updatedIds: ['demo'],
        }),
      );
    } else {
      response.end(
        JSON.stringify({ success: true, message: '采集成功', data: ['浏览器集成验证成功'] }),
      );
    }
  } else {
    response.setHeader('content-type', 'text/html');
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
  assert.equal(await evaluate("document.querySelector('scwc-extension').plugins.length"), 1);
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
    await evaluate("document.querySelector('scwc-extension').results[0]"),
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
    await evaluate("document.querySelector('scwc-extension').snapshot.data.controls[0].value"),
    'text',
  );
  const pluginShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium-plugins.png'),
    Buffer.from(String(pluginShot.data), 'base64'),
  );
  await evaluate(
    "document.documentElement.dataset.theme='light-2026'; document.querySelector('scwc-extension').panel='capture'; document.querySelector('scwc-extension').updateComplete",
  );
  const lightShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/chromium-light.png'),
    Buffer.from(String(lightShot.data), 'base64'),
  );
  console.log(
    'PASS: Chromium popup, selection/reopen, parent/undo, local persistence, core sync, plugin list, crawl, context menu, menu select, footer bounds and themes',
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
