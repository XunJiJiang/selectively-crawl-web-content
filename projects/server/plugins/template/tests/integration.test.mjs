import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import WebSocket from 'ws';
import { build } from 'esbuild';
import './isolate-environment.mjs';

// 这是插件边界测试：真实 Node 子进程、HTTP、SQLite、Socket、SDK 与 Lit 构建产物。
// JSDOM 只验证 DOM/事件，不把它当作像素布局、真实图片加载或工作台节能计时的证明。
const directory = fileURLToPath(new URL('../', import.meta.url));
const core = (relative) => import(new URL(`../../../${relative}`, import.meta.url));
const logger = { info() {}, pathInfo() {}, warn() {}, error() {} };
const browsers = [];
let root,
  origin,
  server,
  client,
  runtime,
  storage,
  routes,
  registry,
  plugins,
  events,
  InstancePort,
  PROTOCOL,
  sdkCode,
  html;
const token = 'template-integration-only';

async function waitFor(check, message = 'condition', timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${message}`);
}
async function api(route, body) {
  const response = await fetch(`${origin}/web/api/workbench${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-scwc-client-window': 'template-test',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.ok && result.success, true, JSON.stringify(result));
  return result.data;
}
async function pluginApi(route, body) {
  const url = new URL(`/web/api/plugin/template-test${route}`, origin);
  url.searchParams.set('site', origin);
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.ok && result.success, true, JSON.stringify(result));
  return result.data;
}
const backend = (action) => pluginApi('/validation/feedback', { action });

before(async () => {
  root = await fs.mkdtemp(path.join(directory, 'tests/.tmp-'));
  Object.assign(process.env, {
    SCWC_DATA_DIR: root,
    SCWC_WEB_WORKBENCH_DB: path.join(root, 'workbench.sqlite'),
    REDIS_ENABLED: 'false',
    TOKEN: token,
    HOST: 'http://127.0.0.1',
  });
  ({ PluginProcessClient: client } = await core('plugin/process/client.ts'));
  const Client = client;
  const values = new Map();
  client = new Client({
    pluginId: 'template',
    entry: path.join(directory, 'index.ts'),
    pluginDir: directory,
    name: 'template-test',
    cwd: directory,
    logger,
    env: { ...process.env },
    execArgv: ['--import', new URL('./isolate-environment.mjs', import.meta.url).href],
    runtime: {
      mode: 'process',
      apiVersion: 2,
      startupTimeoutMs: 15000,
      requestTimeoutMs: 5000,
      shutdownTimeoutMs: 2000,
    },
    cache: () => ({
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value);
        return value;
      },
      del: async (key) => values.delete(key),
      mdel: async (keys) => {
        keys.forEach((key) => values.delete(key));
        return true;
      },
      setRedirect: async () => {
        throw new Error('unused cache redirect');
      },
    }),
  });
  const handler = await client.start(); // 原生 Node 类型擦除，不能用 Vitest 转译掩盖加载错误。
  ({ plugins } = await core('plugin/load.ts'));
  plugins.push({
    name: 'template-test',
    pluginId: 'template',
    safeId: 'template-test',
    pluginDir: directory,
    entryFile: path.join(directory, 'index.ts'),
    entry: handler.ui.entry,
    linkWith: [],
    logger,
    runtime: client.info,
    handler,
  });
  routes = await core('router/web/api/load.ts');
  routes.registerPluginApi(plugins.at(-1));
  routes.registerPluginResources(plugins.at(-1));
  ({ pluginWebSocketRegistry: registry } = await core('router/web/websocket.ts'));
  registry.register(plugins.at(-1));
  const { app } = await core('router/index.ts');
  const { attachUpgradeDispatcher } = await core('router/web/workbench/websocket.ts');
  runtime = await core('workbench/runtime.ts');
  storage = await core('workbench/storage.ts');
  ({ workbenchEvents: events } = await core('workbench/events.ts'));
  ({ InstancePort, PROTOCOL } = await import('../../../../shared/workbench-protocol.ts'));
  server = createServer(app);
  attachUpgradeDispatcher(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  html = await (await fetch(`${origin}/web/page/plugin/template/`)).text();
  const sdkBuild = await build({
    entryPoints: [fileURLToPath(new URL('../../../../webUtils/lib/index.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__sdk',
    platform: 'browser',
  });
  sdkCode = sdkBuild.outputFiles[0].text + '\nwindow.scwcutils = __sdk.default;';
});

after(async () => {
  for (const { window, host, forward } of browsers) {
    window.dispatchEvent(new window.Event('pagehide'));
    if (forward) events.off('event', forward);
    host?.close();
    window.close();
  }
  registry?.unregister('template-test');
  routes?.unregisterPluginRoutes('template-test');
  await client?.stop?.(false);
  if (plugins)
    plugins.splice(
      plugins.findIndex((p) => p.safeId === 'template-test'),
      1,
    );
  await runtime?.closeWorkbench();
  storage?.closeStorage();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
});

test('真实插件 API、资源、后端任务和通知回调经过 IPC', async () => {
  assert.equal(client.info.status, 'ready');
  assert.match(html, /data-scwc-bootstrap/);
  assert.match(html, /\/web\/page\/plugin\/template\/assets\//);
  const probe = await pluginApi('/validation/delay?ms=10&run=native');
  assert.equal(probe.run, 'native');
  const image = await fetch(
    `${origin}/web/resource/plugin/template-test/validation/image.svg?ms=10&site=${encodeURIComponent(origin)}`,
  );
  assert.match(image.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await image.text(), /resource#\d+ loaded/);
  assert.equal((await backend('task.create')).task.status, 'queued');
  assert.equal((await backend('task.run')).task.status, 'running');
  assert.equal((await backend('task.progress')).task.progress, 50);
  assert.equal((await backend('task.content')).task.content, '插件已更新任务内容');
  assert.equal((await backend('task.succeed')).task.status, 'succeeded');
  await backend('task.create');
  assert.equal((await backend('task.fail')).task.status, 'failed');
  await backend('task.create');
  assert.equal((await backend('task.cancel')).task.status, 'cancelled');
  let snapshot = await backend('notice.create');
  assert.equal(snapshot.notification.actions.length, 4);
  assert.equal(snapshot.notification.autoRead, false);
  assert.equal(snapshot.notification.progress, null);
  await api('/notifications/visibility', { ids: [snapshot.notification.id] });
  snapshot = await backend('inspect');
  assert.equal(snapshot.visible, true);
  assert.equal(snapshot.notification.readAt, null);
  const old = snapshot.notification.actions[0].id;
  snapshot = await backend('notice.actions');
  assert.notEqual(snapshot.notification.actions[0].id, old);
  await api(
    `/notifications/${snapshot.notification.id}/actions/${snapshot.notification.actions[0].id}`,
    {},
  );
  assert.equal((await backend('inspect')).notification.progress, 50);
  assert.ok((await backend('notice.read')).notification.readAt);
  assert.equal((await backend('notice.unread')).notification.readAt, null);
  assert.equal((await backend('notice.hide')).notification.progress, false);
  assert.equal((await backend('notice.close')).notification, null);
});

async function browser(hosted) {
  const dom = new JSDOM(html, {
    url: `${origin}/web/page/plugin/template/`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  // Node fetch 要求本 realm 的 AbortSignal；不替换 SDK 的取消/重发逻辑。
  w.AbortController = AbortController;
  w.AbortSignal = AbortSignal;
  // 浏览器自动添加的来源头由夹具补齐；业务请求依旧经过真实核心 HTTP 鉴权和路由。
  w.fetch = (url, options = {}) =>
    fetch(new URL(url, w.location.href), {
      ...options,
      headers: {
        ...Object.fromEntries(new Headers(options.headers)),
        origin,
        referer: w.location.href,
      },
    });
  w.WebSocket = class extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { origin });
    }
  };
  w.crypto.randomUUID ??= () => crypto.randomUUID();
  const item = { window: w };
  browsers.push(item);
  if (hosted) {
    const tabId = crypto.randomUUID(),
      frameEpoch = crypto.randomUUID();
    const session = await api('/page-sessions', {
      pluginId: 'template',
      tabId,
      frameEpoch,
      url: w.location.href,
    });
    const { port1, port2 } = new MessageChannel();
    item.host = new InstancePort(port1, tabId, frameEpoch);
    item.messages = [];
    item.host.onEvent = (method, payload) => item.messages.push({ method, payload });
    const parent = {
      postMessage(message) {
        if (message.type !== 'hello') return;
        w.dispatchEvent(
          new w.MessageEvent('message', {
            origin,
            source: parent,
            ports: [port2],
            data: {
              protocol: PROTOCOL,
              version: 1,
              type: 'welcome',
              documentNonce: message.documentNonce,
              session,
              focused: true,
              visible: true,
              theme: { mode: 'dark-2026' },
              keybindings: [],
            },
          }),
        );
      },
    };
    Object.defineProperty(w, 'parent', { value: parent });
    item.forward = (event) => {
      if (event.type === 'notification.action' && event.payload.tabId === tabId)
        item.host.event('notification.action', { ...event.payload, eventId: event.eventId });
      if (event.type === 'job.changed' && event.payload.owner?.tabId === tabId)
        item.host.event('task.changed', event.payload);
    };
    events.on('event', item.forward);
    item.session = session;
  }
  w.eval(sdkCode);
  await w.scwcutils.ready;
  const script = dom.window.document.querySelector('script[type="module"]');
  const js = await (await fetch(new URL(script.src, origin))).text();
  w.eval(js); // 执行真实 Vite 产物，验证组件注册及按钮后的 Lit 重绘。
  await waitFor(
    () =>
      [...w.document.querySelectorAll('button')].some(
        (b) => b.textContent === '创建任务' && !b.disabled,
      ),
    'Lit ready',
  );
  return item;
}

test('独立浏览器 SDK + Lit：前端控制对象和通知按钮通过真实事件 Socket 回调', async () => {
  const { window: w } = await browser(false);
  assert.deepEqual(JSON.parse(JSON.stringify(w.scwcutils.externalState.get())), {
    inWorkbench: false,
    inBrowser: true,
  });
  const click = async (label) => {
    const button = [...w.document.querySelectorAll('button')].find((b) => b.textContent === label);
    assert.ok(button && !button.disabled, label);
    button.click();
    await w.document.querySelector('template-validation').updateComplete;
    await waitFor(() => !button.disabled, label);
  };
  await click('创建任务');
  await waitFor(() => w.document.querySelector('pre').textContent.includes('queued'));
  await click('开始');
  await click('进度 50%');
  await click('成功');
  await click('创建通知');
  const snapshot = JSON.parse(w.document.querySelector('pre').textContent);
  assert.equal(snapshot.task.status, 'succeeded');
  await api(
    `/notifications/${snapshot.notification.id}/actions/${snapshot.notification.actions[0].id}`,
    {},
  );
  await waitFor(
    () => runtime.getWorkbench().notifications.get(snapshot.notification.id).progress === 50,
    'page action via socket',
  );
  await click('查询控制对象');
  assert.equal(JSON.parse(w.document.querySelector('pre').textContent).notification.progress, 50);
  await click('主动关闭');
  assert.equal(JSON.parse(w.document.querySelector('pre').textContent).notification, null);
});

test('宿主消息端口：页面状态、保护请求、可中断重发、主动取消和 DOM 资源恢复', async () => {
  const item = await browser(true),
    w = item.window,
    sdk = w.scwcutils,
    host = item.host;
  assert.equal(sdk.externalState.inWorkbench, true);
  assert.equal(sdk.externalState.focused, true);
  host.event('focus.changed', false);
  host.event('visibility.changed', false);
  await waitFor(() => sdk.externalState.focused === false && sdk.externalState.visible === false);
  const task = await sdk.tasks.create({ title: '页面活动保护' });
  await waitFor(() =>
    item.messages.some(
      (m) => m.method === 'activity.acquire' && m.payload.id === `feedback-task:${task.id}`,
    ),
  );
  await task.cancel();
  await waitFor(() =>
    item.messages.some(
      (m) => m.method === 'activity.release' && m.payload.id === `feedback-task:${task.id}`,
    ),
  );
  await assert.rejects(
    sdk.logger.info('超过按钮上限', {
      actions: Array.from({ length: 5 }, () => ({ label: '按钮', onClick() {} })),
    }),
  );
  const protectedRequest = sdk.fetch('/validation/delay?ms=100&run=protected');
  assert.equal(await host.request('connection.pause', {}), false);
  host.event('lifecycle.suspend', {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    w.document.querySelector('.event-list').textContent.includes('lifecycle.onSuspend'),
    false,
  );
  await protectedRequest;
  host.event('lifecycle.suspend', {});
  await waitFor(() =>
    w.document.querySelector('.event-list').textContent.includes('lifecycle.onSuspend'),
  );
  host.event('lifecycle.resume', {});
  await waitFor(() =>
    w.document.querySelector('.event-list').textContent.includes('lifecycle.onResume'),
  );
  const run = crypto.randomUUID();
  const marked = sdk.fetch(`/validation/delay?ms=250&run=${run}`, { interruptible: true });
  await waitFor(async () =>
    (await pluginApi('/validation/events')).events.some((e) =>
      e.message.includes(`started run=${run}`),
    ),
  );
  assert.equal(await host.request('connection.pause', {}), true);
  host.event('session.changed', item.session);
  await marked;
  const recorded = await pluginApi('/validation/events');
  assert.equal(recorded.events.filter((e) => e.message.includes(`started run=${run}`)).length, 2);
  const controller = new w.AbortController();
  const cancelled = sdk.fetch('/validation/delay?ms=250&run=cancelled', {
    interruptible: true,
    signal: controller.signal,
  });
  const rejected = assert.rejects(cancelled);
  await host.request('connection.pause', {});
  controller.abort();
  await rejected;
  host.event('session.changed', item.session);
  const img = w.document.createElement('img');
  img.src = sdk.resource('/validation/image.svg?ms=10');
  w.document.body.append(img);
  await waitFor(() =>
    item.messages.some((m) => m.method === 'requests.changed' && m.payload.delta > 0),
  );
  assert.equal(await host.request('connection.pause', {}), false);
  // JSDOM 不加载图片，这里只测试 load 释放保护；真实资源 HTTP 已在第一个用例覆盖。
  img.dispatchEvent(new w.Event('load'));
  img.remove();
  const markedImg = w.document.createElement('img');
  const imageUrl = sdk.resource('/validation/image.svg?ms=10', { interruptible: true });
  markedImg.src = imageUrl;
  w.document.body.append(markedImg);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await host.request('connection.pause', {}), true);
  assert.equal(markedImg.hasAttribute('src'), false);
  host.event('session.changed', item.session);
  await waitFor(() => markedImg.getAttribute('src') === imageUrl);
  markedImg.remove();
});

test('真实插件 WebSocket：缺省连接保护、可中断连接恢复和手动关闭', async () => {
  const item = await browser(true),
    sdk = item.window.scwcutils,
    host = item.host;
  const protectedSocket = sdk.websocket('/validation/socket');
  await waitFor(() => protectedSocket.readyState === 1);
  assert.equal(await host.request('connection.pause', {}), false);
  protectedSocket.close();
  await waitFor(() => protectedSocket.readyState === 3);
  const ids = [];
  const socket = sdk.websocket('/validation/socket', undefined, { interruptible: true });
  socket.onmessage = (event) => ids.push(JSON.parse(event.data).connectionId);
  await waitFor(() => ids.length > 0);
  const first = ids[0];
  assert.equal(await host.request('connection.pause', {}), true);
  host.event('session.changed', item.session);
  await waitFor(() => ids.some((id) => id !== first), 'socket restored with new connection');
  socket.close();
  await waitFor(() => socket.readyState === 3);
  await host.request('connection.pause', {});
  host.event('session.changed', item.session);
  assert.equal(socket.readyState, 3);
});
