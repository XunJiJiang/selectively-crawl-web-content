import { randomUUID } from 'node:crypto';
import { TerminalModel, sanitizeOutput } from './model.ts';
import { Renderer } from './render.ts';
import { CoreConnection } from './core.ts';
import { TerminalPlugins } from './plugin/load.ts';
import { splitCommand } from '../server/utils/command.ts';
import { InvocationInputError } from '../server/common/interaction.ts';
import { colorLogText } from '../server/common/color.ts';
import type { CommandInfo, ExecutionEvent, OutputEvent } from './protocol.ts';
import type {
  InputFailure,
  InputRequest,
  TaskSnapshot,
  InvocationIdentity,
} from '../server/types/task.d.ts';
import type { Key } from './input.ts';
import type { CommandConflict, ConflictChoice } from './plugin/types.d.ts';

export class TerminalController {
  readonly model: TerminalModel;
  readonly renderer = new Renderer();
  readonly core: CoreConnection;
  readonly plugins = new TerminalPlugins();
  commands: CommandInfo[] = [];
  ready = false;
  private coreTasks: TaskSnapshot[] = [];
  private terminalExecutions = new Map<
    string,
    { event: ExecutionEvent; returned: boolean; error?: string }
  >();
  private finished = new Map<string, ExecutionEvent>();
  private activeCoreExecutions = new Map<string, ExecutionEvent>();
  private waiters = new Map<string, (event: ExecutionEvent) => void>();
  private expectedStop = false;
  private closing = false;
  private restarting = false;
  private retries = 0;
  private lastStart = 0;
  private retryTimer?: NodeJS.Timeout;
  private pending = false;
  private inputEnded = false;
  private interaction?: Promise<void>;
  private coreConfirmation?: TerminalModel['panel'];
  private panelExecutions = new Set<string>();
  private discardedPanelExecutions = new Set<string>();
  private globalExecutionId?: string;
  onChange?: () => void;
  onOutput?: (text: string) => void;
  onExit?: () => Promise<void>;
  onCopy?: (text: string) => Promise<void>;
  constructor(model: TerminalModel, core: CoreConnection) {
    this.model = model;
    this.plugins.preferences = model.pluginPreferences;
    this.core = core;
    core.on('output', (value: OutputEvent) => this.output(value));
    core.on('commands', (commands: CommandInfo[]) => {
      this.commands = commands;
      void this.plugins.reconcile(commands).catch((error) => this.error(error));
      this.changed();
    });
    core.on('ready', (value: { port: number; commands: CommandInfo[] }) => {
      this.ready = true;
      this.commands = value.commands;
      this.model.message = `服务端口 ${value.port}`;
      this.changed();
    });
    core.on('task.changed', (tasks: TaskSnapshot[]) => {
      this.coreTasks = tasks;
      this.changed();
    });
    core.on('input.request', (request: InputRequest) => {
      this.askInput(request, (value, error) =>
        core.call('input.answer', { id: request.id, value, error }),
      );
    });
    core.on('input.closed', (value: { id: string; windowId: string }) => {
      const window = this.model.byId(value.windowId);
      if (window?.input?.id === value.id) {
        window.input = undefined;
      }
      this.changed();
    });
    for (const name of ['command.started', 'command.returned', 'command.finished']) {
      core.on(name, (event: ExecutionEvent) => {
        if (name === 'command.started') {
          this.activeCoreExecutions.set(event.executionId, event);
        }
        if (name === 'command.finished') {
          this.activeCoreExecutions.delete(event.executionId);
        }
        if (name === 'command.returned' && event.error) {
          this.output({
            windowId: event.windowId,
            executionId: event.executionId,
            text: `命令函数失败：${event.error}`,
          });
        }
        if (name !== 'command.returned' || event.status === 'background') {
          this.execution(event, name === 'command.finished');
        }
      });
    }
    core.on('confirmation.request', (value: { id: string; text: string }) => {
      void this.interact('配置确认', async () => {
        this.coreConfirmation = this.model.panel;
        try {
          const answer = await this.confirm(value.text);
          await core.call('confirmation.answer', { id: value.id, answer });
        } finally {
          this.coreConfirmation = undefined;
        }
      }).catch((error) => this.error(error));
    });
    core.on('lifecycle.request', (value: { restart: boolean }) => {
      void this.lifecycle(value.restart).catch((error) => this.error(error));
    });
    core.on('failure', (error) => this.error(error));
    core.on('closed', () => {
      this.ready = false;
      this.coreTasks = [];
      for (const event of this.activeCoreExecutions.values()) {
        this.execution({ ...event, status: 'interrupted', error: '核心进程已停止' }, true);
      }
      this.activeCoreExecutions.clear();
      for (const window of this.model.windows) {
        if (window.task && !this.terminalExecutions.has(window.task.executionId)) {
          this.execution({ ...window.task, status: 'interrupted', error: '核心进程已停止' }, true);
        }
      }
      if (this.coreConfirmation && this.model.panel === this.coreConfirmation) {
        this.model.cancelPanelInput('closed');
      }
      this.changed();
      if (!this.expectedStop && !this.closing) {
        if (Date.now() - this.lastStart > 5000) {
          this.retries = 0;
        }
        if (++this.retries <= 3) {
          this.retryTimer = setTimeout(
            () => {
              void this.start().catch((error) => this.error(error));
            },
            500 * 2 ** (this.retries - 1),
          );
        } else {
          this.error('核心连续启动失败，可检查配置后使用 :r 重启');
        }
      }
    });
    this.plugins.on('commands', () => this.changed());
    this.plugins.on('preferences', () => this.changed());
    this.plugins.resolveConflict = (conflict) => this.resolvePluginConflict(conflict);
    this.plugins.on('output', (value: OutputEvent) => this.output(value));
    this.plugins.on('task', () => this.updateTerminalExecutions());
    this.plugins.on('failure', () => this.updateTerminalExecutions());
    this.plugins.nextInput = (request, signal) =>
      new Promise((resolve, reject) => {
        if (this.panelExecutions.has(request.identity.executionId)) {
          const abort = () => this.model.cancelPanelInput();
          if (signal.aborted) {
            reject(new InvocationInputError('cancelled', '输入已取消'));
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
          void this.model.next(request.message).then(([error, value]) => {
            signal.removeEventListener('abort', abort);
            if (error) {
              reject(error);
            } else {
              resolve(value ?? '');
            }
            this.changed();
          });
          this.changed();
          return;
        }
        const abort = () => {
          const window = this.model.byId(request.identity.windowId ?? '');
          if (window?.input?.id === request.id) {
            window.input = undefined;
          }
          reject(new InvocationInputError('cancelled', '输入已取消'));
          this.changed();
        };
        signal.addEventListener('abort', abort, { once: true });
        this.askInput(request, async (value, error) => {
          signal.removeEventListener('abort', abort);
          if (error) {
            reject(
              new InvocationInputError(
                error === 'eof' ? 'closed' : error,
                error === 'eof'
                  ? '输入流已关闭'
                  : error === 'busy'
                    ? '当前窗口正在等待其他输入'
                    : '用户取消输入',
              ),
            );
          } else {
            resolve(value ?? '');
          }
        });
      });
    this.plugins.registry.on(
      'owner.stop',
      ({ identities }: { identities: { executionId: string }[] }) => {
        for (const record of this.terminalExecutions.values()) {
          if (identities.some((identity) => identity.executionId === record.event.executionId)) {
            record.event.status = 'interrupted';
            record.error = '终端插件宿主停止';
          }
        }
      },
    );
    this.plugins.invokeCore = async (command, parent) => {
      if (['exit', 'restart'].includes(splitCommand(command)[0])) {
        throw new Error('终端插件子命令不能直接退出或重启核心');
      }
      const executionId = randomUUID();
      if (this.panelExecutions.has(parent.executionId)) {
        this.panelExecutions.add(executionId);
      }
      const accepted = await this.core.call<{ control?: boolean }>('command.execute', {
        command,
        windowId: parent.windowId,
        executionId,
        parentExecutionId: parent.executionId,
      });
      if (accepted.control) {
        throw new Error('终端插件不能通过子命令直接执行生命周期操作');
      }
      const event =
        this.finished.get(executionId) ??
        (await new Promise<ExecutionEvent>((resolve) => this.waiters.set(executionId, resolve)));
      if (event.status !== 'succeeded') {
        throw new Error(event.error ?? `核心子命令 ${event.status}`);
      }
    };
  }
  async start() {
    this.expectedStop = false;
    this.lastStart = Date.now();
    await this.core.start(this.model.output.id);
  }
  private changed() {
    this.model.commands = [...this.commands, ...this.plugins.list()];
    this.model.globalExtensions = this.plugins.list('global').map((item) => ({
      name: item.name,
      description: item.description ?? '',
      usage: item.usage ?? item.name,
    }));
    this.onChange?.();
  }
  private async resolvePluginConflict(conflict: CommandConflict): Promise<ConflictChoice> {
    if (this.inputEnded) {
      throw new InvocationInputError('closed', '输入流已关闭');
    }
    if (this.model.panel?.running) {
      await this.interaction;
    }
    let choice: ConflictChoice | undefined;
    await this.interact(
      conflict.kind === 'identifier' ? '插件标识冲突' : '插件命令冲突',
      async () => {
        const plugins = conflict.first.kind === 'plugin';
        const identifier = conflict.kind === 'identifier';
        const prompt = identifier
          ? `标识 "${conflict.identifier}" 冲突：\n第一个：${conflict.first.label}\n第二个：${conflict.second.label}\n:a 保留第一个，为第二个自定义标识\n:b 保留第二个，为第一个自定义标识\n:c 两个都自定义标识\n:d 卸载第一个插件\n:e 卸载第二个插件`
          : conflict.kind === 'cleared'
            ? `插件 ${conflict.second.label} 曾有命令冲突，其他插件已加前缀或卸载，现已无冲突\n:a 为这个插件全部命令添加标识前缀\n:b 不添加前缀`
            : `插件 ${conflict.second.label} 与 ${conflict.first.label} 的全部冲突命令：\n${conflict.names.join('、')}\n:a 为当前插件 ${conflict.second.id} 的全部命令添加标识前缀\n:b ${plugins ? `保留 ${conflict.first.id}，卸载当前插件` : '卸载当前插件'}${plugins ? `\n:c 保留当前插件，卸载 ${conflict.first.id}` : ''}`;
        const allowed: ConflictChoice[] = identifier
          ? ['a', 'b', 'c', 'd', 'e']
          : plugins
            ? ['a', 'b', 'c']
            : ['a', 'b'];
        let text = prompt;
        for (;;) {
          const [error, answer] = await this.model.nextChoice(text);
          if (error) {
            throw error;
          }
          const value = answer.trim().slice(1) as ConflictChoice;
          if (answer.trim() === ':' + value && allowed.includes(value)) {
            choice = value;
            break;
          }
          text = `请输入 ${allowed.map((item) => ':' + item).join('、')} 后按 Enter\n${prompt}`;
        }
        if (identifier && choice && ['a', 'b', 'c'].includes(choice)) {
          const participants: ('first' | 'second')[] =
            choice === 'a' ? ['second'] : choice === 'b' ? ['first'] : ['first', 'second'];
          for (const participant of participants) {
            let message = `为${participant === 'first' ? '第一个' : '第二个'}插件 ${conflict[participant].label} 输入新简短标识`;
            for (;;) {
              const [error, value] = await this.model.next(message);
              if (error) {
                throw error;
              }
              const identifier = value.trim();
              const failure = conflict.checkIdentifier?.(identifier, participant);
              if (failure) {
                message = `${failure}\n请输入另一个简短标识`;
                continue;
              }
              if (conflict.identifiers) {
                conflict.identifiers[participant] = identifier;
              }
              break;
            }
          }
        }
      },
    );
    await this.interaction;
    if (!choice) {
      throw new Error('插件冲突未裁决，已取消加载');
    }
    return choice;
  }
  private askInput(
    request: InputRequest,
    answer: (value?: string, error?: InputFailure) => Promise<unknown>,
  ) {
    if (this.panelExecutions.has(request.identity.executionId)) {
      void this.model.next(request.message).then(async ([error, value]) => {
        await answer(
          value,
          error
            ? error.code === 'busy'
              ? 'busy'
              : error.code === 'cancelled'
                ? 'cancelled'
                : 'eof'
            : undefined,
        ).catch((failure) => this.error(failure));
        this.changed();
      });
      this.changed();
      return;
    }
    const window = this.model.byId(request.identity.windowId ?? '');
    if (!window || this.inputEnded) {
      void answer(undefined, 'eof').catch((error) => this.error(error));
      return;
    }
    if (window.input) {
      void answer(undefined, 'busy').catch((error) => this.error(error));
      return;
    }
    window.input = {
      ...request,
      draft: '',
      cursor: 0,
      answer: async (value, error) => {
        await answer(value, error);
      },
    };
    this.output({
      windowId: window.id,
      executionId: request.identity.executionId,
      text: request.message,
    });
  }
  async endInput() {
    if (this.inputEnded) {
      return;
    }
    this.inputEnded = true;
    this.model.cancelPanelInput('closed');
    await Promise.all(
      this.model.windows.map(async (window) => {
        const input = window.input;
        if (input) {
          window.input = undefined;
          await input.answer(undefined, 'eof').catch((error) => this.error(error));
        }
      }),
    );
    this.changed();
  }
  private async answerInput(value: string) {
    const window = this.model.active;
    const input = window.input;
    if (!input) {
      return;
    }
    window.input = undefined;
    await input.answer(value);
    this.changed();
  }
  async cancelInput() {
    const window = this.model.active;
    const input = window.input;
    if (!input) {
      return false;
    }
    window.input = undefined;
    await input.answer(undefined, 'cancelled');
    this.changed();
    return true;
  }
  private error(error: unknown) {
    this.model.message = error instanceof Error ? error.message : String(error);
    this.output({ windowId: this.model.output.id, text: this.model.message });
  }
  output(value: OutputEvent) {
    if (value.executionId && this.discardedPanelExecutions.has(value.executionId)) {
      return;
    }
    const text = colorLogText(value.text, value.level);
    if (value.executionId && this.panelExecutions.has(value.executionId) && this.model.panel) {
      this.panelOutput(text);
      return;
    }
    this.model.append({ ...value, text });
    this.onOutput?.(sanitizeOutput(text));
    this.changed();
  }
  private execution(event: ExecutionEvent, done: boolean) {
    if (event.executionId && event.windowId) {
      // Child executions share output but never replace the parent window's title.
      const parent = this.model.byId(event.windowId)?.task;
      if (!parent || parent.executionId === event.executionId) {
        this.model.execution(event);
      }
      if (done) {
        this.finished.set(event.executionId, event);
        this.waiters.get(event.executionId)?.(event);
        this.waiters.delete(event.executionId);
      }
      if (this.finished.size > 4096) {
        const key = this.finished.keys().next().value;
        if (key) {
          this.finished.delete(key);
        }
      }
    }
    this.changed();
  }
  private updateTerminalExecutions() {
    for (const [id, execution] of this.terminalExecutions) {
      if (!execution.returned || this.plugins.registry.busy(id)) {
        continue;
      }
      this.execution(
        {
          ...execution.event,
          status:
            execution.event.status === 'interrupted'
              ? 'interrupted'
              : execution.event.status === 'cancelling'
                ? 'cancelled'
                : execution.error
                  ? 'failed'
                  : 'succeeded',
          error: execution.error,
        },
        true,
      );
      this.terminalExecutions.delete(id);
    }
    this.changed();
  }
  private async validate(command: string) {
    const parts = splitCommand(command);
    if (!parts.length) {
      throw new Error('未提供命令');
    }
    if (!this.plugins.has(parts[0])) {
      await this.core.call('command.validate', { command });
    }
    return parts;
  }
  private async execute(windowId: string, command: string) {
    const window = this.model.byId(windowId);
    if (!window || window.kind === 'output') {
      throw new Error('输出窗口不能执行命令');
    }
    if (window.task) {
      throw new Error('当前窗口有任务，使用 :run 替换或 :new 新建窗口');
    }
    if (['exit', 'restart'].includes(command.trim())) {
      await this.lifecycle(command.trim() === 'restart');
      return;
    }
    const parts = await this.validate(command);
    this.model.append({ windowId, text: `> ${command}` });
    const executionId = randomUUID();
    if (this.plugins.has(parts[0])) {
      const event: ExecutionEvent = { command, windowId, executionId, status: 'running' };
      const record = { event, returned: false, error: undefined as string | undefined };
      this.terminalExecutions.set(executionId, record);
      this.model.execution(event);
      this.model.record(window, command);
      const identity: InvocationIdentity = { windowId, executionId };
      void this.plugins
        .execute(parts[0], parts.slice(1), identity)
        .catch((error) => {
          record.error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          record.returned = true;
          if (this.plugins.registry.busy(executionId)) {
            record.event = { ...event, status: 'background' };
            this.model.execution(record.event);
          }
          this.updateTerminalExecutions();
        });
    } else {
      this.model.execution({ command, windowId, executionId, status: 'running' });
      try {
        await this.core.call('command.execute', { command, windowId, executionId });
      } catch (error) {
        this.model.execution({
          command,
          windowId,
          executionId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      this.model.record(window, command);
    }
    this.changed();
  }
  private async cancel(executionId: string, force = false): Promise<boolean> {
    const window = this.model.windows.find((item) => item.task?.executionId === executionId);
    if (window?.task) {
      window.task.status = 'cancelling';
    }
    const local = this.terminalExecutions.get(executionId);
    if (local) {
      local.event.status = 'cancelling';
    }
    this.model.message = '正在等待任务停止';
    this.changed();
    const [core, terminal] = await Promise.all([
      this.core.peer
        ? this.core
            .call<{ cancelled: boolean; needsForce?: boolean }>(
              'command.cancel',
              { executionId, force },
              5000,
            )
            .catch(() => ({ cancelled: false, needsForce: true }))
        : Promise.resolve({ cancelled: true }),
      this.plugins.cancel(executionId, force),
    ]);
    if (core.cancelled && terminal) {
      if (window?.task?.executionId === executionId) {
        this.model.execution({ ...window.task, status: 'cancelled' });
      }
      return true;
    }
    return false;
  }
  private async cancelThen(executionId: string, action: () => Promise<void> | void) {
    if (await this.cancel(executionId)) {
      await action();
      return;
    }
    if (await this.confirm('强制取消将停止整个插件进程，并中断该插件其他任务，是否确认？')) {
      if (!(await this.cancel(executionId, true))) {
        throw new Error('任务无法安全取消，操作未执行');
      }
      await action();
    }
    this.changed();
  }
  private panelOutput(text: string) {
    this.model.writePanel(text);
    this.onOutput?.(sanitizeOutput(text));
    this.changed();
  }
  private retirePanelExecutions() {
    for (const id of this.panelExecutions) {
      this.discardedPanelExecutions.add(id);
    }
    this.panelExecutions.clear();
    while (this.discardedPanelExecutions.size > 4096) {
      const id = this.discardedPanelExecutions.keys().next().value;
      if (id) {
        this.discardedPanelExecutions.delete(id);
      }
    }
  }
  private async interact(command: string, action: () => Promise<void>) {
    if (this.model.panel?.running) {
      throw new Error('全局命令仍在执行或等待输入');
    }
    const panel = this.model.beginPanel(command);
    const work = action()
      .catch((error) => this.panelOutput(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        this.model.finishPanel(panel);
        if (!this.model.panel) {
          this.retirePanelExecutions();
        }
        this.changed();
      });
    this.interaction = work;
    this.changed();
    // Yield at each next() so keyboard and piped answers can advance the same command.
    await Promise.race([work, panel.step.promise]);
  }
  private async confirm(text: string) {
    let prompt = text;
    for (;;) {
      const [error, answer] = await this.model.nextChoice(
        `${prompt}\n输入 :y 确认 / :n 取消，然后按 Enter`,
      );
      if (error) {
        return false;
      }
      if (answer.trim() === ':y' || answer.trim() === ':n') {
        this.model.message = '';
        return answer.trim() === ':y';
      }
      prompt = `请输入 :y 或 :n\n${text}`;
    }
  }
  private async answerPanel(value: string) {
    const panel = this.model.panel;
    if (!panel?.input) {
      return;
    }
    panel.step = Promise.withResolvers<void>();
    panel.input.reply(value);
    await Promise.race([this.interaction ?? Promise.resolve(), panel.step.promise]);
    this.changed();
  }
  async global(raw: string) {
    this.model.recordGlobal(raw.replace(/^:/, '').trim());
    await this.interact(raw.replace(/^:/, ''), () => this.executeGlobal(raw));
  }
  private async executeGlobal(raw: string) {
    const text = raw.replace(/^:/, '').trim();
    const [name, ...args] = splitCommand(text);
    const count = (min: number, max = min) => {
      if (args.length < min || args.length > max) {
        throw new Error('全局命令参数错误');
      }
    };
    const clear = () => {
      this.model.message = '';
    };
    if (name === 'q' || name === 'r' || name === 'restart') {
      count(0);
      await this.lifecycle(name !== 'q');
      return;
    }
    if (name === 's' || name === 'switch') {
      count(1);
      this.model.switch(this.model.byIndex(args[0]).id);
      clear();
    } else if (name === 'new') {
      count(0);
      this.model.newWindow();
      clear();
    } else if (['w', 'c', 'close'].includes(name)) {
      count(name === 'w' ? 0 : 1);
      const target = name === 'w' ? this.model.active : this.model.byIndex(args[0]);
      if (target.kind === 'output') {
        throw new Error('输出窗口不能关闭');
      }
      const id = target.id;
      const executionId = target.task?.executionId;
      const close = () => {
        this.model.close(id);
        clear();
      };
      if (!executionId) {
        close();
      } else {
        if (await this.confirm('当前窗口有命令正在执行，是否确认关闭？')) {
          if (!this.model.byId(id)) {
            return;
          }
          if (
            this.model.byId(id)?.task?.executionId &&
            this.model.byId(id)?.task?.executionId !== executionId
          ) {
            throw new Error('目标任务已变化');
          }
          await this.cancelThen(executionId, close);
        }
      }
    } else if (name === 'run') {
      count(2, 1024);
      const window = this.model.byIndex(args[0]);
      if (window.kind === 'output') {
        throw new Error('输出窗口不能执行命令');
      }
      const match = /^run\s+\d+\s+([\s\S]+)$/.exec(text);
      if (!match) {
        throw new Error('用法：:run N <命令>');
      }
      const command = match[1];
      await this.validate(command);
      const id = window.id;
      const executionId = window.task?.executionId;
      const run = async () => {
        await this.execute(id, command);
        clear();
      };
      if (!executionId) {
        await run();
      } else {
        if (await this.confirm('当前窗口有任务正在执行，是否终止并执行新命令？')) {
          const current = this.model.byId(id);
          if (!current) {
            throw new Error('目标窗口已关闭');
          }
          if (current.task && current.task.executionId !== executionId) {
            throw new Error('目标任务已变化');
          }
          if (!current.task) {
            await run();
          } else {
            await this.cancelThen(executionId, run);
          }
        }
      }
    } else if (name === 'cancel') {
      count(0, 1);
      const window = args.length ? this.model.byIndex(args[0]) : this.model.active;
      if (!window.task) {
        throw new Error('当前窗口没有任务');
      }
      await this.cancelThen(window.task.executionId, clear);
    } else if (name === 'help') {
      count(0);
      this.panelOutput(
        '全局命令（含空格的参数请加引号）\n' +
          this.model.globalCommands
            .map(
              (item) =>
                `:${item.usage}${item.aliases?.length ? ` (${item.aliases.map((alias) => ':' + alias).join('/')})` : ''}  ${item.description}`,
            )
            .join('\n') +
          '\n命令标签：直接输入 · ↑/↓ 历史（含草稿） · Enter 执行\n空输入：: 全局命令 · Tab/Shift+Tab 切换标签 · ←/→ 滚动标签栏\n输入：Tab/Shift+Tab 补全 · Shift+←/→ 选中 · Ctrl/Cmd+←/→ 按空格分词跳转 · Alt/Option+←/→ 头尾跳转（可加 Shift 选中）\n拖动选中输出 · Ctrl/Cmd+C 复制选中项 · Esc 取消选中或关闭底栏\n底栏输出：↑/↓ 或鼠标滚轮滚动 · : 继续输入 · Esc 丢弃\n可执行命令：\n' +
          [...this.commands, ...this.plugins.list()]
            .map((item) => `${item.name} ${item.description ?? ''}`)
            .join('\n'),
      );
      clear();
    } else if (name === 'rename') {
      count(1, 2);
      this.model.rename(
        args.length === 2 ? this.model.byIndex(args[1]) : this.model.active,
        args[0],
      );
      clear();
    } else if (name === 'transparent-bg') {
      count(1);
      if (!['true', 'false'].includes(args[0])) {
        throw new Error('用法：:transparent-bg [true|false]');
      }
      this.model.transparentBackground = args[0] === 'true';
      clear();
    } else if (name === 'clear') {
      count(0, 1);
      const target = args[0] ?? 'output';
      if (!['output', 'history', 'all'].includes(target)) {
        throw new Error('用法：:clear [output|history|all]');
      }
      if (target !== 'history') {
        this.model.active.lines = [];
        this.model.active.bytes = 0;
        this.model.active.scroll = 0;
        this.model.active.anchor = undefined;
      }
      if (target !== 'output') {
        this.model.active.history = [];
        this.model.active.historyCursor = 0;
        this.model.active.historyDraft = '';
      }
      clear();
    } else if (this.plugins.has(name, 'global')) {
      const executionId = randomUUID();
      this.globalExecutionId = executionId;
      this.panelExecutions.add(executionId);
      try {
        await this.plugins.execute(name, args, { windowId: randomUUID(), executionId });
        await this.plugins.registry.waitIdle(executionId, 24 * 60 * 60 * 1000);
      } finally {
        this.globalExecutionId = undefined;
      }
    } else {
      throw new Error(`未知全局命令：${name ?? ''}`);
    }
    this.changed();
  }
  async lifecycle(restart: boolean, confirmed = false, force = false) {
    if (!this.model.panel?.running) {
      await this.interact(restart ? 'restart' : 'q', () =>
        this.lifecycle(restart, confirmed, force),
      );
      return;
    }
    if (this.closing || this.restarting) {
      return;
    }
    const tasks = this.core.peer
      ? await this.core
          .call<TaskSnapshot[]>('tasks.snapshot', undefined, 1000)
          .catch(() => this.coreTasks)
      : [];
    if (
      !confirmed &&
      (tasks.length ||
        this.plugins.registry.busy() ||
        this.model.windows.some((window) => window.task))
    ) {
      if (await this.confirm(`当前有任务正在执行，是否确认${restart ? '重启' : '退出'}？`)) {
        await this.lifecycle(restart, true);
      }
      this.changed();
      return;
    }
    const [local, cancelled] = await Promise.all([
      this.plugins.cancel(undefined, force),
      this.core.peer
        ? this.core
            .call<{ cancelled: boolean }>('command.cancel', { force }, 5000)
            .catch(() => ({ cancelled: false }))
        : Promise.resolve({ cancelled: true }),
    ]);
    if ((!local || !cancelled.cancelled) && !force) {
      if (await this.confirm('仍有任务未停止，强制结束将中断相关进程的全部任务，是否确认？')) {
        await this.lifecycle(restart, true, true);
      }
      this.changed();
      return;
    }
    this.expectedStop = true;
    clearTimeout(this.retryTimer);
    if (restart) {
      this.restarting = true;
    } else {
      this.closing = true;
    }
    this.model.globalDraft = '';
    this.model.globalCursor = 0;
    if (!cancelled.cancelled && force) {
      await this.core.kill();
    } else {
      if (this.core.peer) {
        await this.core
          .call(restart ? 'lifecycle.restart' : 'lifecycle.exit', { force })
          .catch(() => undefined);
      }
      await this.core.waitClosed();
    }
    if (restart) {
      this.restarting = false;
      await this.start();
    } else {
      await this.plugins.unload();
      await this.onExit?.();
    }
  }
  async key(key: Key) {
    const copying = key.name === 'c' && (key.ctrl || key.meta);
    if (
      this.pending &&
      !this.model.panel?.input &&
      !copying &&
      !['mouse', 'up', 'down', 'escape'].includes(key.name)
    ) {
      return;
    }
    if (key.name !== 'tab') {
      this.model.clearBoundary();
    }
    const notice = this.model.message;
    let success =
      key.name !== 'unknown' && !(key.mouse && (key.mouse.release || key.mouse.button & 32));
    try {
      const selected = this.renderer.selectedText(this.model);
      if (!key.mouse && !copying && this.model.editing) {
        this.renderer.clearOutputSelection();
      }
      if (copying && selected) {
        if (!this.onCopy) {
          throw new Error('剪贴板不可用');
        }
        await this.onCopy(selected);
        this.renderer.clearSelection(this.model);
      } else if (key.mouse) {
        this.mouse(key);
      } else if (copying && key.meta) {
        success = false;
      } else if (this.model.panel?.input && key.name === 'enter') {
        this.pending = true;
        await this.answerPanel(this.model.text);
      } else if (
        this.model.panel?.input &&
        (key.name === 'escape' || (key.name === 'c' && key.ctrl))
      ) {
        this.model.cancelPanelInput();
        await this.interaction;
      } else if (key.name === 'escape') {
        this.renderer.clearSelection(this.model);
        if (this.model.mode === 'normal') {
          this.model.active.anchor = undefined;
          this.model.active.scroll = 0;
        } else if (!this.model.panel?.running) {
          this.model.panel = undefined;
          this.retirePanelExecutions();
          this.model.completionPreview = false;
          this.model.mode = 'normal';
        }
      } else if (
        key.name === 'backspace' &&
        this.model.mode === 'global' &&
        !this.model.panel?.input &&
        !this.model.globalDraft
      ) {
        this.model.panel = undefined;
        this.retirePanelExecutions();
        this.model.completionPreview = false;
        this.model.mode = 'normal';
      } else if (this.model.mode === 'global-output') {
        if (!this.model.panel?.running && key.sequence === ':') {
          this.model.enterGlobal();
        } else if (
          !this.model.panel?.running &&
          this.model.active.kind === 'output' &&
          /^[：﹕꞉∶︰]$/u.test(key.sequence)
        ) {
          throw new Error('请输入英文半角冒号 ":" 进入全局命令');
        } else if (key.name === 'up' || key.name === 'down') {
          this.renderer.scrollPanel(this.model, key.name === 'up' ? 1 : -1);
        } else if (copying && this.globalExecutionId) {
          this.pending = true;
          await Promise.all([
            this.plugins.cancel(this.globalExecutionId),
            this.core.peer
              ? this.core.call('command.cancel', { executionId: this.globalExecutionId })
              : Promise.resolve(),
          ]);
        } else {
          success = false;
        }
      } else if (copying) {
        if (this.model.active.input) {
          this.pending = true;
          await this.cancelInput();
        } else if (this.model.editing && (this.model.text || this.model.mode === 'global')) {
          this.model.setInput('', 0);
        } else if (this.model.active.task) {
          this.pending = true;
          const executionId = this.model.active.task.executionId;
          await this.interact('cancel', () => this.cancelThen(executionId, () => undefined));
        } else {
          this.pending = true;
          await this.lifecycle(false);
        }
      } else if (key.name === 'tab') {
        if (this.model.mode === 'global' || (this.model.editing && this.model.text)) {
          this.model.completeGlobal(key.shift ? -1 : 1);
        } else if (!this.model.panel?.input) {
          this.model.tab(key.shift ? -1 : 1);
          this.renderer.reveal();
          this.renderer.clearSelection(this.model);
        }
      } else if (key.name === 'paste') {
        const text = sanitizeOutput(key.sequence).replace(/\n/g, ' ');
        if (this.canEnterGlobal() && text.startsWith(':')) {
          this.model.enterGlobal();
          this.model.edit(text.slice(1));
        } else if (this.model.editing) {
          this.model.edit(text);
        } else if (/^[：﹕꞉∶︰]/u.test(text)) {
          throw new Error('请输入英文半角冒号 ":" 进入全局命令');
        }
      } else if (this.canEnterGlobal() && key.sequence === ':') {
        this.model.enterGlobal();
      } else if (
        this.model.mode === 'normal' &&
        this.model.active.kind !== 'command' &&
        !this.model.active.input &&
        /^[：﹕꞉∶︰]$/u.test(key.sequence)
      ) {
        throw new Error('请输入英文半角冒号 ":" 进入全局命令');
      } else if (this.model.editing) {
        if (key.name === 'enter') {
          this.pending = true;
          this.model.commitGlobalCompletion();
          if (this.model.mode === 'global') {
            await this.global(this.model.globalDraft);
          } else if (this.model.active.input) {
            await this.answerInput(this.model.text);
          } else if (this.model.active.draft.trim()) {
            const window = this.model.active;
            await this.execute(window.id, window.draft);
            this.model.setInput('', 0);
          }
        } else if (key.name === 'up' || key.name === 'down') {
          if (this.model.panel?.input) {
            this.renderer.scrollPanel(this.model, key.name === 'up' ? 1 : -1);
          } else if (this.model.mode === 'global' || !this.model.active.input) {
            this.model.history(key.name === 'up' ? -1 : 1);
          } else {
            this.renderer.scroll(this.model, key.name === 'up' ? 1 : -1);
          }
        } else if (key.name === 'left' || key.name === 'right') {
          if (
            !this.model.text &&
            !key.shift &&
            !key.ctrl &&
            !key.meta &&
            !key.alt &&
            this.model.mode === 'normal'
          ) {
            this.scrollTabs(key.name === 'left' ? -1 : 1);
          } else {
            this.model.move(
              key.name === 'left' ? -1 : 1,
              key.shift,
              key.alt ? 'edge' : key.ctrl || key.meta ? 'word' : 'grapheme',
            );
          }
        } else if (key.name === 'backspace' || key.name === 'delete') {
          this.model.edit('', key.name);
        } else if (key.name === 'home' || key.name === 'end') {
          this.model.move(key.name === 'home' ? -1 : 1, key.shift, 'edge');
        } else if (key.name === 'pageup' || key.name === 'pagedown') {
          this.renderer.scroll(
            this.model,
            (key.name === 'pageup' ? 1 : -1) * Math.max(1, this.renderer.height - 2),
          );
        } else if (
          key.name === 'text' &&
          !key.ctrl &&
          !key.meta &&
          !/[\x00-\x1f\x7f]/.test(key.sequence) &&
          this.model.text.length < 65536
        ) {
          if (key.sequence === ' ') {
            this.model.commitGlobalCompletion();
          }
          this.model.edit(key.sequence);
        }
        if (
          this.model.mode === 'normal' &&
          ['text', 'paste', 'backspace', 'delete', 'up', 'down', 'enter'].includes(key.name)
        ) {
          this.model.active.anchor = undefined;
          this.model.active.scroll = 0;
        }
      } else if (key.name === 'up' || key.name === 'down') {
        this.renderer.scroll(this.model, key.name === 'up' ? 1 : -1);
      } else if (key.name === 'left' || key.name === 'right') {
        this.scrollTabs(key.name === 'left' ? -1 : 1);
      }
    } catch (error) {
      success = false;
      this.error(error);
    } finally {
      if (success && this.model.message === notice) {
        this.model.message = '';
      }
      this.pending = false;
      this.changed();
    }
  }
  private canEnterGlobal() {
    return (
      this.model.mode === 'normal' &&
      !this.model.active.input &&
      (this.model.active.kind !== 'command' || !this.model.active.draft)
    );
  }
  private scrollTabs(direction: number, columns = false) {
    this.renderer.scrollTabs(this.model, direction, columns);
  }
  private mouse(key: Key) {
    const mouse = key.mouse;
    if (!mouse) {
      return;
    }
    if (
      this.renderer.dragSelection(
        this.model,
        mouse.column,
        mouse.row,
        mouse.release,
        Boolean(mouse.button & 32),
      )
    ) {
      return;
    }
    if (mouse.release) {
      return;
    }
    if (mouse.button & 64) {
      const amount = mouse.button & 1 ? -3 : 3;
      if (mouse.row === 0) {
        this.scrollTabs(-amount, true);
      } else if (this.renderer.panelAt(mouse.row) && this.model.panel) {
        this.renderer.scrollPanel(this.model, amount);
      } else {
        this.renderer.scroll(this.model, amount);
      }
    } else if (mouse.row === 0 && mouse.button & 32) {
      this.renderer.hoverAt(mouse.column);
    } else if (mouse.row === 0 && (mouse.button & 3) === 0 && !this.model.panel?.running) {
      const hit = this.renderer.hit(mouse.column);
      if (hit?.id) {
        this.model.switch(hit.id);
      }
      if (hit?.arrow) {
        this.scrollTabs(hit.arrow);
      }
    } else if ((mouse.button & 3) === 0 && !(mouse.button & 32)) {
      this.renderer.beginSelection(this.model, mouse.column, mouse.row);
    }
  }
  async line(line: string) {
    const notice = this.model.message;
    try {
      if (this.model.panel?.input) {
        await this.answerPanel(line);
      } else if (this.model.active.input) {
        await this.answerInput(line);
      } else if (line.startsWith(':')) {
        await this.global(line);
      } else {
        const window =
          this.model.active.kind === 'command'
            ? this.model.active
            : (this.model.windows.find((window) => window.kind === 'command') ??
              this.model.newWindow());
        this.model.switch(window.id);
        await this.execute(window.id, line);
      }
      if (this.model.message === notice) {
        this.model.message = '';
      }
    } catch (error) {
      this.error(error);
    }
    this.changed();
  }
  async dispose() {
    this.closing = true;
    clearTimeout(this.retryTimer);
    this.model.cancelPanelInput('closed');
    await this.core.kill();
    await this.plugins.unload();
  }
}
