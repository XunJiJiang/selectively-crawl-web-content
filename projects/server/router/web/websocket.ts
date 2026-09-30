import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { TOKEN } from '../../common/env.ts';
import { serverLogger } from '../../common/logger.ts';
import { isSameDomain } from '../../utils/url.ts';

type RegisteredChannel = {
  plugin: SCWC.IPluginMeta;
  path: string;
  config: SCWC.TPluginWebSocket;
  clients: Set<WebSocket>;
};

function reject(socket: import('node:stream').Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function queryOf(request: IncomingMessage): URLSearchParams | undefined {
  try {
    return new URL(request.url ?? '', 'http://localhost').searchParams;
  } catch {
    return undefined;
  }
}

function safePath(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/gu, '');
  if (!normalized || normalized.includes('..') || normalized.includes('//')) {
    throw new Error('WebSocket 通道路径无效');
  }
  return normalized;
}

function serialize(data: unknown): string | Buffer {
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return data;
  }
  return JSON.stringify(data);
}

export class PluginWebSocketRegistry {
  private readonly channels = new Map<string, RegisteredChannel>();
  private readonly server = new WebSocketServer({ noServer: true });

  register(plugin: SCWC.IPluginMeta): void {
    const websocket = plugin.handler?.ui?.websocket;
    if (!websocket) {
      return;
    }
    const add = (...configs: SCWC.TPluginWebSocket[]): void => {
      for (const config of configs) {
        const path = safePath(config.path);
        const key = `${plugin.safeId}/${path}`;
        if (this.channels.has(key)) {
          throw new Error(`WebSocket 通道重复注册: ${path}`);
        }
        this.channels.set(key, { plugin, path, config, clients: new Set() });
      }
    };
    if (typeof websocket === 'function') {
      websocket({ add });
    } else {
      add(...websocket);
    }
  }

  attach(httpServer: Server): void {
    httpServer.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(request.url ?? '', 'http://localhost');
    } catch {
      reject(socket, 400, 'Bad Request');
      return;
    }
    const match = parsed.pathname.match(/^\/web\/websocket\/plugin\/([^/]+)\/(.+)$/u);
    if (!match) {
      return reject(socket, 404, 'Not Found');
    }
    const channel = this.channels.get(`${match[1]}/${match[2]}`);
    if (!channel) {
      return reject(socket, 404, 'Not Found');
    }
    const query = queryOf(request);
    const site = query?.get('site');
    if (!site || !isSameDomain(request.headers.origin ?? request.headers.referer ?? '', site)) {
      return reject(socket, 400, 'Bad Request');
    }
    if (TOKEN && query?.get('token') !== TOKEN) {
      return reject(socket, 401, 'Unauthorized');
    }
    this.server.handleUpgrade(request, socket, head, (client) => {
      this.server.emit('connection', client, request, channel);
    });
  }

  constructor() {
    this.server.on(
      'connection',
      (socket: WebSocket, request: IncomingMessage, channel: RegisteredChannel) => {
        channel.clients.add(socket);
        const context: SCWC.TPluginWebSocketContext = {
          req: request,
          socket,
          channel: channel.path,
          query: queryOf(request) ?? new URLSearchParams(),
          clients: channel.clients,
          send: (data) => {
            if (socket.readyState === socket.OPEN) {
              socket.send(serialize(data));
            }
          },
          broadcast: (data, excludeSelf = false) => {
            for (const client of channel.clients) {
              if (excludeSelf && client === socket) {
                continue;
              }
              if (client.readyState === client.OPEN) {
                client.send(serialize(data));
              }
            }
          },
          close: (code, reason) => socket.close(code, reason),
        };
        let cleanup: void | (() => void) | undefined;
        let closed = false;
        let cleanupInvoked = false;
        const invokeCleanup = (): void => {
          if (cleanupInvoked) {
            return;
          }
          cleanupInvoked = true;
          cleanup?.();
        };
        void Promise.resolve()
          .then(() => channel.config.onConnect?.(context))
          .then((value) => {
            if (closed) {
              value?.();
            } else {
              cleanup = value;
            }
          })
          .catch((error) => {
            serverLogger.error(
              `WebSocket 通道连接处理失败: ${channel.plugin.name}/${channel.path}`,
              error,
            );
            socket.close(1011, '连接初始化失败');
          });
        socket.on('message', (data: RawData, isBinary) => {
          void Promise.resolve()
            .then(() =>
              channel.config.onMessage?.(
                isBinary ? Buffer.from(data as Buffer) : data.toString(),
                context,
              ),
            )
            .catch((error) => {
              serverLogger.error(
                `WebSocket 通道消息处理失败: ${channel.plugin.name}/${channel.path}`,
                error,
              );
            });
        });
        socket.on('close', () => {
          closed = true;
          channel.clients.delete(socket);
          invokeCleanup();
          void Promise.resolve()
            .then(() => channel.config.onClose?.(context))
            .catch((error) => {
              serverLogger.error(
                `WebSocket 通道关闭处理失败: ${channel.plugin.name}/${channel.path}`,
                error,
              );
            });
        });
        socket.on('error', (error) =>
          serverLogger.warn(`WebSocket 通道错误: ${channel.plugin.name}/${channel.path}`, error),
        );
      },
    );
  }
}

export const pluginWebSocketRegistry = new PluginWebSocketRegistry();
