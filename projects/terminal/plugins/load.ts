import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Peer } from '../peer.ts';
import { isPackaged, ROOT, SERVER_ROOT } from '../../server/common/paths.ts';
import { TaskRegistry } from '../../server/common/tasks.ts';
import { inputReply } from '../../server/common/interaction.ts';
import { colorEnvironment } from '../../server/common/color.ts';
import type { InputRequest, InvocationIdentity, TaskSnapshot } from '../../server/types/task.d.ts';
import type { OutputEvent, CommandInfo } from '../protocol.ts';

interface Loaded {
  id: string;
  owner: string;
  peer: Peer;
  child: ChildProcess;
  closed: Promise<unknown>;
  commands: CommandInfo[];
}
export class TerminalPlugins extends EventEmitter {
  readonly registry = new TaskRegistry();
  private loaded: Loaded[] = [];
  private commands = new Map<string, { plugin: Loaded; name: string }>();
  private outputId: string | null = null;
  invokeCore?: (command: string, identity: InvocationIdentity) => Promise<void>;
  nextInput?: (request: InputRequest, signal: AbortSignal) => Promise<string>;
  async load(directory: string, outputId: string, coreCommands: CommandInfo[]) {
    this.outputId = outputId;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      let child: ChildProcess | undefined;
      try {
        const pkg = JSON.parse(
          await fs.readFile(path.join(directory, entry.name, 'package.json'), 'utf8'),
        );
        if (pkg.enabled === false) {
          continue;
        }
        if (typeof pkg.main !== 'string') {
          throw new Error('终端插件缺少 main');
        }
        const owner = `terminal-plugin:${randomUUID()}`;
        const host = isPackaged
          ? path.join(SERVER_ROOT, 'terminal-host.cjs')
          : path.join(ROOT, 'projects/terminal/plugins/host.ts');
        child = fork(host, isPackaged ? ['--scwc-terminal-plugin-host'] : [], {
          env: colorEnvironment(),
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          serialization: 'advanced',
          detached: process.platform !== 'win32',
          execArgv: [],
        });
        const processChild = child;
        const peer = new Peer((packet, callback) => {
          if (processChild.connected) {
            processChild.send(packet, callback);
          } else {
            callback(new Error('终端插件已停止'));
          }
        });
        const inputs = new Map<string, AbortController>();
        processChild.on('message', (message) => peer.receive(message));
        const closed = new Promise((resolve) =>
          processChild.once('close', () => {
            peer.close();
            for (const input of inputs.values()) {
              input.abort();
            }
            this.registry.removeOwner(owner);
            this.commands.forEach((item, key) => {
              if (item.plugin.owner === owner) {
                this.commands.delete(key);
              }
            });
            this.emit('failure', owner);
            resolve(undefined);
          }),
        );
        processChild.on('error', (error) =>
          this.emit('output', { windowId: outputId, text: error.message }),
        );
        for (const stream of [processChild.stdout, processChild.stderr]) {
          stream?.setEncoding('utf8');
          stream?.on('data', (chunk: string) => {
            const active = this.registry
              .list()
              .filter((item) => item.owner === owner && item.identity);
            const identity = active.length === 1 ? active[0].identity : undefined;
            this.emit('output', {
              windowId: identity?.windowId ?? outputId,
              executionId: identity?.executionId,
              text: chunk,
            });
          });
        }
        peer.onEvent = (event, value) => {
          if (event === 'input.cancel') {
            inputs.get((value as { id: string }).id)?.abort();
          }
          if (event === 'output') {
            this.emit('output', value as OutputEvent);
          }
          if (event === 'task') {
            this.registry.update(owner, value as TaskSnapshot);
            this.emit('task');
          }
        };
        peer.onCall = async (method, value) => {
          const nextInput = this.nextInput;
          if (method === 'input.next' && nextInput) {
            const request = value as InputRequest;
            const identity = this.registry
              .list()
              .find(
                (item) =>
                  item.owner === owner &&
                  item.identity?.executionId === request.identity?.executionId,
              )?.identity;
            if (
              !identity ||
              typeof request.id !== 'string' ||
              typeof request.message !== 'string' ||
              !['string', 'number', 'boolean', 'bigint', 'date'].includes(request.type)
            ) {
              throw new Error('输入请求没有活动命令');
            }
            const controller = new AbortController();
            inputs.set(request.id, controller);
            try {
              return await inputReply(
                () => nextInput({ ...request, identity }, controller.signal),
                controller.signal,
              );
            } finally {
              inputs.delete(request.id);
            }
          }
          if (method !== 'invokeCore' || !this.invokeCore) {
            throw new Error('核心子命令不可用');
          }
          const args = value as { command: string; identity: InvocationIdentity };
          return this.invokeCore(args.command, args.identity);
        };
        const infos = await peer.call<CommandInfo[]>('hello', {
          entry: path.resolve(directory, entry.name, pkg.main),
          pluginId: entry.name,
          outputId,
        });
        const loaded = {
          id: entry.name,
          owner,
          peer,
          child: processChild,
          closed,
          commands: infos,
        };
        this.loaded.push(loaded);
        for (const info of infos) {
          const reserved = [
            'exit',
            'restart',
            'help',
            'q',
            'w',
            'r',
            's',
            'c',
            'new',
            'run',
            'cancel',
            'close',
            'switch',
          ];
          let name = info.name;
          if (
            reserved.includes(name) ||
            this.commands.has(name) ||
            coreCommands.some((item) => item.name === name)
          ) {
            const previous = this.commands.get(name);
            if (previous) {
              this.commands.delete(name);
              this.commands.set(`${previous.plugin.id}:${previous.name}`, previous);
            }
            name = `${entry.name}:${name}`;
            this.emit('output', {
              windowId: outputId,
              text: `终端命令 ${info.name} 重名，使用 ${name}`,
            });
          }
          this.commands.set(name, { plugin: loaded, name: info.name });
        }
      } catch (error) {
        child?.kill('SIGKILL');
        this.emit('output', {
          windowId: outputId,
          text: `终端插件 ${entry.name} 加载失败：${error}`,
        });
      }
    }
  }
  list() {
    return [...this.commands].map(([name, item]) => ({
      name,
      description: item.plugin.commands.find((info) => info.name === item.name)?.description,
    }));
  }
  reconcile(coreCommands: CommandInfo[]) {
    for (const [name, entry] of [...this.commands]) {
      if (!name.includes(':') && coreCommands.some((command) => command.name === name)) {
        this.commands.delete(name);
        this.commands.set(`${entry.plugin.id}:${entry.name}`, entry);
        this.emit('output', {
          windowId: this.outputId,
          text: `核心命令 ${name} 已注册，终端插件命令改为 ${entry.plugin.id}:${entry.name}`,
        });
      }
    }
  }
  has(name: string) {
    return this.commands.has(name);
  }
  async execute(name: string, args: string[], identity: InvocationIdentity) {
    const command = this.commands.get(name);
    if (!command) {
      throw new Error('终端插件命令不可用');
    }
    const { plugin } = command;
    this.registry.update(plugin.owner, {
      id: identity.executionId,
      owner: plugin.owner,
      identity,
      busy: true,
      automatic: 1,
      manual: false,
      reported: 0,
      returned: false,
      revision: 0,
    });
    try {
      await plugin.peer.call(
        'execute',
        { name: command.name, args, identity },
        24 * 60 * 60 * 1000,
      );
    } catch (error) {
      if (!this.registry.busy(identity.executionId)) {
        throw error;
      }
      throw error;
    }
  }
  async cancel(executionId?: string, force = false) {
    for (const plugin of this.loaded) {
      if (plugin.child.exitCode === null) {
        void plugin.peer.call('cancel', { executionId }, 1000).catch(() => undefined);
      }
    }
    if (await this.registry.waitIdle(executionId, 2000)) {
      return true;
    }
    if (!force) {
      return false;
    }
    const owners = new Set(
      this.registry
        .list()
        .filter((item) => !executionId || item.identity?.executionId === executionId)
        .map((item) => item.owner),
    );
    await Promise.all(
      this.loaded.filter((item) => owners.has(item.owner)).map((item) => this.kill(item)),
    );
    return !this.registry.busy(executionId);
  }
  private async kill(plugin: Loaded) {
    if (plugin.child.exitCode !== null) {
      return;
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(plugin.child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.once('error', () => plugin.child.kill('SIGKILL'));
    } else {
      try {
        process.kill(-(plugin.child.pid ?? 0), 'SIGKILL');
      } catch {
        plugin.child.kill('SIGKILL');
      }
    }
    await plugin.closed;
  }
  async unload() {
    await Promise.all(
      this.loaded.map(async (item) => {
        if (item.child.exitCode === null) {
          try {
            await item.peer.call('unload', undefined, 2000);
          } catch {
            /* Deadline reached. */
          }
          await this.kill(item);
        }
      }),
    );
  }
}
