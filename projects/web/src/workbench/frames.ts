import { commands, effectiveKeys } from './commands.ts';
import {
  InstancePort,
  PROTOCOL,
  type PageRegistration,
} from '../../../shared/workbench-protocol.ts';
import type { WorkbenchStore } from './store.ts';
import type { ConfigSnapshot, PageSession, PluginTab, WorkbenchEvent } from './types.ts';
import { uid, groups } from './model.ts';
export interface FrameRuntime {
  tabId: string;
  frame: HTMLIFrameElement;
  epoch: string;
  nonce?: string;
  port?: InstancePort;
  session?: PageSession;
  url: string;
  state: string;
  visible: boolean;
  focused: boolean;
  dirty: boolean;
  dirtyRevision?: number;
  checkpointTimer?: ReturnType<typeof setTimeout>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  properties: { label: string; value: string }[];
  capabilities: Record<string, boolean>;
  activity: Map<string, string>;
  requests: number;
  observedRequests?: number;
  failedRequests?: number;
  searchRevision: number;
  searchAvailable: boolean;
  lastBackgroundAt: number;
  transition?: string;
  error?: string;
  handshaking?: boolean;
  pendingHello?: MessageEvent;
  handshakeTimer?: ReturnType<typeof setTimeout>;
  reportingNavigation?: number;
  navigationQueue?: Promise<unknown>;
}
/** Frames have a single stable parent. Group moves only change their viewport rectangle. */
export class FramePool extends EventTarget {
  readonly runtimes = new Map<string, FrameRuntime>();
  readonly hibernated = new Map<string, boolean>();
  private raf = 0;
  private bindingRevision = -1;
  private observer: ResizeObserver;
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private navigationTimer: ReturnType<typeof setInterval>;
  private container: HTMLElement;
  private store: WorkbenchStore;
  private root: ShadowRoot;
  private command: (id: string, args?: unknown) => Promise<unknown>;
  constructor(
    container: HTMLElement,
    store: WorkbenchStore,
    root: ShadowRoot,
    command: (id: string, args?: unknown) => Promise<unknown>,
  ) {
    super();
    this.container = container;
    this.store = store;
    this.root = root;
    this.command = command;
    window.addEventListener('message', this.hello);
    this.observer = new ResizeObserver(() => this.position());
    this.observer.observe(container);
    store.addEventListener('server-event', this.serverEvent);
    store.addEventListener('core-restarted', this.restarted);
    store.addEventListener('connection-paused', this.paused);
    store.addEventListener('connection-resumed', this.resumed);
    store.pausePages = async () => {
      const results = await Promise.all(
        [...this.runtimes.values()]
          .filter((r) => r.port)
          .map(async (r) => {
            try {
              return await r.port?.request<boolean>('connection.pause', {}, 2000);
            } catch {
              return false;
            }
          }),
      );
      if (results.some((result) => !result)) {
        this.resumed();
        return false;
      }
      return true;
    };
    // Same-origin fallback also covers routers that replace the SDK history wrappers.
    this.navigationTimer = setInterval(() => {
      for (const runtime of this.runtimes.values()) {
        if (
          !['ready', 'document-loaded', 'bridge-unavailable'].includes(runtime.state) ||
          runtime.reportingNavigation
        ) {
          continue;
        }
        try {
          const url = runtime.frame.contentWindow?.location.href;
          if (url && url !== 'about:blank' && url !== runtime.url) {
            this.onEvent(runtime, 'navigation.report', { url });
          }
        } catch {
          /* Cross-origin documents cannot be inspected by the host. */
        }
      }
    }, 250);
    this.timer = setInterval(() => void this.energy(), 10000);
  }
  private changed() {
    this.dispatchEvent(new Event('change'));
  }
  sync() {
    const snapshot = this.store.workspace?.snapshot;
    if (!snapshot) {
      return;
    }
    if (this.bindingRevision !== this.store.preferences.revision) {
      this.bindingRevision = this.store.preferences.revision;
      for (const r of this.runtimes.values()) {
        r.port?.event('keybindings.changed', this.bindings());
      }
    }
    const tabs = snapshot.tabs.filter((t): t is PluginTab => t.kind === 'plugin');
    for (const [id, r] of this.runtimes) {
      const tab = tabs.find((t) => t.id === id),
        catalog = tab && this.store.catalog.find((p) => p.pluginId === tab.pluginId);
      if (!tab || catalog?.runtime.status !== 'ready') {
        this.remove(r);
      }
    }
    for (const group of groups(snapshot.layout.center)) {
      const tab = tabs.find((t) => t.id === group.activeTabId);
      const slot = this.slot(group.id);
      const visible = Boolean(
        slot && slot.getBoundingClientRect().width > 0 && slot.getBoundingClientRect().height > 0,
      );
      if (
        tab &&
        visible &&
        this.hibernated.get(tab.id) !== false &&
        !this.runtimes.has(tab.id) &&
        this.store.catalog.some(
          (p) =>
            p.pluginId === tab.pluginId && p.runtime.status === 'ready' && p.ui.state === 'ready',
        )
      ) {
        this.create(tab);
      }
    }
    for (const r of this.runtimes.values()) {
      const tab = tabs.find((t) => t.id === r.tabId);
      if (!tab) {
        continue;
      }
      const group = groups(snapshot.layout.center).find((g) => g.activeTabId === r.tabId);
      const slot = group && this.slot(group.id);
      const visible = Boolean(
        slot && slot.getBoundingClientRect().width > 0 && slot.getBoundingClientRect().height > 0,
      );
      if (r.visible !== visible) {
        r.visible = visible;
        if (visible) {
          r.transition = undefined;
          if (r.state === 'suspended') {
            r.state = 'ready';
          }
          r.port?.event('lifecycle.resume', {});
        } else {
          r.lastBackgroundAt = Date.now();
        }
        r.port?.event('visibility.changed', visible);
      }
      const focus = this.store.focusedLocation;
      const focused = Boolean(
        visible &&
        group?.id === snapshot.layout.focusedGroupId &&
        (!focus || (focus.kind === 'tab' && focus.id === r.tabId)),
      );
      if (r.focused !== focused) {
        r.focused = focused;
        r.port?.event('focus.changed', focused);
      }
      if (r.url !== tab.url && !r.reportingNavigation) {
        r.url = tab.url;
        this.invalidate(r);
        try {
          r.frame.contentWindow?.location.replace(tab.url);
        } catch {
          r.frame.src = tab.url;
        }
      }
    }
    this.position();
  }
  private slot(groupId: string) {
    return [...this.root.querySelectorAll<HTMLElement>('[data-page-slot]')].find(
      (el) => el.dataset.pageSlot === groupId,
    );
  }
  position() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const base = this.container.getBoundingClientRect(),
        snapshot = this.store.workspace?.snapshot;
      if (!snapshot) {
        return;
      }
      for (const r of this.runtimes.values()) {
        const group = groups(snapshot.layout.center).find((g) => g.activeTabId === r.tabId),
          slot = group && this.slot(group.id),
          rect = slot?.getBoundingClientRect();
        const centerArea = this.root.querySelector<HTMLElement>('.center-area');
        const centerRect = centerArea?.getBoundingClientRect();
        const visible = Boolean(
          rect &&
          rect.width > 0 &&
          rect.height > 0 &&
          !centerArea?.hidden &&
          (!centerRect || (centerRect.width > 0 && centerRect.height > 0)) &&
          !['error', 'restore-error'].includes(r.state),
        );
        r.frame.hidden = !visible;
        if (visible && rect) {
          const clips = [
            slot?.closest('.page-viewport'),
            this.root.querySelector('.center-scroll'),
            this.root.querySelector('.center-area'),
            this.root.host,
          ]
            .filter((el): el is Element => Boolean(el))
            .map((el) => el.getBoundingClientRect());
          const center = clips.length
            ? {
                top: Math.max(...clips.map((r) => r.top)),
                right: Math.min(...clips.map((r) => r.right)),
                bottom: Math.min(...clips.map((r) => r.bottom)),
                left: Math.max(...clips.map((r) => r.left)),
              }
            : undefined;
          Object.assign(r.frame.style, {
            left: `${rect.left - base.left}px`,
            top: `${rect.top - base.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            clipPath: center
              ? `inset(${Math.max(0, center.top - rect.top)}px ${Math.max(0, rect.right - center.right)}px ${Math.max(0, rect.bottom - center.bottom)}px ${Math.max(0, center.left - rect.left)}px)`
              : '',
          });
        }
      }
    });
  }
  private create(tab: PluginTab) {
    const frame = document.createElement('iframe');
    frame.title = tab.customTitle || tab.originalPageTitle;
    frame.className = 'page-frame';
    frame.referrerPolicy = 'same-origin';
    const r: FrameRuntime = {
      tabId: tab.id,
      frame,
      epoch: uid(),
      url: tab.url,
      state: 'navigating',
      visible: true,
      focused: false,
      dirty: false,
      properties: [],
      capabilities: {},
      activity: new Map(),
      requests: 0,
      searchRevision: 0,
      searchAvailable: false,
      lastBackgroundAt: Date.now(),
    };
    this.runtimes.set(tab.id, r);
    frame.addEventListener('load', () => {
      if (this.stopped || !this.runtimes.has(r.tabId)) {
        return;
      }
      try {
        const actual = frame.contentWindow?.location.href;
        if (actual && new URL(actual).origin === location.origin) {
          r.url = actual;
          const current = this.store.workspace?.snapshot.tabs.find((t) => t.id === r.tabId);
          if (current?.kind === 'plugin' && current.url !== actual) {
            this.onEvent(r, 'navigation.report', { url: actual });
          }
        }
        const error = frame.contentDocument?.documentElement.dataset.scwcError;
        if (error) {
          r.state = 'error';
          r.error = '插件页面不可用，请查看构建任务。';
          this.changed();
          return;
        }
      } catch {
        r.state = 'error';
        r.error = '页面已离开当前核心，请刷新。';
        this.changed();
        return;
      }
      if (!r.port) {
        r.state = 'document-loaded';
      }
      frame.contentWindow?.postMessage(
        { protocol: PROTOCOL, version: 1, type: 'handshake-request' },
        location.origin,
      );
      clearTimeout(r.handshakeTimer);
      r.handshakeTimer = setTimeout(() => {
        if (!r.port && r.state !== 'error') {
          r.state = 'bridge-unavailable';
          this.changed();
        }
      }, 5000);
      this.changed();
    });
    frame.src = tab.url;
    this.container.append(frame);
    this.changed();
  }
  private invalidate(r: FrameRuntime) {
    clearTimeout(r.handshakeTimer);
    clearTimeout(r.checkpointTimer);
    r.port?.close();
    r.port = undefined;
    r.session = undefined;
    r.epoch = uid();
    r.nonce = undefined;
    r.searchAvailable = false;
    r.capabilities = {};
    r.activity.clear();
    r.state = 'navigating';
    r.requests = 0;
    this.store.setPageRequests(r.tabId, 0);
    r.observedRequests = 0;
    r.failedRequests = 0;
    r.dirty = false;
    r.properties = [];
    this.changed();
  }
  private hello = async (event: MessageEvent) => {
    const data = event.data;
    if (
      event.origin !== location.origin ||
      data?.protocol !== PROTOCOL ||
      data.version !== 1 ||
      data.type !== 'hello' ||
      typeof data.documentNonce !== 'string' ||
      data.documentNonce.length > 200
    ) {
      return;
    }
    const r = [...this.runtimes.values()].find((r) => r.frame.contentWindow === event.source);
    if (!r || (r.nonce === data.documentNonce && r.port)) {
      return;
    }
    if (r.handshaking) {
      if (r.nonce !== data.documentNonce) {
        r.pendingHello = event;
        r.epoch = uid();
      }
      return;
    }
    const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === r.tabId);
    if (!tab || tab.kind !== 'plugin') {
      return;
    }
    r.handshaking = true;
    r.nonce = data.documentNonce;
    try {
      const resolved = await this.store.api.request<{ url: string; pluginId: string }>(
        '/url/resolve',
        { url: data.url, pluginId: tab.pluginId },
      );
      if (!this.runtimes.has(r.tabId) || r.frame.contentWindow !== event.source) {
        return;
      }
      this.invalidate(r);
      const epoch = r.epoch;
      r.nonce = data.documentNonce;
      const session = await this.store.api.request<PageSession>('/page-sessions', {
        ...this.store.session(),
        tabId: r.tabId,
        pluginId: tab.pluginId,
        url: resolved.url,
        frameEpoch: epoch,
      });
      if (this.runtimes.get(r.tabId) !== r || r.epoch !== epoch) {
        return;
      }
      r.session = session;
      const channel = new MessageChannel();
      r.port = new InstancePort(channel.port1, r.tabId, epoch);
      r.port.onEvent = (method, payload) => this.onEvent(r, method, payload);
      r.port.onRequest = async (method, payload) => {
        if (method === 'host.executeCommand') {
          const { commandId, args } = payload as { commandId: string; args: unknown };
          if (!['openUrl', 'bookmark', 'notifications'].includes(commandId)) {
            throw new Error('unsupported');
          }
          return this.command(commandId, args);
        }
        if (method === 'navigation.navigate') {
          return this.command('navigateTab', { tabId: r.tabId, ...(payload as object) });
        }
        throw new Error('unsupported');
      };
      r.frame.contentWindow?.postMessage(
        {
          protocol: PROTOCOL,
          version: 1,
          type: 'welcome',
          documentNonce: data.documentNonce,
          session,
          theme: this.themeProjection(),
          capabilities: { search: true },
          keybindings: this.bindings(),
          navigationIndex: tab.navigation.index,
          focused: r.focused,
          visible: r.visible,
        },
        location.origin,
        [channel.port2],
      );
    } catch (e) {
      r.error = this.store.message(e);
      r.state = 'error';
      this.changed();
    } finally {
      r.handshaking = false;
      const pending = r.pendingHello;
      r.pendingHello = undefined;
      if (pending) {
        void this.hello(pending);
      }
    }
  };
  private onEvent(r: FrameRuntime, method: string, payload: unknown) {
    if (this.runtimes.get(r.tabId) !== r) {
      return;
    }
    if (method === 'ready') {
      r.state = 'ready';
      clearTimeout(r.handshakeTimer);
      const data = payload as { title?: string; url?: string };
      this.onEvent(r, 'page.update', { title: data.title });
      void this.restore(r);
    }
    if (method === 'page.focus') {
      void this.command('focusPage', r.tabId).catch(() => undefined);
    }
    if (method === 'page.update') {
      const data = payload as PageRegistration;
      if (typeof data.dirty === 'boolean') {
        r.dirty = data.dirty;
        r.dirtyRevision = (r.dirtyRevision ?? 0) + 1;
        r.transition = undefined;
        if (r.dirty) {
          this.scheduleCheckpoint(r);
        }
      }
      if (Array.isArray(data.properties)) {
        r.properties = data.properties
          .slice(0, 100)
          .filter((p) => typeof p.label === 'string' && typeof p.value === 'string');
      }
      if (data.title && typeof data.title === 'string') {
        void this.store
          .update((s) => {
            const tab = s.tabs.find((t) => t.id === r.tabId);
            if (tab?.kind === 'plugin') {
              tab.originalPageTitle = String(data.title).slice(0, 1000);
            }
          })
          .catch(() => undefined);
      }
    }
    if (method === 'navigation.report') {
      const data = payload as { url: string; replace?: boolean; index?: number };
      if (typeof data.url === 'string') {
        r.url = data.url;
        r.reportingNavigation = (r.reportingNavigation ?? 0) + 1;
        r.navigationQueue = (r.navigationQueue ?? Promise.resolve())
          .then(() => this.command('reportNavigation', { tabId: r.tabId, ...data }))
          .catch((e) => this.store.toast(this.store.message(e), 'error'))
          .finally(() => {
            r.reportingNavigation = Math.max(0, (r.reportingNavigation ?? 1) - 1);
            if (!r.reportingNavigation) {
              const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === r.tabId);
              if (tab?.kind === 'plugin') {
                r.port?.event('navigation.changed', { index: tab.navigation.index });
              }
            }
            this.sync();
          });
      }
    }
    if (method === 'state.checkpoint') {
      this.scheduleCheckpoint(r);
    }
    if (method === 'lifecycle.changed') {
      r.capabilities = { ...r.capabilities, ...(payload as Record<string, boolean>) };
    }
    if (method === 'activity.acquire') {
      const data = payload as { id: string; reason: string };
      if (r.activity.size < 100 && typeof data.id === 'string') {
        r.activity.set(data.id, String(data.reason));
      }
    }
    if (method === 'activity.release') {
      r.activity.delete((payload as { id: string }).id);
    }
    if (method === 'requests.changed') {
      const data = payload as { delta: number; failed?: boolean };
      r.requests = Math.max(0, r.requests + Number(data.delta || 0));
      this.store.setPageRequests(r.tabId, r.requests);
      if (r.requests) {
        r.lastBackgroundAt = Date.now();
        if (r.state === 'suspended') {
          r.state = 'ready';
          r.port?.event('lifecycle.resume', {});
        }
      } else {
        r.lastBackgroundAt = Date.now();
      }
      if (data.delta > 0) {
        r.observedRequests = (r.observedRequests ?? 0) + 1;
      }
      if (data.failed) {
        r.failedRequests = (r.failedRequests ?? 0) + 1;
      }
    }
    if (method === 'page.activity') {
      this.store.activity();
    }
    if (method === 'search.changed') {
      const data = payload as { revision: number; available: boolean };
      r.searchAvailable = Boolean(data.available);
      r.searchRevision = Number(data.revision);
      this.dispatchEvent(new Event('search-changed'));
    }
    if (method === 'keybinding.invoke') {
      const commandId = (payload as { commandId: string }).commandId;
      if (this.bindings().some((b) => b.id === commandId)) {
        void this.command(commandId, { tabId: r.tabId }).catch((e) =>
          this.store.toast(this.store.message(e), 'error'),
        );
      }
    }
    if (method === 'session.renew') {
      void this.renew(r).catch((e) => this.store.toast(this.store.message(e), 'warn'));
    }
    if (method === 'settings.changed') {
      this.dispatchEvent(new Event('settings-changed'));
    }
    this.changed();
  }
  private async renew(r: FrameRuntime) {
    const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === r.tabId);
    if (!tab || tab.kind !== 'plugin') {
      return;
    }
    const epoch = r.epoch,
      session = await this.store.api.request<PageSession>(
        '/page-sessions',
        {
          ...this.store.session(),
          tabId: r.tabId,
          pluginId: tab.pluginId,
          url: r.url,
          frameEpoch: epoch,
        },
        undefined,
        false,
        true,
      );
    if (r.epoch === epoch) {
      r.session = session;
      r.port?.event('session.changed', session);
    }
  }
  private async restore(r: FrameRuntime) {
    const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === r.tabId);
    if (tab?.kind !== 'plugin' || !tab.stateSnapshotId) {
      return;
    }
    const epoch = r.epoch;
    try {
      const snapshot = await this.store.api.request<{ state: unknown }>(
        `/snapshots/${encodeURIComponent(tab.stateSnapshotId)}`,
      );
      if (r.epoch !== epoch) {
        return;
      }
      r.state = 'restoring';
      await r.port?.request('lifecycle.restore', snapshot.state, 5000);
      if (r.epoch === epoch) {
        r.state = 'ready';
      }
    } catch (e) {
      r.state = 'restore-error';
      r.error = `状态恢复失败：${this.store.message(e)}。旧快照已保留，可导出后重新加载。`;
    }
    this.position();
    this.changed();
  }
  async canLeave(id: string, reason: string) {
    const r = this.runtimes.get(id);
    if (!r?.dirty) {
      return true;
    }
    if (r.port && r.capabilities.canLeave) {
      try {
        return await r.port.request<boolean>('lifecycle.canLeave', { reason }, 2000);
      } catch {
        return false;
      }
    }
    return await this.store.confirm('此页面包含未保存更改。继续离开？');
  }
  async traverse(id: string, delta: number) {
    const r = this.runtimes.get(id);
    if (!r?.port) {
      return false;
    }
    try {
      return await r.port.request<boolean>('navigation.traverse', { delta }, 2000);
    } catch {
      return false;
    }
  }
  private scheduleCheckpoint(r: FrameRuntime) {
    clearTimeout(r.checkpointTimer);
    r.checkpointTimer = setTimeout(() => {
      if (r.capabilities.serialize && this.runtimes.get(r.tabId) === r) {
        void this.checkpoint(r.tabId).catch(() => undefined);
      }
    }, 2000);
  }
  async checkpoint(id: string, reason = 'checkpoint') {
    const r = this.runtimes.get(id);
    if (!r?.port || !r.capabilities.serialize) {
      return;
    }
    const epoch = r.epoch,
      state = await r.port.request('lifecycle.serialize', { reason }, 2000);
    if (r.epoch !== epoch) {
      throw new Error('页面代次已变化');
    }
    const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === id);
    if (!tab || tab.kind !== 'plugin') {
      return;
    }
    const previousSnapshotId = tab.stateSnapshotId;
    const result = await this.store.api.request<{ id: string }>('/snapshots', {
      ...this.store.session(),
      kind: 'state',
      owner: id,
      pluginId: tab.pluginId,
      state,
      metadata: { url: tab.url, frameEpoch: epoch },
    });
    if (r.epoch !== epoch || this.runtimes.get(id) !== r) {
      throw new Error('页面已变化，旧快照保持独立。');
    }
    await this.store.update((s) => {
      const t = s.tabs.find((t) => t.id === id);
      if (t?.kind === 'plugin') {
        t.stateSnapshotId = result.id;
      }
    });
    if (previousSnapshotId && previousSnapshotId !== result.id) {
      void this.store.api
        .request(`/snapshots/${encodeURIComponent(previousSnapshotId)}/delete`, {})
        .catch(() => undefined);
    }
    return result.id;
  }
  async hibernate(id: string, automatic = false) {
    const r = this.runtimes.get(id);
    if (!r) {
      return;
    }
    const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === id);
    if (
      !tab ||
      tab.kind !== 'plugin' ||
      r.requests > 0 ||
      (automatic && (r.visible || r.dirty || r.activity.size || r.requests || tab.keepAlive))
    ) {
      return;
    }
    if (!r.capabilities.serialize || !r.capabilities.restore) {
      if (automatic) {
        return;
      }
      if (!(await this.store.confirm('此页面未提供状态恢复能力。释放页面后将重新加载，继续？'))) {
        return;
      }
      if (!(await this.canLeave(id, 'hibernate'))) {
        return;
      }
      this.hibernated.set(id, false);
      this.remove(r);
      this.changed();
      return;
    }
    if (!(await this.canLeave(id, 'hibernate'))) {
      return;
    }
    const transition = (r.transition = uid());
    r.state = 'hibernating';
    this.changed();
    try {
      await this.checkpoint(id, 'hibernate');
      if (
        r.transition !== transition ||
        r.requests ||
        (automatic && (r.visible || r.dirty || r.activity.size))
      ) {
        throw new Error('页面状态已变化，保留运行');
      }
      this.hibernated.set(id, automatic);
      this.remove(r);
    } catch (e) {
      r.state = 'ready';
      r.port?.event('lifecycle.resume', {});
      if (!automatic) {
        this.store.toast(this.store.message(e), 'warn');
      }
    }
    this.changed();
  }
  wake(id: string) {
    this.hibernated.delete(id);
    const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === id);
    if (tab?.kind === 'plugin' && !this.runtimes.has(id)) {
      this.create(tab);
    }
    this.sync();
  }
  refresh(id: string) {
    this.hibernated.delete(id);
    const r = this.runtimes.get(id);
    if (r) {
      this.invalidate(r);
      r.frame.contentWindow?.location.replace(r.url);
    } else {
      this.wake(id);
    }
  }
  stop(id: string) {
    const r = this.runtimes.get(id);
    if (r) {
      try {
        r.port?.event('requests.abort', {});
        r.state = 'stopped';
      } catch {
        r.error = '当前页面不支持停止';
      }
      this.changed();
    }
  }
  private themeProjection() {
    const styles = getComputedStyle(document.documentElement);
    return {
      mode: document.documentElement.dataset.theme,
      tokens: Object.fromEntries(
        [
          '--surface-0',
          '--surface-1',
          '--text-primary',
          '--text-secondary',
          '--border-default',
          '--accent-primary',
          '--font-sans',
        ].map((key) => [key, styles.getPropertyValue(key).trim()]),
      ),
    };
  }
  theme() {
    const theme = this.themeProjection();
    for (const r of this.runtimes.values()) {
      r.port?.event('theme.changed', theme);
    }
  }
  private bindings() {
    const allowed = new Set([
      'quickOpen',
      'nextTab',
      'previousTab',
      'closeTab',
      'restoreClosed',
      'refresh',
      'sidebar',
      'auxiliary',
      'panel',
      'openUrl',
      'back',
      'forward',
      'settings',
    ]);
    return commands
      .filter((c) => allowed.has(c.id))
      .map((c) => ({
        id: c.id,
        keys: effectiveKeys(c, this.store.preferences.values.keybindings),
      }));
  }
  private serverEvent = (e: Event) => {
    const event = (e as CustomEvent<WorkbenchEvent>).detail;
    if (event.type === 'preferences.changed') {
      for (const r of this.runtimes.values()) {
        r.port?.event('keybindings.changed', this.bindings());
      }
    }
    if (event.type === 'config.changed') {
      for (const r of this.runtimes.values()) {
        const tab = this.store.workspace?.snapshot.tabs.find((t) => t.id === r.tabId);
        if (tab?.kind === 'plugin' && tab.pluginId === event.entityId) {
          r.port?.event('config.changed', event.payload as ConfigSnapshot);
        }
      }
    }
  };
  private restarted = () => {
    for (const r of this.runtimes.values()) {
      this.remove(r);
    }
    this.sync();
  };
  private paused = () => {
    for (const r of this.runtimes.values()) {
      clearTimeout(r.checkpointTimer);
      clearTimeout(r.reconnectTimer);
      r.port?.event('connection.paused', {});
    }
  };
  private resumed = () => {
    for (const r of this.runtimes.values()) {
      // Only renew authorization. Keep the iframe and its document alive.
      this.resumeRuntime(r);
    }
  };
  private resumeRuntime(r: FrameRuntime, attempts = 0) {
    clearTimeout(r.reconnectTimer);
    if (this.stopped || this.store.disconnectedForIdle || this.runtimes.get(r.tabId) !== r) {
      return;
    }
    void this.renew(r).catch(() => {
      r.reconnectTimer = setTimeout(
        () => this.resumeRuntime(r, attempts + 1),
        Math.min(15000, 1000 * 2 ** attempts),
      );
    });
  }
  private async energy() {
    if (this.store.disconnectedForIdle || !this.store.preferences.values.energy?.enabled) {
      return;
    }
    const minutes = this.store.preferences.values.energy.idleMinutes;
    for (const r of this.runtimes.values()) {
      if (!r.visible) {
        const elapsed = Date.now() - r.lastBackgroundAt;
        if (elapsed > 30000 && r.state === 'ready' && !r.requests && !r.activity.size) {
          r.port?.event('lifecycle.suspend', {});
          r.state = 'suspended';
        }
        if (elapsed > minutes * 60000) {
          await this.hibernate(r.tabId, true);
        }
      }
    }
    const visible = [...this.runtimes.values()].filter((r) => r.visible).length;
    for (const r of [...this.runtimes.values()]
      .filter((r) => !r.visible)
      .sort((a, b) => a.lastBackgroundAt - b.lastBackgroundAt)) {
      if (this.runtimes.size <= visible + 3) {
        break;
      }
      if (Date.now() - r.lastBackgroundAt > 30000) {
        await this.hibernate(r.tabId, true);
      }
    }
    this.changed();
  }
  private remove(r: FrameRuntime) {
    r.transition = undefined;
    clearTimeout(r.handshakeTimer);
    clearTimeout(r.checkpointTimer);
    clearTimeout(r.reconnectTimer);
    r.port?.close();
    this.store.setPageRequests(r.tabId, 0);
    r.frame.remove();
    this.runtimes.delete(r.tabId);
    this.dispatchEvent(new Event('search-changed'));
  }
  dispose() {
    clearInterval(this.navigationTimer);
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.observer.disconnect();
    window.removeEventListener('message', this.hello);
    this.store.removeEventListener('server-event', this.serverEvent);
    this.store.removeEventListener('core-restarted', this.restarted);
    this.store.removeEventListener('connection-paused', this.paused);
    this.store.removeEventListener('connection-resumed', this.resumed);
    this.store.pausePages = undefined;
    for (const r of this.runtimes.values()) {
      this.remove(r);
    }
  }
}
