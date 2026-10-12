import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import {
  currentNodeInfo,
  loadDirectoryEnvironment,
  readBuildInfo,
  validateNode,
} from './node-runtime.ts';

/** Called from the bundled start.cjs; every child then inherits this exact Node runtime. */
export function startDirectory(directory: string, args = process.argv.slice(2)): void {
  const build = readBuildInfo(directory);
  if (args.length === 1 && args[0] === '--check-node') {
    validateNode(currentNodeInfo(), build);
    console.log(process.execPath);
    return;
  }
  loadDirectoryEnvironment(directory, process.env);
  const selected = process.env.SCWC_NODE_PATH?.trim();
  if (selected) {
    const requested = fs.realpathSync(path.resolve(directory, selected));
    if (requested !== fs.realpathSync(process.execPath)) {
      const probe = spawnSync(requested, [path.join(directory, 'start.cjs'), '--check-node'], {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      if (probe.error || probe.status !== 0) {
        throw new Error(`SCWC_NODE_PATH 不合规：${probe.error?.message ?? probe.stderr.trim()}`);
      }
      const executable = fs.realpathSync(probe.stdout.trim());
      if (executable !== fs.realpathSync(process.execPath)) {
        const child = spawn(executable, [path.join(directory, 'start.cjs'), ...args], {
          stdio: 'inherit',
          env: process.env,
        });
        const interrupt = () => {
          // Windows broadcasts console Ctrl+C to the inherited console already.
          if (process.platform !== 'win32') {
            child.kill('SIGINT');
          }
        };
        const terminate = () => child.kill('SIGTERM');
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        child.once('error', (error) => {
          console.error(error.message);
          process.exitCode = 1;
        });
        child.once('close', (code) => {
          process.off('SIGINT', interrupt);
          process.off('SIGTERM', terminate);
          process.exitCode = code ?? 1;
        });
        return;
      }
    }
  }
  validateNode(currentNodeInfo(), build);
  process.env.SCWC_DISTRIBUTION_MODE = 'node';
  process.env.SCWC_APP_DIR = directory;
  process.env.SCWC_RUNTIME_ROOT = path.join(directory, 'runtime');
  if (args.includes('--help')) {
    console.log(
      'SCWC Node 目录版\nnode start.cjs 默认启动多窗口终端\n--no-terminal 直接启动核心\n--build-plugin-web <插件目录> 使用内置 Vite 构建页面\n配置：读取 start.cjs 同目录 .env；SCWC_NODE_PATH 可指定 Node 路径。',
    );
    return;
  }
  const entry = args.includes('--scwc-web-build-host')
    ? 'web-build-host.cjs'
    : args.some((arg) => arg === '--build-plugin-web' || arg.startsWith('--build-plugin-web='))
      ? 'web-build-cli.cjs'
      : args.includes('--scwc-plugin-host')
        ? 'host.cjs'
        : args.includes('--scwc-terminal-plugin-host')
          ? 'terminal-host.cjs'
          : args.includes('--no-terminal')
            ? 'core.cjs'
            : 'terminal.cjs';
  createRequire(path.join(directory, 'start.cjs'))(path.join(directory, 'runtime', entry));
}

if (typeof require !== 'undefined' && require.main === module) {
  try {
    startDirectory(path.dirname(__filename));
  } catch (error) {
    console.error('SCWC 目录版启动失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
