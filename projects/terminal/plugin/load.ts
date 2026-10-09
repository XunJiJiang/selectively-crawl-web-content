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
import { reservedCommands } from '../global.ts';
import type { InputRequest, InvocationIdentity, TaskSnapshot } from '../../server/types/task.d.ts';
import type { OutputEvent, CommandInfo } from '../protocol.ts';

import type { Loaded, CommandConflict, ConflictChoice } from './types.d.ts';

export class TerminalPlugins extends EventEmitter {
  readonly registry = new TaskRegistry();
  private loaded: Loaded[] = [];
  private commands = new Map<string, { plugin: Loaded; name: string }>();
  private outputId: string | null = null;
  private coreCommands: CommandInfo[] = [];
  private mutation = Promise.resolve();
  private decisions = new Set<string>();
  resolveConflict?: (conflict: CommandConflict) => Promise<ConflictChoice>;
  invokeCore?: (command: string, identity: InvocationIdentity) => Promise<void>;
  nextInput?: (request: InputRequest, signal: AbortSignal) => Promise<string>;
  load(directory: string, outputId: string, coreCommands: CommandInfo[]) {
    this.coreCommands = coreCommands;
    return this.enqueue(() => this.loadDirectory(directory, outputId));
  }
  private enqueue(action: () => Promise<void>) {
    const work = this.mutation.then(action);
    this.mutation = work.catch(() => undefined);
    return work;
  }
  private async loadDirectory(directory: string, outputId: string) {
    this.outputId = outputId;
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        entries = [];
      } else {
        throw error;
      }
    }
    // The bundled system adapter uses the same isolated host and registration contract.
    entries = [
      { name: 'scwc', isDirectory: () => true },
      ...entries
        .filter((entry) => entry.name !== 'scwc')
        .sort((first, second) => first.name.localeCompare(second.name)),
    ];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        this.loaded.some((plugin) => plugin.id === entry.name && !plugin.discarded)
      ) {
        continue;
      }
      let child: ChildProcess | undefined;
      try {
        const builtin = entry.name === 'scwc';
        const pluginDirectory = builtin
          ? path.join(ROOT, 'projects/terminal/plugins/scwc')
          : path.join(directory, entry.name);
        const pkg =
          builtin && isPackaged
            ? { main: 'index.ts' }
            : JSON.parse(await fs.readFile(path.join(pluginDirectory, 'package.json'), 'utf8'));
        if (pkg.enabled === false) {
          continue;
        }
        if (!builtin && typeof pkg.main !== 'string') {
          throw new Error('终端插件缺少 main');
        }
        const owner = `terminal-plugin:${randomUUID()}`;
        const host = isPackaged
          ? path.join(SERVER_ROOT, 'terminal-host.cjs')
          : path.join(ROOT, 'projects/terminal/plugin/host.ts');
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
            const plugin = this.loaded.find((item) => item.owner === owner);
            if (plugin) {
              plugin.discarded = true;
            }
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
          entry: builtin && isPackaged ? undefined : path.resolve(pluginDirectory, pkg.main),
          pluginId: entry.name,
          outputId,
          commands: this.coreCommands,
        });
        const loaded: Loaded = {
          id: entry.name,
          owner,
          peer,
          child: processChild,
          closed,
          commands: infos,
          prefixed: new Set(),
          discarded: false,
          published: false,
        };
        this.loaded.push(loaded);
        try {
          if (
            !(await this.resolveSystemConflicts(loaded)) ||
            !(await this.resolvePluginConflicts(loaded))
          ) {
            continue;
          }
          if (loaded.discarded || loaded.child.exitCode !== null) {
            continue;
          }
          loaded.published = true;
          this.rebuild();
        } catch (error) {
          await this.discard(loaded);
          throw error;
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
  list(scope: 'command' | 'global' = 'command') {
    return [...this.commands]
      .map(([name, item]) => ({
        ...item.plugin.commands.find((info) => info.name === item.name),
        name,
        usage: item.plugin.commands
          .find((info) => info.name === item.name)
          ?.usage?.replace(/^\S+/, name),
      }))
      .filter((item) => (item.scope ?? 'command') === scope);
  }
  reconcile(coreCommands: CommandInfo[]) {
    this.coreCommands = coreCommands;
    return this.enqueue(async () => {
      for (const plugin of [...this.loaded]) {
        if (plugin.published && !plugin.discarded) {
          try {
            await this.resolveSystemConflicts(plugin);
          } catch (error) {
            await this.discard(plugin);
            throw error;
          }
        }
      }
      this.rebuild();
    });
  }
  private async decision(conflict: CommandConflict) {
    if (!this.resolveConflict) {
      throw new Error(
        `命令 ${conflict.name} 冲突，需要交互裁决后才能加载插件 ${conflict.second.id}`,
      );
    }
    const choice = await this.resolveConflict(conflict);
    if (!['a', 'b', 'c'].includes(choice) || (conflict.first.kind !== 'plugin' && choice === 'c')) {
      throw new Error('无效的命令冲突裁决');
    }
    return choice;
  }
  private async resolveSystemConflicts(plugin: Loaded) {
    const systems = [
      ...reservedCommands.map((name) => ({ name, kind: 'terminal' as const, id: '终端内建命令' })),
      ...this.coreCommands.map(({ name }) => ({ name, kind: 'core' as const, id: 'SCWC核心服务' })),
    ];
    for (const command of plugin.commands) {
      for (const system of systems.filter((item) => item.name === command.name)) {
        if (plugin.discarded) {
          return false;
        }
        const key = `${plugin.owner}:${system.kind}:${command.name}`;
        if (this.decisions.has(key)) {
          continue;
        }
        const choice = await this.decision({
          name: command.name,
          first: system,
          second: { kind: 'plugin', id: plugin.id },
        });
        if (plugin.discarded) {
          return false;
        }
        if (choice === 'b') {
          await this.discard(plugin);
          return false;
        }
        plugin.prefixed.add(command.name);
        this.decisions.add(key);
        this.notice(
          `命令 ${command.name} 已裁决：插件 ${plugin.id} 使用 ${plugin.id}:${command.name}`,
        );
      }
    }
    return !plugin.discarded;
  }
  private async resolvePluginConflicts(plugin: Loaded) {
    for (const first of [...this.loaded]) {
      if (first === plugin || !first.published || first.discarded) {
        continue;
      }
      for (const command of plugin.commands) {
        if (plugin.discarded) {
          return false;
        }
        if (first.discarded) {
          break;
        }
        if (!first.commands.some((item) => item.name === command.name)) {
          continue;
        }
        const key = `${first.owner}:${plugin.owner}:${command.name}`;
        if (this.decisions.has(key)) {
          continue;
        }
        const choice = await this.decision({
          name: command.name,
          first: { kind: 'plugin', id: first.id },
          second: { kind: 'plugin', id: plugin.id },
        });
        if (plugin.discarded) {
          return false;
        }
        if (first.discarded) {
          break;
        }
        this.decisions.add(key);
        if (choice === 'b') {
          await this.discard(plugin);
          return false;
        }
        if (choice === 'c') {
          await this.discard(first);
          break;
        }
        first.prefixed.add(command.name);
        plugin.prefixed.add(command.name);
        this.notice(
          `命令 ${command.name} 已裁决：使用 ${first.id}:${command.name} 和 ${plugin.id}:${command.name}`,
        );
      }
    }
    return !plugin.discarded;
  }
  private notice(text: string) {
    this.emit('output', { windowId: this.outputId, text });
  }
  private rebuild() {
    this.commands.clear();
    for (const plugin of this.loaded) {
      if (!plugin.published || plugin.discarded) {
        continue;
      }
      for (const command of plugin.commands) {
        const name = plugin.prefixed.has(command.name)
          ? `${plugin.id}:${command.name}`
          : command.name;
        this.commands.set(name, { plugin, name: command.name });
      }
    }
    this.emit('commands');
  }
  private async discard(plugin: Loaded) {
    if (plugin.discarded) {
      return;
    }
    plugin.discarded = true;
    this.rebuild();
    try {
      await plugin.peer.call('unload', undefined, 2000);
    } catch {
      /* Stop an unresponsive host below. */
    }
    await this.kill(plugin);
    this.loaded = this.loaded.filter((item) => item !== plugin);
    this.notice(`已放弃加载插件 ${plugin.id}，其全部命令已移除`);
  }
  has(name: string, scope: 'command' | 'global' = 'command') {
    const item = this.commands.get(name);
    return Boolean(
      item &&
      (item.plugin.commands.find((info) => info.name === item.name)?.scope ?? 'command') === scope,
    );
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
