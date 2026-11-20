import { LitElement, html, css, unsafeCSS, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { debounce, type DebouncedFunction } from 'es-toolkit';
import { browser, call } from './browser.ts';
import type { Init, PluginBatch } from './background.ts';
import {
  changedConnection,
  initialSettings,
  permissionOrigin,
  type Draft,
  type Item,
  type PopupPanel,
  type Settings,
  type SiteData,
  type Snapshot,
} from './model.ts';
import type { PluginConfig, PluginItem } from '../../shared/types/plugin.d.ts';
import type { TConfig } from '../../shared/types/config.d.ts';
import type { ContextMenuItem } from '../../web/src/components/context-menu/menu-types.ts';
import '../../web/src/components/scroll-container.ts';
import '../../web/src/components/context-menu/wb-context-menu.ts';
import '../../web/src/components/context-menu/wb-menu-select.ts';
import '../../web/var.css';
import '@vscode/codicons/dist/codicon.css';
import './popup.css';
import styles from './surface.css?raw';
import {
  CLIENT_VERSION,
  versionNoticeKey,
  type VersionNotice,
} from '../../shared/client-version.ts';
import { ExtensionNotifications, type NotificationType } from './notifications.ts';
import '../../shared/components/script-ui.ts';
import {
  scriptConfigProblem,
  readScriptValues,
  saveScriptValues,
  type ScriptUIEvent,
  type ScriptUIResult,
  ScriptUIRefreshQueue,
} from '../../shared/script-ui.ts';
import type { FieldValue } from '../../shared/declarative-ui.ts';
import type { ScriptUIView } from '../../shared/components/script-ui.ts';
import type {
  SiteNotificationOptions,
  NotificationScope,
} from '../../shared/site-notifications.ts';
import type { ExtensionNotification } from './notification-model.ts';

// 原生弹窗在小屏幕上会被浏览器压低；缩短内部布局以保持底栏可见。
window.addEventListener('resize', () => {
  if (window.innerHeight > 100) {
    document.body.style.height = `${Math.min(580, window.innerHeight)}px`;
  }
});

@customElement('scwc-extension')
export class ExtensionPopup extends LitElement {
  static styles = [
    css`
      ${unsafeCSS(styles)}
    `,
  ];
  @state() private accessor context: Init = { settings: initialSettings(), syncBlocked: false };
  @state() private accessor panel: PopupPanel = 'capture';
  @state() private accessor plugins: PluginConfig[] = [];
  @state() private accessor activePlugin = '';
  @state() private accessor connected = false;
  @state() private accessor syncBlocked = false;
  @state() private accessor busy = false;
  @state() private accessor loaded = false;
  @state() private accessor config = initialSettings().config;
  @state() private accessor theme: Settings['theme'] = 'dark-2026';
  @state() private accessor permissionRequired = false;
  @state() private accessor connectionError = '';
  @state() private accessor draftLabel = '';
  @state() private accessor draftPrefix = '';
  @state() private accessor manual = false;
  @state() private accessor selector = '';
  @state() private accessor menu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  private generation = 0;
  private edits = 0;
  private saveTail: Promise<unknown> = Promise.resolve();
  private syncAfterSave = debounce(() => void this.sync('background'), 500);
  private connectionWrite?: Promise<Pick<Init, 'settings' | 'snapshot'>>;
  private poll?: ReturnType<typeof setInterval>;
  private polling = false;
  private themeRevision = 0;
  private controlChanges = new Map<
    string,
    { value: boolean; commit: DebouncedFunction<(checked: boolean) => void> }
  >();
  private flushControlChanges = () => {
    for (const { commit } of this.controlChanges.values()) {
      commit.flush();
      commit.cancel();
    }
  };
  private lastSite = '';
  private pluginGeneration = 0;
  private templates = new ScriptUIRefreshQueue<PluginBatch>();
  private notifications = new ExtensionNotifications();
  private shownVersions = new Set<string>();
  private receiveNotification = (
    input: unknown,
    sender: { id?: string },
    respond: (value: unknown) => void,
  ) => {
    const message = input as {
      type?: string;
      record: ExtensionNotification;
      options: SiteNotificationOptions;
    };
    if (sender.id !== browser.runtime.id || message.type !== 'notification.received') {
      return;
    }
    void this.notifications
      .receive(message.record, message.options)
      .then(() => respond({ ok: true }));
    return true;
  };
  @state() private accessor refreshingPlugins = new Set<string>();
  private versionNotice = (event: Event) => {
    const notice = (event as CustomEvent<VersionNotice>).detail;
    const key = `${versionNoticeKey(notice)}:${notice.status}:${notice.route}`;
    if (!this.shownVersions.has(key)) {
      this.shownVersions.add(key);
      this.notifications.add(
        notice.message,
        notice.status === 'warning' ? 'warn' : 'error',
        notice,
      );
    }
  };
  private selectPlugin(id: string) {
    for (const view of this.shadowRoot?.querySelectorAll<ScriptUIView>('scwc-script-ui') ?? []) {
      if (view.identity === this.activePlugin) {
        view.preserveInteraction();
      }
    }
    this.activePlugin = id;
    this.rememberNavigation();
    void this.updateComplete.then(() => {
      for (const view of this.shadowRoot?.querySelectorAll<ScriptUIView>('scwc-script-ui') ?? []) {
        if (view.identity === id) {
          view.restoreInteraction();
        }
      }
    });
  }
  private selectPanel(panel: PopupPanel) {
    if (panel === 'settings' && this.panel !== 'settings' && !this.connectionWrite) {
      this.config = this.connectionConfig;
      this.connectionError = '';
    }
    this.panel = panel;
    this.rememberNavigation();
  }
  private rememberNavigation() {
    if (!this.snapshot) {
      return;
    }
    // 两级标签属于扩展本地视图，立即交给后台保存，避免弹窗关闭或核心同步覆盖选择。
    void call({
      type: 'navigation.save',
      site: this.site,
      navigation: { panel: this.panel, activePlugin: this.activePlugin },
    }).catch((error: unknown) => this.say(`标签保存失败：${String(error)}`, true));
  }
  private restoreNavigation() {
    this.panel = this.snapshot ? (this.context.navigation?.panel ?? 'capture') : 'settings';
    this.activePlugin =
      this.context.navigation?.activePlugin ?? this.snapshot?.data.plugin.activeTab ?? '';
  }
  private get snapshot() {
    return this.context.snapshot;
  }
  private get connectionConfig() {
    return this.snapshot?.data.config ?? this.context.settings.config;
  }
  private get site() {
    return this.context.tab?.url ?? '';
  }
  private get tab() {
    return this.context.tab?.id;
  }
  private get items() {
    return this.snapshot?.data.items ?? [];
  }

  connectedCallback() {
    super.connectedCallback();
    this.notifications.suppressVersion = (notice) => call({ type: 'version.dismiss', notice });
    window.addEventListener('scwc-version-notice', this.versionNotice);
    window.addEventListener('pagehide', this.flushControlChanges);
    browser.runtime?.onMessage?.addListener(this.receiveNotification);
    void this.initialize();
  }
  disconnectedCallback() {
    this.flushControlChanges();
    super.disconnectedCallback();
    window.removeEventListener('scwc-version-notice', this.versionNotice);
    window.removeEventListener('pagehide', this.flushControlChanges);
    browser.runtime?.onMessage?.removeListener?.(this.receiveNotification);
    this.generation++;
    this.pluginGeneration++;
    clearInterval(this.poll);
    this.syncAfterSave.cancel();
  }
  private say(message: string, error = false, scope: NotificationScope = 'internal') {
    this.showNotification(message, error ? 'error' : 'info', scope);
  }
  private showNotification(
    message: string,
    type: NotificationType = 'info',
    scope: NotificationScope = 'internal',
  ) {
    void this.notify({ title: message, type, scope }).catch((error) =>
      this.notifications.add(error instanceof Error ? error.message : String(error), 'error'),
    );
  }
  /** Local callers and plugin responses use the same scope contract. */
  async notify(options: SiteNotificationOptions) {
    if (options.scope === 'external') {
      const id = await call<string>({
        type: 'notification.show',
        tab: this.tab,
        site: this.site,
        options,
      });
      await this.notifications.refreshHistory();
      return id;
    }
    return this.notifications.add(
      options.description ? `${options.title}\n${options.description}` : options.title,
      options.type,
      undefined,
      options,
    );
  }
  private async run(work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), true);
    }
  }
  private async initialize() {
    await this.run(async () => {
      this.context = await call<Init>({ type: 'init' });
      this.syncBlocked = this.context.syncBlocked;
      this.config = this.connectionConfig;
      this.applyTheme(this.context.settings.theme);
      this.restoreNavigation();
      this.loaded = true;
      if ((await this.checkCorePermission()) && this.snapshot) {
        if (await this.sync('startup')) {
          await this.loadPlugins();
        }
      }
    });
    this.loaded = true;
    this.poll = setInterval(() => {
      void this.refresh();
    }, 4000);
  }
  private async refresh() {
    if (this.polling || this.busy || this.connectionWrite) {
      return;
    }
    this.polling = true;
    const generation = this.generation;
    try {
      const current = await call<Init>({ type: 'init' });
      if (generation !== this.generation) {
        return;
      }
      const wasSyncBlocked = this.syncBlocked;
      this.syncBlocked = current.syncBlocked;
      if (current.tab?.url !== this.site) {
        const sameOrigin = current.snapshot?.website === this.snapshot?.website;
        this.flushControlChanges();
        this.syncAfterSave.cancel();
        this.generation++;
        this.pluginGeneration++;
        this.edits++;
        this.context = current;
        this.connected = false;
        if (!sameOrigin) {
          this.plugins = [];
          this.lastSite = '';
          this.config = this.connectionConfig;
          this.connectionError = '';
          this.restoreNavigation();
        }
        const granted = await this.checkCorePermission();
        if (!current.snapshot) {
          this.panel = 'settings';
        } else if (granted && (await this.sync('startup'))) {
          await this.loadPlugins();
        }
      } else {
        const wasConnected = this.connected;
        if ((await this.checkCorePermission()) && !this.syncBlocked) {
          await this.sync('background');
        }
        if ((!wasConnected && this.connected) || (wasSyncBlocked && !this.syncBlocked)) {
          await this.loadPlugins(true);
        }
      }
    } catch {
      this.connected = false;
    } finally {
      this.polling = false;
    }
  }
  private async sync(mode: 'startup' | 'interactive' | 'background' = 'background') {
    if (!this.snapshot) {
      return false;
    }
    if (mode === 'background' && (this.syncBlocked || this.permissionRequired)) {
      this.connected = false;
      return false;
    }
    const generation = this.generation,
      edits = this.edits;
    try {
      const next = await call<Snapshot>({ type: 'core.sync', site: this.site, mode });
      if (generation !== this.generation) {
        return false;
      }
      this.connected = true;
      this.syncBlocked = false;
      if (edits === this.edits) {
        this.context = { ...this.context, snapshot: next };
      }
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.connected = false;
        const circuitBlocked =
          error instanceof Error && 'code' in error && error.code === 'CORE_SYNC_BLOCKED';
        if (circuitBlocked) {
          this.syncBlocked = true;
          this.say(error.message, true);
        }
        if (mode === 'interactive' && !circuitBlocked) {
          this.syncBlocked = true;
          this.say(error instanceof Error ? error.message : String(error), true);
        }
      }
      return false;
    }
  }
  private save(patch: Partial<SiteData>) {
    if (!this.snapshot) {
      return Promise.resolve();
    }
    const site = this.site,
      generation = this.generation;
    this.edits++;
    this.context = {
      ...this.context,
      snapshot: { ...this.snapshot, data: { ...this.snapshot.data, ...patch } },
    };
    // 立即把请求交给后台落盘；后续网络同步允许在关闭弹窗后于下次打开重试。
    const pending = call<Snapshot>({ type: 'site.patch', site, patch });
    this.saveTail = pending;
    void pending
      .then(() => {
        if (generation !== this.generation) {
          return;
        }
        this.syncAfterSave();
      })
      .catch((error: unknown) => this.say(`保存失败：${String(error)}`, true));
    return pending;
  }
  private async loadPlugins(force = false) {
    if (this.tab === undefined || !this.snapshot) {
      return;
    }
    const generation = ++this.pluginGeneration,
      site = this.site;
    try {
      const batch = await call<PluginBatch>({
        type: 'plugins',
        tab: this.tab,
        site,
        previousSite: force ? undefined : this.lastSite || undefined,
      });
      if (generation !== this.pluginGeneration || site !== this.site) {
        return;
      }
      const active = batch.activeIds ?? batch.data.map((plugin) => plugin.id);
      const updated = new Set(batch.updatedIds ?? batch.data.map((plugin) => plugin.id));
      const merged = new Map(
        [...this.plugins.filter((plugin) => !force && !updated.has(plugin.id)), ...batch.data].map(
          (plugin) => [plugin.id, plugin],
        ),
      );
      this.plugins = active.flatMap((id) =>
        merged.has(id) ? [merged.get(id) as PluginConfig] : [],
      );
      this.lastSite = site;
      if (!this.plugins.some((plugin) => plugin.id === this.activePlugin)) {
        this.activePlugin = this.plugins[0]?.id ?? '';
      }
    } catch (error) {
      this.say(`插件加载失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
  }
  private async page(command: string, selector?: string) {
    if (this.tab === undefined || !this.snapshot) {
      return;
    }
    return call<Draft | null>({ type: 'page', tab: this.tab, site: this.site, command, selector });
  }
  private async refreshPlugin(id: string) {
    if (this.tab === undefined || this.refreshingPlugins.has(id)) {
      return;
    }
    const site = this.site,
      generation = this.pluginGeneration;
    this.refreshingPlugins = new Set([...this.refreshingPlugins, id]);
    try {
      const previous = [
        ...(this.shadowRoot?.querySelectorAll<ScriptUIView>('scwc-script-ui') ?? []),
      ]
        .find((view) => view.identity === id)
        ?.refreshBaseline();
      const batch = await this.templates.run(id, () =>
        call<PluginBatch>({ type: 'plugins', tab: this.tab, site, pluginId: id, ...previous }),
      );
      if (site !== this.site || generation !== this.pluginGeneration) {
        return;
      }
      const replacement = batch.data.find((plugin) => plugin.id === id);
      this.plugins = this.plugins.flatMap((plugin) =>
        plugin.id === id ? (replacement ? [replacement] : []) : [plugin],
      );
      if (!this.plugins.some((plugin) => plugin.id === this.activePlugin)) {
        this.activePlugin = this.plugins[0]?.id ?? '';
      }
    } catch (error) {
      if (site === this.site && generation === this.pluginGeneration) {
        this.say(`插件刷新失败：${error instanceof Error ? error.message : String(error)}`, true);
      }
    } finally {
      this.refreshingPlugins = new Set([...this.refreshingPlugins].filter((entry) => entry !== id));
    }
  }
  private async refreshJsonModel(
    plugin: PluginConfig,
    previous?: { instanceId: string; dirtyFields: string[] },
  ) {
    const site = this.site,
      generation = this.pluginGeneration;
    const batch = await this.templates.run(plugin.id, () =>
      call<PluginBatch>({ type: 'plugins', tab: this.tab, site, pluginId: plugin.id, ...previous }),
    );
    if (site !== this.site || generation !== this.pluginGeneration || !this.isConnected) {
      throw new Error('插件实例已经切换');
    }
    const next = batch.data.find((p) => p.id === plugin.id);
    if (!next?.ui) {
      throw new Error(next?.configError ?? '插件模板未就绪');
    }
    this.plugins = this.plugins.map((p) => (p.id === next.id ? next : p));
    return next.ui;
  }
  private saveJsonValues(plugin: PluginConfig, values: Record<string, FieldValue>) {
    void this.save({
      controls: saveScriptValues(plugin.id, values, this.snapshot?.data.controls ?? []),
    });
  }
  private async invokeJson(plugin: PluginConfig, request: ScriptUIEvent) {
    await this.saveTail;
    const response = await call<{ data: ScriptUIResult }>({
      type: 'plugin.event',
      tab: this.tab,
      site: this.site,
      plugin: plugin.id,
      requireFullContent: plugin.requireFullContent !== false,
      request,
    });
    if (response.data.result) {
      this.showResult({ data: response.data.result });
    }
    return response.data;
  }
  private choose = () =>
    this.run(async () => {
      await this.page('start');
      window.close();
    });
  private alterSelection = (command: 'parent' | 'undo') =>
    this.run(async () => {
      const draft = await this.page(command);
      this.context = { ...this.context, draft: draft ?? undefined };
    });
  private cancelSelection = () =>
    this.run(async () => {
      await this.page('cancel');
      this.context = { ...this.context, draft: undefined };
      this.manual = false;
    });
  private addSelection = () =>
    this.run(async () => {
      const selector = this.manual ? this.selector.trim() : this.context.draft?.selector;
      if (!selector) {
        throw new Error('请先选择元素或输入选择器');
      }
      await this.save({
        items: [...this.items, { selector, label: this.draftLabel, prefix: this.draftPrefix }],
        selectionExpanded: true,
      });
      if (!this.manual) {
        await this.page('confirm');
      }
      this.context = { ...this.context, draft: undefined };
      this.manual = false;
      this.selector = '';
      this.draftLabel = '';
      this.draftPrefix = '';
      this.say('已添加抓取项');
    });
  private editItem(index: number, field: keyof Item, value: string) {
    void this.save({
      items: this.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    });
  }
  private removeItem(index: number) {
    void this.save({ items: this.items.filter((_, i) => i !== index) });
  }
  private moveItem(index: number, delta: number) {
    const items = [...this.items];
    const [item] = items.splice(index, 1);
    items.splice(index + delta, 0, item);
    void this.save({ items });
  }
  private itemMenu(event: MouseEvent, index: number) {
    event.preventDefault();
    this.menu = {
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          kind: 'action',
          id: 'highlight',
          label: '在网页中高亮',
          action: () =>
            this.run(async () => {
              await this.page('highlight', this.items[index].selector);
            }),
        },
        {
          kind: 'action',
          id: 'up',
          label: '上移',
          disabled: index === 0,
          action: () => this.moveItem(index, -1),
        },
        {
          kind: 'action',
          id: 'down',
          label: '下移',
          disabled: index === this.items.length - 1,
          action: () => this.moveItem(index, 1),
        },
        { kind: 'separator', id: 'sep' },
        { kind: 'action', id: 'remove', label: '删除抓取项', action: () => this.removeItem(index) },
      ],
    };
  }
  private async submit() {
    if (this.busy || !this.snapshot || this.tab === undefined) {
      return;
    }
    this.busy = true;
    await this.run(async () => {
      await this.saveTail;
      const result = await call({ type: 'crawl', tab: this.tab, site: this.site });
      this.showResult(result);
    });
    this.busy = false;
  }
  private showResult(input: unknown) {
    const result = input as { message?: string; data?: unknown };
    const data = result.data as
      | {
          type?: string;
          message?: string;
          data?: { message?: string; type?: NotificationType | 'warning'; scope?: NotificationScope };
        }
      | unknown[]
      | undefined;
    const showTypedNotification = (entry: unknown) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const value = entry as {
        type?: string;
        message?: string;
        scope?: NotificationScope;
        data?: { message?: string; type?: NotificationType | 'warning'; scope?: NotificationScope };
      };
      const notification = value.type === 'notification' ? value.data : value;
      if (!notification?.message) {
        return false;
      }
      const type = notification.type === 'warning' ? 'warn' : notification.type;
      if (!type || !['info', 'success', 'warn', 'error'].includes(type)) {
        return false;
      }
      this.showNotification(notification.message, type as NotificationType, notification.scope);
      return true;
    };
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (showTypedNotification(entry)) {
          continue;
        }
        if (typeof entry === 'string') {
          this.notifications.add(entry, 'success');
          continue;
        }
        const item = entry as { pluginInfo?: { name: string }; info?: string } | null;
        this.notifications.add(
          `${item?.pluginInfo?.name ?? '插件'}：${item?.info ?? ''}`,
          'success',
        );
      }
      if (data.length) {
        return;
      }
    } else if (showTypedNotification(data)) {
      return;
    } else if (data?.data?.message) {
      this.showNotification(
        data.data.message,
        data.data.type === 'warning' ? 'warn' : (data.data.type ?? 'info'),
        data.data.scope,
      );
      return;
    }
    this.notifications.add(
      result.message === 'success' ? '采集成功' : (result.message ?? '操作成功'),
      'success',
    );
  }
  private value(plugin: PluginConfig, control: PluginItem) {
    return (
      this.snapshot?.data.controls.find(
        (entry) => entry.pluginId === plugin.id && entry.channel === control.channel,
      )?.value ??
      control.options?.defaultValue ??
      null
    );
  }
  private changeControl(
    plugin: PluginConfig,
    control: PluginItem,
    value: string | number | boolean | null,
  ) {
    const controls =
      this.snapshot?.data.controls.filter(
        (entry) => entry.pluginId !== plugin.id || entry.channel !== control.channel,
      ) ?? [];
    const generation = this.generation;
    const saved = this.save({
      controls: [...controls, { pluginId: plugin.id, channel: control.channel, value }],
    });
    if (control.options?.autoTrigger) {
      void this.run(async () => {
        await saved;
        if (generation === this.generation) {
          await this.trigger(plugin, control, value);
        }
      });
    }
  }
  private queueToggle(plugin: PluginConfig, control: PluginItem, key: string, value: boolean) {
    const pending = this.controlChanges.get(key) ?? {
      value,
      commit: debounce((checked: boolean) => {
        this.controlChanges.delete(key);
        if (checked !== !!this.value(plugin, control)) {
          this.changeControl(plugin, control, checked);
        }
      }, 500),
    };
    pending.value = value;
    this.controlChanges.set(key, pending);
    pending.commit(value);
  }
  private changeInput(plugin: PluginConfig, control: PluginItem, value: string) {
    if (value !== String(this.value(plugin, control) ?? '')) {
      this.changeControl(plugin, control, value);
    }
  }
  private async trigger(
    plugin: PluginConfig,
    control: PluginItem,
    value: string | number | boolean | null,
  ) {
    const relatedValues = Object.fromEntries(
      (control.options?.relatedChannel ?? []).map((channel) => {
        const related = plugin.controls.find((entry) => entry.channel === channel);
        return [channel, related ? this.value(plugin, related) : null];
      }),
    );
    const result = await call({
      type: 'trigger',
      tab: this.tab,
      site: this.site,
      plugin: plugin.id,
      channel: control.channel,
      event: control.type === 'button' ? 'click' : 'change',
      requireFullContent: control.options?.requireFullContent ?? true,
      relatedValues,
      value,
    });
    this.showResult(result);
  }
  private control(plugin: PluginConfig, control: PluginItem) {
    const value = this.value(plugin, control);
    switch (control.type) {
      case 'button':
        return html`<button
          ?disabled=${this.busy}
          @click=${() =>
            this.run(async () => {
              this.busy = true;
              try {
                await this.saveTail;
                await this.trigger(plugin, control, value);
              } finally {
                this.busy = false;
              }
            })}
        >
          ${control.label}
        </button>`;
      case 'checkbox':
      case 'toggle': {
        const key = JSON.stringify([plugin.id, control.channel]);
        return html`<label class="check"
          ><input
            type="checkbox"
            .checked=${this.controlChanges.get(key)?.value ?? !!value}
            @change=${(event: Event) =>
              this.queueToggle(plugin, control, key, (event.target as HTMLInputElement).checked)}
          />${control.label}</label
        >`;
      }
      case 'select':
        return html`<label
          >${control.label}<wb-menu-select
            .label=${control.label}
            .value=${String(value ?? '')}
            .options=${(control.options?.options ?? []).map((option) => ({
              label: option.label,
              value: String(option.value),
            }))}
            @wb-menu-change=${(event: CustomEvent<{ value: string }>) =>
              this.changeControl(plugin, control, event.detail.value)}
          ></wb-menu-select
        ></label>`;
      default:
        return html`<label
          >${control.label}<input
            type=${control.type === 'input:number' ? 'number' : 'text'}
            .value=${String(value ?? '')}
            @blur=${(event: Event) =>
              this.changeInput(plugin, control, (event.target as HTMLInputElement).value)}
        /></label>`;
    }
  }
  private async checkCorePermission() {
    let origin: string;
    try {
      origin = permissionOrigin(this.connectionConfig);
    } catch {
      this.permissionRequired = false;
      return false;
    }
    const generation = this.generation;
    const granted = await browser.permissions.contains({ origins: [origin] });
    if (generation !== this.generation) {
      return false;
    }
    this.permissionRequired = !granted;
    if (!granted) {
      this.connected = false;
    }
    return granted;
  }
  private reconnect = async () => {
    if (this.snapshot && (await this.sync('interactive'))) {
      await this.loadPlugins(true);
    }
  };
  private authorizeCore = () =>
    this.run(async () => {
      if (this.connectionWrite) {
        return;
      }
      const generation = this.generation;
      // 主机授权必须从点击处理器直接发起。
      const granted = await browser.permissions.request({
        origins: [permissionOrigin(this.connectionConfig)],
      });
      if (generation !== this.generation) {
        return;
      }
      if (!granted) {
        throw new Error('未授权访问核心主机');
      }
      this.permissionRequired = false;
      await this.reconnect();
    });
  private async patchSettings(settings: Partial<Settings>, site?: string) {
    // 旧版后台会把 settings.save 当作整份设置写入。
    const result = await call<Pick<Init, 'settings' | 'snapshot'> | undefined>({
      type: 'settings.patch',
      settings,
      ...(site === undefined ? {} : { site }),
    });
    if (!result?.settings) {
      throw new Error('扩展后台版本不一致，请重新加载扩展');
    }
    return result;
  }
  private async saveConnection(field: keyof TConfig['api'], event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const config = { ...this.config, api: { ...this.config.api, [field]: value } };
    this.config = config;
    if (!this.connectionWrite && !changedConnection(this.connectionConfig, config)) {
      this.connectionError = '';
      return;
    }
    try {
      permissionOrigin(config);
    } catch {
      this.connectionError = '请输入有效的 HTTP(S) 核心地址和端口（1–65535）';
      return;
    }
    this.connectionError = '';
    const generation = ++this.generation;
    this.pluginGeneration++;
    this.syncAfterSave.cancel();
    this.connected = false;
    const pending = this.patchSettings({ config }, this.snapshot ? this.site : undefined);
    this.connectionWrite = pending;
    try {
      const { settings, snapshot } = await pending;
      if (generation !== this.generation) {
        return;
      }
      this.context = {
        ...this.context,
        settings: { ...this.context.settings, config: settings.config },
      };
      if (this.snapshot && snapshot) {
        this.context = {
          ...this.context,
          snapshot: {
            ...this.snapshot,
            data: { ...this.snapshot.data, config: snapshot.data.config },
          },
        };
      }
      this.syncBlocked = false;
    } catch (error) {
      if (generation === this.generation) {
        this.connectionError = error instanceof Error ? error.message : String(error);
      }
      return;
    } finally {
      if (this.connectionWrite === pending) {
        this.connectionWrite = undefined;
      }
    }
    await this.run(async () => {
      if (await this.checkCorePermission()) {
        await this.reconnect();
      }
    });
  }
  private applyTheme(theme: Settings['theme']) {
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
  }
  private changeTheme = (event: CustomEvent<{ value: Settings['theme'] }>) => {
    const theme = event.detail.value;
    if (theme === this.theme) {
      return;
    }
    const revision = ++this.themeRevision;
    this.applyTheme(theme);
    void this.run(async () => {
      try {
        await this.patchSettings({ theme });
        this.context = { ...this.context, settings: { ...this.context.settings, theme } };
      } catch (error) {
        if (revision === this.themeRevision) {
          this.applyTheme(this.context.settings.theme);
        }
        throw error;
      }
    });
  };
  private capture() {
    return html`<div class="toolbar">
        <button class="primary" @click=${this.choose}>＋ 选择网页元素</button
        ><button
          @click=${() => {
            this.manual = !this.manual;
          }}
        >
          添加选择器
        </button>
      </div>
      ${this.context.draft || this.manual
        ? html`<section class="selection">
            <h3>${this.manual ? '添加选择器' : '确认选中元素'}</h3>
            ${this.manual
              ? html`<label
                  >选择器<input
                    .value=${this.selector}
                    @input=${(e: Event) => {
                      this.selector = (e.target as HTMLInputElement).value;
                    }}
                    placeholder="#content 或 CSS 路径"
                /></label>`
              : html`<code>${this.context.draft?.selector}</code>
                  <div class="toolbar">
                    <button @click=${() => this.alterSelection('parent')}>选择父元素</button
                    ><button
                      ?disabled=${(this.context.draft?.depth ?? 0) < 2}
                      @click=${() => this.alterSelection('undo')}
                    >
                      撤销父级
                    </button>
                  </div>`}
            <div class="fields">
              <label
                >描述<input
                  .value=${this.draftLabel}
                  @input=${(e: Event) => {
                    this.draftLabel = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="例如：文章正文" /></label
              ><label
                >文本前缀<input
                  .value=${this.draftPrefix}
                  @input=${(e: Event) => {
                    this.draftPrefix = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="可选"
              /></label>
            </div>
            <div class="toolbar">
              <button class="primary" @click=${this.addSelection}>确认添加</button
              ><button @click=${this.cancelSelection}>取消</button>
            </div>
          </section>`
        : nothing}
      ${!this.items.length
        ? html`<div class="empty">
            <span class="empty-symbol">⌖</span>
            <h3>从一个元素开始</h3>
            <p>点击“选择网页元素”，在网页中点选内容，<br />再点击插件图标回来确认。</p>
          </div>`
        : html`<div class="item-list">
            ${repeat(
              this.items,
              (_, index) => index,
              (item, index) =>
                html`<section
                  class="item"
                  @contextmenu=${(event: MouseEvent) => this.itemMenu(event, index)}
                >
                  <div class="item-heading">
                    <span>抓取项 ${String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <button
                        class="icon"
                        title="高亮网页元素"
                        @click=${() =>
                          this.run(async () => {
                            await this.page('highlight', item.selector);
                          })}
                      >
                        ⌖</button
                      ><button
                        class="icon"
                        title="更多操作"
                        @click=${(event: MouseEvent) => this.itemMenu(event, index)}
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                  <div class="fields">
                    <label
                      >描述<input
                        .value=${item.label}
                        @input=${(e: Event) =>
                          this.editItem(
                            index,
                            'label',
                            (e.target as HTMLInputElement).value,
                          )} /></label
                    ><label
                      >文本前缀<input
                        .value=${item.prefix}
                        @input=${(e: Event) =>
                          this.editItem(index, 'prefix', (e.target as HTMLInputElement).value)}
                    /></label>
                  </div>
                  <label class="selector"
                    >选择器<input
                      .value=${item.selector}
                      @input=${(e: Event) =>
                        this.editItem(index, 'selector', (e.target as HTMLInputElement).value)}
                  /></label>
                </section>`,
            )}
          </div>`}`;
  }
  private pluginPanel() {
    const plugin = this.plugins.find((entry) => entry.id === this.activePlugin);
    return html`${this.plugins.length
      ? html`<wb-scroll-container class="plugin-tabs"
          ><div class="plugin-tab-row">
            ${this.plugins.map(
              (entry) =>
                html`<div
                  class="plugin-tab"
                  data-active=${entry.id === this.activePlugin}
                  role="presentation"
                >
                  <button
                    class=${entry.id === this.activePlugin ? 'active' : ''}
                    role="tab"
                    aria-selected=${entry.id === this.activePlugin}
                    @click=${() => {
                      this.selectPlugin(entry.id);
                      void this.save({ plugin: { expanded: true, activeTab: entry.id } });
                    }}
                  >
                    ${entry.title}</button
                  ><button
                    class="plugin-refresh"
                    title=${`刷新 ${entry.title}`}
                    aria-label=${`刷新 ${entry.title}`}
                    ?disabled=${this.refreshingPlugins.has(entry.id)}
                    @click=${() => this.refreshPlugin(entry.id)}
                  >
                    <wb-icon
                      name=${this.refreshingPlugins.has(entry.id) ? 'loading' : 'refresh'}
                      class=${this.refreshingPlugins.has(entry.id) ? 'spinning' : ''}
                      size="sm"
                    ></wb-icon>
                  </button>
                </div>`,
            )}
          </div></wb-scroll-container
        >`
      : html`<div class="empty">
          <h3>暂无适用插件</h3>
          <p>确认核心已运行，并已启用适用于当前网址的插件。</p>
        </div>`}
    ${repeat(
      this.plugins.filter(
        (p) => p.version === 'v2' && p.ui && !p.configError && !scriptConfigProblem(p),
      ),
      (p) => p.id,
      (entry) => html`<section class="plugin-form" ?hidden=${entry.id !== this.activePlugin}>
        <p>${entry.description}</p>
        <scwc-script-ui
          .identity=${entry.id}
          .active=${this.panel === 'plugins' && entry.id === this.activePlugin}
          .model=${entry.ui}
          .values=${entry.ui
            ? readScriptValues(entry.id, entry.ui, this.snapshot?.data.controls ?? [])
            : {}}
          .saveValues=${(values: Record<string, FieldValue>) => this.saveJsonValues(entry, values)}
          .invoke=${(request: ScriptUIEvent) => this.invokeJson(entry, request)}
          .refreshModel=${(previous: { instanceId: string; dirtyFields: string[] }) =>
            this.refreshJsonModel(entry, previous)}
        ></scwc-script-ui>
        <p class="muted">网址刷新规则：${entry.refreshRule ?? '//'}</p>
      </section>`,
    )}
    ${plugin &&
    !(plugin.version === 'v2' && plugin.ui && !plugin.configError && !scriptConfigProblem(plugin))
      ? html`<section class="plugin-form">
          <p>${plugin.description}</p>
          ${plugin.configError || scriptConfigProblem(plugin)
            ? html`<p role="alert">${plugin.configError ?? scriptConfigProblem(plugin)}</p>`
            : plugin.controls.map(
                (control) => html`<div class="control">${this.control(plugin, control)}</div>`,
              )}
          <p class="muted">网址刷新规则：${plugin.refreshRule ?? '//'}</p>
        </section>`
      : nothing}`;
  }
  private settingsPanel() {
    return html`<div class="section-heading">
        <div>
          <h2>连接设置</h2>
          <p>连接运行在本机或其他主机上的 SCWC 核心。</p>
        </div>
      </div>
      <div class="settings">
        <label
          >核心地址<input
            placeholder="http://localhost"
            .value=${this.config.api.host}
            @blur=${(e: Event) => this.saveConnection('host', e)} /></label
        ><label
          >端口<input
            inputmode="numeric"
            .value=${this.config.api.port}
            @blur=${(e: Event) => this.saveConnection('port', e)} /></label
        ><label
          >访问令牌<input
            type="password"
            autocomplete="off"
            .value=${this.config.api.token}
            @blur=${(e: Event) => this.saveConnection('token', e)}
            placeholder="核心的 TOKEN，关闭鉴权时留空" /></label
        ><label
          >外观<wb-menu-select
            label="外观"
            .value=${this.theme}
            .options=${[
              { label: '深色', value: 'dark-2026' },
              { label: '浅色', value: 'light-2026' },
            ]}
            @wb-menu-change=${this.changeTheme}
          ></wb-menu-select
        ></label>
        ${this.connectionError
          ? html`<span class="sync-auth-warning" role="alert">${this.connectionError}</span>`
          : nothing}
        ${this.permissionRequired
          ? html`<button class="primary" @click=${this.authorizeCore}>授权访问核心</button>`
          : this.syncBlocked && this.snapshot
            ? html`<span class="sync-auth-warning" role="alert"
                  >同步已暂停，请检查核心地址、端口和网络连接。</span
                ><button class="primary" @click=${this.reconnect}>重新连接</button>`
            : nothing}
        <p class="storage-note">
          数据保存在扩展的独立存储中，按网站共享。连接核心后，与油猴脚本同步抓取项、插件值和设置；窗口位置与最小化状态不参与扩展配置。
        </p>
      </div>`;
  }
  render() {
    this.notifications.historyOpen = this.panel === 'notifications';
    return html`<header>
        <div class="brand"><strong>SCWC</strong></div>
        <span class="connection" data-connected=${this.connected}
          >${this.connected ? '核心已连接' : '本地保存'}</span
        >
      </header>
      <div class="site-bar">
        <span class="site-dot"></span
        ><span class="site-name" title=${this.site}
          >${this.snapshot?.website ?? '当前页面不支持采集'}</span
        ><button
          class="primary site-capture"
          ?disabled=${this.busy || !this.snapshot}
          @click=${() => this.submit()}
        >
          ${this.busy ? '正在采集…' : '采集并发送'} <wb-icon name="send" size="sm"></wb-icon>
        </button>
      </div>
      <nav aria-label="功能">
        <button
          class=${this.panel === 'capture' ? 'active' : ''}
          ?disabled=${!this.snapshot}
          @click=${() => this.selectPanel('capture')}
        >
          采集 <span>${this.items.length}</span></button
        ><button
          class=${this.panel === 'plugins' ? 'active' : ''}
          ?disabled=${!this.snapshot}
          @click=${() => this.selectPanel('plugins')}
        >
          插件</button
        ><button
          class=${this.panel === 'notifications' ? 'active' : ''}
          @click=${() => this.selectPanel('notifications')}
        >
          通知</button
        ><button
          class=${this.panel === 'settings' ? 'active' : ''}
          @click=${() => this.selectPanel('settings')}
        >
          设置
        </button>
      </nav>
      <div class="content-area">
        <wb-scroll-container class="main-scroll" ?hidden=${this.panel === 'notifications'}
          ><main>
            ${!this.loaded ? html`<p class="muted">正在加载…</p>` : nothing}
            <div ?hidden=${this.panel !== 'capture'}>${this.loaded ? this.capture() : nothing}</div>
            <div ?hidden=${this.panel !== 'plugins'}>${this.pluginPanel()}</div>
            <div ?hidden=${this.panel !== 'settings'}>
              ${this.loaded ? this.settingsPanel() : nothing}
            </div>
          </main></wb-scroll-container
        >
        ${this.notifications}
      </div>
      <footer>
        <span>${this.snapshot ? '按网站保存 · 扩展独立存储' : '请打开 HTTP 或 HTTPS 网页'}</span>
        <span class="muted">v${CLIENT_VERSION}</span>
      </footer>
      ${this.menu
        ? html`<wb-context-menu
            .x=${this.menu.x}
            .y=${this.menu.y}
            .items=${this.menu.items}
            presentation="custom"
            @wb-menu-select=${(event: CustomEvent<{ id: string }>) => {
              const item = this.menu?.items.find((entry) => entry.id === event.detail.id);
              if (item?.kind === 'action' && !item.disabled) {
                void item.action();
              }
              this.menu = null;
            }}
            @wb-menu-close=${() => {
              this.menu = null;
            }}
          ></wb-context-menu>`
        : nothing}`;
  }
}
