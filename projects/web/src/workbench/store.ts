import { BrowserWorkspace, type WorkspacePersistence } from './browser-workspace.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { WorkbenchAPI, ApiError, EventConnection } from '../api/workbench.ts';
import { ConfigController } from '../../../shared/store/config.ts';
import { CONFIG_KEY } from '../../../shared/utils/common.ts';
import { clone, uid, defaultLayout, internalTab, addTab, relocatedUrl } from './model.ts';
import type { DialogField, WorkbenchDialog } from './dialogs.ts';
import type { FocusLocation } from './focus-history.ts';
import type {
  Bookmark,
  Bootstrap,
  CatalogItem,
  ClosedTab,
  Execution,
  InputRequest,
  Job,
  Lease,
  ListPage,
  Notification,
  OutputRecord,
  Preferences,
  PreferenceValues,
  Terminal,
  TerminalViewState,
  WorkbenchEvent,
  Workspace,
  WorkspaceSnapshot,
} from './types.ts';
export class WorkbenchStore extends EventTarget {
  readonly api = new WorkbenchAPI(ConfigController.config);
  focusedLocation?: FocusLocation;
  bootstrap?: Bootstrap;
  workspace?: Workspace;
  lease?: Lease;
  preferences: Preferences = { values: {}, revision: 0 };
  catalog: CatalogItem[] = [];
  bookmarks: Bookmark[] = [];
  history: ClosedTab[] = [];
  notifications: Notification[] = [];
  terminals: Terminal[] = [];
  executions: Execution[] = [];
  inputs: InputRequest[] = [];
  jobs = new Map<string, Job>();
  outputs = new Map<string, OutputRecord[]>();
  outputGaps = new Map<string, number>();
  private terminalViews = new Map<string, TerminalViewState>();
  terminalView(terminal: Terminal): TerminalViewState {
    let view = this.terminalViews.get(terminal.id);
    if (!view) {
      view = {
        draft: terminal.draft,
        historyCursor: -1,
        historyDraft: '',
        historyLocked: false,
        selectionAnchor: terminal.draft.length,
        selectionHead: terminal.draft.length,
        follow: true,
        scrollTop: 0,
      };
      this.terminalViews.set(terminal.id, view);
    }
    return view;
  }
  cursors: Record<string, string | null> = {};
  totals: Record<string, number> = {};
  connection: 'connected' | 'connecting' | 'disconnected' = 'connecting';
  loading = true;
  error = '';
  saveState: 'saved' | 'saving' | 'unsaved' = 'saved';
  toasts: {
    id: string;
    text: string;
    level: string;
    focused?: boolean;
    notification: Notification;
    remote: boolean;
  }[] = [];
  private localNotifications: Notification[] = [];
  dialogState?: WorkbenchDialog;
  private dialogs: Promise<unknown> = Promise.resolve();
  dialog(title: string, fields: DialogField[] = []) {
    const result = this.dialogs.then(
      () =>
        new Promise<Record<string, string> | null>((resolve) => {
          this.dialogState = {
            title,
            fields,
            resolve: (value) => {
              this.dialogState = undefined;
              this.changed();
              resolve(value);
            },
          };
          this.changed();
        }),
    );
    this.dialogs = result;
    return result;
  }
  async prompt(title: string, value = '') {
    return (await this.dialog(title, [{ name: 'value', label: title, value }]))?.value ?? null;
  }
  async confirm(title: string) {
    return (await this.dialog(title)) !== null;
  }
  private queue: Promise<unknown> = Promise.resolve();
  private events?: EventConnection;
  private renewTimer?: ReturnType<typeof setInterval>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;
  private pending?: { path: string; body: unknown };
  private executionGeneration = 0;
  private persistence?: WorkspacePersistence;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private listGeneration: Record<string, number> = {};
  constructor() {
    super();
    try {
      this.localNotifications = JSON.parse(localStorage.getItem('scwc.notifications') ?? '[]');
    } catch {
      /* Storage is optional. */
    }
    window.addEventListener('pagehide', this.release);
  }
  private release = () => {
    if (this.lease) {
      void this.api
        .request(
          `/workspaces/${this.lease.workspaceId}/lease`,
          { action: 'release', lease: this.lease.token },
          undefined,
          true,
        )
        .catch(() => undefined);
    }
  };
  changed() {
    if (!this.disposed) {
      this.dispatchEvent(new Event('change'));
    }
  }
  get notificationItems() {
    const active = new Set(this.toasts.map((t) => t.id));
    return [...this.localNotifications, ...this.notifications]
      .filter((n) => !active.has(n.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private persistNotifications() {
    try {
      localStorage.setItem(
        'scwc.notifications',
        JSON.stringify(this.localNotifications.slice(0, 1000)),
      );
    } catch {
      /* Optional browser persistence. */
    }
  }
  toast(text: string, level = 'info', notification?: Notification) {
    const id = notification?.id ?? uid();
    const value = notification ?? {
      id,
      title: text,
      message: '',
      source: 'core',
      pluginId: null,
      level,
      readAt: null,
      updatedAt: new Date().toISOString(),
      count: 1,
      actions: [],
    };
    if (this.toasts.some((t) => t.id === id)) {
      this.dismissToast(id, true);
    }
    this.toasts = [
      ...this.toasts,
      { id, text, level, notification: value, remote: Boolean(notification) },
    ];
    this.scheduleToast(id);
    this.changed();
  }
  private scheduleToast(id: string) {
    clearTimeout(this.toastTimers.get(id));
    this.toastTimers.set(
      id,
      setTimeout(() => this.dismissToast(id, false), 6000),
    );
  }
  focusToast(id: string, focused: boolean) {
    const toast = this.toasts.find((t) => t.id === id);
    if (!toast) {
      return;
    }
    toast.focused = focused;
    if (focused) {
      clearTimeout(this.toastTimers.get(id));
      toast.notification.readAt = new Date().toISOString();
      if (toast.remote) {
        void this.ackNotifications([id]).catch(() => undefined);
      }
    } else {
      this.scheduleToast(id);
    }
    this.changed();
  }
  dismissToast(id: string, manual = true) {
    clearTimeout(this.toastTimers.get(id));
    this.toastTimers.delete(id);
    const toast = this.toasts.find((t) => t.id === id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    if (toast && !manual && !toast.remote) {
      this.localNotifications = [toast.notification, ...this.localNotifications].slice(0, 1000);
      this.persistNotifications();
    }
    if (toast?.remote && manual) {
      void this.deleteNotifications([id]).catch(() => undefined);
    }
    this.changed();
  }
  async ackNotifications(ids: string[]) {
    const readAt = new Date().toISOString();
    for (const n of [...this.localNotifications, ...this.notifications]) {
      if (ids.includes(n.id)) {
        n.readAt = readAt;
      }
    }
    this.persistNotifications();
    this.changed();
    const remote = ids.filter((id) => !this.localNotifications.some((n) => n.id === id));
    if (remote.length) {
      await this.api.request('/notifications/ack', { ids: remote });
    }
  }
  async deleteNotifications(ids: string[]) {
    const remote = ids.filter((id) => !this.localNotifications.some((n) => n.id === id));
    this.localNotifications = this.localNotifications.filter((n) => !ids.includes(n.id));
    this.notifications = this.notifications.filter((n) => !ids.includes(n.id));
    this.persistNotifications();
    this.changed();
    if (remote.length) {
      await this.api.request('/notifications/delete', { ids: remote });
    }
  }
  async authenticate(token: string) {
    this.api.config.api.token = token.trim();
    await this.start();
    if (!this.error) {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.api.config));
    }
  }
  async start() {
    this.loading = true;
    this.error = '';
    this.changed();
    try {
      this.bootstrap = await this.api.request<Bootstrap>('/bootstrap');
      this.preferences = this.bootstrap.preferences;
      const requested = this.lease?.workspaceId ?? uid();
      const initialize = !this.lease;
      this.persistence ??= new BrowserWorkspace(this.bootstrap.installationId);
      this.lease = await this.api.request<Lease>(
        `/workspaces/${encodeURIComponent(requested)}/lease`,
        { action: 'acquire' },
      );

      this.workspace = await this.api.request<Workspace>(`/workspaces/${this.lease.workspaceId}`);
      this.applyExecutionState(this.workspace);
      if (initialize) {
        let seed = this.persistence.load();
        if (!seed) {
          try {
            const legacyId = sessionStorage.getItem('scwc.workspace');
            if (legacyId) {
              seed = (
                await this.api.request<Workspace>(`/workspaces/${encodeURIComponent(legacyId)}`)
              ).snapshot;
            }
          } catch {
            /* Migration is best effort if the legacy workspace no longer exists. */
          }
        }
        // Each document gets a fresh ID, including duplicated browser tabs.
        await this.update((snapshot) => {
          if (seed) {
            Object.assign(snapshot, seed);
          }
          snapshot.binding = { kind: 'browser-temporary', localPath: null };
        });
      }
      const relocated = clone(this.workspace.snapshot);
      if (this.relocate(relocated)) {
        await this.update((s) => {
          s.tabs = relocated.tabs;
        });
      }
      await this.refreshLists();
      if (this.workspace.revision === 0 && this.workspace.snapshot.tabs.length === 0) {
        await this.update((s) => {
          defaultLayout(s);
          addTab(s, internalTab('welcome'));
        });
      }
      this.events?.close();
      this.events = new EventConnection(
        this.api,
        () => ({ ...this.session(), coreBootId: requireValue(this.bootstrap).coreBootId }),
        (e) => this.onEvent(e),
        (state) => {
          this.connection = state;
          this.changed();
        },
        () => this.resync(),
      );
      void this.events.connect();
      clearInterval(this.renewTimer);
      this.renewTimer = setInterval(() => void this.renew(), 10000);
    } catch (e) {
      this.error = this.message(e);
      this.connection = 'disconnected';
    } finally {
      this.loading = false;
      this.changed();
    }
  }
  private relocate(snapshot: WorkspaceSnapshot) {
    let changed = false;
    for (const tab of snapshot.tabs) {
      if (tab.kind !== 'plugin' || tab.locator.installationId !== this.bootstrap?.installationId) {
        continue;
      }
      const url = relocatedUrl(tab.locator, this.bootstrap.installationId, tab.url);
      if (url !== tab.url) {
        tab.url = url;
        changed = true;
      }
      for (const entry of tab.navigation.entries) {
        if (
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof entry.url === 'string'
        ) {
          try {
            const stored = new URL(entry.url);
            if (
              stored.origin !== location.origin &&
              stored.pathname.startsWith(`/web/page/plugin/${encodeURIComponent(tab.pluginId)}/`)
            ) {
              entry.url = location.origin + stored.pathname + stored.search + stored.hash;
              changed = true;
            }
          } catch {
            /* Preserve unrecognized old navigation entries for inspection. */
          }
        }
      }
    }
    return changed;
  }
  session() {
    if (!this.lease) {
      throw new Error('工作区尚未连接');
    }
    return { workspaceId: this.lease.workspaceId, lease: this.lease.token };
  }
  private recoveryKey() {
    return `scwc.workspace.draft.${this.lease?.workspaceId ?? 'local'}`;
  }
  private preserve(snapshot: WorkspaceSnapshot) {
    this.persistence?.publish(snapshot);
    try {
      localStorage.setItem(
        this.recoveryKey(),
        JSON.stringify({
          snapshot,
          revision: this.workspace?.revision,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      this.toast('浏览器存储不可用，请导出工作区以保留草稿。', 'error');
    }
  }
  private async renew() {
    if (!this.lease || this.disposed) {
      return;
    }
    try {
      this.lease = await this.api.request<Lease>(`/workspaces/${this.lease.workspaceId}/lease`, {
        action: 'renew',
        lease: this.lease.token,
      });
    } catch {
      this.connection = 'disconnected';
      this.changed();
      try {
        const lease = await this.api.request<Lease>(`/workspaces/${this.lease.workspaceId}/lease`, {
          action: 'acquire',
        });
        if (lease.workspaceId !== this.lease.workspaceId) {
          this.toast('租约已被另一窗口接管，请重新连接以创建独立工作区。', 'warn');
          return;
        }
        this.lease = lease;
      } catch {
        /* The connection UI exposes a retry without discarding local state. */
      }
    }
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  update(mutate: (snapshot: WorkspaceSnapshot) => void) {
    return this.serial(async () => {
      if (!this.workspace) {
        throw new Error('工作区尚未连接');
      }
      const next = clone(this.workspace.snapshot);
      mutate(next);
      if (JSON.stringify(next) === JSON.stringify(this.workspace.snapshot)) {
        return;
      }
      this.workspace = { ...this.workspace, snapshot: next };
      this.saveState = 'saving';
      this.changed();
      this.preserve(next);
      await this.commit(`/workspaces/${this.workspace.workspaceId}/save`, {
        snapshot: next,
        baseRevision: this.workspace.revision,
        lease: this.session().lease,
        operationId: uid(),
      }).catch(() => undefined);
    });
  }
  private async commit(path: string, body: unknown) {
    if (body && typeof body === 'object' && 'lease' in body) {
      body = { ...body, lease: this.session().lease };
    }
    this.pending = { path, body };
    try {
      let saved: Workspace;
      try {
        saved = await this.api.request<Workspace>(path, body);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'revision_conflict') {
          throw error;
        }
        // This page is the sole writer. Preserve its draft and bind a new operation to the current revision.
        const remote = await this.api.request<Workspace>(
          `/workspaces/${this.session().workspaceId}`,
        );
        body = { ...(body as object), baseRevision: remote.revision, operationId: uid() };
        this.pending = { path, body };
        saved = await this.api.request<Workspace>(path, body);
      }
      this.workspace = saved;
      if (!path.endsWith('/save')) {
        this.persistence?.publish(saved.snapshot);
      }
      clearTimeout(this.retryTimer);
      if (path === '/history/restore') {
        const snapshot = clone(saved.snapshot);
        if (this.relocate(snapshot)) {
          await this.commit(`/workspaces/${saved.workspaceId}/save`, {
            snapshot,
            baseRevision: saved.revision,
            lease: this.session().lease,
            operationId: uid(),
          });
          return;
        }
      }
      this.saveState = 'saved';
      this.pending = undefined;
      try {
        localStorage.removeItem(this.recoveryKey());
      } catch {
        /* A committed server receipt remains saved even if browser cleanup fails. */
      }
    } catch (e) {
      this.saveState = 'unsaved';
      clearTimeout(this.retryTimer);
      if (!this.disposed) {
        this.retryTimer = setTimeout(() => void this.retrySave().catch(() => undefined), 2000);
      }
      throw e;
    } finally {
      this.changed();
    }
  }
  retrySave() {
    return this.serial(async () => {
      if (this.pending) {
        await this.commit(this.pending.path, this.pending.body);
      }
    });
  }
  async acceptRemote() {
    const fresh = await this.api.request<Workspace>(`/workspaces/${this.session().workspaceId}`);
    this.workspace = fresh;
    this.pending = undefined;
    this.saveState = 'saved';
    try {
      localStorage.removeItem(this.recoveryKey());
    } catch {
      /* Browser storage is best effort after accepting the server snapshot. */
    }
    this.applyExecutionState(fresh);
    this.changed();
  }
  closeTabs(tabIds: string[]) {
    return this.serial(async () => {
      if (!this.workspace || !tabIds.length) {
        return;
      }
      if (this.pending) {
        await this.commit(this.pending.path, this.pending.body);
      }
      const path = `/workspaces/${this.workspace.workspaceId}/close-tabs`,
        body = {
          tabIds,
          baseRevision: this.workspace.revision,
          lease: this.session().lease,
          operationId: uid(),
        };
      await this.commit(path, body);
      await this.loadList('history');
    });
  }
  restore(closeIds: string[], groupId: string) {
    return this.serial(async () => {
      if (this.pending) {
        await this.commit(this.pending.path, this.pending.body);
      }
      await this.commit('/history/restore', {
        ...this.session(),
        closeIds,
        groupId,
        baseRevision: requireValue(this.workspace).revision,
        operationId: uid(),
      });
      await this.loadList('history');
    });
  }
  async setPreferences(values: PreferenceValues, reset?: string[]) {
    const revision = this.preferences.revision;
    try {
      this.preferences = await this.api.request<Preferences>('/preferences', {
        values,
        baseRevision: revision,
        reset,
      });
      this.changed();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'revision_conflict') {
        this.preferences = await this.api.request<Preferences>('/preferences');
        this.changed();
      }
      throw e;
    }
  }
  async loadList(key: 'catalog' | 'bookmarks' | 'history' | 'notifications', more = false) {
    const generation = (this.listGeneration[key] ?? 0) + 1;
    this.listGeneration[key] = generation;
    const endpoint = key === 'catalog' ? 'plugins' : key;
    const result = await this.api.list<unknown>(`/${endpoint}`, more ? this.cursors[key] : null);
    // Notification history is bounded by the server; loading every page keeps the unread bell exact.
    if (key === 'notifications' && !more) {
      const cursors = new Set<string>();
      while (result.nextCursor && this.listGeneration[key] === generation) {
        if (cursors.has(result.nextCursor)) {
          throw new Error('通知分页游标未前进');
        }
        cursors.add(result.nextCursor);
        const next = await this.api.list<unknown>(`/${endpoint}`, result.nextCursor);
        result.items.push(...next.items);
        result.nextCursor = next.nextCursor;
      }
    }
    if (this.listGeneration[key] !== generation) {
      return;
    }
    const values = more ? [...this[key], ...result.items] : result.items;
    if (key === 'catalog') {
      this.catalog = values as CatalogItem[];
    }
    if (key === 'bookmarks') {
      this.bookmarks = values as Bookmark[];
    }
    if (key === 'history') {
      this.history = values as ClosedTab[];
    }
    if (key === 'notifications') {
      this.notifications = values as Notification[];
    }
    if (key === 'catalog') {
      const ids = [
        ...new Set(
          this.workspace?.snapshot.tabs.filter((t) => t.kind === 'plugin').map((t) => t.pluginId) ??
            [],
        ),
      ];
      await Promise.all(
        ids
          .filter((id) => !this.catalog.some((p) => p.pluginId === id))
          .map((id) => this.getPlugin(id)),
      );
    }
    this.cursors[key] = result.nextCursor;
    this.totals[key] = result.total;
    this.changed();
  }
  async getPlugin(id: string) {
    const known = this.catalog.find((p) => p.pluginId === id);
    if (known) {
      return known;
    }
    const result = await this.api.list<CatalogItem>('/plugins', null, { pluginId: id });
    const plugin = result.items[0];
    if (plugin) {
      this.catalog = [...this.catalog, plugin];
      this.changed();
    }
    return plugin;
  }
  async refreshLists() {
    await Promise.all([
      this.loadList('catalog'),
      this.loadList('bookmarks'),
      this.loadList('history'),
      this.loadList('notifications'),
      this.refreshTerminals(),
    ]);
  }
  async refreshTerminals() {
    if (!this.lease) {
      return;
    }
    this.terminals = await this.api.request<Terminal[]>(
      `/terminals?workspaceId=${encodeURIComponent(this.lease.workspaceId)}`,
    );
    this.changed();
  }
  private boundedOutput(records: OutputRecord[], truncatedBefore?: number | null) {
    const unique = [...new Map(records.map((r) => [r.seq, r])).values()]
        .filter((r) => !truncatedBefore || r.seq >= truncatedBefore)
        .sort((a, b) => a.seq - b.seq),
      result: OutputRecord[] = [];
    let bytes = 0;
    for (let i = unique.length - 1; i >= 0 && result.length < 10000; i--) {
      const row = unique[i];
      bytes += new TextEncoder().encode(JSON.stringify(row)).length;
      if (bytes > 10 * 1024 * 1024) {
        break;
      }
      result.push(row);
    }
    return result.reverse();
  }
  async loadOutput(id: string, reset = false) {
    const current = reset ? [] : (this.outputs.get(id) ?? []);
    let after = current[current.length - 1]?.seq ?? 0;
    let batch: ListPage<OutputRecord> & { truncatedBefore: number | null };
    let records = [...current];
    // Persistent output has its own monotonic sequence; bounded batches catch up beyond the event ring.
    do {
      batch = await this.api.request(
        `/terminals/${encodeURIComponent(id)}/output?workspaceId=${encodeURIComponent(this.session().workspaceId)}&after=${after}&limit=500`,
      );
      records.push(...batch.items);
      after = records[records.length - 1]?.seq ?? after;
      if (batch.truncatedBefore) {
        this.outputGaps.set(id, batch.truncatedBefore);
      }
    } while (batch.items.length === 500);
    this.outputs.set(
      id,
      this.boundedOutput([...(this.outputs.get(id) ?? []), ...records], this.outputGaps.get(id)),
    );
    this.changed();
  }
  async pluginAction(pluginId: string, action: string) {
    const job = await this.api.request<Job>(`/plugins/${encodeURIComponent(pluginId)}/actions`, {
      action,
      idempotencyKey: uid(),
    });
    this.jobs.set(job.id, job);
    this.changed();
    return this.trackJob(job.id);
  }
  async rescan() {
    const job = await this.api.request<Job>('/plugins/rescan', { idempotencyKey: uid() });
    this.jobs.set(job.id, job);
    return this.trackJob(job.id);
  }
  private async trackJob(id: string) {
    let job = requireValue(this.jobs.get(id));
    while (!this.disposed && ['queued', 'running', 'cancelling'].includes(job.status)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      job = await this.api.request<Job>(`/jobs/${encodeURIComponent(id)}`);
      this.jobs.set(id, job);
      this.changed();
    }
    await this.loadList('catalog');
    if (job.status === 'failed') {
      throw new Error(job.error ?? '插件操作失败');
    }
    return job;
  }
  async syncExecutions() {
    const generation = ++this.executionGeneration;
    const workspace = await this.api.request<Workspace>(
      `/workspaces/${this.session().workspaceId}`,
    );
    if (generation !== this.executionGeneration) {
      return;
    }
    this.applyExecutionState(workspace);
    this.changed();
  }
  private applyExecutionState(w: Workspace) {
    this.executions = w.executions ?? [];
    this.inputs = w.inputs ?? [];
  }
  private onEvent(e: WorkbenchEvent) {
    if (e.type === 'terminal.output') {
      const data = e.payload as {
        streamId: string;
        items: OutputRecord[];
        truncatedBefore: number | null;
      };
      const existing = this.outputs.get(data.streamId) ?? [];
      this.outputs.set(
        data.streamId,
        this.boundedOutput([...existing, ...data.items], data.truncatedBefore),
      );
      if (data.truncatedBefore) {
        this.outputGaps.set(data.streamId, data.truncatedBefore);
      }
      this.changed();
      return;
    }
    if (e.type === 'job.changed') {
      const job = e.payload as Job;
      this.jobs.set(job.id, job);
      this.changed();
      return;
    }
    this.dispatchEvent(new CustomEvent('server-event', { detail: e }));
    if (e.type.startsWith('execution.') || e.type.startsWith('input.')) {
      void this.syncExecutions().catch((error) => this.toast(this.message(error), 'error'));
      return;
    }
    if (e.type === 'preferences.changed') {
      const next = e.payload as Preferences;
      if (next.revision > this.preferences.revision) {
        this.preferences = next;
        this.changed();
      }
      return;
    }
    if (e.type === 'workspace.changed') {
      return;
    } // This lease is the sole writer; HTTP receipts own local revision updates.
    if (e.type === 'notification.created') {
      const notification = e.payload as Notification;
      this.toast(notification.title, notification.level, notification);
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => void this.refreshLists().catch((error) => this.toast(this.message(error), 'error')),
      120,
    );
  }
  private async resync() {
    const boot = await this.api.request<Bootstrap>('/bootstrap');
    const changed = boot.coreBootId !== this.bootstrap?.coreBootId;
    this.preferences = boot.preferences;
    if (changed) {
      this.toast('核心已重启，正在重新连接；历史命令不会重放。', 'warn');
      if (this.lease) {
        this.lease = await this.api.request<Lease>(`/workspaces/${this.lease.workspaceId}/lease`, {
          action: 'acquire',
        });
      }

      this.bootstrap = boot;
      this.dispatchEvent(new Event('core-restarted'));
    }
    this.bootstrap = boot;
    if (this.saveState === 'saved') {
      await this.acceptRemote();
    }
    await this.refreshLists();
    await Promise.all([...this.outputs.keys()].map((id) => this.loadOutput(id)));
  }
  exportDraft() {
    try {
      return localStorage.getItem(this.recoveryKey()) ?? JSON.stringify(this.workspace, null, 2);
    } catch {
      return JSON.stringify(this.workspace, null, 2);
    }
  }
  message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  dispose() {
    window.removeEventListener('pagehide', this.release);
    this.disposed = true;
    clearInterval(this.renewTimer);
    clearTimeout(this.refreshTimer);
    clearTimeout(this.retryTimer);
    for (const timer of this.toastTimers.values()) {
      clearTimeout(timer);
    }
    this.events?.close();
    if (this.lease) {
      void this.api
        .request(`/workspaces/${this.lease.workspaceId}/lease`, {
          action: 'release',
          lease: this.lease.token,
        })
        .catch(() => undefined);
    }
  }
}
