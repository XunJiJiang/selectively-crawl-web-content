import chalk from 'chalk';

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
      console.log(chalk.blue(`[${tag}]`), ...message);
    },
    pathInfo: (...message: Parameters<Console['log']>) => {
      console.log(chalk.blue(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
    warn: (...message: Parameters<Console['warn']>) => {
      console.warn(chalk.yellow(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
    error: (...message: Parameters<Console['error']>) => {
      console.error(chalk.red(`[${tag}]`), ...message, chalk.blue(relativePath));
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
