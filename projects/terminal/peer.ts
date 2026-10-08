import { randomUUID } from 'node:crypto';
import { serialize } from 'node:v8';
import type { Packet } from './protocol.ts';

export class Peer {
  sessionId = '';
  onCall?: (method: string, args: unknown) => unknown | Promise<unknown>;
  onEvent?: (event: string, data: unknown) => void;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
  >();
  private closed = false;
  private incoming = 0;
  private sending = 0;
  private critical: Packet[] = [];
  private flushing = false;
  private queuedBytes = 0;
  private sendPacket: (packet: Packet, callback: (error: Error | null) => void) => void;
  constructor(sendPacket: (packet: Packet, callback: (error: Error | null) => void) => void) {
    this.sendPacket = sendPacket;
  }
  private send(packet: Packet) {
    if (this.closed || this.sending >= 128 || serialize(packet).byteLength > 1024 * 1024) {
      return Promise.reject(new Error('终端通信已关闭或队列已满'));
    }
    return new Promise<void>((resolve, reject) => {
      this.sending++;
      const complete = (error: Error | null) => {
        this.sending--;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      try {
        this.sendPacket(packet, complete);
      } catch (error) {
        complete(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  call<T = unknown>(method: string, args?: unknown, timeout = 10000): Promise<T> {
    if (this.closed || this.pending.size >= 64) {
      return Promise.reject(new Error('终端通信不可用'));
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`终端请求超时：${method}`));
            }, timeout)
          : undefined;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      void this.send({
        version: 1,
        sessionId: this.sessionId,
        kind: 'call',
        id,
        method,
        args,
      }).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  event(event: string, data: unknown) {
    if (this.closed) {
      return;
    }
    const packet: Packet = { version: 1, sessionId: this.sessionId, kind: 'event', event, data };
    const bytes = serialize(packet).byteLength;
    // Queue bursts in order; never let command.finished overtake command output.
    if (
      bytes > 1024 * 1024 ||
      this.queuedBytes + bytes > 32 * 1024 * 1024 ||
      this.critical.length >= 16384
    ) {
      // Extreme overload is explicit and attributed to the original window.
      if (event === 'output') {
        const last = this.critical.at(-1);
        if (last?.kind === 'event' && last.event === 'output.overflow') {
          return;
        }
        const marker: Packet = {
          ...packet,
          event: 'output.overflow',
          data: {
            ...(data as object),
            text: '[输出队列超过 32 MiB 或 16384 条限制，部分输出已截断]',
          },
        };
        this.critical.push(marker);
        this.queuedBytes += serialize(marker).byteLength;
        void this.flushCritical();
      } else {
        this.close();
      }
      return;
    }
    this.queuedBytes += bytes;
    this.critical.push(packet);
    void this.flushCritical();
  }
  private async flushCritical() {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      while (this.critical.length && !this.closed) {
        try {
          await this.send(this.critical[0]);
          const packet = this.critical.shift();
          if (packet) {
            this.queuedBytes = Math.max(0, this.queuedBytes - serialize(packet).byteLength);
          }
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    } finally {
      this.flushing = false;
    }
  }
  receive(value: unknown) {
    if (
      this.closed ||
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('kind' in value)
    ) {
      return;
    }
    const packet = value as Packet;
    if (packet.kind === 'call') {
      if (packet.method !== 'hello' && packet.sessionId !== this.sessionId) {
        return;
      }
      if (this.incoming >= 64) {
        return;
      }
      this.incoming++;
      void Promise.resolve()
        .then(() => {
          if (!this.onCall) {
            throw new Error('终端处理器未就绪');
          }
          return this.onCall(packet.method, packet.args);
        })
        .then((result) =>
          this.send({
            version: 1,
            sessionId: this.sessionId,
            kind: 'result',
            id: packet.id,
            value: result,
          }),
        )
        .catch((error) =>
          this.send({
            version: 1,
            sessionId: this.sessionId,
            kind: 'result',
            id: packet.id,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined),
        )
        .finally(() => {
          this.incoming--;
        });
    } else if (packet.kind === 'result') {
      const pending = this.pending.get(packet.id);
      if (!pending) {
        return;
      }
      // The first hello response establishes the new core session.
      if (this.sessionId && packet.sessionId !== this.sessionId) {
        return;
      }
      if (!this.sessionId) {
        this.sessionId = packet.sessionId;
      }
      clearTimeout(pending.timer);
      this.pending.delete(packet.id);
      if (packet.error) {
        pending.reject(new Error(packet.error));
      } else {
        pending.resolve(packet.value);
      }
    } else if (
      packet.kind === 'event' &&
      (!this.sessionId || packet.sessionId === this.sessionId)
    ) {
      this.onEvent?.(packet.event === 'output.overflow' ? 'output' : packet.event, packet.data);
    }
  }
  close() {
    this.closed = true;
    this.critical = [];
    this.queuedBytes = 0;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('终端连接已断开'));
    }
    this.pending.clear();
  }
}
