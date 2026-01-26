import chalk from 'chalk';

const log = {
  info: (...message: any[]) => {
    console.log(chalk.blue('[SCWC INFO]'), ...message);
  },
  warn: (...message: any[]) => {
    console.warn(chalk.yellow('[SCWC WARN]'), ...message);
  },
  error: (...message: any[]) => {
    console.error(chalk.bgRed.gray('[SCWC ERROR]'), ...message);
  },
};

export function createLogger(tag: string, relativePath: string) {
  return {
    info: (...message: any[]) => {
      console.log(chalk.blue(`[${tag}]`), ...message);
    },
    pathInfo: (...message: any[]) => {
      console.log(chalk.blue(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
    warn: (...message: any[]) => {
      console.warn(chalk.yellow(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
    error: (...message: any[]) => {
      console.error(chalk.red(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
  };
}

export default log;
