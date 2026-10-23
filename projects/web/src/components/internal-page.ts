import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import style from '../workbench/workbench.css?raw';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { InternalPage } from '../workbench/types.ts';
import { groups, titleOf } from '../workbench/model.ts';
import {
  commands,
  conflicts,
  effectiveKeys,
  eventKey,
  platform,
  type Command,
} from '../workbench/commands.ts';
import {
  icon,
  iconButton,
  pluginCard,
  bookmarkList,
  bookmarkFolderButton,
} from '../workbench/ui.ts';
import { ConfigController } from '../../../shared/store/config.ts';
import { CONFIG_KEY } from '../../../shared/utils/common.ts';
import './context-menu/wb-menu-select.ts';
@customElement('wb-internal-page')
export class InternalPageView extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property() accessor page: InternalPage = 'welcome';
  @state() private accessor query = '';
  @state() private accessor filter = 'all';
  @state() private accessor sort = 'name';
  @state() private accessor editing: Command | null = null;
  @state() private accessor recorded = '';
  @state() private accessor bindingError = '';
  static styles = css`
    ${unsafeCSS(style)}:host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .internal-view {
      min-height: 100%;
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    queueMicrotask(() => this.store?.addEventListener('change', this.changed));
  }
  disconnectedCallback() {
    this.store?.removeEventListener('change', this.changed);
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (changed.has('page')) {
      this.query = '';
      this.filter = 'all';
      this.editing = null;
    }
  }
  private changed = () => this.requestUpdate();
  private action = (id: string, args?: unknown) =>
    this.dispatchEvent(
      new CustomEvent('workbench-command', { detail: { id, args }, bubbles: true, composed: true }),
    );
  private run(work: () => Promise<unknown>) {
    void work().catch((e) => this.store.toast(this.store.message(e), 'error'));
  }
  render() {
    if (!this.store) {
      return nothing;
    }
    switch (this.page) {
      case 'pages':
        return html`<div class="internal-view">
          ${this.header('PAGES', '页面', '打开的页面与插件页面。')}
          <div class="record-list">
            ${this.store.workspace?.snapshot.tabs.map(
              (tab) =>
                html`<button class="record-card" @click=${() => this.action('focusTab', tab.id)}>
                  ${icon(tab.kind === 'plugin' ? 'pages' : tab.page)}${titleOf(tab)}
                </button>`,
            )}
          </div>
          <div class="plugin-grid">
            ${this.store.catalog
              .filter((p) => p.ui.state === 'ready')
              .map((p) => pluginCard(p, this.action))}
          </div>
        </div>`;
      case 'welcome':
        return this.welcome();
      case 'settings':
        return this.settings();
      case 'keybindings':
        return this.keybindings();
      case 'plugins':
        return this.plugins();
      case 'bookmarks':
        return this.bookmarks();
      case 'history':
        return this.history();
      case 'search':
        return html`<slot name="search"></slot>`;
    }
  }
  private header(eyebrow: string, title: string, description: string) {
    return html`<div class="page-heading">
      <span class="eyebrow">${eyebrow}</span>
      <h1>${title}</h1>
      <p>${description}</p>
    </div>`;
  }
  private search(placeholder: string) {
    return html`<div class="page-search">
      ${icon('search')}<input
        aria-label=${placeholder}
        placeholder=${placeholder}
        .value=${live(this.query)}
        @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
      />${this.page === 'bookmarks' ? bookmarkFolderButton(this.store, this.action) : nothing}
    </div>`;
  }
  private welcome() {
    const ready = this.store.catalog.filter((p) => p.runtime.status === 'ready'),
      pages = ready.filter((p) => p.ui.state === 'ready');
    return html`<div class="internal-view welcome-view">
      <div class="welcome-intro">
        <div class="welcome-symbol">${icon('pages')}</div>
        <span class="eyebrow">SELECTIVELY CRAWL WEB CONTENT</span>
        <h1>你的插件，<br /><span>一个工作台。</span></h1>
        <p>打开页面、整理内容、运行命令。<br />从这里开始，继续你的工作。</p>
      </div>
      <div class="welcome-columns">
        <section>
          <h2>开始</h2>
          <button class="welcome-link" @click=${() => this.action('plugins')}>
            ${icon('plugins')}<span>浏览插件<small>管理插件与页面</small></span
            >${icon('arrow')}</button
          ><button class="welcome-link" @click=${() => this.action('quickOpen')}>
            ${icon('search')}<span>快速访问<small>搜索页面、收藏与操作</small></span
            ><kbd>F1</kbd></button
          ><button class="welcome-link" @click=${() => this.action('newTerminal')}>
            ${icon('terminal')}<span>新建命令终端<small>执行核心注册命令</small></span
            >${icon('plus')}
          </button>
        </section>
        <section>
          <h2>工作区概览</h2>
          <div class="overview-stats">
            <div><strong>${ready.length}</strong><span>运行中的插件</span></div>
            <div><strong>${pages.length}</strong><span>可用页面</span></div>
            <div><strong>${this.store.bookmarks.length}</strong><span>收藏</span></div>
          </div>
          <div class="welcome-tip">
            ${icon('split')}
            <div>
              <strong>让页面并排工作</strong>
              <p>通过“布局 → 向右拆分”对照多个页面，也可将标签拖入其他分组。</p>
            </div>
          </div>
          <button class="text-button" @click=${() => this.action('keybindings')}>
            查看全部快捷键 ${icon('arrow')}
          </button>
        </section>
      </div>
      ${pages.length
        ? html`<section class="welcome-recent">
            <div class="section-heading">
              可用插件 <span class="spacer"></span
              ><button class="text-button" @click=${() => this.action('plugins')}>
                查看全部 ${icon('arrow')}
              </button>
            </div>
            <div class="plugin-grid">
              ${pages.slice(0, 3).map((p) => pluginCard(p, this.action, true))}
            </div>
          </section>`
        : html`<div class="notice">
            ${icon('info')}暂无可用插件页面，可在插件管理中启用或构建页面。
          </div>`}
      <div class="welcome-footer">
        <span><i class="dot success"></i>本机工作区</span><span>主题与布局会自动保存</span>
      </div>
    </div>`;
  }
  private plugins() {
    let items = this.store.catalog.filter(
      (p) =>
        (!this.query ||
          `${p.title} ${p.description ?? ''} ${p.pluginId}`
            .toLowerCase()
            .includes(this.query.toLowerCase())) &&
        (this.filter === 'all' ||
          p.runtime.status === this.filter ||
          (this.filter === 'ui' && p.ui.state === 'ready') ||
          (this.filter === 'favorite' &&
            this.store.bookmarks.some((b) => b.pluginId === p.pluginId))),
    );
    items = [...items].sort((a, b) =>
      this.sort === 'status'
        ? a.runtime.status.localeCompare(b.runtime.status)
        : a.title.localeCompare(b.title),
    );
    return html`<div class="internal-view">
      ${this.header('EXTENSIONS', '插件管理', '查看所有已发现的插件，管理后端运行与页面构建。')}
      <div class="view-toolbar">
        ${this.search('搜索插件名称、描述或目录…')}<select
          aria-label="筛选插件"
          .value=${this.filter}
          @change=${(e: Event) => (this.filter = (e.target as HTMLSelectElement).value)}
        >
          ${[
            ['all', '全部插件'],
            ['ready', '运行中'],
            ['disabled', '已禁用'],
            ['failed', '运行失败'],
            ['ui', '页面就绪'],
            ['favorite', '已收藏'],
          ].map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select
        ><select
          aria-label="插件排序"
          @change=${(e: Event) => (this.sort = (e.target as HTMLSelectElement).value)}
        >
          <option value="name">按名称</option>
          <option value="status">按运行状态</option></select
        ><button class="btn secondary" @click=${() => this.action('rescan')}>
          ${icon('refresh')}重新扫描
        </button>
      </div>
      <div class="section-heading">
        ${items.length} 个插件
        <span class="muted"> / ${this.store.totals.catalog ?? items.length} 个发现项</span>
      </div>
      <div class="plugin-grid">
        ${items.map((p) =>
          pluginCard(
            p,
            this.action,
            false,
            this.store.bookmarks.some((b) => b.pluginId === p.pluginId),
          ),
        )}
      </div>
      ${!items.length
        ? html`<div class="empty">
            ${icon('plugins')}
            <p>没有匹配的插件</p>
            <button class="btn secondary" @click=${() => (this.query = '')}>清除搜索</button>
          </div>`
        : nothing}${this.more('catalog')}
    </div>`;
  }
  private bookmarks() {
    return html`<div class="internal-view">
      ${this.header('BOOKMARKS', '收藏', '保留精确地址，随时回到需要的内容。')}${this.search(
        '搜索收藏名称或 URL…',
      )}${bookmarkList(this.store, this.action, this.query)}${this.more('bookmarks')}
    </div>`;
  }
  private history() {
    const rows = this.store.history.filter(
      (h) =>
        `${titleOf(h.tab)} ${h.tab.url}`.toLowerCase().includes(this.query.toLowerCase()) &&
        (this.filter === 'all' || h.tab.pluginId === this.filter),
    );
    return html`<div class="internal-view">
      ${this.header(
        'RECENTLY CLOSED',
        '关闭历史',
        '统一记录已关闭的插件标签，恢复时保留原来的地址与状态。',
      )}
      <div class="view-toolbar">
        ${this.search('搜索已关闭的页面…')}<select
          aria-label="按插件筛选历史"
          @change=${(e: Event) => (this.filter = (e.target as HTMLSelectElement).value)}
        >
          <option value="all">所有插件</option>
          ${this.store.catalog.map((p) => html`<option value=${p.pluginId}>${p.title}</option>`)}
        </select>
      </div>
      <div class="record-list">
        ${rows.map(
          (h) =>
            html`<article class="record-card">
              ${icon('history')}<button
                class="record-main"
                @click=${() => this.action('restoreHistory', h)}
              >
                <strong>${titleOf(h.tab)}</strong><small class="mono">${h.tab.url}</small
                ><small
                  >${new Date(h.closedAt).toLocaleString()} ·
                  ${h.restoredAt ? '已恢复' : '可恢复'}</small
                ></button
              ><button class="btn secondary" @click=${() => this.action('restoreHistory', h)}>
                恢复</button
              >${iconButton('trash', '删除历史记录', () => this.action('deleteHistory', h))}
            </article>`,
        )}
      </div>
      ${!rows.length
        ? html`<div class="empty">
            ${icon('history')}
            <p>没有关闭记录</p>
            <span>浏览、刷新和休眠不会产生关闭历史。</span>
          </div>`
        : nothing}${this.more('history')}
    </div>`;
  }
  private more(key: 'catalog' | 'bookmarks' | 'history') {
    return this.store.cursors[key]
      ? html`<button
          class="btn secondary load-more"
          @click=${() => this.run(() => this.store.loadList(key, true))}
        >
          加载更多
        </button>`
      : nothing;
  }
  private setting(title: string, description: string, control: unknown) {
    if (this.query && !`${title} ${description}`.toLowerCase().includes(this.query.toLowerCase())) {
      return nothing;
    }
    return html`<div class="setting-row">
      <div>
        <strong>${title}</strong>
        <p>${description}</p>
      </div>
      <div class="setting-control">${control}</div>
    </div>`;
  }
  private settings() {
    const s = requireValue(this.store.workspace).snapshot,
      theme = this.store.preferences.values.theme ?? 'dark-2026',
      energy = this.store.preferences.values.energy ?? { enabled: false, idleMinutes: 10 };
    return html`<div class="internal-view settings-view">
      ${this.header(
        'PREFERENCES',
        '设置',
        '调整外观、布局与页面行为。更改会自动保存。',
      )}${this.search('搜索设置…')}
      <section>
        <h2>外观</h2>
        ${this.setting(
          '颜色主题',
          '统一应用于工作台、菜单、输出与终端。',
          html`<wb-menu-select
              label="颜色主题"
              .value=${theme}
              .options=${[
                { value: 'dark-2026', label: '2026 深色' },
                { value: 'light-2026', label: '2026 浅色' },
                { value: 'system', label: '跟随系统' },
              ]}
              @wb-menu-change=${(e: CustomEvent<{ value: string }>) =>
                this.run(() =>
                  this.store.setPreferences({
                    theme: e.detail.value as typeof theme,
                  }),
                )}
            ></wb-menu-select
            ><button
              class="text-button"
              @click=${() => this.run(() => this.store.setPreferences({}, ['theme']))}
            >
              重置
            </button>`,
        )}
      </section>
      <section>
        <h2>布局</h2>
        ${this.setting(
          '主侧栏位置',
          '活动栏跟随主侧栏，辅助侧栏位于对侧。',
          html`<wb-menu-select
            label="主侧栏位置"
            .value=${s.layout.mainSidebar.side}
            .options=${[
              { value: 'left', label: '左侧' },
              { value: 'right', label: '右侧' },
            ]}
            @wb-menu-change=${(e: CustomEvent<{ value: string }>) =>
              this.run(() =>
                this.store.update((s) => {
                  s.layout.mainSidebar.side = e.detail.value as 'left' | 'right';
                }),
              )}
          ></wb-menu-select>`,
        )}${this.setting(
          '标签栏位置',
          '应用到所有现有页面组。',
          html`<wb-menu-select
            label="标签栏位置"
            .value=${groups(s.layout.center)[0].tabBarPosition}
            .options=${[
              { value: 'top', label: '顶部' },
              { value: 'bottom', label: '底部' },
              { value: 'left', label: '左侧' },
              { value: 'right', label: '右侧' },
            ]}
            @wb-menu-change=${(e: CustomEvent<{ value: string }>) =>
              this.run(() =>
                this.store.update((s) => {
                  for (const g of groups(s.layout.center)) {
                    g.tabBarPosition = e.detail.value as 'top' | 'bottom' | 'left' | 'right';
                  }
                }),
              )}
          ></wb-menu-select>`,
        )}${this.setting(
          '面板停靠',
          '输出与终端支持底部、左侧、右侧停靠。',
          html`<wb-menu-select
            label="面板停靠"
            .value=${s.layout.panel.dock}
            .options=${[
              { value: 'bottom', label: '底部' },
              { value: 'left', label: '左侧' },
              { value: 'right', label: '右侧' },
            ]}
            @wb-menu-change=${(e: CustomEvent<{ value: string }>) =>
              this.run(() =>
                this.store.update((s) => {
                  s.layout.panel.dock = e.detail.value as 'bottom' | 'left' | 'right';
                }),
              )}
          ></wb-menu-select>`,
        )}${this.setting(
          '面板对齐',
          '面板占据中心区域或工作台全宽。',
          html`<wb-menu-select
            label="面板对齐"
            .value=${s.layout.panel.align}
            .options=${[
              { value: 'center', label: '对齐中心' },
              { value: 'full', label: '全宽' },
            ]}
            @wb-menu-change=${(e: CustomEvent<{ value: string }>) =>
              this.run(() =>
                this.store.update((s) => {
                  s.layout.panel.align = e.detail.value as 'center' | 'full';
                }),
              )}
          ></wb-menu-select>`,
        )}${this.setting(
          '恢复默认布局',
          '重置区域位置与尺寸，合并分组并保留所有标签。',
          html`<button class="btn secondary" @click=${() => this.action('resetLayout')}>
            恢复默认
          </button>`,
        )}
      </section>
      <section>
        <h2>页面与节能</h2>
        ${this.setting(
          '自动休眠',
          '仅休眠已提供序列化与恢复能力、无未保存编辑及保活活动的后台页面。',
          html`<label class="switch"
            ><input
              type="checkbox"
              aria-label="自动休眠"
              .checked=${energy.enabled}
              @change=${(e: Event) =>
                this.run(() =>
                  this.store.setPreferences({
                    energy: { ...energy, enabled: (e.target as HTMLInputElement).checked },
                  }),
                )} /><span></span
          ></label>`,
        )}${this.setting(
          '后台休眠延时',
          '后台页面 30 秒后协作暂停，达到设定分钟数后尝试保存状态并释放。',
          html`<input
              type="number"
              aria-label="后台休眠分钟数"
              min="1"
              max="1440"
              .value=${String(energy.idleMinutes)}
              @change=${(e: Event) =>
                this.run(() =>
                  this.store.setPreferences({
                    energy: {
                      ...energy,
                      idleMinutes: Number((e.target as HTMLInputElement).value),
                    },
                  }),
                )}
            /><span>分钟</span>`,
        )}
      </section>
      <section>
        <h2>快捷键</h2>
        ${this.setting(
          '快捷键设置',
          '搜索、修改、移除或重置全部工作台快捷键。',
          html`<button class="btn secondary" @click=${() => this.action('keybindings')}>
            ${icon('keyboard')}打开快捷键设置
          </button>`,
        )}
      </section>
      <section>
        <h2>数据与连接</h2>
        ${this.setting(
          '工作区草稿',
          '导出布局和逻辑标签，不包含主令牌、页面授权或命令输入回复。',
          html`<button class="btn secondary" @click=${() => this.action('export')}>
            ${icon('download')}导出
          </button>`,
        )}${this.setting(
          '服务地址',
          '管理 API 需要精确同源，请从核心 /web/ 地址打开工作台。',
          html`<code>${location.origin}</code>`,
        )}${this.setting(
          '连接令牌',
          '仅保存在当前来源的连接配置中。修改后重新连接。',
          html`<form
            @submit=${(e: SubmitEvent) => {
              e.preventDefault();
              const token = new FormData(e.currentTarget as HTMLFormElement).get('token');
              const config = {
                ...ConfigController.config,
                api: { ...ConfigController.config.api, token: String(token ?? '') },
              };
              ConfigController.config = config;
              localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
              location.reload();
            }}
          >
            <input
              name="token"
              type="password"
              aria-label="连接令牌"
              autocomplete="off"
              placeholder="输入当前服务令牌"
            /><button class="btn secondary" type="submit">重新连接</button>
          </form>`,
        )}
      </section>
    </div>`;
  }
  private async saveBinding(command: Command, keys: string[] | null) {
    const bindings = this.store.preferences.values.keybindings ?? [];
    const next = bindings.filter(
      (b) =>
        !(b.commandId === command.id && b.platform === platform() && b.context === command.context),
    );
    next.push({ commandId: command.id, platform: platform(), context: command.context, keys });
    await this.store.setPreferences({ keybindings: next });
    this.editing = null;
    this.bindingError = '';
  }
  private keybindings() {
    const overrides = this.store.preferences.values.keybindings ?? [];
    const rows = commands.filter((c) => {
      const keys = effectiveKeys(c, overrides);
      const modified = overrides.some(
        (b) => b.commandId === c.id && (b.platform === platform() || b.platform === 'all'),
      );
      return (
        `${c.label} ${c.description} ${c.id} ${c.context} ${keys.join(' ')}`
          .toLowerCase()
          .includes(this.query.toLowerCase()) &&
        (this.filter === 'all' ||
          (this.filter === 'modified' && modified) ||
          (this.filter === 'unbound' && !keys.length))
      );
    });
    const collision =
      this.editing && this.recorded ? conflicts(this.editing, [this.recorded], overrides) : [];
    return html`<div class="internal-view keybindings-view">
      ${this.header(
        'KEYBOARD SHORTCUTS',
        '快捷键设置',
        '所有菜单、命令面板和快捷键使用同一份命令清单。',
      )}
      <div class="view-toolbar">
        ${this.search('搜索名称、命令 ID、组合键或上下文…')}<select
          aria-label="快捷键筛选"
          .value=${this.filter}
          @change=${(e: Event) => (this.filter = (e.target as HTMLSelectElement).value)}
        >
          <option value="all">全部命令</option>
          <option value="modified">已修改</option>
          <option value="unbound">未绑定</option></select
        ><button
          class="btn secondary"
          @click=${async () =>
            (await this.store.confirm('恢复全部默认快捷键？')) &&
            this.run(() => this.store.setPreferences({}, ['keybindings']))}
        >
          全部重置
        </button>
      </div>
      <p class="notice">
        ${icon('info')}浏览器保留 Ctrl/Cmd+W、Ctrl+Tab 等按键。可使用 Alt+W、Alt+J/K 或界面按钮。
      </p>
      <div class="keybindings-table">
        <div class="keybinding-row table-head">
          <span>命令</span><span>快捷键</span><span>上下文 / 来源</span><span></span>
        </div>
        ${rows.map((c) => {
          const modified = overrides.some(
            (b) => b.commandId === c.id && (b.platform === platform() || b.platform === 'all'),
          );
          return html`<div class="keybinding-row">
            <div><strong>${c.label}</strong><small class="mono">${c.id}</small></div>
            <div>${effectiveKeys(c, overrides).map((key) => html`<kbd>${key}</kbd>`)}</div>
            <div>
              <small class="mono">${c.context}</small><small>${modified ? '已修改' : '默认'}</small>
            </div>
            <div class="row-actions">
              ${iconButton('edit', '修改快捷键', () => {
                this.editing = c;
                this.recorded = '';
                this.bindingError = '';
                queueMicrotask(() =>
                  this.renderRoot.querySelector<HTMLInputElement>('#record-key')?.focus(),
                );
              })}${iconButton('close', '移除绑定', () =>
                this.run(() => this.saveBinding(c, null)),
              )}${iconButton('refresh', '恢复默认绑定', () =>
                this.run(() =>
                  this.store.setPreferences({
                    keybindings: overrides.filter((b) => b.commandId !== c.id),
                  }),
                ),
              )}
            </div>
          </div>`;
        })}
      </div>
      ${this.editing
        ? html`<div
            class="inline-editor"
            role="dialog"
            aria-modal="true"
            aria-label="录入快捷键"
            @keydown=${(e: KeyboardEvent) => e.stopPropagation()}
          >
            <h2>${this.editing.label}</h2>
            <p>按下需要的组合键。Escape 取消。</p>
            <input
              id="record-key"
              aria-label="录入组合键"
              readonly
              .value=${this.recorded}
              placeholder="按下组合键…"
              @keydown=${(e: KeyboardEvent) => {
                e.preventDefault();
                if (e.isComposing) {
                  return;
                }
                if (e.key === 'Escape') {
                  this.editing = null;
                  return;
                }
                const key = eventKey(e);
                if (key) {
                  this.recorded = key;
                  this.bindingError =
                    (e.metaKey || e.ctrlKey) && ['W', 'T', 'L'].includes(e.key.toUpperCase())
                      ? '此组合键由浏览器保留，请使用其他组合键。'
                      : '';
                }
              }}
            />${collision.length
              ? html`<p class="warn">
                  与 ${collision.map((c) => c.label).join('、')} 冲突。保存将保留这些冲突绑定。
                </p>`
              : nothing}${this.bindingError
              ? html`<p class="error">${this.bindingError}</p>`
              : nothing}
            <div class="btn-group">
              <button
                class="btn primary"
                ?disabled=${!this.recorded || Boolean(this.bindingError)}
                @click=${() =>
                  this.editing &&
                  this.run(() => this.saveBinding(requireValue(this.editing), [this.recorded]))}
              >
                ${collision.length ? '仍然使用' : '保存绑定'}</button
              ><button class="btn secondary" @click=${() => (this.editing = null)}>取消</button>
            </div>
          </div>`
        : nothing}
    </div>`;
  }
}
