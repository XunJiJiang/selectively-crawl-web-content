import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginProcessClient } from './client.ts';
import { resolveProcessOptions } from './options.ts';

const pluginRoot = fileURLToPath(new URL('../../plugins/', import.meta.url));
const pluginNames = fs
  .readdirSync(pluginRoot)
  .filter((name) => fs.existsSync(path.join(pluginRoot, name, 'package.json')));
const clients: PluginProcessClient[] = [];
const roots: string[] = [];
let resetAsmrDatabase: (() => void) | undefined;

function setup(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `scwc-${name}-migration-`));
  roots.push(root);
  const values = new Map<string, SCWC.TPluginCacheableData>();
  const cache: SCWC.IPluginCache = {
    set: async (key, value) => {
      values.set(key, value);
      return value;
    },
    get: async <T extends SCWC.TPluginCacheableData>(key: string) =>
      values.get(key) as T | undefined,
    setRedirect: async (_key, target) => target,
    del: async (key) => values.delete(key),
    mdel: async (keys) => keys.every((key) => values.delete(key)),
  };
  const logger: SCWC.TLogger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const metadata = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, name, 'package.json'), 'utf8'),
  ) as { main: string; runtime?: unknown };
  const client = new PluginProcessClient({
    entry: path.join(pluginRoot, name, metadata.main),
    name,
    cwd: root,
    cache: () => cache,
    logger,
    runtime: {
      ...resolveProcessOptions(metadata.runtime),
      startupTimeoutMs: 5000,
      shutdownTimeoutMs: 1500,
    },
    execArgv: ['--experimental-strip-types', '--no-experimental-transform-types'],
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      ASMR_STORAGE_PATH: path.join(root, 'asmr'),
      ASMR_ADMIN_PASSWORD: 'temporary-test-password',
      IMAGE_STORAGE_PATH: path.join(root, 'images'),
      REDIS_USER: '',
      REDIS_PASSWORD: '',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '9',
      REDIS_TIMEOUT: '100',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '*',
    },
  });
  clients.push(client);
  return { root, client, logger };
}

afterEach(async () => {
  // ASMR keeps its own optional Redis cache. A restart does not clear that store.
  await Promise.all(clients.splice(0).map((client) => client.stop(true)));
  resetAsmrDatabase?.();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('installed plugin migration to default v2', () => {
  it.each(pluginNames)('activates and unloads %s in a native isolated process', async (name) => {
    const c = setup(name);
    const handler = await c.client.start();
    expect(c.client.info).toMatchObject({
      mode: 'process',
      apiVersion: 2,
      status: 'ready',
      pid: expect.any(Number),
    });
    expect(c.client.info.pid).not.toBe(process.pid);
    expect(typeof handler.onRequest).toBe('function');
    const apis = handler.ui?.api as SCWC.THostedPluginApi[] | undefined;
    if (name === 'local-watch-list' || name === 'template') {
      const testApi = apis?.find((api) => api.path === '/api/test');
      expect(testApi).toBeDefined();
      expect(
        await testApi?.handler(
          {},
          {
            req: {
              method: 'GET',
              originalUrl: '/',
              params: {},
              query: {},
              headers: {},
            } as unknown as import('express').Request,
            res: {} as import('express').Response,
          },
        ),
      ).toContain('Hello');
    }
    if (name === 'asmr') {
      const login = apis?.find((api) => api.path === 'auth/login');
      expect(
        await login?.handler(
          { userId: 'admin', password: 'temporary-test-password' },
          {
            req: {
              method: 'POST',
              originalUrl: '/',
              params: {},
              query: {},
              headers: {},
            } as unknown as import('express').Request,
            res: {} as import('express').Response,
          },
        ),
      ).toMatchObject({ token: expect.any(String), user: { userId: 'admin' } });
    }
    await c.client.stop(true);
    expect(c.client.info.status).toBe('stopped');
    expect(c.logger.warn).not.toHaveBeenCalledWith(
      '插件停止超时或失败，将终止插件进程',
      expect.anything(),
    );
  });

  it.skipIf(!pluginNames.includes('asmr'))(
    'returns an authorized ASMR file descriptor and rejects invalid tickets',
    async () => {
      // Installed plugins are optional; absent plugins must not break collection/types.
      const { serveMediaResource } = await import(
        pathToFileURL(path.join(pluginRoot, 'asmr/src/web/media-resource.ts')).href
      );
      const { PlayerDatabase } = await import(
        pathToFileURL(path.join(pluginRoot, 'asmr/src/utils/database/player-data.ts')).href
      );
      resetAsmrDatabase = () => PlayerDatabase.reset();
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-asmr-resource-'));
      roots.push(root);
      const logger: SCWC.TLogger = {
        info: vi.fn(),
        pathInfo: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const player = PlayerDatabase.getInstance(path.join(root, 'player.sqlite'), logger);
      const media = path.join(root, 'audio.mp3');
      fs.writeFileSync(media, 'media-test');
      const ticket = player.issueResourceTicket('test-user', media);
      const request = { method: 'GET', url: '/', params: {}, query: { ticket }, headers: {} };
      expect(serveMediaResource(player, request)).toMatchObject({
        kind: 'file',
        path: media,
        contentType: 'audio/mpeg',
        headers: { 'Content-Disposition': 'inline' },
      });
      expect(
        serveMediaResource(player, { ...request, query: { ticket: 'invalid' } }),
      ).toMatchObject({
        kind: 'response',
        status: 404,
      });
    },
  );
});
