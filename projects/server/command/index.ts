import readline from 'node:readline';
import {
  configuredPluginDirectory,
  inactivePlugins,
  plugins,
  enablePlugin,
  disablePlugin,
  reloadPlugin,
} from '../plugin/load.ts';
import path from 'node:path';
import { buildPluginWeb } from '../plugin/web/build.ts';
import { pluginLogger } from '../plugin/log.ts';
import {
  registerCommand,
  SYSTEM_SYMBOL,
  printCommandHelp,
  printHelp,
  parseAndRunCommands,
  CommandError,
} from '../utils/command.ts';
import { TOKEN, ACTIVE_PORT, HOST } from '../common/env.ts';
import { InvocationInputError, setInputHandler } from '../common/interaction.ts';

let interruptInput: (() => boolean) | undefined;
export function cancelStdinInput() {
  return interruptInput?.() ?? false;
}

/** 重启脚本位置 */
// const RESTART_SCRIPT_PATH = path.join(process.cwd(), 'server', 'scripts', 'restart.ts');

/**
 * 注册默认系统命令
 * @param serverLogger
 * @param pluginLogger
 * @param plugins
 * @param inactivePlugins
 */
export function registerDefaultCommands(serverLogger: SCWC.TLogger) {
  registerCommand(
    serverLogger,
    'exit',
    () => {
      // process.exit(0);
      // 发送退出信号
      process.emit('message', 'SIGINT-exit', null);
    },
    SYSTEM_SYMBOL,
    '退出程序',
  );
  // BUG: 重启后会导致输入和 zsh 输入冲突, 输入内容会被 zsh 获取到, 导致命令输入出现问题
  registerCommand(
    serverLogger,
    'restart',
    () => {
      // 发送重启信号
      process.emit('message', 'SIGINT-restart', null);
    },
    SYSTEM_SYMBOL,
    '重启程序',
  );
  registerCommand(
    serverLogger,
    'help',
    (log, _options, _unusedArgs, originArgs) => {
      if (originArgs.length === 1) {
        printHelp(log);
      } else if (originArgs.length === 2) {
        printCommandHelp(originArgs[1]);
      } else {
        log.error('用法错误: help [命令名称]');
      }
    },
    SYSTEM_SYMBOL,
    '显示帮助信息',
  );
  registerCommand(
    serverLogger,
    'server',
    () => {
      serverLogger.info('');
    },
    SYSTEM_SYMBOL,
    '',
    [
      {
        name: 'info',
        description: '显示服务器信息',
        execute: () => {
          serverLogger.info('服务器信息:');
          serverLogger.info(`- URL: ${HOST}:${ACTIVE_PORT}`);
          serverLogger.info(`- TOKEN: ${TOKEN ?? '未设置'}`);
        },
      },
    ],
  );
  registerCommand(
    pluginLogger,
    'plugin',
    () => {
      pluginLogger.info('');
    },
    SYSTEM_SYMBOL,
    '管理核心服务插件',
    [
      ...(
        [
          ['enable', '启用插件并保存启用状态', enablePlugin],
          ['disable', '禁用插件并保存禁用状态', disablePlugin],
          ['reload', '重载已加载插件', reloadPlugin],
        ] as const
      ).map(([name, description, action]) => ({
        name,
        description,
        exampleUsage: `plugin ${name} <插件目录名>`,
        execute: async (
          logger: SCWC.TLogger,
          _options: unknown,
          _unused: unknown,
          origin: string[],
        ) => {
          if (origin.length !== 3) {
            throw new CommandError(`用法：plugin ${name} <插件目录名>`, false);
          }
          await action(origin[2]);
          logger.info(`插件 ${origin[2]} ${name} 完成`);
        },
      })),
      {
        name: 'build-web',
        description: '使用内置 Vite 重建指定插件页面',
        exampleUsage: 'plugin build-web <插件目录名>',
        execute: async (logger, _options, _unused, origin, context) => {
          const id = origin[2];
          if (origin.length !== 3 || !id || id === '.' || id === '..' || /[/\\]/.test(id)) {
            throw new CommandError('用法：plugin build-web <插件目录名>', false);
          }
          const plugin = [...plugins, ...inactivePlugins].find((item) => item.pluginId === id);
          const directory = plugin?.pluginDir ?? path.join(await configuredPluginDirectory(), id);
          await buildPluginWeb(directory, logger, { signal: context.signal });
        },
      },
      {
        name: 'ls',
        description: '列出所有插件',
        execute: () => {
          pluginLogger.info('所有插件列表:');
          for (const plugin of plugins) {
            pluginLogger.info(
              `- ${plugin.name} (目录: ${plugin.pluginId})[${plugin.runtime?.status ?? 'enabled'}] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})${plugin.runtime ? ` (process pid=${plugin.runtime.pid ?? '-'}${plugin.runtime.reason ? `: ${plugin.runtime.reason}` : ''})` : ''}`,
            );
          }
          for (const plugin of inactivePlugins) {
            pluginLogger.info(
              `- ${plugin.name} (目录: ${plugin.pluginId})[disabled] (原因: ${plugin.reason}) (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})${plugin.runtime ? ` (process pid=${plugin.runtime.pid ?? '-'}${plugin.runtime.reason ? `: ${plugin.runtime.reason}` : ''})` : ''}`,
            );
          }
        },
      },
      {
        name: 'ps',
        description: '列出所有已加载的插件',
        execute: () => {
          if (plugins.length === 0) {
            pluginLogger.info('没有加载插件');
          } else {
            pluginLogger.info('已加载插件列表:');
          }
          for (const plugin of plugins) {
            pluginLogger.info(
              `- ${plugin.name} (目录: ${plugin.pluginId})[${plugin.runtime?.status ?? 'enabled'}] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})${plugin.runtime ? ` (process pid=${plugin.runtime.pid ?? '-'}${plugin.runtime.reason ? `: ${plugin.runtime.reason}` : ''})` : ''}`,
            );
          }
          if (inactivePlugins.length === 0) {
            pluginLogger.info('没有未激活的插件');
          } else {
            pluginLogger.info('未激活插件列表:');
          }
          for (const plugin of inactivePlugins) {
            pluginLogger.info(
              `- ${plugin.name} (目录: ${plugin.pluginId})[disabled] (原因: ${plugin.reason}) (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})${plugin.runtime ? ` (process pid=${plugin.runtime.pid ?? '-'}${plugin.runtime.reason ? `: ${plugin.runtime.reason}` : ''})` : ''}`,
            );
          }
        },
      },
    ],
  );
}

export function listenProcessStdin(serverLogger: SCWC.TLogger) {
  const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const inputs = new Map<string, (value?: string, error?: Error) => void>();
  interruptInput = () => {
    const complete = inputs.values().next().value;
    if (!complete) {
      return false;
    }
    complete(undefined, new InvocationInputError('cancelled', '用户取消输入'));
    return true;
  };
  let closed = false;
  let running = false;
  const lines: string[] = [];
  const drain = () => {
    while (inputs.size && lines.length) {
      inputs.values().next().value?.(lines.shift());
    }
    if (!lines.length && closed) {
      for (const complete of [...inputs.values()]) {
        complete(undefined, new InvocationInputError('closed', '输入流已关闭'));
      }
    }
    if (running || !lines.length || inputs.size) {
      return;
    }
    const line = lines.shift();
    if (line === undefined) {
      return;
    }
    if (!line.trim()) {
      drain();
      return;
    }
    running = true;
    void parseAndRunCommands(line)
      .catch((error) =>
        serverLogger.error(
          error instanceof CommandError ? `命令执行失败: ${error.message}` : error,
        ),
      )
      .finally(() => {
        running = false;
        drain();
      });
  };
  setInputHandler(
    (request, signal) =>
      new Promise((resolve, reject) => {
        if (closed && !lines.length) {
          reject(new InvocationInputError('closed', '输入流已关闭'));
          return;
        }
        const abort = () =>
          complete(undefined, new InvocationInputError('cancelled', '输入已取消'));
        const complete = (value?: string, error?: Error) => {
          inputs.delete(request.id);
          signal.removeEventListener('abort', abort);
          if (error) {
            reject(error);
          } else {
            resolve(value ?? '');
          }
        };
        inputs.set(request.id, complete);
        signal.addEventListener('abort', abort, { once: true });
        process.stdout.write(request.message + '\n');
        drain();
      }),
  );
  reader.on('line', (line) => {
    lines.push(line);
    drain();
  });
  reader.on('close', () => {
    closed = true;
    drain();
  });
  process.stdin.resume();
}
