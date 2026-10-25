import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  getCommands,
  validateCommand,
  parseAndRunCommands,
  completeCommand,
  commandEvents,
  CommandError,
} from '../utils/command.ts';
import { invocationStorage, taskRegistry, type TaskScope } from '../common/tasks.ts';
import { registerInputSession, InvocationInputError } from '../common/interaction.ts';
import { subscribeLog } from '../utils/log.ts';
import { pluginClients } from '../plugin/process/client.ts';
import type { InputRequest } from '../types/task.d.ts';
import { assert, coreBootId, json, now, WorkbenchError, type WorkbenchStorage } from './storage.ts';
import { identifier, type WorkspaceService } from './workspace.ts';
import { workbenchEvents } from './events.ts';

type Execution = {
  id: string;
  terminalId: string;
  owner: string;
  scope: TaskScope;
  returned: boolean;
  error?: string;
  done: boolean;
};
export class CommandService {
  private active = new Map<string, Execution>();
  private sessions = new Map<string, () => void>();
  private inputs = new Map<
    string,
    { request: InputRequest; owner: string; complete: (value?: string, error?: Error) => void }
  >();
  private replies = new Map<
    string,
    { owner: string; executionId: string; terminalId: string; value: string }
  >();
  private connections = new Map<string, number>();
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private completions = new Map<string, AbortController>();
  private unsubscribe: () => void;
  private pendingOutput: { streamId: string; value: unknown }[] = [];
  private pendingBytes = 0;
  private outputTimer?: ReturnType<typeof setTimeout>;
  private storage: WorkbenchStorage;
  private startedAt = now();
  private workspace: WorkspaceService;
  private onLifecycle: (restart: boolean) => void;
  constructor(
    storage: WorkbenchStorage,
    workspace: WorkspaceService,
    onLifecycle: (restart: boolean) => void = (restart) => {
      process.emit('message', restart ? 'SIGINT-restart' : 'SIGINT-exit', null);
    },
  ) {
    this.onLifecycle = onLifecycle;
    this.storage = storage;
    this.workspace = workspace;
    this.unsubscribe = subscribeLog((event) => {
      if (event.sessionId?.startsWith('web:')) {
        const id = event.executionId;
        const execution = id
          ? (this.storage.db.prepare('SELECT terminal_id FROM executions WHERE id=?').get(id) as
              | { terminal_id: string }
              | undefined)
          : undefined;
        if (execution) {
          this.output(execution.terminal_id, event);
        }
      } else if (!event.sessionId) {
        this.output('public', event);
      }
    });
    taskRegistry.on('change', this.changed);
    taskRegistry.on('owner.stop', this.ownerStopped);
    commandEvents.on('change', this.commandsChanged);
  }
  private commandsChanged = () => {
    for (const c of this.completions.values()) {
      c.abort();
    }
    workbenchEvents.publish('commands.changed', this.commands());
  };
  commands() {
    return getCommands().map((c) => ({
      ...c,
      executable: true,
    }));
  }
  terminals(workspaceId: string) {
    this.workspace.get(workspaceId);
    return (
      this.storage.db
        .prepare('SELECT id,value_json,revision FROM terminals WHERE workspace_id=?')
        .all(workspaceId) as { id: string; value_json: string; revision: number }[]
    ).map((r) => ({ id: r.id, ...JSON.parse(r.value_json), revision: r.revision }));
  }
  terminal(id: string, workspaceId: string) {
    const row = this.storage.db
      .prepare('SELECT * FROM terminals WHERE id=? AND workspace_id=?')
      .get(id, workspaceId) as { id: string; value_json: string; revision: number } | undefined;
    assert(row, 'not_found', '终端不属于此工作区', 404);
    return { id, ...JSON.parse(row.value_json), revision: row.revision };
  }
  saveTerminal(workspaceId: string, owner: string, lease: string, input: unknown) {
    this.workspace.checkLease(workspaceId, owner, lease);
    const data = z
      .object({
        id: identifier.optional(),
        title: z.string().max(200),
        draft: z.string().max(65536).default(''),
        baseRevision: z.number().int().nonnegative().default(0),
      })
      .strict()
      .parse(input);
    const id = data.id ?? randomUUID(),
      existing = data.id ? this.terminal(id, workspaceId) : undefined;
    assert((existing?.revision ?? 0) === data.baseRevision, 'revision_conflict', '终端已变化', 409);
    const value = {
      title: data.title,
      draft: data.draft,
      history: existing?.history ?? [],
      archivedAt: existing?.archivedAt ?? null,
    };
    this.storage.db
      .prepare(
        'INSERT INTO terminals VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision',
      )
      .run(id, workspaceId, json(value), data.baseRevision + 1);
    return this.terminal(id, workspaceId);
  }
  async execute(
    workspaceId: string,
    owner: string,
    lease: string,
    terminalId: string,
    command: string,
    key: string,
  ) {
    this.workspace.checkLease(workspaceId, owner, lease);
    identifier.parse(key);
    z.string().min(1).max(65536).parse(command);
    const receiptKey = `execute:${terminalId}:${key}`;
    const old = this.storage.db
      .prepare('SELECT id,command FROM executions WHERE request_key=?')
      .get(receiptKey) as { id: string; command: string } | undefined;
    if (old) {
      assert(old.command === command, 'idempotency_conflict', '幂等键已用于不同命令', 409);
      this.terminal(terminalId, workspaceId);
      return this.execution(old.id);
    }
    const terminal = this.terminal(terminalId, workspaceId);
    assert(!terminal.archivedAt, 'archived', '终端已归档', 409);
    assert(
      ![...this.active.values()].some((e) => e.terminalId === terminalId && !e.done),
      'terminal_busy',
      '终端正忙',
      409,
    );
    let validated: ReturnType<typeof validateCommand>;
    try {
      validated = validateCommand(command);
    } catch (error) {
      if (error instanceof CommandError) {
        throw new WorkbenchError(error.code, error.message, 400);
      }
      throw error;
    }
    const lifecycle = validated.system && ['exit', 'restart'].includes(validated.originalName);
    const id = randomUUID(),
      sessionId = `web:${workspaceId}`;
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(
        sessionId,
        registerInputSession(sessionId, (request, signal) =>
          this.next(request, signal, workspaceId),
        ),
      );
    }
    const scope = taskRegistry.create(`web:${terminalId}`, {
      executionId: id,
      windowId: terminalId,
      sessionId,
    });
    const execution: Execution = { id, terminalId, owner, scope, returned: false, done: false };
    this.active.set(id, execution);
    const value = {
      id,
      terminalId,
      workspaceId,
      coreBootId,
      owner,
      status: 'running',
      command,
      createdAt: now(),
    };
    this.storage.db.transaction(() => {
      this.storage.db
        .prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?)')
        .run(id, terminalId, coreBootId, 'running', command, receiptKey, json(value));
      const { revision: _, id: __, ...metadata } = terminal;
      metadata.history = [...(terminal.history ?? []), command].slice(-1000);
      metadata.draft = '';
      this.storage.db
        .prepare('UPDATE terminals SET value_json=?,revision=revision+1 WHERE id=?')
        .run(json(metadata), terminalId);
    })();
    this.persistOutput(terminalId, { type: 'command', text: command, executionId: id });
    workbenchEvents.publish('execution.started', value, id);
    void invocationStorage
      .run(scope.context, () =>
        lifecycle ? Promise.resolve() : parseAndRunCommands(command, scope.context),
      )
      .catch((error) => {
        execution.error = error instanceof Error ? error.message : String(error);
        this.output(terminalId, { level: 'error', text: execution.error, executionId: id });
      })
      .finally(() => {
        this.flushOutput();
        execution.returned = true;
        this.storage.db.prepare("UPDATE executions SET status='returned' WHERE id=?").run(id);
        workbenchEvents.publish('execution.returned', { executionId: id }, id);
        scope.finish();
        this.changed();
        if (lifecycle) {
          setTimeout(() => this.onLifecycle(validated.originalName === 'restart'), 50);
        }
      });
    return value;
  }
  private ownerStopped = ({ identities }: { identities: { executionId: string }[] }) => {
    for (const e of this.active.values()) {
      if (identities.some((i) => taskRegistry.executionIds(e.id).has(i.executionId))) {
        e.error = '插件宿主停止，执行已中断';
      }
    }
  };
  private changed = () => {
    this.flushOutput();
    for (const e of this.active.values()) {
      if (e.returned && !e.done && !taskRegistry.busy(e.id)) {
        e.done = true;
        const status = e.scope.controller.signal.aborted
          ? 'cancelled'
          : e.error
            ? 'failed'
            : 'succeeded';
        this.storage.db.prepare('UPDATE executions SET status=? WHERE id=?').run(status, e.id);
        workbenchEvents.publish(
          'execution.finished',
          { executionId: e.id, terminalId: e.terminalId, status, error: e.error },
          e.id,
        );
        this.active.delete(e.id);
      }
    }
  };
  execution(id: string) {
    const row = this.storage.db
      .prepare('SELECT value_json,status FROM executions WHERE id=?')
      .get(id) as { value_json: string; status: string } | undefined;
    assert(row, 'not_found', '执行不存在', 404);
    return { ...JSON.parse(row.value_json), status: row.status };
  }
  async cancel(
    workspaceId: string,
    owner: string,
    lease: string,
    terminalId: string,
    id: string,
    bootId: string,
    force = false,
  ) {
    this.workspace.checkLease(workspaceId, owner, lease);
    this.terminal(terminalId, workspaceId);
    assert(bootId === coreBootId, 'stale_boot', '核心已重启', 409);
    const e = this.active.get(id);
    assert(e && e.terminalId === terminalId, 'stale_execution', '执行已结束或不属于目标终端', 409);
    const ids = taskRegistry.executionIds(id);
    taskRegistry.cancel(id);
    for (const client of pluginClients.values()) {
      for (const executionId of ids) {
        client.cancel(executionId);
      }
    }
    await taskRegistry.waitIdle(id, 2000);
    const remaining = taskRegistry
      .list()
      .filter((s) => s.identity && ids.has(s.identity.executionId));
    const owners = [...new Set(remaining.map((s) => s.owner))];
    if (force) {
      await Promise.all(owners.map((o) => pluginClients.get(o)?.terminate()));
    }
    return { cancelled: !taskRegistry.busy(id), needsForce: taskRegistry.busy(id), owners };
  }
  async complete(
    workspaceId: string,
    owner: string,
    lease: string,
    terminalId: string,
    command: string,
    cursor: number,
    signal: AbortSignal,
  ) {
    this.workspace.checkLease(workspaceId, owner, lease);
    this.terminal(terminalId, workspaceId);
    assert(
      Number.isInteger(cursor) && cursor >= 0 && cursor <= command.length,
      'invalid_cursor',
      '补全光标无效',
    );
    const key = `${workspaceId}:${terminalId}`;
    this.completions.get(key)?.abort();
    const controller = new AbortController();
    this.completions.set(key, controller);
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      return await completeCommand({ command, cursor }, controller.signal);
    } finally {
      signal.removeEventListener('abort', abort);
      if (this.completions.get(key) === controller) {
        this.completions.delete(key);
      }
    }
  }
  private next(request: InputRequest, signal: AbortSignal, workspaceId: string): Promise<string> {
    this.flushOutput();
    return new Promise((resolve, reject) => {
      const close = (value?: string, error?: Error) => {
        this.inputs.delete(request.id);
        signal.removeEventListener('abort', abort);
        workbenchEvents.publish('input.closed', {
          requestId: request.id,
          workspaceId,
          terminalId: request.identity.windowId,
        });
        if (error) {
          reject(error);
        } else {
          resolve(value ?? '');
        }
      };
      const abort = () => close(undefined, new InvocationInputError('cancelled', '输入已取消'));
      this.inputs.set(request.id, { request, owner: workspaceId, complete: close });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        return abort();
      }
      workbenchEvents.publish('input.requested', { ...request, workspaceId });
      if (!this.connections.get(workspaceId)) {
        this.disconnected(workspaceId);
      }
    });
  }
  input(
    workspaceId: string,
    owner: string,
    lease: string,
    requestId: string,
    terminalId: string,
    executionId: string,
    bootId: string,
    value: string,
  ) {
    this.workspace.checkLease(workspaceId, owner, lease);
    assert(bootId === coreBootId, 'stale_boot', '核心已重启', 409);
    z.string().max(65536).parse(value);
    const old = this.replies.get(requestId);
    if (old) {
      assert(
        old.owner === workspaceId &&
          old.executionId === executionId &&
          old.terminalId === terminalId &&
          old.value === value,
        'input_conflict',
        '输入已被不同回复消费',
        409,
      );
      return { accepted: true };
    }
    const input = this.inputs.get(requestId);
    assert(
      input &&
        input.owner === workspaceId &&
        input.request.identity.windowId === terminalId &&
        input.request.identity.executionId === executionId,
      'stale_input',
      '输入请求归属不匹配或已结束',
      409,
    );
    this.replies.set(requestId, { owner: workspaceId, executionId, terminalId, value });
    if (this.replies.size > 1000) {
      this.replies.delete(this.replies.keys().next().value ?? '');
    }
    input.complete(value);
    return { accepted: true };
  }
  connected(workspaceId: string) {
    this.connections.set(workspaceId, (this.connections.get(workspaceId) ?? 0) + 1);
    clearTimeout(this.disconnectTimers.get(workspaceId));
    this.disconnectTimers.delete(workspaceId);
    return () => {
      this.connections.set(workspaceId, Math.max(0, (this.connections.get(workspaceId) ?? 1) - 1));
      if (!this.connections.get(workspaceId)) {
        this.disconnected(workspaceId);
      }
    };
  }
  private disconnected(workspaceId: string) {
    if (this.disconnectTimers.has(workspaceId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(workspaceId);
      for (const input of this.inputs.values()) {
        if (input.owner === workspaceId) {
          input.complete(undefined, new InvocationInputError('closed', '输入连接已断开'));
          taskRegistry.cancel(input.request.identity.executionId);
          for (const client of pluginClients.values()) {
            client.cancel(input.request.identity.executionId);
          }
        }
      }
    }, 60000);
    timer.unref();
    this.disconnectTimers.set(workspaceId, timer);
  }
  state(workspaceId: string) {
    return {
      executions: (
        this.storage.db
          .prepare(
            'SELECT e.id FROM executions e JOIN terminals t ON e.terminal_id=t.id WHERE t.workspace_id=? ORDER BY e.rowid DESC LIMIT 100',
          )
          .all(workspaceId) as { id: string }[]
      ).map((r) => this.execution(r.id)),
      inputs: [...this.inputs.values()]
        .filter((i) => i.owner === workspaceId)
        .map((i) => i.request),
    };
  }
  output(streamId: string, value: unknown) {
    const bytes = Buffer.byteLength(json(value));
    if (bytes + this.pendingBytes > 2 * 1024 * 1024) {
      this.flushOutput();
      if (bytes > 2 * 1024 * 1024) {
        this.persistOutput(streamId, { level: 'warn', text: '[输出过载，已截断超大记录]' });
        return;
      }
    }
    this.pendingOutput.push({ streamId, value });
    this.pendingBytes += bytes;
    if (this.pendingBytes >= 32768) {
      this.flushOutput();
    } else if (!this.outputTimer) {
      this.outputTimer = setTimeout(() => this.flushOutput(), 50);
      this.outputTimer.unref();
    }
  }
  private flushOutput() {
    clearTimeout(this.outputTimer);
    this.outputTimer = undefined;
    const queue = this.pendingOutput;
    this.pendingOutput = [];
    this.pendingBytes = 0;
    for (const record of queue) {
      this.persistOutput(record.streamId, record.value);
    }
  }
  private persistOutput(streamId: string, value: unknown) {
    const text = String((value as { text?: unknown })?.text ?? '');
    const records: unknown[] = [];
    this.storage.db.transaction(() => {
      this.storage.db.prepare('INSERT OR IGNORE INTO output_streams(id) VALUES (?)').run(streamId);
      for (let i = 0; i < Math.max(1, text.length); i += 16000) {
        const seq = (
          this.storage.db
            .prepare('UPDATE output_streams SET seq=seq+1 WHERE id=? RETURNING seq')
            .get(streamId) as { seq: number }
        ).seq;
        const record = {
          ...(value as object),
          streamId,
          seq,
          timestamp: now(),
          coreBootId,
          text: text.slice(i, i + 16000),
        };
        this.storage.db
          .prepare('INSERT INTO output_records VALUES (?,?,?,?)')
          .run(streamId, seq, record.timestamp, json(record));
        records.push(record);
      }
      this.storage.db
        .prepare(
          'DELETE FROM output_records WHERE stream_id=? AND seq <= (SELECT seq-10000 FROM output_streams WHERE id=?)',
        )
        .run(streamId, streamId);
      // Byte budgets include JSON metadata and preserve explicit sequence gaps.
      this.storage.db
        .prepare(
          'DELETE FROM output_records WHERE stream_id=? AND seq IN (SELECT seq FROM (SELECT seq,SUM(length(CAST(value_json AS BLOB))) OVER (ORDER BY seq DESC) AS bytes FROM output_records WHERE stream_id=?) WHERE bytes>10485760)',
        )
        .run(streamId, streamId);
      this.storage.db
        .prepare(
          'DELETE FROM output_records WHERE (stream_id,seq) IN (SELECT stream_id,seq FROM (SELECT stream_id,seq,SUM(length(CAST(value_json AS BLOB))) OVER (ORDER BY timestamp DESC,seq DESC) AS bytes FROM output_records) WHERE bytes>104857600)',
        )
        .run();
    })();
    workbenchEvents.publish(
      'terminal.output',
      {
        streamId,
        items: records,
        truncatedBefore: this.outputPage(streamId, 0, 1).truncatedBefore,
      },
      streamId,
      undefined,
      `output:${streamId}`,
    );
  }
  outputPage(streamId: string, after: number, limit = 100) {
    const rows = this.storage.db
      .prepare(
        'SELECT value_json FROM output_records WHERE stream_id=? AND seq>? ORDER BY seq LIMIT ?',
      )
      .all(streamId, after, limit) as { value_json: string }[];
    const first = (
      this.storage.db
        .prepare('SELECT MIN(seq) AS seq FROM output_records WHERE stream_id=?')
        .get(streamId) as { seq: number | null }
    ).seq;
    return {
      items: rows.map((r) => {
        const record = JSON.parse(r.value_json);
        return {
          ...record,
          restored: record.coreBootId
            ? record.coreBootId !== coreBootId
            : record.timestamp < this.startedAt,
        };
      }),
      truncatedBefore: first && first > 1 ? first : null,
    };
  }
  alterTerminal(workspaceId: string, owner: string, lease: string, id: string, action: string) {
    this.workspace.checkLease(workspaceId, owner, lease);
    const t = this.terminal(id, workspaceId);
    assert(
      ![...this.active.values()].some((e) => e.terminalId === id),
      'terminal_busy',
      '请先停止执行',
      409,
    );
    const { id: _, revision: _revision, ...value } = t;
    if (action === 'close') {
      value.archivedAt = now();
    } else if (action === 'restore') {
      value.archivedAt = null;
    } else if (action === 'clear-history') {
      value.history = [];
    } else if (action === 'clear-output') {
      this.storage.db.prepare('DELETE FROM output_records WHERE stream_id=?').run(id);
    } else {
      assert(false, 'invalid_action', '未知终端操作');
    }
    this.storage.db
      .prepare('UPDATE terminals SET value_json=?,revision=revision+1 WHERE id=?')
      .run(json(value), id);
    return this.terminal(id, workspaceId);
  }
  close() {
    this.flushOutput();
    this.unsubscribe();
    for (const release of this.sessions.values()) {
      release();
    }
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    for (const input of this.inputs.values()) {
      input.complete(undefined, new InvocationInputError('closed', '核心停止'));
    }
    for (const e of this.active.values()) {
      e.scope.cancel();
    }
    for (const c of this.completions.values()) {
      c.abort();
    }
    taskRegistry.off('change', this.changed);
    taskRegistry.off('owner.stop', this.ownerStopped);
    commandEvents.off('change', this.commandsChanged);
  }
}
