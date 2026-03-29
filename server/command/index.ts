import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
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

/** 重启脚本位置 */
const RESTART_SCRIPT_PATH = path.join(process.cwd(), 'server', 'scripts', 'restart.ts');

/**
 * 注册默认系统命令
 * @param serverLogger
 * @param pluginLogger
 * @param plugins
 * @param inactivePlugins
 */
export function registerDefaultCommands(serverLogger: SCWC.TLogger) {
  /** 系统命令执行状态 */
  const states: {
    /** 是否触发重启 */
    RESTART: boolean;
    /** 执行重启. 执行时期必须是在 process.exit 执行的前一刻 */
    RUN_RESTART?: () => void;
  } = {
    RESTART: false,
  };

  registerCommand(
    serverLogger,
    'exit',
    () => {
      // process.exit(0);
      // 触发 SIGINT 信号, 让主进程执行正常的退出流程
      process.kill(process.pid, 'SIGINT');
    },
    SYSTEM_SYMBOL,
    '退出程序',
  );
  registerCommand(
    serverLogger,
    'restart',
    () => {
      if (!fs.existsSync(RESTART_SCRIPT_PATH)) {
        serverLogger.error('重启脚本不存在');
        return;
      }

      /** 当前进程 pid */
      const currentPid = process.pid;

      states.RESTART = true;
      states.RUN_RESTART = () => {
        const child = spawn(
          'node',
          [RESTART_SCRIPT_PATH, `--runtime=node`, `--version=${process.version}`, `--pid=${currentPid}`],
          {
            detached: true,
            stdio: 'inherit',
          },
        );
        child.unref();
      };
      process.kill(process.pid, 'SIGINT');
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
      if (plugins.length === 0) {
        pluginLogger.info('没有加载插件');
      } else {
        pluginLogger.info('已加载插件列表:');
      }
      for (const plugin of plugins) {
        pluginLogger.info(`- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`);
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
    SYSTEM_SYMBOL,
    '列出所有已加载的插件',
  );

  return () => ({ ...states });
}

export function listenProcessStdin(serverLogger: SCWC.TLogger) {
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', async input => {
    const inputStr = input.toString().trim();
    if (inputStr === '') return;
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
