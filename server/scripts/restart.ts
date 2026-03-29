/**
 * 重启脚本
 * 目前只支持使用能执行 ts 文件的运行时环境执行, 例如 ts-node、tsx、bun。
 */

import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 解析参数 */
function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value ?? 'true';
    }
  }
  return args;
}

/** 等待 */
async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 项目根路径 */
const PROJECT_ROOT_PATH = process.cwd();
/** 脚本相对路径 */
const RESTART_SCRIPT_RELATIVE_PATH = path.join('server', 'index.ts');
/** 脚本绝对路径 */
const RESTART_SCRIPT_PATH = path.join(PROJECT_ROOT_PATH, RESTART_SCRIPT_RELATIVE_PATH);

/** 检查环境 */
function checkEnvironment(
  runtime: string,
  version: string,
):
  | false
  | {
      runtime: string;
      // 前置命令, 例如 nvm use 16
      preCommand: string;
    } {
  // 目前只支持使用 package 中的 start 执行
  return {
    runtime: 'bun',
    preCommand: `cd ${PROJECT_ROOT_PATH}`,
  };
}

/** 执行启动 */
function runStartCommand(preCommand: string, runtime: string) {
  const command = `${preCommand} && ${runtime} start`;
  const child = spawn(command, {
    detached: true,
    stdio: 'inherit',
    shell: true,
  });
  child.unref();
}

/** 检查旧的进程是否仍在运行, 但是不kill旧的进程 */
function checkOldProcess(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ESRCH') {
      return false;
    } else {
      return true;
    }
  }
}

/** 循环检查 */
async function waitForOldProcessExit(pid: number, delay: number = 1000, defaultTimeout: number = 60000) {
  const startTime = Date.now();
  while (checkOldProcess(pid)) {
    console.log(`等待旧的进程 ${pid} 退出...`);
    await wait(delay);
    if (Date.now() - startTime > defaultTimeout) {
      console.error(`等待旧的进程 ${pid} 退出超时`);
      return false;
    }
  }
  return true;
}

function main() {
  const args = parseArgs();
  /** 运行时 */
  const runtime = args.runtime;
  /** 运行时版本 */
  const version = args.version;
  /** 旧的进程 ID */
  const pid = args.pid;

  // 检查 RESTART_SCRIPT_PATH 是否存在
  if (!fs.existsSync(RESTART_SCRIPT_PATH)) {
    console.error(`重启脚本 ${RESTART_SCRIPT_PATH} 不存在`);
    process.exit(1);
  }

  const envCheckResult = checkEnvironment(runtime, version);
  if (!envCheckResult) {
    console.error(`当前环境不满足重启要求: runtime=${runtime}, version=${version}`);
    process.exit(1);
  }

  const { preCommand, runtime: rt } = envCheckResult;
  if (pid) {
    waitForOldProcessExit(Number(pid)).then(done => {
      if (done) {
        runStartCommand(preCommand, rt);
      } else {
        console.error('旧的进程未能成功退出, 无法启动新的进程');
        process.exit(1);
      }
    });
  }
}

const __filename = fileURLToPath(import.meta.url);
const __mainFilename = process.argv[1];
const isMain = __filename === __mainFilename;
if (isMain) {
  main();
} else {
}
