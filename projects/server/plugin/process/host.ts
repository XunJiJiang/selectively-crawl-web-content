import { pathToFileURL } from 'node:url';
import { formatWithOptions } from 'node:util';
import { spawn } from 'node:child_process';
import { createRetryGet, LimitPromise } from '../../utils/axios.ts';
import { RpcPeer } from './rpc.ts';
import { TaskRegistry, invocationStorage } from '../../common/tasks.ts';
import { setInputHandler, remoteInput } from '../../common/interaction.ts';
import { outputColorLevel } from '../../common/color.ts';
import type { InvocationIdentity } from '../../types/task.d.ts';
import type { LogLevel } from '../../utils/log.ts';
import type { Initialize, Invocation, Manifest } from './protocol.ts';
import type {
  ProcessApi,
  ProcessPluginHandler,
  ProcessSocket,
  ProcessSocketContext,
  PluginRequest,
} from '../../types/plugin-process.d.ts';
import type { TPluginCacheableData } from '../../types/cache.d.ts';

const peer = new RpcPeer((message, callback) => {
  if (!process.connected || !process.send) {
    return callback(new Error('插件宿主已断开'));
  }
  process.send(message, callback);
});
const tasks = new TaskRegistry();
setInputHandler((request, signal) => remoteInput(peer, request, signal));
const processTasks = tasks.create('host', undefined, true);
tasks.on('snapshot', (snapshot) => {
  const send = () => {
    void peer.eventAsync('task', snapshot).catch(() => {
      if (process.connected) {
        setTimeout(send, 20);
      }
    });
  };
  send();
});
peer.onEvent = (event, data) => {
  if (event === 'cancel') {
    tasks.cancel((data as { executionId?: string })?.executionId);
  }
};
process.on('message', (message) => peer.receive(message));
// SIGKILL of the core skips its exit hook. The host must then clean its own tree.
process.once('disconnect', () => {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }).once(
      'error',
      () => process.exit(0),
    );
  } else {
    try {
      process.kill(-process.pid, 'SIGKILL');
    } catch {
      process.exit(0);
    }
  }
});
process.on('SIGINT', () => {
  /* Unload is coordinated through IPC by the core. */
}); // The core owns the coordinated unload sequence.

let plugin: ProcessPluginHandler | undefined;
let apis: ProcessApi[] = [];
let channels: ProcessSocket[] = [];
let stopping = false;
let activeCalls = 0;
const connections = new Map<
  string,
  {
    config: ProcessSocket;
    context: ProcessSocketContext;
    cleanup?: () => void;
    closed: boolean;
  }
>();
function log(level: LogLevel, identity?: InvocationIdentity, dynamic = true): SCWC.TLogger['info'] {
  return (...args: unknown[]) => {
    const text = formatWithOptions({ colors: outputColorLevel() > 0 }, ...args);
    const origin = identity ?? (dynamic ? invocationStorage.getStore() : undefined);
    peer.event('log', {
      level,
      text,
      executionId: origin?.executionId,
      windowId: origin?.windowId,
      sessionId: origin?.sessionId,
    });
  };
}
let pluginId = 'plugin';
let logger: SCWC.PluginLogger = Object.freeze({
  pluginId,
  windowId: null,
  info: log('info'),
  pathInfo: log('pathInfo'),
  warn: log('warn'),
  error: log('error'),
});
function scopedLogger(identity: InvocationIdentity): SCWC.PluginLogger {
  return Object.freeze({
    ...identity,
    pluginId,
    info: log('info', identity),
    pathInfo: log('pathInfo', identity),
    warn: log('warn', identity),
    error: log('error', identity),
  });
}
// Raw console output can be routed through the current asynchronous invocation.
console.log = log('info');
console.info = log('info');
console.warn = log('warn');
console.error = log('error');

const cache: SCWC.IPluginCache = {
  set: async <T extends TPluginCacheableData>(key: string, data: T) => {
    await peer.call('cache.set', { key, data }, 10_000);
    return data;
  },
  get: <T>(key: string) => peer.call<T | undefined>('cache.get', { key }, 10_000),
  setRedirect: (key, targetKey) => peer.call('cache.setRedirect', { key, targetKey }, 10_000),
  del: (key) => peer.call('cache.del', { key }, 10_000),
  mdel: (keys) => peer.call('cache.mdel', { keys }, 10_000),
};

function getPlugin(): ProcessPluginHandler {
  if (!plugin) {
    throw new Error('插件尚未初始化');
  }
  return plugin;
}

async function controls(
  context: Parameters<SCWC.TCreatePluginItem>[1],
): Promise<SCWC.TPluginItem[]> {
  const config = getPlugin().pluginConfig?.scripts?.controls;
  const current = invocationStorage.getStore();
  const result =
    typeof config === 'function'
      ? await config(current ? scopedLogger(current) : logger, {
          ...context,
          tasks: current?.tasks,
          signal: current?.signal,
        })
      : (config ?? []);
  const names = result.map((item) => item.channel);
  if (new Set(names).size !== names.length) {
    throw new Error('插件控件 channel 重复');
  }
  return result;
}

async function initialize(args: Initialize): Promise<Manifest> {
  if (plugin) {
    throw new Error('插件不能重复初始化');
  }
  const loaded: unknown = (await import(pathToFileURL(args.entry).href)).default;
  pluginId = args.pluginId ?? args.name;
  logger = Object.freeze({
    ...logger,
    pluginId,
    windowId: args.outputWindowId ?? null,
    sessionId: args.sessionId,
  });
  if (
    !loaded ||
    typeof loaded !== 'object' ||
    ('apiVersion' in loaded && loaded.apiVersion !== undefined && loaded.apiVersion !== 2) ||
    !('onRequest' in loaded) ||
    typeof loaded.onRequest !== 'function'
  ) {
    throw new Error('插件必须导出 onRequest，apiVersion 默认 2 且不支持其他版本');
  }
  plugin = loaded as ProcessPluginHandler;
  await plugin.onLoad?.(logger, {
    tasks: processTasks.reporter,
    signal: processTasks.controller.signal,
    cache,
    LimitPromise,
    createRetryGet: (factory) =>
      createRetryGet(
        `plugin:${args.name}`,
        { info: log('info'), pathInfo: log('pathInfo'), warn: log('warn'), error: log('error') },
        factory,
        cache,
      ),
  });
  const ui = plugin.ui;
  apis = [];
  channels = [];
  if (typeof ui?.api === 'function') {
    ui.api({ add: (...items) => apis.push(...items) });
  } else {
    apis.push(...(ui?.api ?? []));
  }
  if (typeof ui?.websocket === 'function') {
    ui.websocket({ add: (...items) => channels.push(...items) });
  } else {
    channels.push(...(ui?.websocket ?? []));
  }
  const routes = apis.map((item) => `${item.method}:${item.path}`);
  if (new Set(routes).size !== routes.length) {
    throw new Error('插件 API 路由重复');
  }
  let html: string | undefined;
  if (ui?.html) {
    try {
      html = await ui.html();
    } catch (error) {
      logger.warn('插件 HTML 快照不可用', error);
    }
  }
  const command = plugin.pluginConfig?.command;
  return {
    name: plugin.name,
    command: command
      ? {
          description: command.description,
          options: command.options,
          exampleUsage: command.exampleUsage,
          subCommands: command.subCommands?.map(({ execute: _, ...item }) => item),
        }
      : undefined,
    scripts: plugin.pluginConfig?.scripts
      ? {
          title: plugin.pluginConfig.scripts.title,
          description: plugin.pluginConfig.scripts.description,
        }
      : undefined,
    ui: ui
      ? {
          entry: ui.entry,
          hasHtml: Boolean(ui.html),
          html,
          apis: apis.map(({ method, path }) => ({ method, path })),
          resources: ui.resources?.map(({ path }) => ({ path })) ?? [],
          sockets: channels.map(({ path }) => ({ path })),
        }
      : undefined,
  };
}

async function closeConnection(connectionId: string): Promise<void> {
  const connection = connections.get(connectionId);
  if (!connection || connection.closed) {
    return;
  }
  connection.closed = true;
  connections.delete(connectionId);
  connection.cleanup?.();
  await connection.config.onClose?.({
    ...connection.context,
    tasks: invocationStorage.getStore()?.tasks,
    signal: invocationStorage.getStore()?.signal,
  });
}

async function dispatch(method: string, args: unknown, id: string): Promise<unknown> {
  if (method === 'initialize') {
    return initialize(args as Initialize);
  }
  const plugin = getPlugin();
  if (method === 'ping') {
    return;
  }
  if (method === 'unload') {
    stopping = true;
    // Existing asynchronous invocations must finish before their runtime is disposed.
    while (activeCalls > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    for (const connectionId of connections.keys()) {
      await closeConnection(connectionId);
    }
    await plugin.onUnload?.(logger, args as SCWC.IUnloadContext);
    return;
  }
  if (stopping) {
    throw new Error('插件正在停止');
  }
  activeCalls++;
  const context = invocationStorage.getStore();
  const invocationLogger = context ? scopedLogger(context) : logger;
  try {
    switch (method) {
      case 'html':
        return await plugin.ui?.html?.();
      case 'api': {
        const invocation = args as Invocation;
        const api = apis[invocation.index];
        if (!api) {
          throw new Error('插件 API 不存在');
        }
        return await api.handler(invocation.data, {
          request: invocation.request,
          tasks: context?.tasks,
          signal: context?.signal,
          logger: context ? scopedLogger(context) : undefined,
        });
      }
      case 'resource': {
        const invocation = args as Invocation;
        const resource = plugin.ui?.resources?.[invocation.index];
        if (!resource) {
          throw new Error('插件资源不存在');
        }
        return await resource.handler(invocation.data, {
          request: invocation.request,
          tasks: context?.tasks,
          signal: context?.signal,
          logger: context ? scopedLogger(context) : undefined,
        });
      }
      case 'controls': {
        return (await controls(args as Parameters<SCWC.TCreatePluginItem>[1])).map(
          ({ trigger: _, ...item }) => item,
        );
      }
      case 'trigger': {
        const data = args as {
          channel: string;
          context: Parameters<SCWC.TPluginItem['trigger']>[1];
        };
        const item = (await controls({ site: data.context.site })).find(
          (item) => item.channel === data.channel,
        );
        if (!item) {
          throw new Error('插件控件不存在');
        }
        return await item.trigger(invocationLogger, {
          ...data.context,
          tasks: context?.tasks,
          signal: context?.signal,
        });
      }
      case 'command': {
        if (!context) {
          throw new Error('命令调用上下文缺失');
        }
        const data = args as {
          index: number;
          args: [Parameters<SCWC.TCommandExecute>[1], string[], string[]];
        };
        const command = plugin.pluginConfig?.command;
        const execute =
          data.index < 0 ? command?.execute : command?.subCommands?.[data.index]?.execute;
        await execute?.(
          context ? scopedLogger(context) : (logger as SCWC.PluginLogger),
          ...data.args,
          context,
        );
        return;
      }
      case 'request': {
        const data = args as Omit<Parameters<SCWC.IPluginHandler['onRequest']>[0], 'utils'>;
        const [{ writeData, writeDataURL }, { strValidation }, { convertToCN }, { fetchImage }] =
          await Promise.all([
            import('../../utils/writeData.ts'),
            import('../../utils/strValidation.ts'),
            import('../../utils/convertToCN.ts'),
            import('../../utils/fetchImage.ts'),
          ]);
        await plugin.onRequest(
          {
            ...data,
            tasks: context?.tasks,
            signal: context?.signal,
            utils: {
              writeData,
              writeDataURL,
              strValidation,
              convertToCN,
              fetchImage: (url) => fetchImage(url, logger),
            },
          },
          {
            ...invocationLogger,
            toWeb: (info, type) => peer.event('notification', { id, info, type }),
          },
        );
        return;
      }
      case 'socket.connect': {
        const data = args as {
          index: number;
          connectionId: string;
          request: PluginRequest;
          query: string;
        };
        const config = channels[data.index];
        if (!config) {
          throw new Error('插件 WebSocket 通道不存在');
        }
        const context: ProcessSocketContext = {
          tasks: invocationStorage.getStore()?.tasks,
          signal: invocationStorage.getStore()?.signal,
          connectionId: data.connectionId,
          request: data.request,
          channel: config.path,
          query: new URLSearchParams(data.query),
          send: (value) =>
            peer.event('socket', { connectionId: data.connectionId, action: 'send', data: value }),
          broadcast: (value, excludeSelf) =>
            peer.event('socket', {
              connectionId: data.connectionId,
              action: 'broadcast',
              data: value,
              excludeSelf,
            }),
          close: (code, reason) =>
            peer.event('socket', {
              connectionId: data.connectionId,
              action: 'close',
              code,
              reason,
            }),
        };
        const connection = {
          config,
          context,
          closed: false,
          cleanup: undefined as (() => void) | undefined,
        };
        connections.set(data.connectionId, connection);
        try {
          const cleanup = await config.onConnect?.(context);
          if (connection.closed) {
            cleanup?.();
          } else {
            connection.cleanup = cleanup ?? undefined;
          }
        } catch (error) {
          await closeConnection(data.connectionId);
          throw error;
        }
        return;
      }
      case 'socket.message': {
        const data = args as { connectionId: string; data: string | Buffer };
        const connection = connections.get(data.connectionId);
        if (connection && !connection.closed) {
          await connection.config.onMessage?.(data.data, {
            ...connection.context,
            tasks: context?.tasks,
            signal: context?.signal,
            logger: context ? scopedLogger(context) : undefined,
          });
        }
        return;
      }
      case 'socket.close':
        return await closeConnection(String(args));
      default:
        throw new Error(`未知插件操作: ${method}`);
    }
  } finally {
    activeCalls--;
  }
}

peer.onCall = async (method, envelope, id) => {
  if (['initialize', 'ping', 'unload'].includes(method)) {
    return dispatch(method, envelope, id);
  }
  const { payload, identity } = envelope as { payload: unknown; identity: InvocationIdentity };
  const scope = tasks.create('host', identity);
  try {
    return await invocationStorage.run(scope.context, () => dispatch(method, payload, id));
  } finally {
    scope.finish();
    await peer.drainEvents();
  }
};
