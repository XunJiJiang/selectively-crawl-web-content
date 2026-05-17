import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
import stream from 'node:stream';
import { registerArg } from './parseArgs'

import chalk from 'chalk';
import tryCatch from '../utils/tryCatch';

// registerArg('port', {
//   abbreviation: 'p',
//   description: '服务器端口',
//   options: {
//     type: 'number',
//     required: false,
//     defaultValue: 3000,
//   }
// });

function getCursorPosition () {
  return new Promise((resolve, reject) => {
    // 设置终端为 raw 模式，以便直接读取按键输入
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // 定义处理输入的回调函数
    const onData = (data: Buffer) => {
      // ANSI CPR 响应格式通常为 \x1b[y;xR
      const match = /\[(\d+);(\d+)R/.exec(data.toString());
      if (match) {
        const row = parseInt(match[1], 10);
        const col = parseInt(match[2], 10);

        // 恢复终端状态
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();

        resolve({ row, col });
      }
    };

    // 监听标准输入
    stdin.on('data', onData);

    // 发送查询光标位置的 ANSI 转义序列 \x1b[6n
    process.stdout.write('\x1b[6n');
  });
}

async function wait (ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录 */
const projectRoot = path.resolve(__dirname, '..', '..');

// TODO: 不使用长期终端，而是每次启动创建子进程执行, 可以更直接的控制重启和退出, 没有输出多余内容的问题, 也不会被用户执行其他命令
async function main () {

  while (true) {
    const [error, child] = tryCatch(() => spawn('npx', ['tsx', path.join(projectRoot, 'server/index.ts')], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, FORCE_COLOR: '1' },
    }))

    if (error) {
      console.error(`${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red('启动服务器失败:')}`, error);
      process.exit(1);
    }

    const { promise, resolve } = Promise.withResolvers<string>();

    /** 自定义输入 */
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue(''),
    });

    rl.prompt();

    /** 状态 */
    const state = {
      restarting: false,
      exiting: false,
    }

    // 注意, 子进程内已经存在 restart 和 exit, 但是都是退出, 并没有重启的功能
    // 这里拦截 restart 负责重启服务器
    rl.on('line', (line) => {
      const trimmedLine = line.trim();
      if (trimmedLine === 'restart') {
        if (state.restarting) {
          console.log(`${chalk.gray('[')}${chalk.yellow('WARNING')}${chalk.gray(']')} ${chalk.yellow('正在等待服务器重启')}`);
          return;
        }
        state.restarting = true;
        child.stdin.write(line + os.EOL);
      } else if (trimmedLine === 'exit') {
        if (state.exiting) {
          console.log(`${chalk.gray('[')}${chalk.yellow('WARNING')}${chalk.gray(']')} ${chalk.yellow('正在等待服务器退出, 强制退出请输入 q!')}`);
          return;
        }
        state.exiting = true;
        child.stdin.write(line + os.EOL);
      } else if (trimmedLine === 'q!') {
        resolve('exit');
        process.exit(0);
      } else if (child) {
        child.stdin.write(line + os.EOL);
      }
      rl.prompt();
    })

    // 监听子进程错误退出
    child.on('error', (err) => {
      console.error(`${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red('服务器进程发生错误:')}`, err);
    });

    // 监听子进程退出
    child.on('exit', (code, signal) => {
      if (state.exiting) {
        console.log(`${chalk.gray('[')}${chalk.blue('INFO')}${chalk.gray(']')} ${chalk.green('服务器退出')}`);
        resolve('exit');
      } else if (state.restarting) {
        console.log(`${chalk.gray('[')}${chalk.blue('INFO')}${chalk.gray(']')} ${chalk.green('服务器重启')}`);
        resolve('restart');
      } else {
        console.error(`${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red('服务器进程意外退出, 退出码: ${code}, 信号: ${signal}')}`);
        resolve('restart');
      }
    });

    const result = await promise;

    // 关闭输入通道
    rl.close();

    if (result === 'restart') {
      continue;
    } else if (result === 'exit') {
      break;
    }
  }

  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __mainFilename = process.argv[1];
const isMain = __filename === __mainFilename;
if (isMain) {
  main();
} else {
}