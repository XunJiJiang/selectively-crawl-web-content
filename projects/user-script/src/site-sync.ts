import { type UserScriptSnapshot } from '../../shared/userscript-config.ts';
import { type SiteStore } from './site-store.ts';
import { requestCore } from './api/request.ts';

const pollInterval = 2000;

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
/** 使用油猴 HTTP 轮询接收更新；页面 WebSocket 同样受 connect-src 限制。 */
export class SiteConfigConnection {
  private stopped = true;
  private connected = false;
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
    this.connected = false;
    this.generation++;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.abort?.abort();
    this.store.removeEventListener('change', this.changed);
    window.removeEventListener('online', this.reconnect);
    window.removeEventListener('pageshow', this.reconnect);
  }
  private changed = (event: Event) => {
    const key = this.key();
    if (key !== this.connectionKey && this.connectionKey) {
      this.generation++;
      this.abort?.abort();
      this.connected = false;
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
      this.connected = false;
      void this.sync();
    }
  };
  private schedule(delay = this.retryDelay) {
    if (this.stopped || this.retry) {
      return;
    }
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.sync();
    }, delay);
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
    clearTimeout(this.retry);
    this.retry = undefined;
    const generation = this.generation;
    const snapshot = this.store.snapshot,
      config = snapshot.data.config;
    this.connectionKey = this.key();
    const controller = (this.abort = new AbortController());
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const url = coreUrl(config, '/api/userscript/config/sync');
      url.searchParams.set('site', snapshot.website);
      const response = await requestCore(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api.token}`,
        },
        body: JSON.stringify({ snapshot, watch: false }),
        signal: controller.signal,
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
      if (!this.connected) {
        this.connected = true;
        this.store.dispatchEvent(new Event('connected'));
      }
      this.schedule(pollInterval);
      if (this.store.snapshot.updatedAt > result.data.snapshot.updatedAt) {
        this.queued = true;
      }
    } catch {
      if (!this.stopped && generation === this.generation) {
        this.connected = false;
        this.schedule();
        this.retryDelay = Math.min(15000, this.retryDelay * 2);
      }
    } finally {
      clearTimeout(timeout);
      this.running = false;
      if (this.queued && !this.stopped) {
        void this.sync();
      }
    }
  }
  private key() {
    return JSON.stringify([this.store.snapshot.website, this.store.snapshot.data.config.api]);
  }
}
