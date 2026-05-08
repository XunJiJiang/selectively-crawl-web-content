import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
import stream from 'node:stream';
import { registerArg } from './parseArgs'

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

function launchInteractiveTerminal () {
  const platform = os.platform();

  let terminal: string = '';
  let args: string[] = [];

  if (platform === 'win32') {
    terminal = 'cmd.exe';
    args = [];
  } else if (platform === 'darwin' || platform === 'linux') {
    const truZsh = spawnSync('which', ['zsh'], { encoding: 'utf-8' }).stdout.trim();
    if (truZsh) {
      terminal = truZsh;
      args = [];
    } else {
      terminal = 'bash';
      args = [];
    }
  }

  const child = spawn(terminal, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  // 监听子进程的标准错误
  child.stderr.on('data', data => {
    process.stderr.write(data); // 将子进程的错误输出直接写入主进程的 stderr
  });

  child.on('close', code => {
    console.log(`终端关闭，退出码: ${code}`);
  });

  child.on('error', err => {
    console.error('启动终端失败:', err);
  });

  return child;
}

function main () {
  // 启动终端
  const terminalProcess = launchInteractiveTerminal();

  // 使用 readline 监听用户输入
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true, // 确保启用终端模式
  });

  let willRestart = false;
  let willExit = false;

  rl.on('line', input => {
    if (terminalProcess.stdin) {
      terminalProcess.stdin.write(`${input}\n`);
      if (input === 'restart') {
        willRestart = true;
      } else if (input === 'exit') {
        willExit = true;
      }
    }
  });

  terminalProcess.stdin.write('npx tsx server/index.ts\n');

  // 监听子进程的标准输出
  terminalProcess.stdout.on('data', data => {
    process.stdout.write(data); // 将子进程的输出直接写入主进程的 stdout

    if (data.toString().includes('服务重启')) {
      // 发送重启命令
      // 这是一种不安全的做法, 使用变量判断依旧不能确定是否能完全避免误触发
      if (willRestart) {
        willRestart = false;
        terminalProcess.stdin.write('npx tsx server/index.ts\n');
      }
    } else if (data.toString().includes('服务停止')) {
      if (willExit) {
        willExit = false;
        terminalProcess.kill();
        rl.close();
        process.exit(0);
      }
    }
  });
}

const __filename = fileURLToPath(import.meta.url);
const __mainFilename = process.argv[1];
const isMain = __filename === __mainFilename;
if (isMain) {
  main();
} else {
}