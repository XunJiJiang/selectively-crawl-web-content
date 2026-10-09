import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
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

import type { Loaded, CommandConflict, ConflictChoice, PluginPreferences } from './types.d.ts';

export class TerminalPlugins extends EventEmitter {
  readonly registry = new TaskRegistry();
  private loaded: Loaded[] = [];
  private commands = new Map<string, { plugin: Loaded; name: string }>();
  private outputId: string | null = null;
  private coreCommands: CommandInfo[] = [];
  private mutation = Promise.resolve();
  preferences: PluginPreferences = {};
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
    let entries: { name: string; directory?: string; builtin?: boolean; isDirectory(): boolean }[];
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
      {
        name: 'scwc',
        directory: path.join(ROOT, 'projects/terminal/plugins/scwc'),
        builtin: true,
        isDirectory: () => true,
      },
      ...entries
        .filter(
          (entry) =>
            path.resolve(directory, entry.name) !==
            path.join(ROOT, 'projects/terminal/plugins/scwc'),
        )
        .sort((first, second) => first.name.localeCompare(second.name)),
    ];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        this.loaded.some(
          (plugin) =>
            plugin.directory ===
              path.resolve(entry.directory ?? path.join(directory, entry.name)) &&
            !plugin.discarded,
        )
      ) {
        continue;
      }
      let child: ChildProcess | undefined;
      try {
        const builtin = entry.builtin === true;
        const pluginDirectory = path.resolve(entry.directory ?? path.join(directory, entry.name));
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
        const manifest = await peer.call<{ identifier?: string; commands: CommandInfo[] }>(
          'hello',
          {
            entry: builtin && isPackaged ? undefined : path.resolve(pluginDirectory, pkg.main),
            pluginId: entry.name,
            outputId,
            commands: this.coreCommands,
          },
        );
        const infos = manifest.commands;
        const signature = createHash('sha256')
          .update(
            JSON.stringify({
              directory: pluginDirectory,
              entry: pkg.main,
              identifier: manifest.identifier ?? entry.name,
              commands: infos
                .map(({ name, scope }) => [name, scope ?? 'command'])
                .sort(([first], [second]) => first.localeCompare(second)),
            }),
          )
          .digest('hex');
        const loaded: Loaded = {
          id: entry.name,
          directory: pluginDirectory,
          identifier: this.preferences[signature]?.identifier ?? manifest.identifier ?? entry.name,
          signature,
          owner,
          peer,
          child: processChild,
          closed,
          commands: infos,
          prefixed: false,
          hadConflict: false,
          discarded: false,
          published: false,
        };
        this.loaded.push(loaded);
        if (this.preferences[signature]?.policy === 'discard') {
          await this.discard(loaded);
        }
      } catch (error) {
        child?.kill('SIGKILL');
        this.emit('output', {
          windowId: outputId,
          text: `终端插件 ${entry.name} 加载失败：${error}`,
        });
      }
    }
    await this.resolveIdentifiers();
    await this.resolveCommands();
    for (const plugin of this.active()) {
      await plugin.peer.call('identifier.set', { identifier: plugin.identifier });
      plugin.published = true;
    }
    this.rebuild();
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
      await this.resolveIdentifiers();
      await this.resolveCommands();
      this.rebuild();
    });
  }
  private active() {
    return this.loaded.filter((plugin) => !plugin.discarded && plugin.child.exitCode === null);
  }
  private label(plugin: Loaded) {
    return `${plugin.id} (${plugin.directory})`;
  }
  private identity(plugin: Loaded) {
    return { kind: 'plugin' as const, id: plugin.id, label: this.label(plugin) };
  }
  private remember(plugin: Loaded, policy?: 'prefix' | 'plain' | 'discard') {
    this.preferences[plugin.signature] = { policy, identifier: plugin.identifier };
    this.emit('preferences');
  }
  private async decision(conflict: CommandConflict) {
    if (!this.resolveConflict) {
      throw new Error(`插件 ${conflict.second.id} 冲突，需要交互裁决后才能加载`);
    }
    const choice = await this.resolveConflict(conflict);
    const allowed =
      conflict.kind === 'identifier'
        ? ['a', 'b', 'c', 'd', 'e']
        : conflict.kind === 'cleared' || conflict.first.kind === 'system'
          ? ['a', 'b']
          : ['a', 'b', 'c'];
    if (!allowed.includes(choice)) {
      throw new Error('无效的插件冲突裁决');
    }
    return choice;
  }
  private identifierError(value: string, plugin: Loaded, extra?: string) {
    if (!value || !/^[^\s:/\\\x00-\x1f\x7f]+$/u.test(value)) {
      return '标识不能包含空白、冒号、路径分隔符或控制字符';
    }
    if (value.length > 64) {
      return '标识不能超过64个字符';
    }
    if (
      value === extra ||
      this.active().some((item) => item !== plugin && item.identifier === value)
    ) {
      return `标识 ${value} 已被占用`;
    }
    return undefined;
  }
  private async resolveIdentifiers() {
    const plugins = [...this.active()];
    for (let index = 0; index < plugins.length; index++) {
      const first = plugins[index];
      if (first.discarded) {
        continue;
      }
      for (const second of plugins.slice(index + 1)) {
        if (first.discarded) {
          break;
        }
        if (second.discarded || first.identifier !== second.identifier) {
          continue;
        }
        const conflict: CommandConflict = {
          kind: 'identifier',
          names: [],
          identifier: first.identifier,
          first: this.identity(first),
          second: this.identity(second),
          identifiers: {},
          checkIdentifier: (value, participant) =>
            this.identifierError(
              value,
              participant === 'first' ? first : second,
              participant === 'first' ? conflict.identifiers?.second : conflict.identifiers?.first,
            ),
        };
        const choice = await this.decision(conflict);
        if (choice === 'd') {
          this.remember(first, 'discard');
          await this.discard(first);
          break;
        }
        if (choice === 'e') {
          this.remember(second, 'discard');
          await this.discard(second);
          continue;
        }
        const changes: [Loaded, string | undefined][] =
          choice === 'a'
            ? [[second, conflict.identifiers?.second]]
            : choice === 'b'
              ? [[first, conflict.identifiers?.first]]
              : [
                  [first, conflict.identifiers?.first],
                  [second, conflict.identifiers?.second],
                ];
        for (const [plugin, identifier] of changes) {
          if (!identifier || this.identifierError(identifier, plugin)) {
            throw new Error('自定义标识未填写或已被占用');
          }
        }
        if (changes.length === 2 && changes[0][1] === changes[1][1]) {
          throw new Error('两个插件不能使用相同标识');
        }
        for (const [plugin, identifier] of changes) {
          if (!identifier) {
            continue;
          }
          plugin.identifier = identifier;
          this.remember(plugin, this.preferences[plugin.signature]?.policy);
        }
      }
    }
  }
  private async resolveCommands() {
    const plugins = this.active();
    const systemNames = new Set([
      ...reservedCommands,
      ...this.coreCommands.map(({ name }) => name),
    ]);
    for (const plugin of plugins) {
      plugin.prefixed = this.preferences[plugin.signature]?.policy === 'prefix';
      plugin.hadConflict = plugin.commands.some(
        ({ name }) =>
          systemNames.has(name) ||
          plugins.some(
            (other) => other !== plugin && other.commands.some((command) => command.name === name),
          ),
      );
    }
    for (const plugin of plugins) {
      if (plugin.discarded || plugin.prefixed) {
        continue;
      }
      try {
        const systems = plugin.commands
          .map(({ name }) => name)
          .filter((name) => systemNames.has(name));
        if (systems.length) {
          const choice = await this.decision({
            kind: 'commands',
            names: systems,
            first: { kind: 'system', id: '内置命令', label: '终端内建及SCWC核心服务' },
            second: this.identity(plugin),
          });
          if (choice === 'b') {
            this.remember(plugin, 'discard');
            await this.discard(plugin);
            continue;
          }
          this.addPrefix(plugin);
          continue;
        }
        for (const other of plugins) {
          if (other === plugin || other.discarded || other.prefixed) {
            continue;
          }
          const names = plugin.commands
            .map(({ name }) => name)
            .filter((name) => other.commands.some((command) => command.name === name));
          if (!names.length) {
            continue;
          }
          const choice = await this.decision({
            kind: 'commands',
            names,
            first: this.identity(other),
            second: this.identity(plugin),
          });
          if (choice === 'a') {
            this.addPrefix(plugin);
            break;
          }
          if (choice === 'b') {
            this.remember(plugin, 'discard');
            await this.discard(plugin);
            break;
          }
          this.remember(other, 'discard');
          await this.discard(other);
        }
        if (
          !plugin.discarded &&
          !plugin.prefixed &&
          plugin.hadConflict &&
          this.preferences[plugin.signature]?.policy !== 'plain'
        ) {
          const choice = await this.decision({
            kind: 'cleared',
            names: [],
            first: { kind: 'system', id: '已解除的冲突', label: '其他插件已添加标识前缀或卸载' },
            second: this.identity(plugin),
          });
          if (choice === 'a') {
            this.addPrefix(plugin);
          } else {
            this.remember(plugin, 'plain');
          }
        }
      } catch (error) {
        await this.discard(plugin);
        this.notice(
          `插件 ${plugin.id} 冲突未裁决：${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }
  private addPrefix(plugin: Loaded) {
    plugin.prefixed = true;
    this.remember(plugin, 'prefix');
    this.notice(`插件 ${plugin.id} 的全部命令使用标识前缀 ${plugin.identifier}`);
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
        const name = plugin.prefixed ? `${plugin.identifier}:${command.name}` : command.name;
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
