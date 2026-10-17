import chalk from 'chalk';
import { formatWithOptions } from 'node:util';
import { invocationStorage, outputWindowId } from '../common/tasks.ts';
import { outputColorLevel } from '../common/color.ts';
import type { InvocationIdentity, PluginLogger } from '../types/task.d.ts';
import type { TLogger } from '../types/log.d.ts';
import { getNotifications, type NotificationLogger } from '../workbench/notifications.ts';

export type LogLevel = 'info' | 'pathInfo' | 'warn' | 'error';
export type LogSink = (event: {
  windowId: string | null;
  executionId?: string;
  sessionId?: string;
  pluginId?: string;
  level: LogLevel;
  text: string;
}) => void;
let sink: LogSink | undefined;
const subscribers = new Set<LogSink>();
export function subscribeLog(value: LogSink) {
  subscribers.add(value);
  return () => {
    subscribers.delete(value);
  };
}
export function setLogSink(value?: LogSink) {
  sink = value;
}
export function publishLog(
  identity: InvocationIdentity | undefined,
  pluginId: string,
  level: LogLevel,
  args: unknown[],
  fallback: () => void,
) {
  if (!sink && !subscribers.size) {
    fallback();
    return;
  }
  const text = formatWithOptions({ colors: outputColorLevel() > 0 }, ...args);
  const event = {
    windowId: identity?.windowId ?? outputWindowId,
    executionId: identity?.executionId,
    sessionId: identity?.sessionId,
    pluginId,
    level,
    text: `[${pluginId}]${level === 'warn' || level === 'error' ? ` [${level}]` : ''} ${text}`,
  };
  sink?.(event);
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      /* A consumer cannot break command execution. */
    }
  }
  if (!sink) {
    fallback();
  }
}
export function bindLogger(
  base: TLogger,
  identity: InvocationIdentity,
  pluginId: string,
): PluginLogger {
  const method =
    (level: LogLevel) =>
    (...args: unknown[]) =>
      publishLog(identity, pluginId, level, args, () => base[level](...args));
  return Object.freeze({
    workbench: Object.fromEntries(
      ['info', 'success', 'warn', 'error'].map((level) => [
        level,
        (title: string, options: unknown) => {
          getNotifications().publish('plugin', pluginId, level, title, options, {
            executionId: identity.executionId,
          });
        },
      ]),
    ) as unknown as NotificationLogger,
    pluginId,
    ...identity,
    info: method('info'),
    pathInfo: method('pathInfo'),
    warn: method('warn'),
    error: method('error'),
  });
}

// TODO: 记录日志到文件

const log = {
  info: (...message: Parameters<Console['log']>) => {
    console.log(chalk.blue('[SCWC INFO]'), ...message);
  },
  warn: (...message: Parameters<Console['warn']>) => {
    console.warn(chalk.yellow('[SCWC WARN]'), ...message);
  },
  error: (...message: Parameters<Console['error']>) => {
    console.error(chalk.bgRed.gray('[SCWC ERROR]'), ...message);
  },
};

export function createLogger(tag: string, relativePath: string) {
  return {
    info: (...message: Parameters<Console['log']>) => {
      publishLog(invocationStorage.getStore(), tag, 'info', message, () =>
        console.log(chalk.blue(`[${tag}]`), ...message),
      );
    },
    pathInfo: (...message: Parameters<Console['log']>) => {
      publishLog(invocationStorage.getStore(), tag, 'pathInfo', [...message, relativePath], () =>
        console.log(chalk.blue(`[${tag}]`), ...message, chalk.blue(relativePath)),
      );
    },
    warn: (...message: Parameters<Console['warn']>) => {
      publishLog(invocationStorage.getStore(), tag, 'warn', [...message, relativePath], () =>
        console.warn(chalk.yellow(`[${tag}]`), ...message, chalk.blue(relativePath)),
      );
    },
    error: (...message: Parameters<Console['error']>) => {
      publishLog(invocationStorage.getStore(), tag, 'error', [...message, relativePath], () =>
        console.error(chalk.red(`[${tag}]`), ...message, chalk.blue(relativePath)),
      );
    },
  };
}

export default log;

/**
 * 为 command 提供的函数, 用于记录当前用户输入的命令和参数
 * 以便控制台输出时不覆盖当前输入的命令
 * @param nowInput 当前输入的命令和参数字符串
 * @param predictInput 预测的命令和参数字符串, 用于提示用户可能的输入, 必须以 nowInput 开头, 可以与 nowInput 完全相同
 */
// export function logCommandInput(nowInput: string, predictInput?: string) {}
