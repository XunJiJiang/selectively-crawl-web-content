import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import WebSocket from 'ws';

const development = vi.hoisted(() => ({ port: 3201 }));
vi.mock('../../common/setupParam.ts', () => ({
  parsedArgs: {},
  isDev: true,
  isProd: false,
  get WEB_PORT() {
    return development.port;
  },
  get WEB_ORIGIN() {
    return `http://127.0.0.1:${development.port}`;
  },
}));
vi.mock('../../utils/cache.ts', () => ({
  addErrorHandler: () => {
    /* Redis is outside this HTTP fixture. */
  },
  createNamespacedCache: () => ({}),
}));
vi.mock('../../common/env.ts', async () => {
  const { fileURLToPath } = await import('node:url');
  return {
    HOST: 'http://127.0.0.1',
    TOKEN: 'development-test-token',
    ACTIVE_PORT: 3200,
    SERVER_ROOT: fileURLToPath(new URL('../../', import.meta.url)),
    ROOT: fileURLToPath(new URL('../../../../', import.meta.url)),
  };
});

import { app } from '../index.ts';
import { TOKEN } from '../../common/env.ts';
import { attachUpgradeDispatcher } from './workbench/websocket.ts';
import { closeWorkbench } from '../../workbench/runtime.ts';
import { closeStorage } from '../../workbench/storage.ts';

let directory: string, core: string, page: string, server: Server, vite: ViteDevServer;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-vite-'));
  vi.stubEnv('SCWC_DATA_DIR', path.join(directory, 'data'));
  vi.stubEnv('SCWC_WEB_WORKBENCH_DB', path.join(directory, 'workbench.sqlite'));
  server = createServer(app);
  attachUpgradeDispatcher(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  core = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv('SCWC_CORE_URL', core);
  vite = await createViteServer({
    configFile: fileURLToPath(new URL('../../../web/vite.config.ts', import.meta.url)),
    cacheDir: path.join(directory, 'vite-cache'),
    // This HTTP/proxy fixture does not execute browser modules.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'silent',
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite 未分配 HTTP 端口');
  }
  development.port = address.port;
  page = `http://127.0.0.1:${development.port}`;
}, 15000);

afterAll(async () => {
  sockets.forEach((socket) => socket.terminate());
  await vite?.close();
  await closeWorkbench();
  closeStorage();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  vi.unstubAllEnvs();
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function api(endpoint: string, token: string, body?: unknown) {
  return fetch(`${page}/web/api/workbench${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: page,
      Referer: `${page}/web/`,
      'Sec-Fetch-Site': 'same-origin',
      Authorization: `Bearer ${token}`,
      'X-SCWC-Client-Window': 'vite-test',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

it.each(['/web', '/web/', '/web/index.html?workspace=one'])(
  'redirects %s to the configured Vite port',
  async (pathname) => {
    const response = await fetch(core + pathname, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const target = response.headers.get('location') ?? '';
    expect(target).toBe(page + (pathname === '/web' ? '/web/' : pathname));
    const document = await fetch(target);
    expect(document.status).toBe(200);
    expect(await document.text()).toContain('/@vite/client');
  },
);

it('automatically loads the token through Vite and authenticates the first API request', async () => {
  const response = await fetch(`${page}/web/local-config`, {
    headers: {
      Referer: `${page}/web/`,
      'X-SCWC-Local-Config': '1',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { data } = await response.json();
  expect(data).toEqual({ host: 'http://127.0.0.1', port: String(development.port), token: TOKEN });
  const bootstrap = await api('/bootstrap', data.token);
  expect(bootstrap.status).toBe(200);
  expect((await bootstrap.json()).data.installationId).toBeTruthy();
});

it('rejects a wrong token and accepts a manual retry with the current token', async () => {
  expect((await api('/bootstrap', 'wrong-token')).status).toBe(403);
  expect((await api('/bootstrap', TOKEN)).status).toBe(200);
});

it('proxies plugin page paths without falling back to Vite HTML', async () => {
  const response = await fetch(`${page}/web/page/plugin/missing/`);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('/@vite/client');
});

it('serves the same public UI stylesheet from the core and the development proxy without a token', async () => {
  const expected = await fs.readFile(
    new URL('../../public/resources/styles/json-ui.css', import.meta.url),
    'utf8',
  );
  for (const origin of [core, page]) {
    const response = await fetch(`${origin}/web/page/resources/styles/json-ui.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(await response.text()).toBe(expected);
  }
});

it('filters macOS icon resources from both the core and the development proxy', async () => {
  for (const origin of [core, page]) {
    for (const resource of ['macos/Assets.car', 'macos/SCWC.icon/icon.json']) {
      const response = await fetch(`${origin}/web/page/resources/${resource}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('not found');
    }
  }
});

it('preserves the page origin for a single-use WebSocket ticket through Vite', async () => {
  const ticketResponse = await api('/stream-ticket', TOKEN, {});
  expect(ticketResponse.status).toBe(200);
  const { data } = await ticketResponse.json();
  const socket = new WebSocket(
    `${page.replace('http:', 'ws:')}/web/websocket/workbench?ticket=${data.ticket}`,
    { origin: page },
  );
  sockets.push(socket);
  const message = once(socket, 'message');
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'resume', coreBootId: 'old', positions: {} }));
  expect(JSON.parse(String((await message)[0])).type).toBe('connection.resync-required');
});
