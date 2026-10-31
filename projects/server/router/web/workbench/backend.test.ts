import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
vi.mock('../../../common/environment.ts', () => ({ loadEnvironment: () => undefined }));
const installFixture = await vi.hoisted(async () => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { path: join(tmpdir(), `scwc-install-${crypto.randomUUID()}.user.js`) };
});
vi.mock('../../../utils/user-script.ts', () => ({
  userScriptPath: installFixture.path,
  requireUserScript: vi.fn(async () => undefined),
  openUserScriptInstaller: vi.fn(async () => ({ url: 'http://localhost/web/userscript/scwc.user.js', message: '已发送安装请求' })),
}));
vi.mock('../../../utils/cache.ts', () => ({
  addErrorHandler: () => {
    /* Cache is outside this HTTP fixture. */
  },
  createNamespacedCache: () => ({}),
}));
import { app } from '../../index.ts';
import { createServer, type Server } from 'node:http';
import { attachUpgradeDispatcher } from './websocket.ts';
import { TOKEN } from '../../../common/env.ts';
import { loadPlugins, plugins, unloadPlugins } from '../../../plugin/load.ts';
import { getWorkbench, closeWorkbench } from '../../../workbench/runtime.ts';
import { closeStorage } from '../../../workbench/storage.ts';
import { openUserScriptInstaller } from '../../../utils/user-script.ts';

let root: string, base: string, server: Server;
const sockets: WebSocket[] = [];
async function api(url: string, body?: unknown, token = TOKEN, origin = base) {
  const response = await fetch(base + '/web/api/workbench' + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      authorization: `Bearer ${token}`,
      'x-scwc-client-window': 'test-window',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json()) };
}
beforeAll(async () => {
  await fs.writeFile(installFixture.path, '// ==UserScript==\n// @name SCWC installation fixture\n// ==/UserScript==\n');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-web-backend-'));
  process.env.SCWC_DATA_DIR = path.join(root, 'data');
  process.env.SCWC_WEB_WORKBENCH_DB = path.join(root, 'workbench.sqlite');
  for (const id of ['alpha', 'beta']) {
    const directory = path.join(root, 'plugins', id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        type: 'module',
        main: 'index.ts',
        enabled: true,
        name: id,
        scwc: { ui: { title: 'Package ' + id, spa: true, assetPrefix: ['assets/'] } },
      }),
    );
    await fs.writeFile(
      path.join(directory, 'index.html'),
      '<HTML><HEAD><script>globalThis.appStarted=true;</script></HEAD><BODY>ready</BODY></HTML>',
    );
    await fs.writeFile(
      path.join(directory, 'index.ts'),
      `let config;let changes=[];let feedback;let notice;let task;export default {title:'Export ${id}',description:'Description',onRequest(){},configuration:{definitions:[{id:'config',schemaVersion:'1',items:[{id:'persist',key:'persist',label:'Persist',control:'text',defaultValue:''}]}]},async onLoad(logger,context){config=context.config;feedback=context.workbench;await config.set('persist','${id}');config.subscribe(change=>changes.push(change));const ui=context.workbench.ui;await ui.handlers.register('echo',{readOnly:true,run(...args){return args;}});await ui.registerMainSidebar({id:'overview',title:'Overview',icon:{kind:'builtin',name:'info'},content:{format:'html',version:1,html:'<input name="q"><button for="q" onclick="core:string.trim($for:q)|echo($prev)">Go</button>'}});await ui.registerAuxiliarySidebar({id:'details',title:'Details',icon:{kind:'builtin',name:'info'},content:{format:'html',version:1,html:'<p>Details</p>'}});await ui.registerStatusBar({id:'state',ariaLabel:'State',text:'Ready',tooltip:{content:{format:'text',text:'Details'}}});logger.workbench.success('Ready ${id}');},ui:{entry:'./index.html',api:[{method:'POST',path:'/feedback',async handler(){task=await feedback.tasks.create({title:'进程任务',progress:null});notice=await feedback.logger.info('进程通知',{progress:null,autoRead:false,systemNotification:true,actions:[{label:'完成',async onClick(){await task.succeed('完成');await notice.update({title:'已完成',level:'success',progress:100});}}]});await task.setProgress(35);return {notification:await notice.getState(),task:await task.getState()};}},{method:'GET',path:'/read',async handler(){return {value:await config.get('persist'),changes};}},{method:'POST',path:'/write',async handler(data){await config.set('persist',data.value);return await config.list();}}]}};`,
    );
  }
  getWorkbench();
  await fs.mkdir(path.join(root, 'plugins/disabled'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'plugins/disabled/package.json'),
    JSON.stringify({
      main: 'index.ts',
      type: 'module',
      enabled: false,
      scwc: { ui: { title: 'Disabled' } },
    }),
  );
  await fs.writeFile(
    path.join(root, 'plugins/disabled/index.ts'),
    "throw new Error('disabled entry must never execute');",
  );
  await fs.mkdir(path.join(root, 'plugins/malformed'), { recursive: true });
  await loadPlugins(path.join(root, 'plugins'));
  server = createServer(app);
  attachUpgradeDispatcher(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
}, 15000);
afterAll(async () => {
  await fs.rm(installFixture.path, { force: true });
  for (const s of sockets) {
    s.terminate();
  }
  await unloadPlugins(false);
  await closeWorkbench();
  closeStorage();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
  delete process.env.SCWC_DATA_DIR;
  delete process.env.SCWC_WEB_WORKBENCH_DB;
});

it('exposes stable identities, complete metadata, strict origin and the runtime data/scwc config database', async () => {
  const a = await api('/bootstrap'),
    b = await api('/bootstrap');
  expect(a.status).toBe(200);
  expect(a.data.installationId).toBe(b.data.installationId);
  const list = await api('/plugins');
  expect(list.data.items).toHaveLength(4);
  expect(
    list.data.items.find((p: { pluginId: string }) => p.pluginId === 'disabled'),
  ).toMatchObject({ runtime: { status: 'disabled', pid: null }, ui: { detection: 'unknown' } });
  expect(
    list.data.items.find((p: { pluginId: string }) => p.pluginId === 'malformed').diagnostics,
  ).toContainEqual({ code: 'invalid_package', message: 'package.json 缺失或格式错误' });
  expect(list.data.items[0]).toMatchObject({
    pluginId: 'alpha',
    title: 'Package alpha',
    runtime: { status: 'ready', pid: expect.any(Number) },
  });
  expect(JSON.stringify(list)).not.toContain(root);
  expect((await api('/bootstrap', undefined, 'wrong')).status).toBe(403);
  expect((await api('/bootstrap', undefined, TOKEN, 'http://localhost:1')).status).toBe(403);
  expect((await fs.stat(path.join(root, 'data/scwc/plugin-config.sqlite'))).isFile()).toBe(true);
  expect((await api('/plugins/alpha/config')).data.effectiveValues.persist).toBe('alpha');
  expect((await api('/plugins/beta/config')).data.effectiveValues.persist).toBe('beta');
});

it('bridges backend control objects and scopes frontend task and notification controls', async () => {
  const alpha = plugins.find((p) => p.pluginId === 'alpha');
  if (!alpha) {
    throw new Error('alpha missing');
  }
  const created = await fetch(
    `${base}/web/api/plugin/${alpha.safeId}/feedback?site=${encodeURIComponent(base)}`,
    {
      method: 'POST',
      headers: {
        origin: base,
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: '{}',
    },
  );
  const result = (await created.json()).data;
  expect(result.task).toMatchObject({ status: 'running', progress: 35 });
  expect(result.notification).toMatchObject({
    source: 'plugin', progress: null, autoRead: false, systemNotification: true,
  });
  expect(
    (
      await api(
        `/notifications/${result.notification.id}/actions/${result.notification.actions[0].id}`,
        {},
      )
    ).status,
  ).toBe(200);
  expect((await api(`/jobs/${result.task.id}`)).data).toMatchObject({
    status: 'succeeded',
    progress: 100,
  });
  expect(getWorkbench().notifications.get(result.notification.id)).toMatchObject({
    title: '已完成',
    progress: 100,
  });
  const session = (
    await api('/page-sessions', {
      pluginId: 'alpha',
      tabId: 'feedback-tab',
      frameEpoch: 'feedback-one',
      url: `${base}/web/page/plugin/alpha/`,
    })
  ).data;
  const notice = await api(
    '/notifications/publish',
    {
      title: '页面通知', level: 'info',
      options: { progress: null, autoRead: false, systemNotification: true },
    },
    session.grant,
  );
  expect(notice.status).toBe(200);
  expect(notice.data.systemNotification).toBe(true);
  const id = notice.data.id;
  expect(
    (await api(
      `/notifications/${id}/update`,
      { progress: 60, message: '更新正文', systemNotification: false },
      session.grant,
    )).data,
  ).toMatchObject({ progress: 60, message: '更新正文', systemNotification: false });
  expect((await api('/notifications/visibility', { ids: [id] })).status).toBe(200);
  expect((await api(`/notifications/${id}`, undefined, session.grant)).data).toMatchObject({
    visible: true,
    readAt: null,
  });
  expect(
    (await api(`/notifications/${id}/read`, { read: true }, session.grant)).data.readAt,
  ).toBeTruthy();
  const task = await api('/tasks/create', { title: '页面任务', progress: null }, session.grant);
  expect(task.status).toBe(200);
  expect(
    (
      await api(
        `/tasks/${task.data.id}/update`,
        { progress: 100, status: 'succeeded' },
        session.grant,
      )
    ).status,
  ).toBe(200);
  expect(
    (await api('/tasks/start', { pluginId: 'beta', type: 'reload' }, session.grant)).status,
  ).toBe(403);
  expect((await api('/notifications/ack', { ids: [id] }, session.grant)).status).toBe(403);
  const other = (
    await api('/page-sessions', {
      pluginId: 'alpha',
      tabId: 'feedback-other',
      frameEpoch: 'feedback-two',
      url: `${base}/web/page/plugin/alpha/`,
    })
  ).data;
  expect((await api(`/notifications/${id}/update`, { title: '越权' }, other.grant)).status).toBe(
    403,
  );
  expect(
    (await api(`/tasks/${task.data.id}/update`, { content: '越权' }, other.grant)).status,
  ).toBe(403);
  const pending = await api('/tasks/create', { title: '页面离开' }, session.grant);
  expect((await api('/feedback/release', {}, session.grant)).status).toBe(200);
  expect((await api(`/jobs/${pending.data.id}`)).data).toMatchObject({
    status: 'failed',
    progress: false,
  });
  expect((await api(`/notifications/${id}/close`, {}, session.grant)).status).toBe(200);
  expect((await api(`/notifications/${id}`, undefined, session.grant)).status).toBe(404);
});

it('registers declarative UI through real IPC and executes the core current-page JSON template', async () => {
  const registry = (await api('/ui/registry')).data;
  expect(registry.items.filter((v: { pluginId: string }) => v.pluginId === 'alpha')).toHaveLength(
    3,
  );
  expect(JSON.stringify(registry)).not.toContain(root);
  const lease = (await api('/workspaces/declarative/lease', { action: 'acquire' })).data;
  const created = await api('/ui/instances', {
    pluginId: 'alpha',
    surface: 'mainSidebar',
    viewId: 'overview',
    workspaceId: lease.workspaceId,
    lease: lease.token,
  });
  expect(created.status).toBe(200);
  const view = created.data;
  const invoked = await api(`/ui/instances/${view.id}/events`, {
    lease: lease.token,
    eventId: 'ui-call',
    renderRevision: view.renderRevision,
    bindingId: 'e0',
    fields: { q: { value: '  query  ', editSequence: 1 } },
  });
  expect(invoked.status).toBe(200);
  expect(invoked.data.result).toEqual(['query']);
  const inspector = await api('/ui/instances', {
    pluginId: 'alpha',
    surface: 'currentPage',
    viewId: 'currentPage',
    workspaceId: lease.workspaceId,
    lease: lease.token,
  });
  expect(inspector.status, JSON.stringify(inspector)).toBe(200);
  const current = inspector.data;
  expect(JSON.stringify(current.compiled)).not.toContain('ui:');
  const collectNodes = (nodes: unknown[]): { attrs?: Record<string, string> }[] => {
    const collected: { attrs?: Record<string, string> }[] = [];
    for (const raw of nodes) {
      const node = raw as { attrs?: Record<string, string>; children?: unknown[] };
      collected.push(node, ...collectNodes(node.children ?? []));
    }
    return collected;
  };
  const currentNodes = collectNodes(current.compiled.nodes);
  const currentTabs = currentNodes
    .filter((node) => node.attrs?.['data-ui-tab-trigger'])
    .map((node) => node.attrs?.['data-ui-tab-trigger']);
  expect(currentTabs).toEqual(expect.arrayContaining(['properties', 'config', 'diagnostics']));
  expect(currentNodes.filter((node) => node.attrs?.['data-ui-tabs'])).toHaveLength(2);
  expect(current.compiled.events.some((event: { event: string }) => event.event === 'submit')).toBe(
    true,
  );
  const configField = current.compiled.fields[0].name;
  const values = await api(`/ui/instances/${current.id}/data`, {
    renderRevision: current.renderRevision,
    fields: { [configField]: 'alpha' },
  });
  expect(values.status).toBe(200);
  expect(values.data.updates.some((u: { value: unknown }) => u.value === 'alpha')).toBe(true);
  const submit = current.compiled.events.find((e: { event: string }) => e.event === 'submit');
  const saved = await api(`/ui/instances/${current.id}/events`, {
    lease: lease.token,
    eventId: 'ui-save',
    renderRevision: current.renderRevision,
    bindingId: submit.id,
    fields: { [configField]: { value: 'from core template', editSequence: 1 } },
  });
  expect(saved.status).toBe(200);
  expect((await api('/plugins/alpha/config')).data.effectiveValues.persist).toBe(
    'from core template',
  );
  expect((await api(`/ui/instances/${view.id}/release`, {})).status).toBe(200);
  expect((await api(`/ui/instances/${current.id}/release`, {})).status).toBe(200);
});

it('serves the public userscript and requires core authentication for opening the default browser', async () => {
  const script = await fetch(base + '/web/userscript/scwc.user.js');
  expect(script.status).toBe(200);
  expect(script.headers.get('content-type')).toContain('javascript');
  expect(script.headers.get('cache-control')).toBe('no-store');
  expect(await script.text()).toContain('// @name SCWC installation fixture');
  vi.mocked(openUserScriptInstaller).mockClear();
  expect((await api('/userscript/install', {}, 'wrong')).status).toBe(403);
  expect(openUserScriptInstaller).not.toHaveBeenCalled();
  expect((await api('/userscript/install', {})).data.message).toBe('已发送安装请求');
  vi.mocked(openUserScriptInstaller).mockRejectedValueOnce(new Error('默认浏览器不可用'));
  expect(await api('/userscript/install', {})).toMatchObject({ status: 503, code: 'userscript_install_failed', message: '默认浏览器不可用' });
});

it('scopes page grants and ticket streams, synchronizes backend string CRUD, rejects nonstrings and stale grants', async () => {
  const session = (
    await api('/page-sessions', {
      pluginId: 'alpha',
      tabId: 'tab',
      frameEpoch: 'one',
      url: `${base}/web/page/plugin/alpha/`,
    })
  ).data;
  expect((await api('/plugins/beta/config', undefined, session.grant)).status).toBe(403);
  const installs = vi.mocked(openUserScriptInstaller).mock.calls.length;
  expect((await api('/userscript/install', {}, session.grant)).status).toBe(403);
  expect(openUserScriptInstaller).toHaveBeenCalledTimes(installs);
  expect(
    (
      await api(
        '/plugins/alpha/actions',
        { action: 'disable', idempotencyKey: 'no' },
        session.grant,
      )
    ).status,
  ).toBe(403);
  const current = (await api('/plugins/alpha/config', undefined, session.grant)).data;
  const ticket = (await api('/stream-ticket', {}, session.grant)).data.ticket;
  const ws = new WebSocket(
    base.replace('http:', 'ws:') + `/web/websocket/workbench?ticket=${ticket}`,
    { origin: base },
  );
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const ready = new Promise<void>((resolve) =>
    ws.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'connection.ready') {
        resolve();
      }
    }),
  );
  ws.send(
    JSON.stringify({
      type: 'resume',
      coreBootId: (await api('/bootstrap')).data.coreBootId,
      positions: { workbench: 0 },
    }),
  );
  await ready;
  const changed = new Promise<{ payload: { effectiveValues: Record<string, string> } }>((resolve) =>
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.type === 'config.changed') {
        resolve(e);
      }
    }),
  );
  expect(
    (
      await api(
        '/plugins/alpha/config/update',
        {
          values: { persist: 'forbidden' },
          baseRevision: current.revision,
          schemaRevision: current.schemaRevision,
        },
        session.grant,
      )
    ).status,
  ).toBe(403);
  const written = await api(
    '/plugins/alpha/config/update',
    {
      values: { persist: '' },
      baseRevision: current.revision,
      schemaRevision: current.schemaRevision,
    },
    TOKEN,
  );
  expect(written.status).toBe(200);
  expect((await changed).payload.effectiveValues.persist).toBe('');
  const alpha = plugins.find((p) => p.pluginId === 'alpha');
  if (!alpha) {
    throw new Error('alpha missing');
  }
  await expect
    .poll(async () => {
      const r = await fetch(`${base}/web/api/plugin/${alpha.safeId}/read`, {
        headers: { origin: base, authorization: `Bearer ${session.grant}` },
      });
      return (await r.json()).data.value;
    })
    .toBe('');
  expect(
    (
      await api(
        '/plugins/alpha/config/update',
        {
          values: { persist: 20 },
          baseRevision: written.data.revision,
          schemaRevision: current.schemaRevision,
        },
        TOKEN,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await api(
        '/plugins/alpha/config/update',
        {
          values: { persist: 'new' },
          baseRevision: current.revision,
          schemaRevision: current.schemaRevision,
        },
        TOKEN,
      )
    ).status,
  ).toBe(409);
  const reset = await api(
    '/plugins/alpha/config/reset',
    {
      keys: ['persist'],
      baseRevision: written.data.revision,
      schemaRevision: current.schemaRevision,
    },
    TOKEN,
  );
  expect(reset.data.values).not.toHaveProperty('persist');
  const job = await api('/plugins/alpha/actions', {
    action: 'once-disable',
    idempotencyKey: 'stop',
  });
  expect(job.status).toBe(202);
  await expect
    .poll(async () => (await api('/jobs/' + job.data.id)).data.status, { timeout: 5000 })
    .toBe('succeeded');
  const repeated = await api('/plugins/alpha/actions', {
    action: 'once-disable',
    idempotencyKey: 'stop',
  });
  expect(repeated.data).toMatchObject({ id: job.data.id, status: 'succeeded' });
  expect(
    JSON.parse(await fs.readFile(path.join(root, 'plugins/alpha/package.json'), 'utf8')).enabled,
  ).toBe(true);
  expect((await api('/plugins/alpha/config', undefined, session.grant)).status).toBe(403);
});

it('injects SDK before application scripts and supports declared dotted SPA paths', async () => {
  const html = await (
    await fetch(base + '/web/page/plugin/beta/foo.bar', { headers: { accept: 'text/html' } })
  ).text();
  expect(html.indexOf('data-scwc-bootstrap')).toBeLessThan(html.indexOf('appStarted'));
  expect((await fetch(base + '/web/page/plugin/beta/assets/missing.js')).status).toBe(404);
});

it('rejects plugin symlink assets', async (context) => {
  await fs.writeFile(path.join(root, 'outside.txt'), 'secret');
  try {
    await fs.symlink(path.join(root, 'outside.txt'), path.join(root, 'plugins/beta/escape.txt'));
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip('Windows 当前权限不能创建文件 symlink');
      return;
    }
    throw error;
  }
  expect((await fetch(base + '/web/page/plugin/beta/escape.txt')).status).toBe(403);
});
