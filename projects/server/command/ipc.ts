import { randomUUID } from 'node:crypto';
import { Peer } from '../../terminal/peer.ts';
import {
  getCommands,
  completeCommand,
  commandEvents,
  parseAndRunCommands,
  validateCommand,
} from '../utils/command.ts';
import { setLogSink } from '../utils/log.ts';
import { configureTaskIdentity, taskRegistry } from '../common/tasks.ts';
import { InvocationInputError, setInputHandler } from '../common/interaction.ts';
import { pluginClients } from '../plugin/process/client.ts';
import type { TaskScope } from '../common/tasks.ts';
import type { ExecutionEvent } from '../../terminal/protocol.ts';

export function createCoreBridge(shutdown: (restart: boolean) => Promise<void>) {
  if (!process.send || !process.connected) {
    throw new Error('IPC 模式需要终端父进程连接');
  }
  const peer = new Peer((packet, callback) => {
    if (!process.send || !process.connected) {
      callback(new Error('终端已断开'));
      return;
    }
    process.send(packet, callback);
  });
  peer.sessionId = randomUUID();
  process.on('message', (message) => peer.receive(message));
  const handshake = Promise.withResolvers<void>();
  const timer = setTimeout(() => handshake.reject(new Error('终端握手超时')), 15000);
  const executions = new Map<
    string,
    {
      event: ExecutionEvent;
      scope: TaskScope;
      returned: boolean;
      done: boolean;
      error?: string;
      interrupted?: boolean;
    }
  >();
  const confirmations = new Map<string, (answer: boolean) => void>();
  const inputs = new Map<string, (value?: string, error?: Error) => void>();
  setInputHandler(
    (request, signal) =>
      new Promise((resolve, reject) => {
        const execution = executions.get(request.identity.executionId);
        if (!execution || execution.done) {
          reject(new Error('输入请求没有活动命令'));
          return;
        }
        const abort = () =>
          complete(undefined, new InvocationInputError('cancelled', '输入已取消'));
        const complete = (value?: string, error?: Error) => {
          inputs.delete(request.id);
          signal.removeEventListener('abort', abort);
          peer.event('input.closed', { id: request.id, windowId: request.identity.windowId });
          if (error) {
            reject(error);
          } else {
            resolve(value ?? '');
          }
        };
        inputs.set(request.id, complete);
        signal.addEventListener('abort', abort, { once: true });
        peer.event('input.request', request);
      }),
  );
  let stopping = false;
  const changed = () => {
    for (const execution of executions.values()) {
      if (!execution.returned || execution.done || taskRegistry.busy(execution.event.executionId)) {
        continue;
      }
      execution.done = true;
      const status = execution.interrupted
        ? 'interrupted'
        : execution.scope.controller.signal.aborted
          ? 'cancelled'
          : execution.error
            ? 'failed'
            : 'succeeded';
      execution.event = { ...execution.event, status, error: execution.error };
      peer.event('command.finished', execution.event);
    }
    peer.event('task.changed', taskRegistry.list());
  };
  taskRegistry.on('change', changed);
  taskRegistry.on('owner.stop', ({ identities }: { identities: { executionId: string }[] }) => {
    for (const execution of executions.values()) {
      const ids = taskRegistry.executionIds(execution.event.executionId);
      if (!execution.done && identities.some((identity) => ids.has(identity.executionId))) {
        execution.interrupted = true;
        execution.error = '插件宿主停止，任务已中断';
      }
    }
  });
  commandEvents.on('change', (commands) => peer.event('commands', commands));
  setLogSink((output) => {
    if (!output.sessionId || output.sessionId === peer.sessionId) {
      peer.event('output', output);
    }
  });
  async function cancel(executionId?: string, force = false) {
    const ids = executionId ? taskRegistry.executionIds(executionId) : new Set<string>();
    if (executionId) {
      for (let round = 0; round < executions.size; round++) {
        for (const record of executions.values()) {
          if (
            record.scope.identity?.parentExecutionId &&
            ids.has(record.scope.identity.parentExecutionId)
          ) {
            ids.add(record.event.executionId);
          }
        }
      }
    }
    const relevant = () =>
      taskRegistry
        .list()
        .filter((item) => !executionId || (item.identity && ids.has(item.identity.executionId)));
    if (executionId) {
      for (const id of ids) {
        taskRegistry.cancel(id);
        for (const client of pluginClients.values()) {
          client.cancel(id);
        }
      }
    } else {
      taskRegistry.cancel();
      for (const client of pluginClients.values()) {
        client.cancel();
      }
    }
    await taskRegistry.waitIdle(executionId, 2000);
    if (!relevant().length) {
      return { cancelled: true };
    }
    const owners = new Set(relevant().map((item) => item.owner));
    if (!force) {
      return { cancelled: false, needsForce: true, owners: [...owners] };
    }
    await Promise.all(
      [...owners].map(async (owner) => {
        const client = pluginClients.get(owner);
        if (client) {
          await client.terminate();
        }
      }),
    );
    // Killing a host rejects its RPC, allowing the real core wrapper to settle.
    await taskRegistry.waitIdle(executionId, 1000);
    changed();
    return { cancelled: !relevant().length };
  }
  peer.onCall = async (method, args) => {
    const data = (args ?? {}) as Record<string, unknown>;
    if (method === 'hello') {
      if (typeof data.outputWindowId !== 'string') {
        throw new Error('缺少输出窗口 ID');
      }
      configureTaskIdentity(data.outputWindowId, peer.sessionId);
      clearTimeout(timer);
      handshake.resolve();
      return { sessionId: peer.sessionId };
    }
    if (method === 'confirmation.answer') {
      confirmations.get(String(data.id))?.(data.answer === true);
      return;
    }
    if (method === 'input.answer') {
      const complete = inputs.get(String(data.id));
      if (!complete) {
        throw new Error('输入请求已结束');
      }
      if (data.error === 'eof') {
        complete(undefined, new InvocationInputError('closed', '输入流已关闭'));
      } else if (data.error === 'cancelled') {
        complete(undefined, new InvocationInputError('cancelled', '用户取消输入'));
      } else if (data.error === 'busy') {
        complete(undefined, new InvocationInputError('busy', '当前窗口正在等待其他输入'));
      } else if (typeof data.value === 'string') {
        complete(data.value);
      } else {
        throw new Error('无效输入内容');
      }
      return;
    }
    if (method === 'tasks.snapshot') {
      return taskRegistry.list();
    }
    if (method === 'command.validate') {
      return validateCommand(String(data.command ?? ''));
    }
    if (method === 'command.complete') {
      if (typeof data.command !== 'string' || !Number.isInteger(data.cursor)) {
        throw new Error('无效的命令补全请求');
      }
      return completeCommand({ command: data.command, cursor: data.cursor as number });
    }
    if (method === 'command.execute') {
      if (stopping) {
        throw new Error('核心正在停止');
      }
      const command = String(data.command ?? '');
      const { name } = validateCommand(command);
      if (name === 'exit' || name === 'restart') {
        if (data.parentExecutionId) {
          throw new Error('子命令不能直接执行生命周期操作');
        }
        peer.event('lifecycle.request', { restart: name === 'restart' });
        return { control: true };
      }
      const windowId = String(data.windowId ?? '');
      const executionId = String(data.executionId ?? '');
      if (!windowId || !executionId || executions.has(executionId)) {
        throw new Error('无效的窗口或执行 ID');
      }
      const parentExecutionId =
        typeof data.parentExecutionId === 'string' ? data.parentExecutionId : undefined;
      if (
        !parentExecutionId &&
        [...executions.values()].some((item) => !item.done && item.event.windowId === windowId)
      ) {
        throw new Error('当前窗口有任务正在执行');
      }
      const scope = taskRegistry.create('core', {
        windowId,
        executionId,
        sessionId: peer.sessionId,
        parentExecutionId,
      });
      const record = {
        event: { windowId, executionId, command, status: 'running' } as ExecutionEvent,
        scope,
        returned: false,
        done: false,
        error: undefined as string | undefined,
      };
      executions.set(executionId, record);
      peer.event('command.started', record.event);
      void parseAndRunCommands(command, scope.context)
        .catch((error) => {
          record.error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          scope.finish();
          record.returned = true;
          peer.event('command.returned', {
            ...record.event,
            status: taskRegistry.busy(executionId)
              ? 'background'
              : record.error
                ? 'failed'
                : 'succeeded',
            error: record.error,
          });
          changed();
          if (executions.size > 4096) {
            for (const [id, item] of executions) {
              if (item.done) {
                executions.delete(id);
                break;
              }
            }
          }
        });
      return { executionId };
    }
    if (method === 'command.cancel') {
      return cancel(
        typeof data.executionId === 'string' ? data.executionId : undefined,
        data.force === true,
      );
    }
    if (method === 'lifecycle.exit' || method === 'lifecycle.restart') {
      const result = await cancel(undefined, data.force === true);
      if (!result.cancelled) {
        return result;
      }
      stopping = true;
      peer.event('stopping', { restart: method === 'lifecycle.restart' });
      // Reply before the orderly process exit closes IPC.
      setTimeout(() => {
        void shutdown(method === 'lifecycle.restart');
      }, 10);
      return { stopping: true };
    }
    throw new Error(`未知终端请求：${method}`);
  };
  process.once('disconnect', () => {
    clearTimeout(timer);
    for (const complete of [...inputs.values()]) {
      complete(undefined, new Error('终端已断开'));
    }
    setInputHandler();
    void shutdown(false);
  });
  return {
    handshake: handshake.promise,
    ready: (port: number) => peer.event('ready', { port, commands: getCommands() }),
    confirm: (text: string) =>
      new Promise<boolean>((resolve) => {
        const id = randomUUID();
        confirmations.set(id, (answer) => {
          confirmations.delete(id);
          resolve(answer);
        });
        peer.event('confirmation.request', { id, text });
      }),
  };
}
