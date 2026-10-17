import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
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
      `let config;let changes=[];export default {title:'Export ${id}',description:'Description',onRequest(){},async onLoad(logger,context){config=context.config;await config.set('persist','${id}');config.subscribe(change=>changes.push(change));logger.workbench.success('Ready ${id}');},ui:{entry:'./index.html',api:[{method:'GET',path:'/read',async handler(){return {value:await config.get('persist'),changes};}},{method:'POST',path:'/write',async handler(data){await config.set('persist',data.value);return await config.list();}}]}};`,
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
    title: 'Export alpha',
    runtime: { status: 'ready', pid: expect.any(Number) },
  });
  expect(JSON.stringify(list)).not.toContain(root);
  expect((await api('/bootstrap', undefined, 'wrong')).status).toBe(403);
  expect((await api('/bootstrap', undefined, TOKEN, 'http://localhost:1')).status).toBe(403);
  expect((await fs.stat(path.join(root, 'data/scwc/plugin-config.sqlite'))).isFile()).toBe(true);
  expect((await api('/plugins/alpha/config')).data.effectiveValues.persist).toBe('alpha');
  expect((await api('/plugins/beta/config')).data.effectiveValues.persist).toBe('beta');
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
  const written = await api(
    '/plugins/alpha/config/update',
    {
      values: { persist: '' },
      baseRevision: current.revision,
      schemaRevision: current.schemaRevision,
    },
    session.grant,
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
        session.grant,
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
        session.grant,
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
    session.grant,
  );
  expect(reset.data.values).not.toHaveProperty('persist');
  const job = await api('/plugins/alpha/actions', {
    action: 'once-disable',
    idempotencyKey: 'stop',
  });
  expect(job.status).toBe(202);
  await expect.poll(async () => (await api('/jobs/' + job.data.id)).data.status).toBe('succeeded');
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

it('injects SDK before application scripts, supports declared dotted SPA paths and rejects symlink assets', async () => {
  const html = await (
    await fetch(base + '/web/page/plugin/beta/foo.bar', { headers: { accept: 'text/html' } })
  ).text();
  expect(html.indexOf('data-scwc-bootstrap')).toBeLessThan(html.indexOf('appStarted'));
  await fs.writeFile(path.join(root, 'outside.txt'), 'secret');
  await fs.symlink(path.join(root, 'outside.txt'), path.join(root, 'plugins/beta/escape.txt'));
  expect((await fetch(base + '/web/page/plugin/beta/escape.txt')).status).toBe(403);
  expect((await fetch(base + '/web/page/plugin/beta/assets/missing.js')).status).toBe(404);
});
