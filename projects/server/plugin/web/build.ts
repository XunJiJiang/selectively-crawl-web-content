import fs from 'node:fs/promises';
import path from 'node:path';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { ROOT, SERVER_ROOT, isPackaged } from '../../common/paths.ts';
import { colorEnvironment } from '../../common/color.ts';
import { parseWebBuildScript } from './options.ts';
import type { TLogger } from '../../types/log.d.ts';

const pending = new Map<string, Promise<void>>();
const controllers = new Set<AbortController>();
let queue: Promise<void> = Promise.resolve();
let stopping = false;

function kill(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).once(
      'error',
      () => child.kill('SIGKILL'),
    );
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function cancelPluginWebBuilds(): void {
  stopping = true;
  for (const controller of controllers) {
    controller.abort(new Error('核心正在退出，已取消页面构建'));
  }
}

export async function buildPluginWeb(
  directory: string,
  logger: TLogger,
  options: { expectedEntry?: string; signal?: AbortSignal } = {},
): Promise<void> {
  if (stopping) {
    throw new Error('核心正在退出，无法开始新的页面构建');
  }
  directory = path.resolve(directory);
  const existing = pending.get(directory);
  if (existing) {
    return existing;
  }
  const controller = new AbortController();
  controllers.add(controller);
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abort();
  } else {
    options.signal?.addEventListener('abort', abort, { once: true });
  }
  const run = queue
    .catch(() => undefined)
    .then(async () => {
      controller.signal.throwIfAborted();
      const metadata = JSON.parse(
        await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
      ) as { scripts?: Record<string, string> };
      const parsed = parseWebBuildScript(metadata.scripts?.['build:web'], directory);
      logger.info(`正在构建插件页面：${path.basename(directory)}`);
      const child = fork(
        isPackaged
          ? path.join(SERVER_ROOT, 'web-build-host.cjs')
          : path.join(ROOT, 'projects/server/plugin/web/host.ts'),
        isPackaged ? ['--scwc-web-build-host'] : [],
        {
          cwd: directory,
          execArgv: [],
          env: colorEnvironment(process.env),
          serialization: 'advanced',
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          detached: process.platform !== 'win32',
        },
      );
      await new Promise<void>((resolve, reject) => {
        let stderr = '';
        const stop = () => kill(child);
        const exit = () => kill(child);
        const timeout = setTimeout(
          () => controller.abort(new Error('页面构建超过 5 分钟')),
          300_000,
        );
        controller.signal.addEventListener('abort', stop, { once: true });
        process.once('exit', exit);
        child.stdout?.on('data', (chunk) => logger.info(String(chunk).trimEnd()));
        child.stderr?.on('data', (chunk) => {
          stderr = (stderr + String(chunk)).slice(-16_000);
          logger.warn(String(chunk).trimEnd());
        });
        const cleanup = () => {
          clearTimeout(timeout);
          controller.signal.removeEventListener('abort', stop);
          process.off('exit', exit);
        };
        child.once('error', (error) => {
          cleanup();
          reject(error);
        });
        child.once('exit', (code) => {
          cleanup();
          if (controller.signal.aborted) {
            reject(controller.signal.reason);
          } else if (code !== 0) {
            reject(new Error(`插件页面构建失败 (${code})：${stderr}`));
          } else {
            resolve();
          }
        });
        if (controller.signal.aborted) {
          stop();
        } else {
          child.send({ directory, options: parsed, expectedEntry: options.expectedEntry });
        }
      });
      logger.info(`插件页面构建完成：${path.basename(directory)}`);
    });
  queue = run;
  pending.set(directory, run);
  try {
    await run;
  } finally {
    pending.delete(directory);
    controllers.delete(controller);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function preparePluginWeb(
  directory: string,
  entryFile: string,
  entry: string,
  logger: TLogger,
  signal?: AbortSignal,
): Promise<void> {
  const expectedEntry = path.resolve(path.dirname(entryFile), entry);
  if (
    await fs.stat(expectedEntry).then(
      (stat) => stat.isFile(),
      () => false,
    )
  ) {
    return;
  }
  await buildPluginWeb(directory, logger, { expectedEntry, signal });
}

export async function ensurePluginWeb(
  directory: string,
  entryFile: string,
  handler: SCWC.IHostedPluginHandler,
  logger: TLogger,
): Promise<void> {
  const entry = handler.ui?.entry;
  if (!entry) {
    return;
  }
  await preparePluginWeb(directory, entryFile, entry, logger);
  // Replace any missing/old initial HTML snapshot before registering routes.
  await handler.ui?.html?.();
}
