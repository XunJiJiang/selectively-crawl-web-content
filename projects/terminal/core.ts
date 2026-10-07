import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isPackaged, SERVER_ROOT, ROOT } from '../server/common/paths.ts';
import { Peer } from './peer.ts';

export interface CoreOptions {
  execPath?: string;
  args: string[];
  entry?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  useTsx?: boolean;
}
export class CoreConnection extends EventEmitter {
  private child?: ChildProcess;
  peer?: Peer;
  private ready?: ReturnType<typeof Promise.withResolvers<void>>;
  private startupTimer?: NodeJS.Timeout;
  private starting = false;
  readonly options: CoreOptions;
  constructor(options: CoreOptions) {
    super();
    this.options = options;
  }
  async start(outputWindowId: string) {
    if (this.child) {
      throw new Error('核心已经启动');
    }
    const entry =
      this.options.entry ??
      (isPackaged ? path.join(SERVER_ROOT, 'core.cjs') : path.join(SERVER_ROOT, 'index.ts'));
    const child = fork(entry, [...this.options.args, '--interaction=ipc'], {
      execPath: this.options.execPath ?? process.execPath,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
      detached: process.platform !== 'win32',
      cwd: this.options.cwd ?? process.cwd(),
      env: this.options.env ?? process.env,
      execArgv: isPackaged
        ? []
        : this.options.useTsx
          ? ['--import', createRequire(path.join(ROOT, 'package.json')).resolve('tsx')]
          : [],
    });
    this.child = child;
    this.ready = Promise.withResolvers<void>();
    this.starting = true;
    const peer = new Peer((packet, callback) => {
      if (child.connected) {
        child.send(packet, callback);
      } else {
        callback(new Error('核心进程已断开'));
      }
    });
    this.peer = peer;
    child.on('message', (message) => peer.receive(message));
    peer.onEvent = (event, data) => {
      if (event === 'confirmation.request') {
        clearTimeout(this.startupTimer);
      }
      if (event === 'ready') {
        this.ready?.resolve();
      }
      this.emit(event, data);
    };
    child.stdout?.on('data', (chunk) =>
      this.emit('output', { windowId: outputWindowId, text: chunk.toString() }),
    );
    child.stderr?.on('data', (chunk) =>
      this.emit('output', { windowId: outputWindowId, text: chunk.toString() }),
    );
    child.once('error', (error) => {
      this.ready?.reject(error);
      this.emit('failure', error);
    });
    child.once('close', (code, signal) => {
      peer.close();
      this.child = undefined;
      this.peer = undefined;
      this.ready?.reject(new Error(`核心退出：${code ?? signal}`));
      this.emit('closed', { code, signal });
    });
    this.startupTimer = setTimeout(() => this.ready?.reject(new Error('核心启动超时')), 45000);
    try {
      await peer.call('hello', { outputWindowId });
      await this.ready.promise;
    } finally {
      clearTimeout(this.startupTimer);
      this.starting = false;
    }
  }
  call<T = unknown>(method: string, args?: unknown, timeout?: number): Promise<T> {
    if (method === 'confirmation.answer' && this.starting) {
      this.startupTimer = setTimeout(() => this.ready?.reject(new Error('核心启动超时')), 45000);
    }
    if (!this.peer) {
      return Promise.reject(new Error('核心尚未就绪'));
    }
    return this.peer.call<T>(method, args, timeout);
  }
  async kill() {
    const child = this.child;
    if (!child) {
      return;
    }
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
  }
  async waitClosed(timeout = 10000) {
    const child = this.child;
    if (!child) {
      return;
    }
    await Promise.race([
      once(child, 'close'),
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          void this.kill().then(() => resolve());
        }, timeout);
        child.once('close', () => clearTimeout(timer));
      }),
    ]);
  }
}
