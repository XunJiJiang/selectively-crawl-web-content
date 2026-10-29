/** Browser-only, versioned instance protocol shared by the host and injected SDK. */
export const PROTOCOL = 'scwc-workbench';
export interface Envelope {
  protocol: typeof PROTOCOL;
  version: 1;
  kind: 'request' | 'response' | 'event' | 'cancel';
  requestId?: string;
  method: string;
  tabId: string;
  frameEpoch: string;
  sequence: number;
  payload: unknown;
  error?: string;
}
export interface PageSearchBatch {
  items: { id: string; title: string; description?: string; url?: string }[];
  nextCursor: string | null;
  total?: number;
}
export class InstancePort {
  private seq = 0;
  private received = 0;
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  onRequest?: (method: string, payload: unknown, requestId: string) => Promise<unknown>;
  onEvent?: (method: string, payload: unknown) => void;
  onCancel?: (id: string) => void;
  readonly port: MessagePort;
  readonly tabId: string;
  readonly frameEpoch: string;
  constructor(port: MessagePort, tabId: string, frameEpoch: string) {
    this.port = port;
    this.tabId = tabId;
    this.frameEpoch = frameEpoch;
    port.onmessage = (e) => void this.receive(e.data);
    port.start();
  }
  private send(
    kind: Envelope['kind'],
    method: string,
    payload: unknown,
    requestId?: string,
    error?: string,
  ) {
    const message: Envelope = {
      protocol: PROTOCOL,
      version: 1,
      kind,
      method,
      payload,
      requestId,
      tabId: this.tabId,
      frameEpoch: this.frameEpoch,
      sequence: ++this.seq,
      ...(error ? { error } : {}),
    };
    if (JSON.stringify(message).length > 262144) {
      throw new Error('页面消息超过 256KiB');
    }
    this.port.postMessage(message);
  }
  event(method: string, payload: unknown) {
    this.send('event', method, payload);
  }
  request<T = unknown>(
    method: string,
    payload: unknown,
    timeout = 5000,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.pending.size >= 32) {
      return Promise.reject(new Error('页面请求过多'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('已取消'));
    }
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const p = this.pending.get(id);
        if (!p) {
          return;
        }
        clearTimeout(p.timer);
        this.pending.delete(id);
        this.send('cancel', method, null, id);
        reject(new Error('已取消'));
      };
      const done = (run: () => void) => {
        signal?.removeEventListener('abort', abort);
        run();
      };
      const timer = setTimeout(() => {
        abort();
      }, timeout);
      this.pending.set(id, {
        resolve: (v) => done(() => resolve(v as T)),
        reject: (e) => done(() => reject(e)),
        timer,
      });
      signal?.addEventListener('abort', abort, { once: true });
      try {
        this.send('request', method, payload, id);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        done(() => reject(e));
      }
    });
  }
  private async receive(m: Envelope) {
    if (
      m?.protocol !== PROTOCOL ||
      m.version !== 1 ||
      m.tabId !== this.tabId ||
      m.frameEpoch !== this.frameEpoch ||
      !Number.isSafeInteger(m.sequence) ||
      m.sequence <= this.received
    ) {
      return;
    }
    if (JSON.stringify(m).length > 262144) {
      return;
    }
    this.received = m.sequence;
    if (m.kind === 'response' && m.requestId) {
      const p = this.pending.get(m.requestId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.requestId);
        if (m.error) {
          p.reject(new Error(m.error));
        } else {
          p.resolve(m.payload);
        }
      }
      return;
    }
    if (m.kind === 'event') {
      this.onEvent?.(m.method, m.payload);
      return;
    }
    if (m.kind === 'cancel') {
      this.onCancel?.(m.requestId ?? '');
      return;
    }
    if (m.kind === 'request' && m.requestId) {
      try {
        const value = await this.onRequest?.(m.method, m.payload, m.requestId);
        this.send('response', m.method, value ?? null, m.requestId);
      } catch (e) {
        this.send(
          'response',
          m.method,
          null,
          m.requestId,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }
  close() {
    this.port.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('页面通道已关闭'));
    }
    this.pending.clear();
  }
}

export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Required workbench state is unavailable');
  }
  return value;
}
