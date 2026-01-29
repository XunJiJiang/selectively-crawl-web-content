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

/**
 * 注册默认系统命令
 * @param serverLogger
 * @param pluginLogger
 * @param plugins
 * @param inactivePlugins
 */
export function registerDefaultCommands(serverLogger: SCWC.Log) {
  registerCommand(
    serverLogger,
    'exit',
    () => {
      process.exit(0);
    },
    SYSTEM_SYMBOL,
    '退出程序',
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
    pluginLogger,
    'plugin:list',
    () => {
      pluginLogger.info('所有插件列表:');
      for (const plugin of plugins) {
        pluginLogger.info(`- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`);
      }
      for (const plugin of inactivePlugins) {
        pluginLogger.info(
          `- ${plugin.name}[disabled] (原因: ${plugin.reason}) (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`,
        );
      }
    },
    SYSTEM_SYMBOL,
    '列出所有已加载的插件',
  );
  registerCommand(
    pluginLogger,
    'plugin:ps',
    () => {
      pluginLogger.info('已加载插件列表:');
      for (const plugin of plugins) {
        pluginLogger.info(`- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`);
      }
    },
    SYSTEM_SYMBOL,
    '列出所有已加载的插件',
  );
}

export function listenProcessStdin(serverLogger: SCWC.Log) {
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', input => {
    const inputStr = input.toString().trim();
    if (inputStr === '') return;
    try {
      parseAndRunCommands(inputStr);
    } catch (e) {
      if (e instanceof CommandError) {
        serverLogger.error(`命令执行失败: ${e.message}`);
      } else {
        serverLogger.error(`命令执行时出现未知错误: ${e}`);
      }
    }
  });
}
