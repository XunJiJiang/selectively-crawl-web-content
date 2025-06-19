import chalk from 'chalk';

const log = {
  info: (...message: any[]) => {
    console.log(chalk.blue('[SCWC INFO]'), ...message);
  },
  warn: (...message: any[]) => {
    console.warn(chalk.yellow('[SCWC WARN]'), ...message);
  },
  error: (...message: any[]) => {
    console.error(chalk.red('[SCWC ERROR]'), ...message);
  },
};

export function createLogger(tag: string, relativePath: string) {
  return {
    info: (...message: any[]) => {
      console.log(chalk.blue('[SCWC]'), chalk.blue(`[${tag}]`), chalk.blue('[INFO]'), ...message);
    },
    pathInfo: (...message: any[]) => {
      console.log(chalk.bgBlue.white('[SCWC]'), chalk.bgBlue.white(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
    warn: (...message: any[]) => {
      console.warn(
        chalk.bgYellow.gray('[SCWC]'),
        chalk.bgYellow.gray(`[${tag}]`),
        ...message,
        chalk.blue(relativePath)
      );
    },
    error: (...message: any[]) => {
      console.error(chalk.bgRed.gray('[SCWC]'), chalk.bgRed.gray(`[${tag}]`), ...message, chalk.blue(relativePath));
    },
  };
}

export default log;
