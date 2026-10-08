import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginProcessClient } from './client.ts';
import { taskRegistry, invocationStorage } from '../../common/tasks.ts';
import { setInputHandler } from '../../common/interaction.ts';
import { setLogSink } from '../../utils/log.ts';
import apiRouter, {
  registerPluginApi,
  registerPluginResources,
  pluginResourceRouter,
} from '../../router/web/api/load.ts';

const mocks = vi.hoisted(() => ({ plugins: [] as SCWC.IPluginMeta[] }));
vi.mock('../load.ts', () => ({ plugins: mocks.plugins }));
vi.mock('../../common/env.ts', () => ({
  TOKEN: '',
  SERVER_ROOT: fileURLToPath(new URL('../../', import.meta.url)),
}));
import { PluginWebSocketRegistry } from '../../router/web/websocket.ts';
import pageRouter from '../../router/web/page/index.ts';
import pluginRouter from '../../router/plugin.ts';

const clients: PluginProcessClient[] = [];
const servers: Server[] = [];
const directories: string[] = [];
const fixture = fileURLToPath(new URL('./fixtures/plugin.ts', import.meta.url));

function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Missing test fixture value');
  }
  return value;
}

function memoryCache(): SCWC.IPluginCache {
  const data = new Map<string, SCWC.TPluginCacheableData>();
  return {
    set: async (key, value) => {
      data.set(key, value);
      return value;
    },
    get: async <T extends SCWC.TPluginCacheableData>(key: string) => data.get(key) as T | undefined,
    setRedirect: async (key, target) => {
      data.set(key, must(data.get(target)));
      return target;
    },
    del: async (key) => data.delete(key),
    mdel: async (keys) => {
      keys.forEach((key) => data.delete(key));
      return true;
    },
  };
}

function context(
  params: Record<string, string> = {},
  query: Record<string, unknown> = {},
): SCWC.THostedPluginRequestContext {
  return {
    req: {
      method: 'POST',
      originalUrl: '/test',
      params,
      query,
      headers: {},
    } as unknown as express.Request,
    res: {} as express.Response,
  };
}

function setup(options: { mode?: string; timeout?: number; entry?: string; source?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-process-'));
  directories.push(root);
  const media = path.join(root, 'media.bin');
  const page = path.join(root, 'index.html');
  fs.writeFileSync(media, '0123456789');
  fs.writeFileSync(page, '<html><body>static page</body></html>');
  const source = path.join(root, 'plugin.ts');
  if (options.source) {
    fs.writeFileSync(source, options.source);
  }
  const cache = memoryCache();
  const logger: SCWC.TLogger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const client = new PluginProcessClient({
    entry: options.entry ?? (options.source ? source : fixture),
    name: 'fixture',
    logger,
    cache: () => cache,
    cwd: root,
    execArgv: ['--experimental-strip-types', '--no-experimental-transform-types'],
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      SCWC_FIXTURE_MODE: options.mode ?? '',
      SCWC_FIXTURE_MEDIA: media,
      SCWC_FIXTURE_PAGE: page,
      SCWC_FIXTURE_UNLOAD: path.join(root, 'unload.txt'),
      IMAGE_STORAGE_PATH: path.join(root, 'images'),
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      NO_PROXY: '*',
    },
    runtime: {
      mode: 'process',
      apiVersion: 2,
      startupTimeoutMs: options.mode === 'hang' ? 300 : 5000,
      requestTimeoutMs: options.timeout ?? 5000,
      shutdownTimeoutMs: 150,
    },
  });
  clients.push(client);
  return { root, media, client, cache, logger };
}

function apis(handler: SCWC.IHostedPluginHandler): SCWC.THostedPluginApi[] {
  return must(handler.ui).api as SCWC.THostedPluginApi[];
}

function api(handler: SCWC.IHostedPluginHandler, pathname: string, method?: string) {
  return must(
    apis(handler).find((item) => item.path === pathname && (!method || item.method === method)),
  );
}

function metadata(
  handler: SCWC.IHostedPluginHandler,
  client: PluginProcessClient,
  id: string,
): SCWC.IPluginMeta {
  return {
    name: id,
    pluginId: id,
    safeId: id,
    handler,
    runtime: client.info,
    entry: fixture,
    entryFile: fixture,
    pluginDir: `/plugins/${id}`,
    linkWith: [],
    logger: { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as import('node:net').AddressInfo;
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop(false)));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of directories.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  mocks.plugins.length = 0;
  setInputHandler();
  setLogSink();
});

describe('isolated plugin host', () => {
  it('preserves burst and long output from both invocation and saved onLoad loggers', async () => {
    const c = setup({
      source: `
      let saved;
      export default { onLoad(logger) { saved = logger; }, onRequest() {}, pluginConfig: { command: {
        execute(logger) {
          for (let i = 0; i < 250; i++) saved.info('saved-%d', i);
          logger.info('long:' + '猫'.repeat(9000));
          console.log('console:%s:%d', 'value', 42);
        }
      } } };
    `,
    });
    const events: { windowId: string | null; executionId?: string; text: string }[] = [];
    setLogSink((event) => events.push(event));
    const handler = await c.client.start();
    const scope = taskRegistry.create('test', {
      executionId: 'log-command',
      windowId: 'log-window',
    });
    try {
      await invocationStorage.run(scope.context, () =>
        must(must(handler.pluginConfig).command?.execute)(
          c.logger,
          [],
          [],
          ['fixture'],
          scope.context,
        ),
      );
      const output = events.filter((event) => event.executionId === 'log-command');
      expect(output).toHaveLength(252);
      expect(output.every((event) => event.windowId === 'log-window')).toBe(true);
      expect(output.slice(0, 250).map((event) => event.text)).toEqual(
        Array.from({ length: 250 }, (_, i) => `[fixture] saved-${i}`),
      );
      expect(output[250].text).toBe('[fixture] long:' + '猫'.repeat(9000));
      expect(output[251].text).toBe('[fixture] console:value:42');
    } finally {
      scope.finish();
    }
  });
  it('waits for typed input across the process boundary without consuming the command timeout', async () => {
    const c = setup({
      timeout: 200,
      source: `
      export default { onRequest() {}, pluginConfig: { command: { async execute(logger, options, unused, original, context) {
        const [nameError, name] = await context.next('name?', String);
        const [countError, count] = await context.next('count?', Number);
        const [confirmationError, confirmed] = await context.next('confirmed?', Boolean);
        if (nameError || countError || confirmationError) throw new Error('unexpected input error');
        logger.info(name + ':' + count + ':' + confirmed);
      } } } };
    `,
    });
    const answers = ['name', 'invalid', '42', 'false'];
    const messages: string[] = [];
    setInputHandler(async (request) => {
      messages.push(request.message);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return must(answers.shift());
    });
    const handler = await c.client.start();
    const scope = taskRegistry.create('test', {
      executionId: 'input-command',
      windowId: 'input-window',
    });
    try {
      await invocationStorage.run(scope.context, () =>
        must(must(handler.pluginConfig).command?.execute)(
          c.logger,
          [],
          [],
          ['fixture'],
          scope.context,
        ),
      );
      expect(messages).toEqual(['name?', 'count?', '请输入有效的 number\ncount?', 'confirmed?']);
      expect(c.logger.info).toHaveBeenCalledWith('name:42:false');
    } finally {
      scope.finish();
    }
  });
  it('cancels an input request when its command is cancelled', async () => {
    const c = setup({
      source: `export default { onRequest() {}, pluginConfig: { command: { async execute(logger, a, b, c, context) { const [error, value] = await context.next('waiting?', String); logger.info(error.name + ':' + error.code + ':' + value); } } } };`,
    });
    const waiting = Promise.withResolvers<void>();
    setInputHandler(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          waiting.resolve();
          signal.addEventListener('abort', () => reject(new Error('input cancelled')), {
            once: true,
          });
        }),
    );
    const handler = await c.client.start();
    const scope = taskRegistry.create('test', {
      executionId: 'cancel-input',
      windowId: 'cancel-window',
    });
    try {
      const run = invocationStorage.run(scope.context, () =>
        must(must(handler.pluginConfig).command?.execute)(
          c.logger,
          [],
          [],
          ['fixture'],
          scope.context,
        ),
      );
      await waiting.promise;
      c.client.cancel('cancel-input');
      await run;
      expect(c.logger.info).toHaveBeenCalledWith('InvocationInputError:cancelled:undefined');
      await vi.waitFor(() =>
        expect(taskRegistry.list().some((item) => item.owner === c.client.owner)).toBe(false),
      );
    } finally {
      scope.finish();
    }
  });
  it('starts from a native Node parent without inheriting eval or input-type flags', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-native-parent-'));
    directories.push(root);
    const source = `
      const { PluginProcessClient } = await import(process.argv[1]);
      const cache = { set: async (_, v) => v, get: async () => undefined,
        setRedirect: async (_, v) => v, del: async () => true, mdel: async () => true };
      const logger = { info() {}, pathInfo() {}, warn() {}, error() {} };
      const client = new PluginProcessClient({ entry: process.argv[2], name: 'native', logger,
        cache: () => cache, cwd: process.argv[3], env: { ...process.env, SCWC_FIXTURE_MODE: '', SCWC_FIXTURE_UNLOAD: '' },
        runtime: { mode: 'process', apiVersion: 2 } });
      await client.start(); await client.stop(false); console.log('native-process-ok');
    `;
    const output = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-experimental-transform-types',
        '--input-type=module',
        '--eval',
        source,
        new URL('./client.ts', import.meta.url).href,
        fixture,
        root,
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' }, timeout: 5000 },
    );
    expect(output.trim()).toBe('native-process-ok');
  });

  it('runs callbacks in native Node, bridges data, cache, commands, controls and request notifications', async () => {
    const c = setup();
    const handler = await c.client.start();
    expect(c.client.info.pid).not.toBe(process.pid);
    expect((globalThis as { scwcFixturePid?: number }).scwcFixturePid).toBeUndefined();
    const echoed = await api(handler, '/echo/:uuid').handler(
      { bytes: Buffer.from('abc'), count: 3n },
      context({ uuid: '123' }, { query: '猫' }),
    );
    expect(echoed).toMatchObject({
      pid: c.client.info.pid,
      data: { bytes: Buffer.from('abc'), count: 3n },
      request: { params: { uuid: '123' }, query: { query: '猫' } },
    });
    expect(await api(handler, '/cache').handler({}, context())).toEqual({
      pid: c.client.info.pid,
      bytes: Buffer.from('loaded'),
      count: 2n,
    });
    const command = must(must(handler.pluginConfig).command);
    const scope = taskRegistry.create('test', {
      executionId: 'fixture-command',
      windowId: 'fixture-window',
    });
    try {
      await must(command.execute)(c.logger, [], [], ['fixture', 'hello'], scope.context);
      await must(command.subCommands)[0].execute(c.logger, [], [], [], scope.context);
    } finally {
      scope.finish();
    }
    expect(await c.cache.get('command')).toEqual(['fixture', 'hello']);
    expect(await c.cache.get('sub')).toBe(true);
    const site = {
      url: 'https://example.com/a',
      rootUrl: 'https://example.com',
      pathname: '/a',
      origin: 'https://example.com',
      host: 'example.com',
      hostname: 'example.com',
    };
    const factory = must(must(handler.pluginConfig).scripts).controls as SCWC.TCreatePluginItem;
    const controls = await factory(c.logger, { site });
    expect(controls[0].label).toBe('/a');
    expect(
      await controls[0].trigger(c.logger, {
        data: [],
        value: null,
        relatedValues: { label: '猫' },
        site,
      }),
    ).toMatchObject({ data: { message: '猫' } });
    const toWeb = vi.fn();
    await handler.onRequest(
      {
        site,
        data: [],
        utils: {} as Parameters<SCWC.IHostedPluginHandler['onRequest']>[0]['utils'],
      },
      { ...c.logger, toWeb },
    );
    expect(toWeb).toHaveBeenCalledWith('/a', 'success');
    await c.client.stop(true);
    expect(fs.readFileSync(path.join(c.root, 'unload.txt'), 'utf8')).toBe('true');
    expect(c.client.info.status).toBe('stopped');
  });

  it('keeps core HTTP, static pages and a second plugin responsive during synchronous work', async () => {
    const busy = setup();
    const other = setup();
    const [busyHandler, otherHandler] = await Promise.all([
      busy.client.start(),
      other.client.start(),
    ]);
    registerPluginApi(metadata(busyHandler, busy.client, 'busy'));
    registerPluginApi(metadata(otherHandler, other.client, 'other'));
    mocks.plugins.push(metadata(otherHandler, other.client, 'other'));
    const app = express()
      .use(express.json())
      .use('/api', apiRouter)
      .use('/controls', pluginRouter)
      .use('/web/page', pageRouter);
    app.get('/health', (_req, res) => {
      res.send('healthy');
    });
    const { origin } = await listen(app);
    const blocked = fetch(`${origin}/api/busy/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"duration":3000}',
    });
    await vi.waitFor(() => expect(busy.logger.info).toHaveBeenCalledWith('blocking-started'));
    const started = performance.now();
    const responses = await Promise.all([
      fetch(`${origin}/health`).then((response) => response.text()),
      fetch(`${origin}/api/other/echo/123`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then((response) => response.json()),
      fetch(`${origin}/web/page/plugin/other`).then((response) => response.text()),
    ]);
    expect(responses[0]).toBe('healthy');
    expect(responses[1]).toMatchObject({ success: true, data: { pid: other.client.info.pid } });
    expect(responses[2]).toContain('fixture page');
    expect(performance.now() - started).toBeLessThan(750);
    mocks.plugins.push(metadata(busyHandler, busy.client, 'busy'));
    const cachedPage = await fetch(`${origin}/web/page/plugin/busy`).then((response) =>
      response.text(),
    );
    expect(cachedPage).toContain('fixture page');
    const config = await fetch(`${origin}/controls/config?site=https://example.com/`).then(
      (response) => response.json(),
    );
    expect(config).toMatchObject({ code: 200, data: [{ id: 'other' }] });
    expect((await blocked).status).toBe(200);
  });

  it('streams files in the core with Range, download headers and ticket rejection', async () => {
    const c = setup();
    const handler = await c.client.start();
    registerPluginResources(metadata(handler, c.client, 'media'));
    const { origin } = await listen(express().use('/resource', pluginResourceRouter));
    const normal = await fetch(`${origin}/resource/media/media?ticket=valid`);
    expect(normal.status).toBe(200);
    expect(await normal.text()).toBe('0123456789');
    const range = await fetch(`${origin}/resource/media/media?ticket=valid`, {
      headers: { Range: 'bytes=2-5' },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await range.text()).toBe('2345');
    const suffix = await fetch(`${origin}/resource/media/media?ticket=valid`, {
      headers: { Range: 'bytes=-3' },
    });
    expect(await suffix.text()).toBe('789');
    expect(
      (
        await fetch(`${origin}/resource/media/media?ticket=valid`, {
          headers: { Range: 'bytes=99-' },
        })
      ).status,
    ).toBe(416);
    expect((await fetch(`${origin}/resource/media/media?ticket=bad`)).status).toBe(404);
    const download = await fetch(`${origin}/resource/media/download`);
    expect(download.headers.get('content-disposition')).toContain('fixture.bin');
    await download.arrayBuffer();
    fs.writeFileSync(c.media, Buffer.alloc(17 * 1024 * 1024));
    const large = await fetch(`${origin}/resource/media/media?ticket=valid`);
    expect(large.status).toBe(200);
    expect((await large.arrayBuffer()).byteLength).toBe(17 * 1024 * 1024);
  });

  it('reads an entry file directly when a process plugin has no dynamic HTML callback', async () => {
    const c = setup({
      source:
        'export default { apiVersion: 2, onRequest() {}, ui: { entry: process.env.SCWC_FIXTURE_PAGE } };',
    });
    const handler = await c.client.start();
    expect(handler.ui?.html).toBeUndefined();
    mocks.plugins.push(metadata(handler, c.client, 'plain'));
    const { origin } = await listen(express().use('/web/page', pageRouter));
    expect(
      await fetch(`${origin}/web/page/plugin/plain`).then((response) => response.text()),
    ).toContain('static page');
  });

  it('bridges real WebSocket connection, broadcast and cleanup without moving sockets', async () => {
    const c = setup();
    const handler = await c.client.start();
    const registry = new PluginWebSocketRegistry();
    registry.register(metadata(handler, c.client, 'socket'));
    const { server, origin } = await listen(express());
    registry.attach(server);
    const socket = new WebSocket(
      `${origin.replace('http:', 'ws:')}/web/websocket/plugin/socket/events?site=${encodeURIComponent(origin)}`,
      { origin },
    );
    const ready = await new Promise<string>((resolve, reject) => {
      socket.once('message', (data) => resolve(data.toString()));
      socket.once('error', reject);
    });
    expect(JSON.parse(ready)).toMatchObject({ ready: true });
    const echoed = new Promise<string>((resolve) =>
      socket.once('message', (data) => resolve(data.toString())),
    );
    socket.send('hello');
    expect(await echoed).toBe('hello');
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
    await vi.waitFor(() => expect(c.logger.info).toHaveBeenCalledWith('socket-cleaned'));
    expect(c.logger.info).toHaveBeenCalledWith('socket-closed');
  });

  it('fails activation on error, hang or an old contract, without an in-process fallback', async () => {
    const failed = setup({ mode: 'fail' });
    await expect(failed.client.start()).rejects.toThrow('fixture startup failure');
    expect(failed.client.info.status).toBe('failed');
    const hung = setup({ mode: 'hang' });
    await expect(hung.client.start()).rejects.toMatchObject({ status: 504 });
    expect(hung.client.info.status).toBe('failed');
    const legacy = setup();
    const legacyFile = path.join(legacy.root, 'legacy.ts');
    fs.writeFileSync(legacyFile, 'export default { apiVersion: 1, onRequest() {} };');
    const old = setup({ entry: legacyFile });
    await expect(old.client.start()).rejects.toThrow('apiVersion 默认 2');
  });

  it('times out calls, rejects oversized messages, and fails pending requests on crash', async () => {
    const c = setup({ timeout: 100 });
    const handler = await c.client.start();
    await expect(api(handler, '/block').handler(400, context())).rejects.toMatchObject({
      status: 504,
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    await expect(api(handler, '/oversize').handler({}, context())).rejects.toMatchObject({
      status: 413,
    });
    await expect(api(handler, '/crash').handler({}, context())).rejects.toMatchObject({
      status: 503,
    });
    await vi.waitFor(() => expect(c.client.info.status).toBe('failed'));
    await expect(api(handler, '/echo/:uuid').handler({}, context())).rejects.toMatchObject({
      status: 503,
    });
  });

  it('terminates descendant processes when unloading a host', async () => {
    const c = setup();
    const handler = await c.client.start();
    const descendant = (await api(handler, '/descendant').handler({}, context())) as number;
    expect(() => process.kill(descendant, 0)).not.toThrow();
    await c.client.stop(false);
    await vi.waitFor(() => expect(() => process.kill(descendant, 0)).toThrow(), { timeout: 3000 });
  });

  it.skipIf(process.platform === 'win32')(
    'cleans the host tree when its parent disappears without exit hooks',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-parent-disconnect-'));
      directories.push(root);
      const source = `
      const { PluginProcessClient } = await import(process.argv[1]);
      const cache = { set: async (_, v) => v, get: async () => undefined,
        setRedirect: async (_, v) => v, del: async () => true, mdel: async () => true };
      const logger = { info() {}, pathInfo() {}, warn() {}, error() {} };
      const client = new PluginProcessClient({ entry: process.argv[2], name: 'native', logger,
        cache: () => cache, cwd: process.argv[3], env: { ...process.env, SCWC_FIXTURE_MODE: '', SCWC_FIXTURE_UNLOAD: '' },
        runtime: { mode: 'process', apiVersion: 2 } });
      const handler = await client.start();
      const descendant = await handler.ui.api.find(api => api.path === '/descendant').handler({},
        { req: { method: 'POST', originalUrl: '/', params: {}, query: {}, headers: {} } });
      console.log(JSON.stringify({ host: client.info.pid, descendant }));
      setInterval(() => {}, 1000);
    `;
      const parent = spawn(
        process.execPath,
        [
          '--experimental-strip-types',
          '--no-experimental-transform-types',
          '--input-type=module',
          '--eval',
          source,
          new URL('./client.ts', import.meta.url).href,
          fixture,
          root,
        ],
        { env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let ids: { host: number; descendant: number } | undefined;
      try {
        ids = await new Promise((resolve, reject) => {
          let stdout = '';
          parent.stdout.on('data', (chunk) => {
            stdout += String(chunk);
            if (stdout.includes('\n')) {
              resolve(JSON.parse(stdout.trim()));
            }
          });
          parent.once('error', reject);
          parent.once('exit', () =>
            reject(new Error('Native test parent exited before reporting process IDs')),
          );
        });
        const host = must(ids).host;
        const descendant = must(ids).descendant;
        parent.kill('SIGKILL');
        await vi.waitFor(
          () => {
            expect(() => process.kill(host, 0)).toThrow();
            expect(() => process.kill(descendant, 0)).toThrow();
          },
          { timeout: 3000 },
        );
      } finally {
        parent.kill('SIGKILL');
        if (ids) {
          try {
            process.kill(-ids.host, 'SIGKILL');
          } catch {
            /* The host already cleaned its tree. */
          }
        }
      }
    },
  );

  it('activates the actual sticker plugin in a temporary data root using its v2 contract', async () => {
    const entry = fileURLToPath(
      new URL('../../plugins/scwc-plugin-sticker-management/index.ts', import.meta.url),
    );
    const c = setup({ entry });
    const handler = await c.client.start();
    expect(handler.name).toBe('sticker-management');
    const bootstrap = await api(handler, '/api/bootstrap').handler({}, context());
    expect(bootstrap).toMatchObject({
      ok: true,
      data: { systemFolders: { root: expect.any(String) } },
    });
    const project = (await api(handler, '/api/editor/projects', 'POST').handler(
      { name: 'isolated' },
      context(),
    )) as { data: { uuid: string } };
    await api(handler, '/api/editor/projects/:uuid/name').handler(
      { name: 'renamed' },
      context({ uuid: project.data.uuid }),
    );
    expect(
      await api(handler, '/api/editor/projects/:uuid', 'GET').handler(
        {},
        context({ uuid: project.data.uuid }),
      ),
    ).toMatchObject({ data: { name: 'renamed' } });
    await c.client.stop(false);
    expect(c.client.info.status).toBe('stopped');
  });

  it.skipIf(
    !fs.existsSync(fileURLToPath(new URL('../../plugins/image/index.ts', import.meta.url))),
  )('waits for the image plugin to finish saving the downloaded raw bytes', async () => {
    const image = Buffer.from('temporary-image-bytes');
    const app = express();
    app.get('/image', (_req, res) => {
      res.type('jpeg').send(image);
    });
    const { origin } = await listen(app);
    const entry = fileURLToPath(new URL('../../plugins/image/index.ts', import.meta.url));
    const c = setup({ entry });
    fs.mkdirSync(path.join(c.root, 'images'));
    const handler = await c.client.start();
    const toWeb = vi.fn();
    await handler.onRequest(
      {
        data: [{ label: 'image', value: '', images: [`${origin}/image`] }],
        site: { url: origin, rootUrl: origin, pathname: '/', origin },
        utils: {} as Parameters<SCWC.IHostedPluginHandler['onRequest']>[0]['utils'],
      },
      { ...c.logger, toWeb },
    );
    const files = fs
      .readdirSync(path.join(c.root, 'images'))
      .filter(
        (name) => name !== 'data.json' && fs.statSync(path.join(c.root, 'images', name)).isFile(),
      );
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(c.root, 'images', files[0]))).toEqual(image);
    expect(fs.existsSync(path.join(c.root, 'images', 'data.json'))).toBe(true);
  });
});
