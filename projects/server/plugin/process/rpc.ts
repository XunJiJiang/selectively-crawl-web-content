import { randomUUID } from 'node:crypto';
import { serialize } from 'node:v8';
import {
  MAX_MESSAGE_BYTES,
  MAX_PENDING_CALLS,
  PluginProcessError,
  remoteError,
  type Message,
} from './protocol.ts';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Both ends use the same bounded protocol; callbacks stay in their owning process. */
export class RpcPeer {
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  private incoming = 0;
  private sending = 0;
  readonly sendMessage: (message: Message, callback: (error: Error | null) => void) => void;
  onCall?: (method: string, args: unknown, id: string) => unknown | Promise<unknown>;
  onEvent?: (event: string, data: unknown) => void;
  onEventError?: (error: unknown) => void;

  constructor(send: RpcPeer['sendMessage']) {
    this.sendMessage = send;
  }

  private send(message: Message): Promise<void> {
    if (this.closed) {
      return Promise.reject(new PluginProcessError('插件通信已关闭'));
    }
    try {
      if (this.sending >= 128) {
        throw new PluginProcessError('插件 IPC 发送队列已满', 429, 'PLUGIN_BUSY');
      }
      if (serialize(message).byteLength > MAX_MESSAGE_BYTES) {
        throw new PluginProcessError('插件消息超过 16 MiB 限制', 413, 'PLUGIN_MESSAGE_TOO_LARGE');
      }
      return new Promise((resolve, reject) => {
        this.sending++;
        try {
          this.sendMessage(message, (error) => {
            this.sending--;
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        } catch (error) {
          this.sending--;
          reject(error);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  call<T>(method: string, args: unknown, timeoutMs: number, id: string = randomUUID()): Promise<T> {
    if (this.closed) {
      return Promise.reject(new PluginProcessError('插件通信已关闭'));
    }
    if (this.pending.size >= MAX_PENDING_CALLS) {
      return Promise.reject(new PluginProcessError('插件请求队列已满', 429, 'PLUGIN_BUSY'));
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PluginProcessError('插件调用超时；业务操作可能仍在执行', 504, 'PLUGIN_TIMEOUT'));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      void this.send({ version: 2, kind: 'call', id, method, args }).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  event(event: string, data: unknown): void {
    void this.send({ version: 2, kind: 'event', event, data }).catch(() => {
      /* The peer may already be disconnected. */
    });
  }

  receive(message: unknown): void {
    if (
      this.closed ||
      !message ||
      typeof message !== 'object' ||
      !('version' in message) ||
      message.version !== 2 ||
      !('kind' in message)
    ) {
      return;
    }
    const value = message as Message;
    if (value.kind === 'result') {
      const pending = this.pending.get(value.id);
      if (!pending) {
        return;
      }
      this.pending.delete(value.id);
      clearTimeout(pending.timer);
      if (value.error) {
        pending.reject(
          new PluginProcessError(
            value.error.message,
            value.error.status ?? 500,
            value.error.code ?? 'PLUGIN_ERROR',
          ),
        );
      } else {
        pending.resolve(value.value);
      }
    } else if (value.kind === 'event') {
      try {
        this.onEvent?.(value.event, value.data);
      } catch (error) {
        this.onEventError?.(error);
      }
    } else if (value.kind === 'call') {
      if (this.incoming >= MAX_PENDING_CALLS) {
        void this.send({
          version: 2,
          kind: 'result',
          id: value.id,
          error: remoteError(new PluginProcessError('插件请求队列已满', 429, 'PLUGIN_BUSY')),
        }).catch(() => {
          /* The peer may already be disconnected. */
        });
        return;
      }
      this.incoming++;
      void Promise.resolve()
        .then(() => {
          if (!this.onCall) {
            throw new Error('插件未注册通信处理器');
          }
          return this.onCall(value.method, value.args, value.id);
        })
        .then((result) => this.send({ version: 2, kind: 'result', id: value.id, value: result }))
        .catch((error) =>
          this.send({ version: 2, kind: 'result', id: value.id, error: remoteError(error) }).catch(
            () => {
              /* The peer may already be disconnected. */
            },
          ),
        )
        .finally(() => {
          this.incoming--;
        });
    }
  }

  close(error = new PluginProcessError('插件进程已退出')): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
