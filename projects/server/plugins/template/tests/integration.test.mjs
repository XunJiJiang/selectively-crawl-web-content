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
async function api(route, body, method) {
  const response = await fetch(`${origin}/web/api/workbench${route}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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

const allNodes = (nodes) => nodes.flatMap((node) => [node, ...allNodes(node.children ?? [])]);
const namedButton = (view, label) => {
  const node = allNodes(view.compiled.nodes).find(
    (n) => n.tag === 'button' && (n.children ?? []).map((c) => c.text ?? '').join('') === label,
  );
  assert.ok(node, label);
  const binding = view.compiled.events.find((e) => e.nodeId === node.id && e.event === 'click');
  assert.ok(binding, label);
  return binding;
};
const fields = {
  query: { value: '  Native IPC  ', editSequence: 1 },
  memo: 'memo',
  choice: 'a',
  checked: true,
  toggle: false,
};

test('声明式 HTTP/IPC：参数返回、核心处理器、监听初值更新释放、资源与原子回滚', async () => {
  const { ids, coreExamples } = await import('../ui-content.ts');
  const bootstrap = await api('/bootstrap');
  assert.equal(bootstrap.capabilities.pluginPageAPI, 2);
  assert.equal(bootstrap.capabilities.configurationWriteFromPage, false);
  const lease = await api('/workspaces/template-ui-test/lease', { action: 'acquire' });
  const create = (surface, viewId) =>
    api('/ui/instances', {
      pluginId: 'template',
      surface,
      viewId,
      workspaceId: lease.workspaceId,
      lease: lease.token,
    });
  let view = await create('mainSidebar', ids.main);
  assert.equal(view.compiled.format, 'json');
  assert.ok(view.compiled.fields.some((f) => f.name === 'query'));
  const execute = async (label) => {
    const binding = namedButton(view, label);
    return api(`/ui/instances/${view.id}/events`, {
      lease: lease.token,
      eventId: crypto.randomUUID(),
      renderRevision: view.renderRevision,
      bindingId: binding.id,
      fields: Object.fromEntries(binding.capture.map((name) => [name, fields[name]])),
    });
  };
  const bare = await execute('裸名称（唯一参数 $event）');
  assert.equal(bare.status, 'succeeded');
  assert.equal(bare.result.args.length, 1);
  assert.equal(bare.result.args[0].value, '  Native IPC  ');
  const submit = view.compiled.events.find((e) => e.event === 'submit');
  const submitted = await api(`/ui/instances/${view.id}/events`, {
    lease: lease.token,
    eventId: crypto.randomUUID(),
    renderRevision: view.renderRevision,
    bindingId: submit.id,
    fields: Object.fromEntries(submit.capture.map((name) => [name, fields[name]])),
  });
  assert.equal(submitted.result.args[1].query, '  Native IPC  ');
  assert.equal(submitted.result.args[0].values.memo, 'memo');
  const explicit = await execute('显式 $event + 多关联字段');
  assert.equal(explicit.result.args[0][1], 123);
  assert.equal(explicit.result.args[0][2], 'abc');
  assert.equal(explicit.result.args[0][3], '  Native IPC  ');
  const normalized = await execute('同域异步链');
  assert.equal(normalized.result, 'Native IPC');
  assert.ok(normalized.effects.some((e) => e.type === 'value.write'));
  for (const [label] of coreExamples.filter(([label]) => label !== 'config.read / write')) {
    const result = await execute(label);
    assert.equal(result.status, 'succeeded', `${label}: ${JSON.stringify(result)}`);
  }
  assert.equal((await execute('无效数字')).status, 'failed');
  assert.equal((await execute('无效布尔值')).status, 'failed');
  assert.equal((await execute('字段写入类型错误')).status, 'failed');
  assert.equal((await execute('无返回值（预期拒绝 $prev）')).error.code, 'UI_NO_RETURN_VALUE');
  const independent = await execute('独立前后端分支');
  assert.equal(independent.status, 'unavailable');
  assert.equal(independent.result, '<无数据，需要打开插件页面>');
  const values = await api(`/ui/instances/${view.id}/subscriptions`, {
    renderRevision: view.renderRevision,
    fields,
  });
  assert.ok(values.updates.some((u) => u.frontend));
  assert.equal(values.updates.filter((u) => u.error).length, 0, JSON.stringify(values));
  assert.ok(values.subscriptions.length > 2);
  const literal = values.updates.find((u) => String(u.value).includes('<img onerror'));
  assert.ok(literal);
  await pluginApi('/validation/ui', { action: 'bump' });
  const next = await api(`/ui/instances/${view.id}/data`, {
    renderRevision: view.renderRevision,
    fields,
  });
  assert.ok(next.updates.some((u) => String(u.value).includes('后端 counter：1')));
  await api(
    `/ui/instances/${view.id}/subscriptions/${values.subscriptions[0].id}`,
    undefined,
    'DELETE',
  );
  for (const asset of ['demo.svg', 'demo-assets/mark.svg', 'demo-assets/nested/mark.svg']) {
    const response = await fetch(`${origin}${view.assetRoot}/${asset}?cap=${view.assetCapability}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<svg/);
  }
  assert.equal(
    (await fetch(`${origin}${view.assetRoot}/demo-assets/../index.ts?cap=${view.assetCapability}`))
      .status,
    403,
  );
  assert.equal((await fetch(`${origin}${view.assetRoot}/demo.svg?cap=invalid`)).status, 403);
  const before = await api('/ui/registry');
  for (const action of ['invalid', 'reject.cycle', 'reject.cross']) {
    const rejected = await pluginApi('/validation/ui', { action });
    assert.equal(rejected.last.rejected, true, action);
    assert.deepEqual((await api('/ui/registry')).items, before.items);
  }
  view = await api(`/ui/instances/${view.id}/content`);
  await execute('main.set');
  view = await api(`/ui/instances/${view.id}/content`);
  assert.ok(allNodes(view.compiled.nodes).some((n) => n.text === '异步 RenderContext 来源'));
  await execute('target');
  view = await api(`/ui/instances/${view.id}/content`);
  assert.ok(allNodes(view.compiled.nodes).some((n) => n.text?.startsWith('定向实例 ')));
  const aux = await create('auxiliarySidebar', ids.aux);
  assert.equal(aux.compiled.format, 'html');
  for (const [action, format] of [
    ['aux.json', 'json'],
    ['aux.html', 'html'],
  ]) {
    await pluginApi('/validation/ui', { action });
    assert.equal((await api(`/ui/instances/${aux.id}/content`)).compiled.format, format);
  }
  for (const format of ['html', 'json', 'html']) {
    const popup = await create('tooltip', ids.status);
    assert.equal(popup.compiled.format, format);
    await api(`/ui/instances/${popup.id}/release`, {});
    await pluginApi('/validation/ui', { action: 'tooltip' });
  }
  for (const action of [
    'aux.json',
    'aux.content',
    'hide',
    'show',
    'tooltip',
    'tooltip',
    'status.disabled',
    'status.disabled',
    'status.visible',
    'status.visible',
    'inspector',
    'inspector.dispose',
  ])
    await pluginApi('/validation/ui', { action });
  await api(`/ui/instances/${view.id}/release`, {});
  await api(`/ui/instances/${aux.id}`, undefined, 'DELETE');
  await waitFor(
    async () => (await pluginApi('/validation/ui', { action: 'inspect' })).listeners === 0,
  );
  await pluginApi('/validation/ui', { action: 'dispose' });
  assert.equal(
    (await api('/ui/registry')).items.filter((i) => i.pluginId === 'template').length,
    0,
  );
  assert.equal(
    (await fetch(`${origin}${view.assetRoot}/demo.svg?cap=${view.assetCapability}`)).status,
    403,
  );
  await pluginApi('/validation/ui', { action: 'restore' });
  assert.equal(
    (await api('/ui/registry')).items.filter((i) => i.pluginId === 'template').length,
    3,
  );
});

test('后端配置权威：CRUD、异步校验、值/定义双 CAS、页面授权拒写', async () => {
  const read = () => pluginApi('/validation/config', { action: 'list' });
  let snapshot = await read();
  assert.equal(snapshot.definitions.flatMap((d) => d.items).length, 7);
  assert.ok(Object.values(snapshot.definitionSources).every((v) => v === 'backend'));
  const original = snapshot;
  snapshot = await pluginApi('/validation/config', {
    action: 'set',
    value: '  normalized  ',
    baseRevision: snapshot.revision,
  });
  assert.equal(snapshot.effectiveValues['validation.note'], 'normalized');
  await assert.rejects(() =>
    pluginApi('/validation/config', {
      action: 'set',
      value: 'conflict',
      baseRevision: original.revision,
    }),
  );
  await assert.rejects(() =>
    pluginApi('/validation/config', {
      action: 'set',
      value: 'reject',
      baseRevision: snapshot.revision,
    }),
  );
  assert.equal((await read()).effectiveValues['validation.note'], 'normalized');
  snapshot = await pluginApi('/validation/config', {
    action: 'update',
    value: 'batch',
    baseRevision: snapshot.revision,
  });
  assert.equal(snapshot.effectiveValues['validation.memo'], '由后端 update 同批写入');
  const invalidSchema = await fetch(`${origin}/web/api/workbench/plugins/template/config/update`, {
    method: 'POST',
    headers: {
      origin,
      authorization: `Bearer ${token}`,
      'x-scwc-client-window': 'template-test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      values: { 'validation.note': 'bad-schema' },
      baseRevision: snapshot.revision,
      schemaRevision: snapshot.schemaRevision - 1,
    }),
  });
  assert.equal(invalidSchema.status, 409);
  snapshot = await pluginApi('/validation/config', {
    action: 'delete',
    baseRevision: snapshot.revision,
  });
  assert.equal(snapshot.values['validation.note'], undefined);
  assert.equal(snapshot.effectiveValues['validation.note'], '声明式 UI 已接入');
  await pluginApi('/validation/config', { action: 'reset', baseRevision: snapshot.revision });
  await pluginApi('/validation/config', { action: 'unsubscribe' });
  await pluginApi('/validation/config', { action: 'subscribe' });
  const session = await api('/page-sessions', {
    pluginId: 'template',
    tabId: crypto.randomUUID(),
    frameEpoch: crypto.randomUUID(),
    url: `${origin}/web/page/plugin/template/`,
  });
  for (const suffix of [
    '/ui/registry',
    '/plugins/template/config/update',
    '/plugins/template/config/definitions',
    '/plugins/template/config/validation',
  ]) {
    const response = await fetch(`${origin}/web/api/workbench${suffix}`, {
      method: suffix.endsWith('registry') ? 'GET' : 'POST',
      headers: {
        origin,
        authorization: `Bearer ${session.grant}`,
        'content-type': 'application/json',
      },
      ...(suffix.endsWith('registry') ? {} : { body: '{}' }),
    });
    assert.equal(response.status, 403, suffix);
  }
});

test('两个真实页面 SDK：配置初值、暂停队列、revision 去重、来源处理器与注销', async () => {
  const { ConfigDispatchQueue } = await import('../../../../shared/config-dispatch.ts');
  const first = await browser(true),
    second = await browser(true);
  const received = [[], []];
  let active = true;
  const readSnapshot = async () => {
    const s = await api('/plugins/template/config');
    return {
      pluginId: 'template',
      changedKeys: Object.keys(s.effectiveValues),
      effectiveValues: s.effectiveValues,
      revision: s.revision,
      schemaRevision: s.schemaRevision,
    };
  };
  const queues = [first, second].map(
    (item, i) =>
      new ConfigDispatchQueue(
        () => i === 0 || active,
        readSnapshot,
        (value) => item.host.request('config.deliver', value),
      ),
  );
  const forward = (event) => {
    if (event.type === 'config.changed' && event.entityId === 'template')
      queues.forEach((q) => q.enqueue(event.payload));
  };
  events.on('event', forward);
  const stops = [first, second].map((item, i) =>
    item.window.scwcutils.config.subscribe((c) => received[i].push(c.revision)),
  );
  try {
    await Promise.all(queues.map((q) => q.flush()));
    await waitFor(() => received.every((r) => r.length));
    const current = await readSnapshot();
    active = false;
    await api('/plugins/template/config/update', {
      values: { 'validation.note': 'queued' },
      baseRevision: current.revision,
      schemaRevision: current.schemaRevision,
    });
    await waitFor(() => received[0].at(-1) > current.revision);
    assert.equal(received[1].at(-1), current.revision);
    active = true;
    await queues[1].flush();
    await waitFor(() => received[1].at(-1) === received[0].at(-1));
    const value = await readSnapshot();
    queues.forEach((q) => q.enqueue(value));
    await Promise.all(queues.map((q) => q.flush()));
    assert.ok(received.every((r) => new Set(r).size === r.length));
    assert.equal(first.window.scwcutils.page.register, undefined);
    assert.equal(first.window.scwcutils.settings, undefined);
    assert.equal(first.window.scwcutils.config.set, undefined);
    assert.equal(first.window.scwcutils.host.capabilities.uiHandlers, true);
    const registration = first.messages
      .filter((m) => m.method === 'ui.handlers.changed')
      .at(-1).payload;
    const selection = await first.host.request('ui.invoke', {
      name: 'template.selection',
      args: [],
      revision: registration.revision,
      context: { invocation: 'render' },
    });
    assert.equal(selection.hasValue, true);
    const called = await first.host.request('ui.invoke', {
      name: 'template.record',
      args: ['native', 123],
      revision: registration.revision,
      context: { invocation: 'event', sourceTabId: 'first' },
    });
    assert.match(called.value, /native/);
    const other = await second.host.request('ui.invoke', {
      name: 'template.selection',
      args: [],
      context: { invocation: 'render' },
    });
    assert.doesNotMatch(other.value, /native/);
    const custom = await first.window.scwcutils.ui.handlers.register('temporary', {
      readOnly: true,
      run: () => null,
    });
    await custom.dispose();
    await assert.rejects(() =>
      first.host.request('ui.invoke', { name: 'temporary', context: { invocation: 'render' } }),
    );
  } finally {
    stops.forEach((stop) => stop());
    queues.forEach((q) => q.dispose());
    events.off('event', forward);
  }
});

test('仅检查跨插件解析：处理器注册只属于其插件，其他插件不可借用', async () => {
  const { parseProgram } = await import('../../../../shared/ui-expressions.ts');
  const { negativePrograms } = await import('../ui-content.ts');
  for (const source of negativePrograms) assert.throws(() => parseProgram(source));
  const { DeclarativeUIService } = await core('workbench/declarative-ui.ts');
  const service = new DeclarativeUIService();
  const source = {
    handlers: [{ name: 'foreign.handler', readOnly: true, watch: false, reads: [] }],
    views: [],
    mounts: [],
    inspector: false,
  };
  await service.install('other', 'other-owner', directory, source, async () => ({
    hasValue: true,
    value: 'foreign',
  }));
  await assert.rejects(
    () =>
      service.install(
        'caller',
        'caller-owner',
        directory,
        {
          ...source,
          handlers: [],
          views: [
            {
              surface: 'mainSidebar',
              definition: {
                id: 'test',
                title: 'test',
                content: { format: 'html', version: 1, html: '<p>${foreign.handler()}</p>' },
              },
            },
          ],
        },
        async () => null,
      ),
    { code: 'UI_HANDLER_NOT_FOUND' },
  );
  service.releaseOwner('other-owner');
});

test('核心页面信息模板：保存/重置/保留草稿/丢弃与冲突，异步处理器取消', async () => {
  const { createHash } = await import('node:crypto');
  const lease = await api('/workspaces/template-config-form/lease', { action: 'acquire' });
  const view = await api('/ui/instances', {
    pluginId: 'template',
    surface: 'currentPage',
    viewId: 'currentPage',
    workspaceId: lease.workspaceId,
    lease: lease.token,
  });
  assert.equal(view.compiled.format, 'json');
  assert.doesNotMatch(JSON.stringify(view.compiled), /ui:template/);
  const field = (key) => 'config.f' + createHash('sha256').update(key).digest('hex').slice(0, 16);
  const current = await api('/plugins/template/config');
  const values = Object.fromEntries(
    Object.entries(current.effectiveValues)
      .filter(([k]) => k !== 'validation.contract')
      .map(([key, value]) => [field(key), key === 'validation.enabled' ? value === 'true' : value]),
  );
  values[field('validation.note')] = 'draft to save';
  await api(`/ui/instances/${view.id}/data`, {
    renderRevision: view.renderRevision,
    fields: values,
  });
  const binding = (method) =>
    view.compiled.events.find((e) =>
      e.program.branches.some((chain) =>
        chain.some((c) => c.name === `core:inspector.config.${method}`),
      ),
    );
  const execute = (method) => {
    const event = binding(method);
    assert.ok(event, method);
    return api(`/ui/instances/${view.id}/events`, {
      lease: lease.token,
      eventId: crypto.randomUUID(),
      renderRevision: view.renderRevision,
      bindingId: event.id,
      fields: Object.fromEntries(
        event.capture.map((name) => [name, { value: values[name], editSequence: 4 }]),
      ),
    });
  };
  assert.equal((await execute('save')).status, 'succeeded');
  assert.equal(
    (await api('/plugins/template/config')).effectiveValues['validation.note'],
    'draft to save',
  );
  const remote = await api('/plugins/template/config');
  await api('/plugins/template/config/update', {
    values: { 'validation.note': 'remote changed' },
    baseRevision: remote.revision,
    schemaRevision: remote.schemaRevision,
  });
  assert.equal((await execute('save')).status, 'failed');
  assert.equal(values[field('validation.note')], 'draft to save');
  assert.equal((await execute('rebase')).effects[0].type, 'config.rebased');
  assert.equal((await execute('save')).status, 'succeeded');
  assert.equal((await execute('discard')).effects[0].type, 'config.saved');
  assert.equal((await execute('reset')).status, 'succeeded');
  await api(`/ui/instances/${view.id}/release`, {});
  const main = await api('/ui/instances', {
    pluginId: 'template',
    surface: 'mainSidebar',
    viewId: 'template-overview',
    workspaceId: lease.workspaceId,
    lease: lease.token,
  });
  const pending = api(`/ui/instances/${main.id}/events`, {
    lease: lease.token,
    eventId: crypto.randomUUID(),
    renderRevision: main.renderRevision,
    bindingId: namedButton(main, '异步取消（等待中从普通页释放演示）').id,
    fields: {},
  });
  // Give the actual plugin RPC an opportunity to enter its abort-aware wait.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await api(`/ui/instances/${main.id}/release`, {});
  const cancelled = await pending;
  assert.equal(cancelled.status, 'failed');
  assert.ok(['UI_EXECUTION_FAILED', 'UI_STALE_RENDER'].includes(cancelled.error.code));
});
