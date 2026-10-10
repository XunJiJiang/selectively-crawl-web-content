import { formatWithOptions } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Peer } from '../peer.ts';
import { TaskRegistry, invocationStorage } from '../../server/common/tasks.ts';
import { setInputHandler, remoteInput } from '../../server/common/interaction.ts';
import { outputColorLevel } from '../../server/common/color.ts';
import { registerPluginSdk } from '../../server/plugin/sdk/register.ts';
import type { InvocationIdentity, PluginLogger } from '../../server/types/task.d.ts';
import scwcPlugin from '../plugins/scwc/index.ts';
import type { CommandInfo, CompletionRequest } from '../protocol.ts';

const peer = new Peer((packet, callback) => {
  if (process.send && process.connected) {
    process.send(packet, callback);
  } else {
    callback(new Error('终端插件已断开'));
  }
});
process.on('message', (message) => peer.receive(message));
const registry = new TaskRegistry();
setInputHandler((request, signal) => remoteInput(peer, request, signal));
const processScope = registry.create('terminal-plugin', undefined, true);
registry.on('snapshot', (value) => peer.event('task', value));
let plugin: SCWCTerminal.Plugin | undefined;
let pluginId = 'terminal-plugin';
let outputId: string | null = null;
const commands = new Map<string, SCWCTerminal.Command>();
function logger(identity?: InvocationIdentity): PluginLogger {
  const method =
    (level: string) =>
    (...args: unknown[]) => {
      const origin = identity ?? invocationStorage.getStore();
      peer.event('output', {
        windowId: origin?.windowId ?? outputId,
        executionId: origin?.executionId,
        pluginId,
        text: formatWithOptions({ colors: outputColorLevel() > 0 }, ...args),
        level,
      });
    };
  return Object.freeze({
    get pluginId() {
      return pluginId;
    },
    windowId: identity?.windowId ?? outputId,
    executionId: identity?.executionId,
    info: method('info'),
    pathInfo: method('pathInfo'),
    warn: method('warn'),
    error: method('error'),
  });
}
console.log = (...args) => logger(invocationStorage.getStore()).info(...args);
console.info = console.log;
console.warn = (...args) => logger(invocationStorage.getStore()).warn(...args);
console.error = (...args) => logger(invocationStorage.getStore()).error(...args);
peer.onCall = async (method, value) => {
  const args = value as {
    entry: string;
    pluginId: string;
    outputId: string;
    identity: InvocationIdentity;
    name: string;
    args: string[];
    executionId?: string;
    commands?: CommandInfo[];
    request: CompletionRequest;
  };
  if (method === 'hello') {
    pluginId = args.pluginId;
    outputId = args.outputId;
    registerPluginSdk();
    plugin = args.entry
      ? ((await import(pathToFileURL(args.entry).href)).default as SCWCTerminal.Plugin)
      : scwcPlugin;
    if (
      !plugin ||
      typeof plugin.onLoad !== 'function' ||
      (plugin.apiVersion !== undefined && plugin.apiVersion !== 1)
    ) {
      throw new Error('无效终端插件契约');
    }
    if (
      plugin.id !== undefined &&
      (typeof plugin.id !== 'string' ||
        plugin.id.length > 64 ||
        !/^[^\s:/\\\x00-\x1f\x7f]+$/u.test(plugin.id))
    ) {
      throw new Error('插件简短标识不能包含空白、冒号、路径分隔符或控制字符');
    }
    pluginId = plugin.id ?? args.pluginId;
    await plugin.onLoad({
      coreCommands: args.commands ?? [],
      completeCore: (request) => peer.call('completeCore', request, 2000),
      tasks: processScope.reporter,
      logger: logger(),
      signal: processScope.controller.signal,
      registerCommand: (command) => {
        if (
          !/^[\w-]+$/.test(command.name) ||
          commands.has(command.name) ||
          (command.scope !== undefined && !['command', 'global'].includes(command.scope))
        ) {
          throw new Error('终端插件命令重名或格式错误');
        }
        commands.set(command.name, command);
      },
    });
    return {
      identifier: plugin.id,
      commands: [...commands.values()].map(({ name, description, scope, usage }) => ({
        name,
        description,
        scope,
        usage,
      })),
    };
  }
  if (method === 'identifier.set') {
    pluginId = String((value as { identifier: string }).identifier);
    return;
  }
  if (method === 'cancel') {
    registry.cancel(args.executionId);
    return;
  }
  if (method === 'unload') {
    registry.cancel();
    await plugin?.onUnload?.();
    return;
  }
  if (method === 'complete') {
    return (
      commands.get(args.name)?.complete?.(args.request) ?? {
        from: args.request.cursor,
        to: args.request.cursor,
        items: [],
      }
    );
  }
  if (method !== 'execute') {
    throw new Error('未知终端插件请求');
  }
  const command = commands.get(args.name);
  if (!command) {
    throw new Error('终端插件命令不存在');
  }
  const scope = registry.create('terminal-plugin', args.identity);
  const context = scope.context;
  try {
    await invocationStorage.run(context, () =>
      command.execute({
        ...context,
        args: args.args,
        logger: logger(args.identity),
        write: (text) => logger(args.identity).info(text),
        invokeCore: async (command) => {
          const handle = context.tasks.begin('核心子命令');
          try {
            await peer.call(
              'invokeCore',
              { command, identity: args.identity },
              24 * 60 * 60 * 1000,
            );
          } finally {
            handle.end();
          }
        },
      }),
    );
  } finally {
    scope.finish();
  }
};
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
