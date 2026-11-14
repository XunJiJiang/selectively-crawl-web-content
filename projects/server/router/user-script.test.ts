import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../common/environment.ts', () => ({}));
vi.mock('../utils/cache.ts', () => ({
  addErrorHandler: () => undefined,
  createNamespacedCache: () => ({}),
}));
const controls = vi.hoisted(() => ({
  a: vi.fn(() => [{ type: 'button', channel: 'go', label: 'A', trigger: () => undefined }]),
  b: vi.fn(() => [{ type: 'button', channel: 'go', label: 'B', trigger: () => undefined }]),
}));
vi.mock('../plugin/load.ts', () => ({
  pluginLifecycleEvents: { on: vi.fn(), off: vi.fn() },
  plugins: [
    {
      pluginId: 'query',
      name: 'query',
      linkWith: ['https://one.example/*', 'https://two.example/*'],
      logger: { warn: vi.fn() },
      handler: {
        pluginConfig: {
          scripts: {
            title: 'Query',
            refreshRules: [
              { sites: ['https://one.example/*'], rule: '?q' },
              { sites: ['https://two.example/*'], rule: '#' },
            ],
            controls: controls.a,
          },
        },
      },
    },
    {
      pluginId: 'path',
      name: 'path',
      linkWith: ['https://one.example/*'],
      logger: { warn: vi.fn() },
      handler: { pluginConfig: { scripts: { title: 'Path', controls: controls.b } } },
    },
  ],
  inactivePlugins: [],
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  reloadPlugin: vi.fn(),
  unloadPlugins: vi.fn(),
  configuredPluginDirectory: async () => '/unused',
  enqueuePlugin: (_id: string, work: () => unknown) => work(),
}));
import { app } from './index.ts';
import { attachUpgradeDispatcher } from './web/workbench/websocket.ts';
import { TOKEN } from '../common/env.ts';
import { closeUserScriptConfig } from '../user-script/config.ts';
import { siteNotifications } from '../user-script/notifications.ts';
import {
  defaultSiteData,
  websiteOrigin,
  type UserScriptSnapshot,
} from '../../shared/userscript-config.ts';

let server: Server, base: string, directory: string;
const sockets: WebSocket[] = [];
const previousDataDirectory = process.env.SCWC_DATA_DIR;
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-site-http-'));
  process.env.SCWC_DATA_DIR = directory;
  server = createServer(app);
  attachUpgradeDispatcher(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeUserScriptConfig();
  await fs.rm(directory, { recursive: true, force: true });
  if (previousDataDirectory === undefined) {
    delete process.env.SCWC_DATA_DIR;
  } else {
    process.env.SCWC_DATA_DIR = previousDataDirectory;
  }
});
function snapshot(
  website = 'https://one.example',
  date = '2026-10-30T10:00:00.000Z',
): UserScriptSnapshot {
  return { version: 1, website: websiteOrigin(website), updatedAt: date, data: defaultSiteData() };
}
async function sync(
  value: UserScriptSnapshot,
  options: {
    token?: string;
    origin?: string;
    watch?: boolean;
    site?: string;
    notificationCursor?: string;
  } = {},
) {
  const response = await fetch(
    base + `/api/userscript/config/sync?site=${encodeURIComponent(options.site ?? value.website)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: options.origin ?? new URL(value.website).origin,
        authorization: `Bearer ${options.token ?? TOKEN}`,
      },
      body: JSON.stringify({
        snapshot: value,
        watch: options.watch,
        notificationCursor: options.notificationCursor,
      }),
    },
  );
  return { status: response.status, ...(await response.json()) };
}
function connect(ticket: string, origin = 'https://one.example') {
  const socket = new WebSocket(
    base.replace('http:', 'ws:') + `/api/userscript/config/events?ticket=${ticket}`,
    { origin },
  );
  sockets.push(socket);
  return socket;
}
function message(socket: WebSocket) {
  return new Promise<{ snapshot: UserScriptSnapshot }>((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
    socket.once('error', reject);
  });
}
describe('authenticated website sync and live notification', () => {
  it('bridges proactive notifications to polling and sockets, including the ticket handshake gap', async () => {
    const value = snapshot('https://notification.example'),
      origin = 'chrome-extension://notification-test';
    const initial = await sync(value, { origin, watch: true });
    const packets: { type: string; notification?: { title: string; scope: string } }[] = [];
    siteNotifications.publish('plugin', value.website, {
      title: '握手期间',
      scope: 'external',
      placement: 'tc',
    });
    const socket = connect(initial.data.ticket, origin);
    socket.on('message', (data) => packets.push(JSON.parse(String(data))));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await vi.waitFor(() =>
      expect(packets.some((packet) => packet.notification?.title === '握手期间')).toBe(true),
    );
    siteNotifications.publish('plugin', value.website, { title: '主动推送' });
    await vi.waitFor(() =>
      expect(packets.some((packet) => packet.notification?.title === '主动推送')).toBe(true),
    );
    const polled = await sync(value, { origin, notificationCursor: initial.data.cursor });
    expect(polled.data.notifications.map((entry: { title: string }) => entry.title)).toEqual([
      '握手期间',
      '主动推送',
    ]);
    expect(
      (await sync(value, { origin, notificationCursor: polled.data.cursor })).data.notifications,
    ).toEqual([]);
    expect(
      (
        await sync(snapshot('https://different.example'), {
          notificationCursor: initial.data.cursor,
        })
      ).data.notifications,
    ).toEqual([]);
  });
  it('authenticates extension origins, shares data and binds tickets to the requesting extension', async () => {
    const value = snapshot('https://extension-http.example');
    value.data.window.pos = { x: 800, y: 600 };
    value.data.window.minimized = false;
    await sync(value);
    const next = snapshot(value.website, '2026-11-01T00:00:00.000Z');
    next.data.items = [{ selector: '#extension', label: '正文', prefix: '' }];
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    const response = await sync(next, { origin, watch: true });
    expect(response.status).toBe(200);
    expect(response.data.snapshot.data.window).toEqual(value.data.window);
    expect(response.data.snapshot.data.items).toEqual(next.data.items);
    const socket = connect(response.data.ticket, origin);
    expect((await message(socket)).snapshot.data.items).toEqual(next.data.items);
    expect((await sync(next, { origin, token: 'wrong' })).status).toBe(403);
    expect((await sync(next, { origin: 'https://pretend-extension.example' })).status).toBe(400);
    expect((await sync(next, { origin: origin + '/fake-page' })).status).toBe(400);
    const firefox = await sync(next, {
      origin: 'moz-extension://12345678-1234-1234-1234-123456789012',
    });
    expect(firefox.status).toBe(200);
  });
  it('shares origin subscriptions across host paths, iframe paths and direct visits', async () => {
    const host = snapshot('https://frames.example/host');
    const child = snapshot('https://frames.example/child');
    const parentWatch = await sync(host, { watch: true, site: 'https://frames.example/host' });
    const parentSocket = connect(parentWatch.data.ticket, host.website);
    await message(parentSocket);
    const childWatch = await sync(child, { watch: true, site: 'https://frames.example/child' });
    const childSocket = connect(childWatch.data.ticket, child.website);
    await message(childSocket);
    const direct = { ...child, updatedAt: '2026-10-31T10:00:00.000Z', data: defaultSiteData() };
    direct.data.window.pos.x = 900;
    const pending = message(childSocket),
      parentPending = message(parentSocket);
    expect((await sync(direct)).data.snapshot).toEqual(direct);
    expect((await pending).snapshot).toEqual(direct);
    expect((await parentPending).snapshot).toEqual(direct);
    expect((await sync(child)).data.snapshot).toEqual(direct);
    expect((await sync(host)).data.snapshot).toEqual(direct);
  });
  it('rejects wrong credentials, cross-origin writes and malformed snapshots', async () => {
    expect((await sync(snapshot(), { token: 'wrong' })).status).toBe(403);
    expect((await sync(snapshot(), { origin: 'https://one.example:8443' })).status).toBe(403);
    expect((await sync({ ...snapshot(), updatedAt: 'invalid' })).status).toBe(400);
  });
  it('reconciles on every connection and immediately notifies only the matching website', async () => {
    const initial = await sync(snapshot(), { watch: true });
    expect(initial.status).toBe(200);
    const socket = connect(initial.data.ticket),
      first = await message(socket);
    expect(first.snapshot).toEqual(snapshot());
    const other = await sync(snapshot('https://two.example'), { watch: true });
    const otherSocket = connect(other.data.ticket, 'https://two.example');
    await message(otherSocket);
    const leaked = vi.fn();
    otherSocket.on('message', leaked);
    const next = snapshot(undefined, '2026-10-30T10:00:01.000Z');
    next.data.window.pos.x = 700;
    next.data.items = [{ selector: '#new', label: '正文', prefix: '' }];
    const pending = message(socket);
    expect((await sync(next)).data.snapshot).toEqual(next);
    expect((await pending).snapshot).toEqual(next);
    expect(leaked).not.toHaveBeenCalled();
    expect((await sync(snapshot())).data.snapshot).toEqual(next);
    const reconnect = await sync(snapshot(), { watch: true });
    const newSocket = connect(reconnect.data.ticket);
    expect((await message(newSocket)).snapshot).toEqual(next);
  });
  it('consumes each ticket once and binds it to the exact website origin', async () => {
    const { data } = await sync(snapshot(), { watch: true });
    const bad = connect(data.ticket, 'https://wrong.example');
    await expect(
      new Promise((resolve, reject) => {
        bad.once('open', resolve);
        bad.once('error', reject);
      }),
    ).rejects.toThrow('403');
    const reused = connect(data.ticket);
    await expect(
      new Promise((resolve, reject) => {
        reused.once('open', resolve);
        reused.once('error', reject);
      }),
    ).rejects.toThrow('403');
  });
});
describe('per-plugin refresh HTTP contract', () => {
  it('supports extension POST config loading without relaxing source or Bearer validation', async () => {
    const url = base + '/api/plugin/config?site=https%3A%2F%2Fone.example%2Fa';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        origin: 'chrome-extension://test-extension',
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.map((plugin: { id: string }) => plugin.id)).toEqual([
      'query',
      'path',
    ]);
    const denied = await fetch(url, {
      method: 'POST',
      headers: { origin: 'chrome-extension://test-extension', authorization: 'Bearer wrong' },
    });
    expect(denied.status).toBe(403);
    const absent = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(absent.status).toBe(400);
  });
  async function config(site: string, previousSite?: string) {
    const params = new URLSearchParams({ site, ...(previousSite ? { previousSite } : {}) });
    const response = await fetch(base + '/api/plugin/config?' + params, {
      headers: { origin: new URL(site).origin, authorization: `Bearer ${TOKEN}` },
    });
    return response.json();
  }
  it('loads initially then refreshes only the plugin whose declared policy matches', async () => {
    const a = 'https://one.example/a?q=1',
      b = 'https://one.example/b?q=1';
    const initial = await config(a);
    expect(initial.data.map((p: { id: string }) => p.id)).toEqual(['query', 'path']);
    controls.a.mockClear();
    controls.b.mockClear();
    const partial = await config(b, a);
    expect(partial.updatedIds).toEqual(['path']);
    expect(partial.activeIds).toEqual(['query', 'path']);
    expect(controls.a).not.toHaveBeenCalled();
    expect(controls.b).toHaveBeenCalledOnce();
    const query = await config(b.replace('q=1', 'q=2'), b);
    expect(query.updatedIds).toEqual(['query']);
    const ignored = await config('https://two.example/a#one', 'https://two.example/b#one');
    expect(ignored.data).toEqual([]);
    expect(
      (await config('https://two.example/a#two', 'https://two.example/a#one')).updatedIds,
    ).toEqual(['query']);
  });
});
