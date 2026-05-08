import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
import stream from 'node:stream';

// TODO: 使用scripts项目中的参数解析工具
/** 解析参数 */
function parseArgs (): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value ?? 'true';
    }
  }
  return args;
}

function launchInteractiveTerminal () {
  const platform = os.platform();

  let terminal: string = '';
  let args: string[] = [];

  if (platform === 'win32') {
    terminal = 'cmd.exe';
    args = [];
  } else if (platform === 'darwin' || platform === 'linux') {
    terminal = 'bash';
    args = [];
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

  rl.on('line', input => {
    if (input === 'exit') {
      console.log('退出命令已输入');
      rl.close();
    } else {
      console.log(`你输入了: ${input}`);
    }
  });

  // rl.on('line', input => {
  //   if (terminalProcess.stdin) {
  //     console.log(`用户输入: ${input}`);
  //     terminalProcess.stdin.write(`${input}\n`);
  //   }
  // });

  terminalProcess.stdin.write('npx tsx server/index.ts\n');

  // 监听子进程的标准输出
  terminalProcess.stdout.on('data', data => {
    process.stdout.write(data); // 将子进程的输出直接写入主进程的 stdout
  });
}

const __filename = fileURLToPath(import.meta.url);
const __mainFilename = process.argv[1];
const isMain = __filename === __mainFilename;
if (isMain) {
  main();
} else {
}