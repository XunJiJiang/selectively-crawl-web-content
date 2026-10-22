import { TicketSocket } from './ticket-socket.ts';
import {
  requireValue,
  InstancePort,
  PROTOCOL,
  type PageRegistration,
  type PageSearchBatch,
} from '../../shared/workbench-protocol.ts';
import type {
  ConfigChange,
  ConfigDefinition,
  ConfigSnapshot,
} from '../../server/types/plugin-config.d.ts';
import type { TFetch } from './utils/fetch.ts';
export interface Session {
  grant: string;
  safeId: string;
  tabId: string;
  frameEpoch: string;
  expiresAt: number;
}
type LocalItem = ConfigDefinition['items'][number] & {
  format?: (raw: string) => string;
  normalize?: (raw: string) => string | Promise<string>;
  validate?: (raw: string) => true | string | Promise<true | string>;
};
interface Lifecycle {
  canLeave?: (reason: string) => boolean | Promise<boolean>;
  onSuspend?: () => void | Promise<void>;
  onResume?: () => void | Promise<void>;
  serialize?: () => unknown | Promise<unknown>;
  restore?: (state: unknown) => void | Promise<void>;
  capturePreview?: () => Blob | Promise<Blob>;
}
interface SearchOptions {
  search: (request: {
    query: string;
    cursor: string | null;
    limit: number;
    signal: AbortSignal;
  }) => Promise<PageSearchBatch>;
}
interface SettingsOptions {
  schemaId: string;
  schemaVersion: string;
  contextKey?: string;
  items: LocalItem[];
}
export function createWorkbenchSDK(install: (fetch: TFetch) => void) {
  let port: InstancePort | undefined,
    session: Session | undefined,
    readyResolve: () => void,
    readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  void ready.catch(() => undefined);
  const hosted = window.parent !== window;
  const nonce = crypto.randomUUID();
  let hostFocused = false,
    hostVisible = true;
  let navigationBase = 0,
    navigationPosition = 0;
  const navigationUrls = [location.href];
  const historyKey = `scwc:${nonce}`;
  const stateWithPosition = (state: unknown, index: number) =>
    state === null || typeof state === 'object'
      ? { ...(state as object), [historyKey]: index }
      : state;
  const rawReplaceState = history.replaceState.bind(history);
  rawReplaceState(stateWithPosition(history.state, 0), '');

  let lifecycle: Lifecycle = {};
  let search: SearchOptions | undefined;
  let searchRevision = 0;
  const managedRequests = new Set<AbortController>();
  const registrations = new Map<string, SettingsOptions>(),
    requests = new Map<string, AbortController>(),
    configListeners = new Set<(change: ConfigChange) => void>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const emit = (method: string, value: unknown) =>
    listeners.get(method)?.forEach((fn) => fn(value));
  const on = (method: string, fn: (value: unknown) => void) => {
    if (!listeners.has(method)) {
      listeners.set(method, new Set());
    }
    listeners.get(method)?.add(fn);
    return () => listeners.get(method)?.delete(fn);
  };
  async function request<T>(path: string, body?: unknown): Promise<T> {
    await ready;
    if (!session) {
      throw new Error('页面尚未授权');
    }
    const response = await fetch(`/web/api/workbench${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${session.grant}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      referrerPolicy: 'same-origin',
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.message ?? '请求失败');
    }
    return data.data;
  }
  const configPath = () =>
    `/plugins/${encodeURIComponent(decodeURIComponent(location.pathname.split('/')[4]))}/config`;
  let themeMode = 'dark-2026',
    themeTokens: Record<string, string> = {};
  let keybindings: { id: string; keys: string[] }[] = [];
  const applyTheme = (value: unknown) => {
    if (typeof value === 'string') {
      themeMode = value;
    } else if (value && typeof value === 'object') {
      const data = value as { mode: string; tokens?: Record<string, string> };
      themeMode = data.mode;
      themeTokens = data.tokens ?? {};
    }
  };
  const api = {
    ready,
    externalState: {
      get inWorkbench() {
        return Boolean(port);
      },
      get inBrowser() {
        return !hosted;
      },
      get focused(): boolean | undefined {
        return port ? hostFocused : undefined;
      },
      get visible(): boolean | undefined {
        return port ? hostVisible : undefined;
      },
      get() {
        return {
          inWorkbench: Boolean(port),
          inBrowser: !hosted,
          focused: port ? hostFocused : undefined,
          visible: port ? hostVisible : undefined,
        };
      },
      onChange: (fn: (value: unknown) => void) => on('external-state.changed', fn),
    },
    theme: {
      get mode() {
        return themeMode;
      },
      get tokens() {
        return { ...themeTokens };
      },
      onChange: (fn: (value: { mode: string; tokens: Record<string, string> }) => void) =>
        on('theme.changed', () => fn({ mode: themeMode, tokens: { ...themeTokens } })),
    },
    host: {
      capabilities: { workbench: hosted, search: hosted, configuration: true, lifecycle: hosted },
      executeCommand: async (commandId: string, args?: unknown) => {
        await ready;
        if (!port) {
          throw new Error('unsupported');
        }
        return port.request('host.executeCommand', { commandId, args });
      },
    },
    page: {
      register: async (value: PageRegistration) => {
        await ready;
        port?.event('page.update', value);
      },
      update: async (value: PageRegistration) => {
        await ready;
        port?.event('page.update', value);
      },
      onVisibility: (fn: (visible: boolean) => void) =>
        on('visibility.changed', (v) => fn(Boolean(v))),
      onFocus: (fn: (focused: boolean) => void) => on('focus.changed', (v) => fn(Boolean(v))),
    },
    navigation: {
      report: async (value: { url: string; title?: string; replace?: boolean; index?: number }) => {
        await ready;
        port?.event('navigation.report', value);
      },
      navigate: async (url: string) => {
        await ready;
        if (port) {
          return port.request('navigation.navigate', { url });
        }
        location.replace(url);
      },
      registerAdapter: (adapter: (url: string) => void | Promise<void>) => {
        navigationAdapter = adapter;
        return {
          dispose() {
            navigationAdapter = undefined;
          },
        };
      },
    },
    settings: {
      register: async (options: SettingsOptions) => {
        await ready;
        if (options.items.length > 200) {
          throw new Error('配置项过多');
        }
        const define = async (value: SettingsOptions) => {
          const current = await request<ConfigSnapshot>(configPath());
          const definition: ConfigDefinition = {
            id: value.schemaId,
            schemaVersion: value.schemaVersion,
            items: value.items.map(({ format: _, normalize: __, validate: ___, ...item }) => item),
          };
          await request(`${configPath()}/definitions`, {
            definition,
            baseRevision: current.revision,
          });
          port?.event('settings.changed', { schemaId: value.schemaId });
        };
        await define(options);
        registrations.set(options.schemaId, options);
        let current = options;
        return {
          update: async (value: SettingsOptions) => {
            if (value.schemaId !== current.schemaId) {
              throw new Error('配置注册 ID 不能在 update 中改变');
            }
            await define(value);
            registrations.set(value.schemaId, value);
            current = value;
          },
          dispose: async () => {
            if (registrations.get(options.schemaId) === current) {
              registrations.delete(options.schemaId);
            }
            port?.event('settings.changed', { schemaId: options.schemaId });
          },
        };
      },
    },
    search: {
      register: async (options: SearchOptions) => {
        await ready;
        if (!hosted || !port) {
          throw new Error('unsupported');
        }
        for (const r of requests.values()) {
          r.abort();
        }
        search = options;
        port.event('search.changed', { revision: ++searchRevision, available: true });
        return {
          dispose: async () => {
            if (search !== options) {
              return;
            }
            search = undefined;
            for (const r of requests.values()) {
              r.abort();
            }
            port?.event('search.changed', { revision: ++searchRevision, available: false });
          },
        };
      },
    },
    config: {
      get: async (keys?: string[]) => {
        const snapshot = await request<ConfigSnapshot>(configPath());
        return keys
          ? {
              ...snapshot,
              values: Object.fromEntries(
                keys
                  .filter((k) => k in snapshot.effectiveValues)
                  .map((k) => [k, snapshot.effectiveValues[k]]),
              ),
            }
          : snapshot;
      },
      set: async (values: Record<string, string>, options?: { baseRevision?: number }) => {
        const current = await request<ConfigSnapshot>(configPath());
        const normalized = await validateValues(values);
        const ticket = await validation(
          normalized,
          [],
          options?.baseRevision ?? current.revision,
          current.schemaRevision,
        );
        return request<ConfigSnapshot>(`${configPath()}/update`, {
          values: normalized,
          baseRevision: options?.baseRevision ?? current.revision,
          schemaRevision: current.schemaRevision,
          ...ticket,
        });
      },
      reset: async (keys: string[], options?: { baseRevision?: number }) => {
        const current = await request<ConfigSnapshot>(configPath());
        const ticket = await validation(
          {},
          keys,
          options?.baseRevision ?? current.revision,
          current.schemaRevision,
        );
        return request<ConfigSnapshot>(`${configPath()}/reset`, {
          keys,
          baseRevision: options?.baseRevision ?? current.revision,
          schemaRevision: current.schemaRevision,
          ...ticket,
        });
      },
      subscribe: (keys: string[], fn: (change: ConfigChange) => void) => {
        const listener = (change: ConfigChange) => {
          if (change.changedKeys.some((k) => keys.includes(k))) {
            fn(change);
          }
        };
        configListeners.add(listener);
        return () => configListeners.delete(listener);
      },
    },
    lifecycle: {
      checkpoint: async () => {
        await ready;
        port?.event('state.checkpoint', {});
      },
      register: (callbacks: Lifecycle) => {
        lifecycle = callbacks;
        void ready.then(() =>
          port?.event('lifecycle.changed', {
            serialize: Boolean(callbacks.serialize),
            restore: Boolean(callbacks.restore),
            canLeave: Boolean(callbacks.canLeave),
          }),
        );
        return {
          dispose() {
            if (lifecycle === callbacks) {
              lifecycle = {};
            }
          },
        };
      },
    },
    activity: {
      acquire: (reason: string) => {
        const id = crypto.randomUUID();
        void ready.then(() => port?.event('activity.acquire', { id, reason }));
        return {
          id,
          release() {
            port?.event('activity.release', { id });
          },
        };
      },
      release: (id: string) => port?.event('activity.release', { id }),
    },
    logger: Object.fromEntries(
      ['info', 'success', 'warn', 'error'].map((level) => [
        level,
        (title: string, options?: unknown) =>
          request('/notifications/publish', { level, title, options }),
      ]),
    ) as Record<
      'info' | 'success' | 'warn' | 'error',
      (
        title: string,
        options?: { message?: string; dedupeKey?: string; target?: { pluginPath: string } },
      ) => Promise<unknown>
    >,
    requests: {
      track: async <T>(operation: () => Promise<T>) => {
        port?.event('requests.changed', { delta: 1 });
        const start = performance.now();
        let failed = false;
        try {
          return await operation();
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          port?.event('requests.changed', {
            delta: -1,
            duration: performance.now() - start,
            failed,
          });
        }
      },
    },
    websocketAsync: async (url: string, protocols?: string | string[]) => {
      const result = await request<{ ticket: string }>('/stream-ticket', {});
      return openSocket(url, result.ticket, protocols);
    },
  };
  let navigationAdapter: ((url: string) => void | Promise<void>) | undefined;
  async function validateValues(values: Record<string, string>) {
    const next = { ...values };
    for (const options of registrations.values()) {
      for (const item of options.items) {
        if (!(item.key in next)) {
          continue;
        }
        if (item.normalize) {
          next[item.key] = await item.normalize(next[item.key]);
        }
        if (typeof next[item.key] !== 'string') {
          throw new Error('配置值必须为字符串');
        }
        if (item.validate) {
          const result = await item.validate(next[item.key]);
          if (result !== true) {
            throw new Error(result);
          }
        }
      }
    }
    return next;
  }
  async function validation(
    values: Record<string, string>,
    keys: string[],
    baseRevision: number,
    schemaRevision: number,
  ) {
    for (const options of registrations.values()) {
      for (const item of options.items) {
        if (keys.includes(item.key) && item.validate && item.defaultValue !== undefined) {
          const result = await item.validate(item.defaultValue);
          if (result !== true) {
            throw new Error(result);
          }
        }
      }
    }
    return request<{ validationTicket: string }>(`${configPath()}/validation`, {
      accepted: true,
      values,
      keys,
      baseRevision,
      schemaRevision,
    });
  }
  function openSocket(path: string, ticket: string, protocols?: string | string[]) {
    if (!session) {
      throw new Error('页面尚未授权');
    }
    const url = new URL(
      `/web/websocket/plugin/${session.safeId}/${path.replace(/^\//, '')}`,
      location.origin,
    );
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('site', location.href);
    url.searchParams.set('ticket', ticket);
    return new WebSocket(url, protocols);
  }
  function installSession(value: Session) {
    session = value;
    install(
      Object.assign(
        async (path: string, options?: RequestInit) => {
          const url = new URL(
            `/web/api/plugin/${requireValue(session).safeId}/${path.replace(/^\//, '')}`,
            location.origin,
          );
          url.searchParams.set('site', location.href);
          const headers = new Headers(options?.headers);
          headers.set('Authorization', `Bearer ${requireValue(session).grant}`);
          if (!headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
          }
          const controller = new AbortController(),
            abort = () => controller.abort();
          managedRequests.add(controller);
          options?.signal?.addEventListener('abort', abort, { once: true });
          if (options?.signal?.aborted) {
            controller.abort();
          }
          try {
            return await api.requests.track(async () => {
              const response = await fetch(url, { ...options, headers, signal: controller.signal });
              return response.json();
            });
          } finally {
            managedRequests.delete(controller);
            options?.signal?.removeEventListener('abort', abort);
          }
        },
        {
          resource: (path: string) => {
            const url = new URL(
              `/web/resource/plugin/${requireValue(session).safeId}/${path.replace(/^\//, '')}`,
              location.origin,
            );
            url.searchParams.set('site', location.href);
            return url.href;
          },
          websocket: (path: string, protocols?: string | string[]) =>
            new TicketSocket(() => api.websocketAsync(path, protocols)).asWebSocket(),
        },
      ) as TFetch,
    );
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (port) {
        port.event('session.renew', {});
      } else {
        void standalone();
      }
    }, 240000);
  }
  async function handle(method: string, payload: unknown, id: string) {
    const data = payload as Record<string, unknown>;
    if (method === 'search.query') {
      if (!search) {
        throw new Error('页面没有注册搜索');
      }
      const controller = new AbortController();
      requests.set(id, controller);
      try {
        return await search.search({
          query: String(data.query),
          cursor: data.cursor as string | null,
          limit: Math.min(100, Number(data.limit) || 50),
          signal: controller.signal,
        });
      } finally {
        requests.delete(id);
      }
    }
    if (method === 'lifecycle.canLeave') {
      return lifecycle.canLeave ? lifecycle.canLeave(String(data.reason)) : true;
    }
    if (method === 'lifecycle.serialize') {
      if (data.reason === 'hibernate') {
        await lifecycle.onSuspend?.();
      }
      return lifecycle.serialize?.();
    }
    if (method === 'lifecycle.restore') {
      await lifecycle.restore?.(payload);
      await lifecycle.onResume?.();
      return true;
    }
    if (method === 'lifecycle.preview') {
      const blob = await lifecycle.capturePreview?.();
      if (!blob) {
        return null;
      }
      if (blob.type !== 'image/png' || blob.size > 2 * 1024 * 1024) {
        throw new Error('预览需要≤2MiB PNG');
      }
      const response = await fetch('/web/api/workbench/snapshots/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireValue(session).grant}`,
          'Content-Type': 'image/png',
        },
        body: blob,
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message);
      }
      return result.data.id;
    }
    if (method === 'config.validate') {
      const values = await validateValues(data.values as Record<string, string>);
      return {
        values,
        ...(await validation(
          values,
          data.keys as string[],
          Number(data.baseRevision),
          Number(data.schemaRevision),
        )),
      };
    }
    if (method === 'navigation.traverse') {
      const delta = Number(data.delta),
        target = navigationPosition + delta;
      if (!Number.isInteger(delta) || target < 0 || target >= navigationUrls.length) {
        return false;
      }
      history.go(delta);
      return true;
    }
    if (method === 'navigation.navigate') {
      const url = new URL(String(data.url), location.href);
      if (
        url.origin !== location.origin ||
        !url.pathname.startsWith(
          `/web/page/plugin/${encodeURIComponent(decodeURIComponent(location.pathname.split('/')[4]))}/`,
        )
      ) {
        throw new Error('目标不属于当前插件');
      }
      if (navigationAdapter) {
        await navigationAdapter(url.href);
      } else {
        location.replace(url.href);
      }
      return true;
    }
    throw new Error(`unsupported: ${method}`);
  }
  function hello() {
    if (hosted) {
      window.parent.postMessage(
        { protocol: PROTOCOL, version: 1, type: 'hello', documentNonce: nonce, url: location.href },
        location.origin,
      );
    }
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== location.origin || !hosted) {
      return;
    }
    const message = event.data;
    if (message?.protocol !== PROTOCOL || message.version !== 1) {
      return;
    }
    if (message.type === 'handshake-request') {
      hello();
      return;
    }
    if (message.type !== 'welcome' || message.documentNonce !== nonce || !event.ports[0]) {
      return;
    }
    port?.close();
    port = new InstancePort(event.ports[0], message.session.tabId, message.session.frameEpoch);
    port.onRequest = handle;
    port.onCancel = (id) => requests.get(id)?.abort();
    port.onEvent = (method, payload) => {
      if (method === 'navigation.changed') {
        navigationBase = Number((payload as { index: number }).index) - navigationPosition;
      }
      if (method === 'focus.changed' || method === 'visibility.changed') {
        if (method === 'focus.changed') {
          hostFocused = Boolean(payload);
        } else {
          hostVisible = Boolean(payload);
        }
        emit('external-state.changed', api.externalState.get());
      }
      if (method === 'theme.changed') {
        applyTheme(payload);
      }
      if (method === 'keybindings.changed') {
        keybindings = payload as typeof keybindings;
      }
      if (method === 'requests.abort') {
        for (const controller of managedRequests) {
          controller.abort();
        }
      }
      if (method === 'session.changed') {
        installSession(payload as Session);
      }
      if (method === 'config.changed') {
        for (const fn of configListeners) {
          fn(payload as ConfigChange);
        }
      }
      if (method === 'lifecycle.resume') {
        void lifecycle.onResume?.();
      }
      if (method === 'lifecycle.suspend') {
        void lifecycle.onSuspend?.();
      }
      emit(method, payload);
    };
    keybindings = Array.isArray(message.keybindings) ? message.keybindings : [];
    applyTheme(message.theme);
    hostFocused = Boolean(message.focused);
    hostVisible = Boolean(message.visible);
    navigationBase = (Number(message.navigationIndex) || 0) - navigationPosition;
    emit('external-state.changed', api.externalState.get());
    installSession(message.session);
    readyResolve();
    port.event('ready', { title: document.title, url: location.href });
    emit('theme.changed', message.theme);
  });
  let standaloneSocket: WebSocket | undefined;
  let standaloneRetry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0,
    disposed = false;
  const retryStandalone = () => {
    if (disposed) {
      return;
    }
    clearTimeout(standaloneRetry);
    standaloneRetry = setTimeout(() => void standalone(), Math.min(15000, 1000 * 2 ** attempts++));
  };
  async function standalone() {
    try {
      let apiConfig: { host: string; port: string; token: string } | undefined;
      try {
        const local = await fetch('/web/local-config', {
          headers: { 'X-SCWC-Local-Config': '1' },
          mode: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(3000),
        });
        const result = await local.json();
        if (result.success) {
          apiConfig = result.data;
        }
      } catch {
        /* A manually configured same-origin connection remains usable. */
      }
      if (!apiConfig) {
        try {
          apiConfig = JSON.parse(localStorage.getItem('__selective_crawl_config__') ?? 'null')?.api;
        } catch {
          /* Report a missing manual connection below. */
        }
      }
      if (
        !apiConfig ||
        typeof apiConfig.token !== 'string' ||
        new URL(`${apiConfig.host}:${apiConfig.port}`).origin !== location.origin
      ) {
        throw new Error('请先从核心工作台打开页面并配置连接。');
      }
      const response = await fetch('/web/api/workbench/page-sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiConfig.token}`,
          'Content-Type': 'application/json',
          'X-SCWC-Client-Window': nonce,
        },
        body: JSON.stringify({
          pluginId: decodeURIComponent(location.pathname.split('/')[4]),
          url: location.href,
          frameEpoch: crypto.randomUUID(),
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message);
      }
      installSession(result.data);
      readyResolve();

      if (standaloneSocket) {
        standaloneSocket.onclose = null;
        standaloneSocket.close();
      }
      attempts = 0;
      const ticket = await request<{ ticket: string; coreBootId: string }>('/stream-ticket', {});
      const url = new URL('/web/websocket/workbench', location.origin);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticket.ticket);
      const socket = (standaloneSocket = new WebSocket(url));
      socket.onopen = () =>
        socket.send(
          JSON.stringify({ type: 'resume', coreBootId: ticket.coreBootId, positions: {} }),
        );
      socket.onclose = retryStandalone;
      socket.onmessage = (event) => {
        const e = JSON.parse(event.data);
        if (e.type === 'config.changed') {
          for (const fn of configListeners) {
            fn(e.payload);
          }
        }
        if (e.type === 'connection.resync-required') {
          void request<ConfigSnapshot>(configPath()).then((snapshot) => {
            for (const fn of configListeners) {
              fn({
                pluginId: decodeURIComponent(location.pathname.split('/')[4]),
                changedKeys: Object.keys(snapshot.effectiveValues),
                effectiveValues: snapshot.effectiveValues,
                revision: snapshot.revision,
                schemaRevision: snapshot.schemaRevision,
              });
            }
          });
        }
      };
    } catch (error) {
      if (!session) {
        readyReject(error instanceof Error ? error : new Error(String(error)));
      }
      retryStandalone();
      console.warn('scwcutils 初始化失败', error);
    }
  }
  // Observe SPA history without navigating the iframe from the host again.
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name].bind(history);
    history[name] = (...args: Parameters<History[typeof name]>) => {
      const next = name === 'pushState' ? navigationPosition + 1 : navigationPosition;
      original(stateWithPosition(args[0], next), args[1], args[2]);
      if (name === 'pushState') {
        navigationUrls.splice(next);
      }
      navigationPosition = next;
      navigationUrls[next] = location.href;
      void api.navigation
        .report({ url: location.href, title: document.title, replace: name === 'replaceState' })
        .catch(() => undefined);
    };
  }
  window.addEventListener('popstate', (event) => {
    const index =
      event.state && typeof event.state === 'object' ? event.state[historyKey] : undefined;
    const found = Number.isInteger(index)
      ? index
      : navigationUrls.findIndex((url, i) => url === location.href && i !== navigationPosition);
    if (found >= 0 && found < navigationUrls.length) {
      navigationPosition = found;
      void api.navigation
        .report({ url: location.href, title: document.title, index: navigationBase + found })
        .catch(() => undefined);
    }
  });
  window.addEventListener('hashchange', () => {
    if (navigationUrls[navigationPosition] === location.href) {
      return;
    }
    navigationPosition++;
    navigationUrls.splice(navigationPosition);
    navigationUrls.push(location.href);
    rawReplaceState(stateWithPosition(history.state, navigationPosition), '');
    void api.navigation
      .report({ url: location.href, title: document.title })
      .catch(() => undefined);
  });
  window.addEventListener('focus', () => port?.event('page.focus', {}));
  window.addEventListener('pointerdown', () => port?.event('page.focus', {}), { passive: true });
  window.addEventListener('keydown', (event) => {
    if (
      !port ||
      event.isComposing ||
      event.defaultPrevented ||
      event
        .composedPath()
        .some(
          (t) =>
            t instanceof HTMLElement && t.matches('input,textarea,select,[contenteditable=true]'),
        )
    ) {
      return;
    }
    const key = [
      event.metaKey ? 'Meta' : '',
      event.ctrlKey ? 'Ctrl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      event.key.length === 1 ? event.key.toUpperCase() : event.key,
    ]
      .filter(Boolean)
      .join('+')
      .toLowerCase();
    const binding = keybindings.find((b) => b.keys.some((k) => k.toLowerCase() === key));
    if (binding) {
      event.preventDefault();
      event.stopPropagation();
      port.event('keybinding.invoke', { commandId: binding.id });
    }
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    for (const controller of managedRequests) {
      controller.abort();
    }
    clearTimeout(standaloneRetry);
    port?.close();
    standaloneSocket?.close();
    clearTimeout(refreshTimer);
    for (const controller of requests.values()) {
      controller.abort();
    }
  });
  queueMicrotask(() => {
    if (hosted) {
      hello();
    } else {
      void standalone();
    }
  });
  return api;
}
