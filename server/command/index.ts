// import { spawn } from 'node:child_process';
// import path from 'node:path';
// import fs from 'node:fs';
import { inactivePlugins, plugins } from '../plugin/load.ts';
import { pluginLogger } from '../plugin/log.ts';
import {
  registerCommand,
  SYSTEM_SYMBOL,
  printCommandHelp,
  printHelp,
  parseAndRunCommands,
  CommandError,
} from '../utils/command.ts';
import { TOKEN } from '../common/env.ts';

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
    '列出所有已加载的插件',
    [
      {
        name: 'ls',
        description: '列出所有插件',
        execute: () => {
          pluginLogger.info('所有插件列表:');
          for (const plugin of plugins) {
            pluginLogger.info(
              `- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`,
            );
          }
          for (const plugin of inactivePlugins) {
            pluginLogger.info(
              `- ${plugin.name}[disabled] (原因: ${plugin.reason}) (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`,
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
              `- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`,
            );
          }
          if (inactivePlugins.length === 0) {
            pluginLogger.info('没有未激活的插件');
          } else {
            pluginLogger.info('未激活插件列表:');
          }
          for (const plugin of inactivePlugins) {
            pluginLogger.info(
              `- ${plugin.name}[disabled] (原因: ${plugin.reason}) (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`,
            );
          }
        },
      },
    ],
  );
}

export function listenProcessStdin(serverLogger: SCWC.TLogger) {
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', async (input) => {
    const inputStr = input.toString().trim();
    if (inputStr === '') {
      return;
    }
    try {
      await parseAndRunCommands(inputStr);
    } catch (e) {
      if (e instanceof CommandError) {
        serverLogger.error(`命令执行失败: ${e.message}`);
      } else {
        serverLogger.error(`命令执行时出现未知错误: ${e}`);
      }
    }
  });
}
