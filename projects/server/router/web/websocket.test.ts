import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TOKEN } from '../../common/env.ts';
import { PluginWebSocketRegistry } from './websocket.ts';

const openSockets: WebSocket[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openSockets.splice(0).map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.once('close', () => resolve());
          socket.close();
        }),
    ),
  );
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        }),
    ),
  );
});

function plugin(
  safeId: string,
  onMessage: (message: string, send: (value: unknown) => void) => void,
) {
  return {
    name: safeId,
    safeId,
    pluginId: safeId,
    entry: '',
    entryFile: '',
    pluginDir: '',
    linkWith: [],
    handler: {
      onRequest: () => undefined,
      ui: {
        websocket: [
          {
            path: 'tree',
            onMessage: (value: string | Buffer, context: SCWC.TPluginWebSocketContext) =>
              onMessage(String(value), context.send),
          },
        ],
      },
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  } as unknown as SCWC.IPluginMeta;
}

async function listen(registry: PluginWebSocketRegistry): Promise<{ url: string }> {
  const server = createServer();
  servers.push(server);
  registry.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试服务器未分配端口');
  }
  return { url: `ws://127.0.0.1:${address.port}` };
}

function connect(baseUrl: string, safeId: string): Promise<WebSocket> {
  const site = `http://127.0.0.1${new URL(baseUrl).port ? `:${new URL(baseUrl).port}` : ''}/web/page/plugin/${safeId}`;
  const socket = new WebSocket(
    `${baseUrl}/web/websocket/plugin/${safeId}/tree?site=${encodeURIComponent(site)}&token=${encodeURIComponent(TOKEN)}`,
    { origin: site },
  );
  openSockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

describe('PluginWebSocketRegistry', () => {
  it('按 safeId 隔离相同通道名，并分发插件消息', async () => {
    const registry = new PluginWebSocketRegistry();
    registry.register(plugin('plugin-a', (_message, send) => send({ plugin: 'a' })));
    registry.register(plugin('plugin-b', (_message, send) => send({ plugin: 'b' })));
    const { url } = await listen(registry);
    const first = await connect(url, 'plugin-a');
    const second = await connect(url, 'plugin-b');

    const firstMessage = new Promise<unknown>((resolve) => {
      first.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const secondMessage = new Promise<unknown>((resolve) => {
      second.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    first.send('hello');

    await expect(firstMessage).resolves.toEqual({ plugin: 'a' });
    await expect(
      Promise.race([
        secondMessage,
        new Promise((resolve) => setTimeout(() => resolve('no-message'), 80)),
      ]),
    ).resolves.toBe('no-message');
  });

  it('拒绝没有 site 或 token 的握手', async () => {
    const registry = new PluginWebSocketRegistry();
    registry.register(plugin('plugin-a', () => undefined));
    const { url } = await listen(registry);
    const socket = new WebSocket(`${url}/web/websocket/plugin/plugin-a/tree`);
    openSockets.push(socket);
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('unexpected-response', (_request, response) => {
          expect(response.statusCode).toBe(400);
          resolve();
        });
        socket.once('error', reject);
      }),
    ).resolves.toBeUndefined();
  });
});
