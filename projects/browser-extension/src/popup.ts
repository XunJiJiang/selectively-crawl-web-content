import { LitElement, html, css, unsafeCSS, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { browser, call } from './browser.ts';
import type { Init, PluginBatch } from './background.ts';
import {
  coreAddress,
  initialSettings,
  permissionOrigin,
  type Draft,
  type Item,
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
  @state() private accessor context: Init = { settings: initialSettings() };
  @state() private accessor panel: 'capture' | 'plugins' | 'settings' = 'capture';
  @state() private accessor plugins: PluginConfig[] = [];
  @state() private accessor activePlugin = '';
  @state() private accessor connected = false;
  @state() private accessor busy = false;
  @state() private accessor loaded = false;
  @state() private accessor notice = '';
  @state() private accessor noticeError = false;
  @state() private accessor results: string[] = [];
  @state() private accessor config = initialSettings().config;
  @state() private accessor theme: Settings['theme'] = 'dark-2026';
  @state() private accessor draftLabel = '';
  @state() private accessor draftPrefix = '';
  @state() private accessor manual = false;
  @state() private accessor selector = '';
  @state() private accessor menu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  private generation = 0;
  private edits = 0;
  private saveTail: Promise<unknown> = Promise.resolve();
  private syncTimer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private polling = false;
  private controlTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastSite = '';
  private pluginGeneration = 0;
  private get snapshot() {
    return this.context.snapshot;
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
    void this.initialize();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.generation++;
    this.pluginGeneration++;
    clearInterval(this.poll);
    clearTimeout(this.syncTimer);
    for (const timer of this.controlTimers.values()) {
      clearTimeout(timer);
    }
  }
  private say(message: string, error = false) {
    this.notice = message;
    this.noticeError = error;
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
      this.config = structuredClone(this.snapshot?.data.config ?? this.context.settings.config);
      this.theme = this.context.settings.theme;
      document.documentElement.dataset.theme = this.theme;
      this.activePlugin = this.snapshot?.data.plugin.activeTab ?? '';
      if (!this.snapshot) {
        this.panel = 'settings';
      }
      this.loaded = true;
      if (this.snapshot) {
        await this.sync();
        await this.loadPlugins();
      }
    });
    this.loaded = true;
    this.poll = setInterval(() => {
      void this.refresh();
    }, 4000);
  }
  private async refresh() {
    if (this.polling || this.busy || !this.snapshot) {
      return;
    }
    this.polling = true;
    try {
      const current = await call<Init>({ type: 'init' });
      if (current.tab?.url !== this.site) {
        const sameOrigin = current.snapshot?.website === this.snapshot.website;
        this.generation++;
        this.pluginGeneration++;
        this.edits++;
        for (const timer of this.controlTimers.values()) {
          clearTimeout(timer);
        }
        this.controlTimers.clear();
        this.context = current;
        if (!sameOrigin) {
          this.plugins = [];
          this.lastSite = '';
        }
        if (current.snapshot) {
          await this.sync();
          await this.loadPlugins();
        } else {
          this.panel = 'settings';
        }
      } else {
        const wasConnected = this.connected;
        await this.sync();
        if (!wasConnected && this.connected) {
          await this.loadPlugins(true);
        }
      }
    } catch {
      this.connected = false;
    } finally {
      this.polling = false;
    }
  }
  private async sync() {
    if (!this.snapshot) {
      return;
    }
    const generation = this.generation,
      edits = this.edits;
    try {
      const next = await call<Snapshot>({ type: 'core.sync', site: this.site });
      if (generation !== this.generation) {
        return;
      }
      this.connected = true;
      if (this.notice.includes('数据已保存在扩展中')) {
        this.notice = '';
        this.noticeError = false;
      }
      if (edits === this.edits) {
        this.context = { ...this.context, snapshot: next };
        if (this.plugins.some((plugin) => plugin.id === next.data.plugin.activeTab)) {
          this.activePlugin = next.data.plugin.activeTab;
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.connected = false;
        this.say(
          `${error instanceof Error ? error.message : String(error)}；数据已保存在扩展中`,
          true,
        );
      }
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
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
          void this.sync();
        }, 500);
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
    if (this.busy) {
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
    this.say(result.message === 'success' ? '采集成功' : (result.message ?? '操作成功'));
    const data = result.data as
      | { type?: string; data?: { message?: string } }
      | unknown[]
      | undefined;
    if (Array.isArray(data)) {
      this.results = data.map((entry: unknown) => {
        if (typeof entry === 'string') {
          return entry;
        }
        const item = entry as { pluginInfo?: { name: string }; info?: string };
        return `${item.pluginInfo?.name ?? '插件'}：${item.info ?? ''}`;
      });
    } else if (data?.data?.message) {
      this.results = [data.data.message];
    }
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
    const saved = this.save({
      controls: [...controls, { pluginId: plugin.id, channel: control.channel, value }],
    });
    if (!control.options?.autoTrigger) {
      return;
    }
    const key = `${plugin.id}:${control.channel}`;
    clearTimeout(this.controlTimers.get(key));
    const invoke = async () => {
      await saved;
      await this.trigger(plugin, control, value);
    };
    if (control.type.startsWith('input:')) {
      this.controlTimers.set(
        key,
        setTimeout(() => {
          void this.run(invoke);
        }, 500),
      );
    } else {
      void this.run(invoke);
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
      case 'toggle':
        return html`<label class="check"
          ><input
            type="checkbox"
            .checked=${!!value}
            @change=${(event: Event) =>
              this.changeControl(plugin, control, (event.target as HTMLInputElement).checked)}
          />${control.label}</label
        >`;
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
            @input=${(event: Event) =>
              this.changeControl(plugin, control, (event.target as HTMLInputElement).value)}
        /></label>`;
    }
  }
  private saveConnection = () =>
    this.run(async () => {
      coreAddress(this.config);
      // 必须直接由本次按钮点击申请，避免丢失 Firefox/Safari 的用户手势。
      const granted = await browser.permissions.request({
        origins: [permissionOrigin(this.config)],
      });
      if (!granted) {
        throw new Error('未授权访问核心主机，设置尚未保存');
      }
      const settings: Settings = { config: structuredClone(this.config), theme: this.theme };
      this.generation++;
      this.pluginGeneration++;
      this.connected = false;
      await call({ type: 'settings.save', settings });
      this.context = { ...this.context, settings };
      document.documentElement.dataset.theme = this.theme;
      if (this.snapshot) {
        await this.save({ config: settings.config });
        await this.sync();
        await this.loadPlugins(true);
      }
      if (this.connected) {
        this.say('连接成功，设置已保存');
      } else if (!this.snapshot) {
        this.say('设置已保存；打开网站后将连接核心');
      }
    });
  private apiInput(field: keyof TConfig['api'], value: string) {
    this.config = { ...this.config, api: { ...this.config.api, [field]: value } };
  }
  private capture() {
    return html`<div class="section-heading">
        <div>
          <h2>网页采集</h2>
          <p>选择页面元素，保存为可重复使用的抓取项。</p>
        </div>
        <span class="count">${this.items.length}</span>
      </div>
      <div class="toolbar">
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
    return html`<div class="section-heading">
        <div>
          <h2>网站插件</h2>
          <p>当前页面适用的核心插件与操作。</p>
        </div>
        <button class="icon" title="刷新插件" @click=${() => this.loadPlugins(true)}>↻</button>
      </div>
      ${this.plugins.length
        ? html`<wb-scroll-container class="plugin-tabs"
            ><div class="plugin-tab-row">
              ${this.plugins.map(
                (entry) =>
                  html`<button
                    class=${entry.id === this.activePlugin ? 'selected' : ''}
                    @click=${() => {
                      this.activePlugin = entry.id;
                      void this.save({ plugin: { expanded: true, activeTab: entry.id } });
                    }}
                  >
                    ${entry.title}
                  </button>`,
              )}
            </div></wb-scroll-container
          >`
        : html`<div class="empty">
            <h3>暂无适用插件</h3>
            <p>确认核心已运行，并已启用适用于当前网址的插件。</p>
          </div>`}
      ${plugin
        ? html`<section class="plugin-form">
            <p>${plugin.description}</p>
            ${plugin.controls.map(
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
            @input=${(e: Event) =>
              this.apiInput('host', (e.target as HTMLInputElement).value)} /></label
        ><label
          >端口<input
            inputmode="numeric"
            .value=${this.config.api.port}
            @input=${(e: Event) =>
              this.apiInput('port', (e.target as HTMLInputElement).value)} /></label
        ><label
          >访问令牌<input
            type="password"
            autocomplete="off"
            .value=${this.config.api.token}
            @input=${(e: Event) => this.apiInput('token', (e.target as HTMLInputElement).value)}
            placeholder="核心的 TOKEN，关闭鉴权时留空" /></label
        ><label
          >通知位置<wb-menu-select
            label="通知位置"
            .value=${this.config.notify.placement}
            .options=${[
              { label: '右上', value: 'tr' },
              { label: '左上', value: 'tl' },
              { label: '上方居中', value: 'tc' },
              { label: '右下', value: 'br' },
              { label: '左下', value: 'bl' },
              { label: '下方居中', value: 'bc' },
            ]}
            @wb-menu-change=${(e: CustomEvent<{ value: TConfig['notify']['placement'] }>) => {
              this.config = { ...this.config, notify: { placement: e.detail.value } };
            }}
          ></wb-menu-select></label
        ><label
          >外观<wb-menu-select
            label="外观"
            .value=${this.theme}
            .options=${[
              { label: '深色', value: 'dark-2026' },
              { label: '浅色', value: 'light-2026' },
            ]}
            @wb-menu-change=${(e: CustomEvent<{ value: Settings['theme'] }>) => {
              this.theme = e.detail.value;
            }}
          ></wb-menu-select></label
        ><button class="primary" @click=${this.saveConnection}>保存并连接</button>
        <p class="storage-note">
          数据保存在扩展的独立存储中，按网站共享。连接核心后，与油猴脚本同步抓取项、插件值和设置；窗口位置与最小化状态不参与扩展配置。
        </p>
      </div>`;
  }
  render() {
    return html`<header>
        <div class="brand-mark">⌖</div>
        <div class="brand"><strong>SCWC</strong><span>选择性网页采集</span></div>
        <span class="connection" data-connected=${this.connected}
          >${this.connected ? '核心已连接' : '本地保存'}</span
        >
      </header>
      <div class="site-bar">
        <span class="site-dot"></span
        ><span title=${this.site}>${this.snapshot?.website ?? '当前页面不支持采集'}</span>
      </div>
      <nav aria-label="功能">
        <button
          class=${this.panel === 'capture' ? 'active' : ''}
          ?disabled=${!this.snapshot}
          @click=${() => {
            this.panel = 'capture';
          }}
        >
          采集 <span>${this.items.length}</span></button
        ><button
          class=${this.panel === 'plugins' ? 'active' : ''}
          ?disabled=${!this.snapshot}
          @click=${() => {
            this.panel = 'plugins';
          }}
        >
          插件</button
        ><button
          class=${this.panel === 'settings' ? 'active' : ''}
          @click=${() => {
            this.panel = 'settings';
            this.config = structuredClone(
              this.snapshot?.data.config ?? this.context.settings.config,
            );
          }}
        >
          设置
        </button>
      </nav>
      <wb-scroll-container class="main-scroll"
        ><main>
          ${!this.loaded
            ? html`<p class="muted">正在加载…</p>`
            : this.panel === 'capture'
              ? this.capture()
              : this.panel === 'plugins'
                ? this.pluginPanel()
                : this.settingsPanel()}
          ${this.notice
            ? html`<div class="notice" role="status" ?data-error=${this.noticeError}>
                ${this.notice}<button
                  class="icon"
                  title="关闭提示"
                  @click=${() => {
                    this.notice = '';
                  }}
                >
                  ×
                </button>
              </div>`
            : nothing}
          ${this.results.length
            ? html`<details class="results" open>
                <summary>处理结果</summary>
                ${this.results.map((line) => html`<p>${line}</p>`)}
              </details>`
            : nothing}
        </main></wb-scroll-container
      >
      <footer>
        <span>${this.snapshot ? '按网站保存 · 扩展独立存储' : '请打开 HTTP 或 HTTPS 网页'}</span
        >${this.panel === 'capture' && this.snapshot
          ? html`<button class="primary" ?disabled=${this.busy} @click=${() => this.submit()}>
              ${this.busy ? '正在采集…' : '采集并发送'} <span>↗</span>
            </button>`
          : html`<span class="muted">v1.0.0</span>`}
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
