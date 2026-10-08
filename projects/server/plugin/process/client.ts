import { fork, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { RpcPeer } from './rpc.ts';
import { PluginProcessError, type Manifest } from './protocol.ts';
import { requestData, sendResource } from './resource.ts';
import { isPackaged, PLUGIN_HOST } from '../../common/paths.ts';
import { currentIdentity, taskRegistry } from '../../common/tasks.ts';
import { inputReply, readInput } from '../../common/interaction.ts';
import { publishLog, type LogLevel } from '../../utils/log.ts';
import type { InputRequest, InvocationIdentity, TaskSnapshot } from '../../types/task.d.ts';
import type {
  ProcessInfo,
  ProcessOptions,
  ResourceResponse,
} from '../../types/plugin-process.d.ts';

export interface ClientOptions {
  pluginId?: string;
  entry: string;
  name: string;
  logger: SCWC.TLogger;
  cache: () => SCWC.IPluginCache;
  runtime: ProcessOptions;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  execArgv?: string[];
}
export const pluginClients = new Map<string, PluginProcessClient>();

function childArguments(): string[] {
  const result: string[] = [];
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i];
    if (['--eval', '-e', '--print', '-p', '--input-type'].includes(arg)) {
      i++;
      continue;
    }
    if (/^--(?:inspect|input-type|experimental-transform-types)(?:=|$|-)/u.test(arg)) {
      continue;
    }
    result.push(arg);
  }
  return result;
}

export class PluginProcessClient {
  readonly owner = `plugin:${randomUUID()}`;
  private readonly identities = new Map<string, InvocationIdentity>();
  private readonly commandCalls = new Map<string, string>();
  private readonly inputs = new Map<string, AbortController>();
  readonly info: ProcessInfo = { mode: 'process', apiVersion: 2, status: 'starting' };
  private readonly options: ClientOptions;
  private readonly child: ChildProcess;
  private readonly peer: RpcPeer;
  private readonly exited: Promise<void>;
  private readonly notifications = new Map<
    string,
    Parameters<SCWC.IHostedPluginHandler['onRequest']>[1]
  >();
  private readonly sockets = new Map<string, SCWC.THostedPluginWebSocketContext>();
  private heartbeat?: NodeJS.Timeout;
  private pinging = false;
  private stopping = false;
  private manifest?: Manifest;
  private html?: string;
  private htmlRefresh?: Promise<string | undefined>;
  private readonly killOnParentExit = () => this.killTree('SIGKILL');

  constructor(options: ClientOptions) {
    this.options = options;
    pluginClients.set(this.owner, this);
    this.child = fork(PLUGIN_HOST, isPackaged ? ['--scwc-plugin-host'] : [], {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      execArgv: options.execArgv ?? childArguments(),
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
    });
    this.info.pid = this.child.pid;
    this.peer = new RpcPeer((message, callback) => {
      if (!this.child.connected) {
        return callback(new PluginProcessError('插件进程已断开'));
      }
      this.child.send(message, callback);
    });
    this.child.on('message', (message) => this.peer.receive(message));
    this.peer.onCall = (method, args) => this.cacheCall(method, args);
    this.peer.onEvent = (event, data) => this.event(event, data);
    this.peer.onEventError = (error) => options.logger.warn('插件事件处理失败', error);
    this.exited = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        if (!this.stopping) {
          this.fail(`插件进程退出: ${code ?? signal}`);
        } else {
          this.info.status = 'stopped';
          this.peer.close();
        }
        this.cleanup();
        this.killTree('SIGKILL');
        resolve();
      }),
    );
    this.child.once('error', (error) => this.fail(error.message));
    this.child.once('disconnect', () => {
      this.peer.close();
      if (!this.stopping) {
        this.fail('插件 IPC 连接断开');
        this.killTree('SIGKILL');
      }
    });
    for (const [stream, level] of [
      [this.child.stdout, 'info'],
      [this.child.stderr, 'warn'],
    ] as const) {
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        const active = [...this.commandCalls.keys()].flatMap((id) => {
          const identity = this.identities.get(id);
          return identity ? [identity] : [];
        });
        publishLog(
          active.length === 1 ? active[0] : undefined,
          options.pluginId ?? options.name,
          level,
          [chunk],
          () => options.logger[level](chunk),
        );
      });
    }
    process.once('exit', this.killOnParentExit);
  }

  private cleanup(): void {
    for (const input of this.inputs.values()) {
      input.abort(new Error('插件宿主已停止'));
    }
    this.inputs.clear();
    taskRegistry.removeOwner(this.owner);
    pluginClients.delete(this.owner);
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    process.off('exit', this.killOnParentExit);
    for (const context of this.sockets.values()) {
      context.close(1011, '插件进程已停止');
    }
    this.sockets.clear();
    this.notifications.clear();
  }

  private fail(reason: string): void {
    this.info.status = 'failed';
    this.info.reason = reason;
    this.peer.close(new PluginProcessError(reason));
    this.options.logger.error(reason);
  }

  private killTree(signal: NodeJS.Signals): void {
    if (!this.child.pid) {
      return;
    }
    if (process.platform === 'win32') {
      if (this.child.exitCode === null) {
        spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore' }).on(
          'error',
          () => this.child.kill(signal),
        );
      }
    } else {
      try {
        process.kill(-this.child.pid, signal);
      } catch {
        /* Already exited. */
      }
    }
  }

  private async cacheCall(method: string, args: unknown): Promise<unknown> {
    if (method === 'input.next') {
      const request = args as InputRequest;
      const identity = this.identities.get(request.identity?.executionId);
      const callId = identity && this.commandCalls.get(identity.executionId);
      if (
        !identity ||
        !callId ||
        typeof request.id !== 'string' ||
        typeof request.message !== 'string' ||
        !['string', 'number', 'boolean', 'bigint', 'date'].includes(request.type)
      ) {
        throw new Error('输入请求没有活动命令');
      }
      const controller = new AbortController();
      this.inputs.set(request.id, controller);
      const resume = this.peer.pauseTimeout(callId);
      try {
        return await inputReply(
          () => readInput({ ...request, identity }, controller.signal),
          controller.signal,
        );
      } finally {
        this.inputs.delete(request.id);
        resume();
      }
    }
    const data = args as { key?: unknown; data?: unknown; targetKey?: unknown; keys?: unknown };
    const cache = this.options.cache();
    const key = data.key;
    if (method === 'cache.mdel') {
      if (
        !Array.isArray(data.keys) ||
        data.keys.length > 5000 ||
        !data.keys.every((key) => typeof key === 'string')
      ) {
        throw new Error('无效的缓存键列表');
      }
      return cache.mdel(data.keys);
    }
    if (typeof key !== 'string' || key.length > 4096) {
      throw new Error('无效的缓存键');
    }
    switch (method) {
      case 'cache.get': {
        const value = await cache.get(key);
        if (value instanceof Readable) {
          throw new Error('独立进程缓存不支持 Readable 流');
        }
        return value;
      }
      case 'cache.set':
        if (data.data === undefined || data.data === null) {
          throw new Error('缓存值不能为 null 或 undefined');
        }
        await cache.set(key, data.data as SCWC.TPluginCacheableData);
        return;
      case 'cache.del':
        return cache.del(key);
      case 'cache.setRedirect':
        if (typeof data.targetKey !== 'string') {
          throw new Error('无效的缓存重定向键');
        }
        return cache.setRedirect(key, data.targetKey);
      default:
        throw new Error('未知插件缓存操作');
    }
  }

  private event(event: string, value: unknown): void {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (event === 'input.cancel') {
      this.inputs.get((value as { id: string }).id)?.abort();
    } else if (event === 'log') {
      const data = value as { level: LogLevel; text: string; executionId?: string };
      if (
        ['info', 'pathInfo', 'warn', 'error'].includes(data.level) &&
        typeof data.text === 'string'
      ) {
        const identity = data.executionId ? this.identities.get(data.executionId) : undefined;
        publishLog(
          identity,
          this.options.pluginId ?? this.options.name,
          data.level,
          [data.text],
          () => this.options.logger[data.level](data.text),
        );
      }
    } else if (event === 'task') {
      const snapshot = value as TaskSnapshot;
      if (
        typeof snapshot.id === 'string' &&
        typeof snapshot.revision === 'number' &&
        typeof snapshot.busy === 'boolean'
      ) {
        const identity = snapshot.identity
          ? this.identities.get(snapshot.identity.executionId)
          : undefined;
        if (!snapshot.identity || identity) {
          taskRegistry.update(this.owner, { ...snapshot, identity });
        }
      }
    } else if (event === 'notification') {
      const data = value as {
        id: string;
        info: string;
        type?: 'info' | 'warn' | 'error' | 'success';
      };
      this.notifications.get(data.id)?.toWeb(data.info, data.type);
    } else if (event === 'socket') {
      const data = value as {
        connectionId: string;
        action: string;
        data: unknown;
        excludeSelf?: boolean;
        code?: number;
        reason?: string;
      };
      const context = this.sockets.get(data.connectionId);
      if (!context) {
        return;
      }
      if (data.action === 'send') {
        context.send(data.data);
      }
      if (data.action === 'broadcast') {
        context.broadcast(data.data, data.excludeSelf);
      }
      if (data.action === 'close') {
        context.close(data.code, data.reason);
      }
    }
  }

  private call<T>(
    method: string,
    args: unknown,
    timeoutMs = this.options.runtime.requestTimeoutMs ?? 30_000,
    id?: string,
  ): Promise<T> {
    if (this.stopping || this.info.status === 'failed' || this.info.status === 'stopped') {
      return Promise.reject(new PluginProcessError(this.info.reason ?? '插件进程不可用'));
    }
    if (['initialize', 'ping'].includes(method)) {
      return this.peer.call<T>(method, args, timeoutMs, id);
    }
    const current = currentIdentity();
    const identity =
      method === 'command'
        ? current
        : { ...current, executionId: randomUUID(), parentExecutionId: current.executionId };
    this.identities.set(identity.executionId, identity);
    if (this.identities.size > 4096) {
      for (const key of this.identities.keys()) {
        if (!taskRegistry.busy(key)) {
          this.identities.delete(key);
          break;
        }
      }
    }
    taskRegistry.update(this.owner, {
      id: identity.executionId,
      owner: this.owner,
      identity,
      automatic: 1,
      manual: false,
      reported: 0,
      returned: false,
      revision: 0,
      busy: true,
    });
    const callId = id ?? randomUUID();
    if (method === 'command') {
      this.commandCalls.set(identity.executionId, callId);
    }
    return this.peer.call<T>(method, { payload: args, identity }, timeoutMs, callId).finally(() => {
      if (method === 'command') {
        this.commandCalls.delete(identity.executionId);
      }
    });
  }
  cancel(executionId?: string) {
    this.peer.event('cancel', { executionId });
  }
  async terminate() {
    this.stopping = true;
    this.info.status = 'stopping';
    this.killTree('SIGKILL');
    await this.exited;
  }

  async start(): Promise<SCWC.IHostedPluginHandler> {
    try {
      this.manifest = await this.call<Manifest>(
        'initialize',
        {
          entry: this.options.entry,
          name: this.options.name,
          options: this.options.runtime,
          pluginId: this.options.pluginId ?? this.options.name,
          outputWindowId: currentIdentity().windowId,
          sessionId: currentIdentity().sessionId,
        },
        this.options.runtime.startupTimeoutMs ?? 30_000,
      );
      this.html = this.manifest.ui?.html;
      this.info.status = 'ready';
      this.heartbeat = setInterval(() => {
        if (this.pinging || this.stopping) {
          return;
        }
        this.pinging = true;
        void this.call('ping', undefined, 5000)
          .then(() => {
            if (!this.stopping) {
              this.info.status = 'ready';
            }
            this.info.reason = undefined;
          })
          .catch((error) => {
            if (this.info.status === 'ready' || this.info.status === 'unresponsive') {
              this.info.status = 'unresponsive';
              this.info.reason = error.message;
            }
          })
          .finally(() => {
            this.pinging = false;
          });
      }, 5000);
      this.heartbeat.unref();
      return this.proxy(this.manifest);
    } catch (error) {
      await this.stop(false);
      this.info.status = 'failed';
      this.info.reason = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(isRestart: boolean): Promise<void> {
    if (this.stopping) {
      await this.exited;
      return;
    }
    this.stopping = true;
    this.info.status = 'stopping';
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    try {
      await this.peer.call('unload', { isRestart }, this.options.runtime.shutdownTimeoutMs ?? 5000);
    } catch (error) {
      this.options.logger.warn(
        '插件停止超时或失败，将终止插件进程',
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.killTree('SIGKILL');
      await this.exited;
      this.peer.close();
      this.cleanup();
    }
  }

  private async pageHtml(): Promise<string> {
    if (!this.htmlRefresh) {
      this.htmlRefresh = this.call<string | undefined>('html', undefined, 1000)
        .then((html) => {
          if (html !== undefined) {
            this.html = html;
          }
          return this.html;
        })
        .finally(() => {
          this.htmlRefresh = undefined;
        });
    }
    try {
      return (await this.htmlRefresh) ?? '';
    } catch (error) {
      if (this.html !== undefined) {
        return this.html;
      }
      throw error;
    }
  }

  private proxy(manifest: Manifest): SCWC.IHostedPluginHandler {
    const command = manifest.command;
    return {
      name: manifest.name,
      onRequest: async ({ data, site }, logger) => {
        const id = randomUUID();
        this.notifications.set(id, logger);
        try {
          await this.call('request', { data, site }, undefined, id);
        } finally {
          this.notifications.delete(id);
        }
      },
      onUnload: async (_logger, { isRestart }) => this.stop(isRestart),
      pluginConfig: {
        command: command
          ? {
              ...command,
              execute: async (_logger, options, unusedArgs, originArgs) => {
                await this.call('command', { index: -1, args: [options, unusedArgs, originArgs] });
              },
              subCommands: command.subCommands?.map((item, index) => ({
                ...item,
                execute: async (_logger, options, unusedArgs, originArgs) => {
                  await this.call('command', { index, args: [options, unusedArgs, originArgs] });
                },
              })),
            }
          : undefined,
        scripts: manifest.scripts
          ? {
              ...manifest.scripts,
              controls: async (_logger, context) => {
                const items = await this.call<Omit<SCWC.TPluginItem, 'trigger'>[]>(
                  'controls',
                  context,
                  1500,
                );
                return items.map((item) => ({
                  ...item,
                  trigger: (_logger, context) =>
                    this.call('trigger', { channel: item.channel, context }),
                }));
              },
            }
          : undefined,
      },
      ui: manifest.ui
        ? {
            entry: manifest.ui.entry,
            html: manifest.ui.hasHtml ? () => this.pageHtml() : undefined,
            api: manifest.ui.apis.map((item, index) => ({
              ...item,
              handler: (data, { req }) =>
                this.call('api', { index, data, request: requestData(req) }),
            })),
            resources: manifest.ui.resources.map((item, index) => ({
              ...item,
              handler: async (data, { req, res }) => {
                const resource = await this.call<ResourceResponse>('resource', {
                  index,
                  data,
                  request: requestData(req),
                });
                await sendResource(resource, req, res);
              },
            })),
            websocket: manifest.ui.sockets.map((item, index) => {
              const ids = new WeakMap<SCWC.THostedPluginWebSocketContext, string>();
              return {
                ...item,
                onConnect: async (context) => {
                  if (this.sockets.size >= 128) {
                    throw new PluginProcessError('插件 WebSocket 连接数超过限制', 429);
                  }
                  const connectionId = randomUUID();
                  ids.set(context, connectionId);
                  this.sockets.set(connectionId, context);
                  const cleanup = () => {
                    if (!this.sockets.has(connectionId)) {
                      return;
                    }
                    this.sockets.delete(connectionId);
                    ids.delete(context);
                    void this.call('socket.close', connectionId).catch(() => {
                      /* The peer may already be disconnected. */
                    });
                  };
                  try {
                    await this.call('socket.connect', {
                      index,
                      connectionId,
                      query: context.query.toString(),
                      request: {
                        method: context.req.method ?? 'GET',
                        url: context.req.url ?? '',
                        params: {},
                        query: Object.fromEntries(context.query),
                        headers: context.req.headers,
                      },
                    });
                    return cleanup;
                  } catch (error) {
                    cleanup();
                    throw error;
                  }
                },
                onMessage: async (data, context) => {
                  const connectionId = ids.get(context);
                  if (connectionId) {
                    await this.call('socket.message', { connectionId, data });
                  }
                },
                onClose: async (context) => {
                  const connectionId = ids.get(context);
                  if (!connectionId) {
                    return;
                  }
                  this.sockets.delete(connectionId);
                  ids.delete(context);
                  await this.call('socket.close', connectionId).catch(() => {
                    /* Host may have exited. */
                  });
                },
              };
            }),
          }
        : undefined,
    };
  }
}
