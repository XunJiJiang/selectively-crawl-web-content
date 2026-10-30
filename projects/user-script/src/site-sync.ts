import { type UserScriptSnapshot } from '../../shared/userscript-config.ts';
import { type SiteStore } from './site-store.ts';

export function coreUrl(config: UserScriptSnapshot['data']['config'], path: string) {
  const url = new URL(config.api.host);
  const port = config.api.port.replace(/[^\d]/g, '');
  if (
    !/^\d+$/.test(port) ||
    +port < 1 ||
    +port > 65535 ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    throw new Error('核心地址或端口无效');
  }
  url.port = port;
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
}
/** 每次成功连接都先同步，再订阅即时通知；离线编辑先落本地，恢复后重试。 */
export class SiteConfigConnection {
  private stopped = true;
  private socket?: WebSocket;
  private abort?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  private running = false;
  private queued = false;
  private generation = 0;
  private retryDelay = 500;
  private connectionKey = '';
  private store: SiteStore;
  constructor(store: SiteStore) {
    this.store = store;
  }
  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.store.addEventListener('change', this.changed);
    window.addEventListener('online', this.reconnect);
    window.addEventListener('pageshow', this.reconnect);
    void this.sync();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.abort?.abort();
    this.socket?.close();
    this.socket = undefined;
    this.store.removeEventListener('change', this.changed);
    window.removeEventListener('online', this.reconnect);
    window.removeEventListener('pageshow', this.reconnect);
  }
  private changed = (event: Event) => {
    const key = this.key();
    if (key !== this.connectionKey && this.connectionKey) {
      this.generation++;
      this.abort?.abort();
      this.socket?.close();
      this.socket = undefined;
    }
    if (
      (event as CustomEvent<{ source: string }>).detail.source === 'local' ||
      key !== this.connectionKey
    ) {
      void this.sync();
    }
  };
  private reconnect = () => {
    if (!this.stopped) {
      this.socket?.close();
      this.socket = undefined;
      void this.sync();
    }
  };
  private schedule() {
    if (this.stopped || this.retry) {
      return;
    }
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.sync();
    }, this.retryDelay);
    this.retryDelay = Math.min(15000, this.retryDelay * 2);
  }
  async sync() {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.queued = false;
    const generation = this.generation;
    const snapshot = this.store.snapshot,
      config = snapshot.data.config;
    this.connectionKey = this.key();
    const watch = !this.socket;
    const controller = (this.abort = new AbortController());
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const url = coreUrl(config, '/api/userscript/config/sync');
      url.searchParams.set('site', snapshot.website);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api.token}`,
        },
        body: JSON.stringify({ snapshot, watch }),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message ?? '网站配置同步失败');
      }
      if (this.stopped || generation !== this.generation) {
        return;
      }
      // 只有这份上传后没有新编辑时，才接受相同日期的核心裁决。
      this.store.accept(result.data.snapshot, this.store.snapshot.updatedAt === snapshot.updatedAt);
      if (this.stopped || generation !== this.generation) {
        return;
      }
      this.retryDelay = 500;
      clearTimeout(this.retry);
      this.retry = undefined;
      if (watch && result.data.ticket) {
        this.subscribe(config, result.data.ticket, generation);
      }
      if (watch) {
        this.store.dispatchEvent(new Event('connected'));
      }
      if (this.store.snapshot.updatedAt > result.data.snapshot.updatedAt) {
        this.queued = true;
      }
    } catch {
      if (!this.stopped && generation === this.generation) {
        this.schedule();
      }
    } finally {
      clearTimeout(timeout);
      this.running = false;
      if (this.queued && !this.stopped) {
        void this.sync();
      }
    }
  }
  private subscribe(
    config: UserScriptSnapshot['data']['config'],
    ticket: string,
    generation: number,
  ) {
    const url = coreUrl(config, '/api/userscript/config/events');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    const socket = (this.socket = new WebSocket(url));
    socket.onmessage = (event) => {
      if (this.stopped || generation !== this.generation || this.socket !== socket) {
        return;
      }
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'config.changed' && message.snapshot) {
          this.store.accept(message.snapshot, true);
          if (this.store.snapshot.updatedAt > message.snapshot.updatedAt) {
            void this.sync();
          }
        }
      } catch {
        socket.close();
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = undefined;
        this.schedule();
      }
    };
  }
  private key() {
    return JSON.stringify([this.store.snapshot.website, this.store.snapshot.data.config.api]);
  }
}
