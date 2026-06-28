import path from 'node:path';
// import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
// import stream from 'node:stream';
import { getNameArg, registerArg } from './parseArgs.ts';
import chalk from 'chalk';
import tryCatch from '../utils/tryCatch.ts';
import { buildWebIfNeeded } from './build.ts';
// import { startProxy } from './proxy.ts';

// 模式
// 当模式为 'prod' 时, 使用 server/public/web 中的 index.html 文件
// 当模式为 'dev' 时, 将所有请求转发到指定端口的 web 服务器, 不再使用 server/public/web 中的 index.html 文件
registerArg('mode', {
  abbreviation: 'm',
  description: '运行模式',
  options: {
    type: 'string',
    required: false,
    defaultValue: 'prod', // 'dev' | 'prod'
  },
});

// 是否在启动时构建 web 项目
// 当为 true 时, 将不考虑其他参数, 均构建 web 项目
// 当为 false 时, 将根据其他参数判断是否需要构建 web 项目
registerArg('build', {
  abbreviation: 'b',
  description: '是否构建 web 项目',
  options: {
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
});

// 注册 web 服务器 host
registerArg('web-host', {
  abbreviation: 'wh',
  description: 'Web 服务器 host',
  options: {
    type: 'string',
    required: false,
    defaultValue: 'localhost',
  },
});

// 注册 web 服务器端口参数
registerArg('web-port', {
  abbreviation: 'wp',
  description: 'Web 服务器端口',
  options: {
    type: 'number',
    required: false,
    defaultValue: 3201,
  },
});

const mode = getNameArg<string>('mode') ?? 'prod';
const build = getNameArg<boolean>('build') ?? false;
// const webHost = getNameArg<string>('web-host') ?? 'localhost';
// const webPort = getNameArg<number>('web-port') ?? 3201;

// registerArg('port', {
//   abbreviation: 'p',
//   description: '服务器端口',
//   options: {
//     type: 'number',
//     required: false,
//     defaultValue: 3000,
//   }
// });

// function getCursorPosition () {
//   return new Promise((resolve, reject) => {
//     // 设置终端为 raw 模式，以便直接读取按键输入
//     const stdin = process.stdin;
//     stdin.setRawMode(true);
//     stdin.resume();
//     stdin.setEncoding('utf8');

//     // 定义处理输入的回调函数
//     const onData = (data: Buffer) => {
//       // ANSI CPR 响应格式通常为 \x1b[y;xR
//       const match = /\[(\d+);(\d+)R/.exec(data.toString());
//       if (match) {
//         const row = parseInt(match[1], 10);
//         const col = parseInt(match[2], 10);

//         // 恢复终端状态
//         stdin.removeListener('data', onData);
//         stdin.setRawMode(false);
//         stdin.pause();

//         resolve({ row, col });
//       }
//     };

//     // 监听标准输入
//     stdin.on('data', onData);

//     // 发送查询光标位置的 ANSI 转义序列 \x1b[6n
//     process.stdout.write('\x1b[6n');
//   });
// }

// async function wait (ms: number) {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目目录 */
const PROJECTS_PATH = path.resolve(__dirname, '..', '..');

/** 查找 npx */
async function findNpx() {
  // windows
  if (os.platform() === 'win32') {
    // where.exe npx
    const whereNpx = spawn('where.exe', ['npx']);
    let npxPath = '';
    for await (const chunk of whereNpx.stdout) {
      npxPath += chunk;
    }
    return npxPath.split(os.EOL)[0].trim() + '.cmd';
  } else if (os.platform() === 'linux' || os.platform() === 'darwin') {
    // linux 和 macOS
    const whichNpx = spawn('which', ['npx']);
    let npxPath = '';
    for await (const chunk of whichNpx.stdout) {
      npxPath += chunk;
    }
    return npxPath.split(os.EOL)[0].trim();
  } else {
    return 'npx';
  }
}

async function main() {
  await buildWebIfNeeded(build, mode);
  // startProxy(mode, webHost, webPort);

  /** 连续快速服务器进程意外退出次数 */
  let consecutiveExitCount = 0;
  let timeoutId: NodeJS.Timeout | undefined = void 0;

  while (true) {
    const [error, child] = await tryCatch(async () =>
      spawn(
        await findNpx(),
        ['tsx', path.join(PROJECTS_PATH, 'server/index.ts'), `--mode=${mode}`],
        {
          stdio: ['pipe', 'inherit', 'inherit'],
          env: { ...process.env, FORCE_COLOR: '1' },
          shell: true,
        },
      ),
    );

    if (error) {
      console.error(
        `${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red('启动服务器失败:')}`,
        error,
      );
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
    };

    // 注意, 子进程内已经存在 restart 和 exit, 但是都是退出, 并没有重启的功能
    // 这里拦截 restart 负责重启服务器
    rl.on('line', (line) => {
      const trimmedLine = line.trim();
      if (trimmedLine === 'restart') {
        if (state.restarting) {
          console.log(
            `${chalk.gray('[')}${chalk.yellow('WARNING')}${chalk.gray(']')} ${chalk.yellow('正在等待服务器重启')}`,
          );
          return;
        }
        state.restarting = true;
        child.stdin.write(line + os.EOL);
      } else if (trimmedLine === 'exit') {
        if (state.exiting) {
          console.log(
            `${chalk.gray('[')}${chalk.yellow('WARNING')}${chalk.gray(']')} ${chalk.yellow('正在等待服务器退出, 强制退出请输入 q!')}`,
          );
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
    });

    // 监听子进程错误退出
    child.on('error', (err) => {
      console.error(
        `${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red('服务器进程发生错误:')}`,
        err,
      );
    });

    // 监听子进程退出
    child.on('exit', (code, signal) => {
      if (state.exiting) {
        console.log(
          `${chalk.gray('[')}${chalk.blue('INFO')}${chalk.gray(']')} ${chalk.green('服务器退出')}`,
        );
        resolve('exit');
      } else if (state.restarting) {
        console.log(
          `${chalk.gray('[')}${chalk.blue('INFO')}${chalk.gray(']')} ${chalk.green('服务器重启')}`,
        );
        resolve('restart');
      } else {
        console.error(
          `${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red(`服务器进程意外退出, 退出码: ${code}, 信号: ${signal}`)}`,
        );
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        consecutiveExitCount++;
        timeoutId = setTimeout(() => {
          consecutiveExitCount = 0;
        }, 5000);
        if (consecutiveExitCount >= 3) {
          console.error(
            `${chalk.gray('[')}${chalk.red('ERROR')}${chalk.gray(']')} ${chalk.red('服务器连续快速退出超过 3 次, 请检查代码或配置是否有误')}`,
          );
          resolve('exit');
        }
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
  //
}
