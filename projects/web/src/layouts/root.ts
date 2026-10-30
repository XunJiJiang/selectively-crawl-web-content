import type { DeclarativeView } from '../components/declarative-view.ts';
import type { UIContribution, ClientEffect } from '../../../shared/declarative-ui.ts';
import '../components/plugin-status.ts';
import {
  MIN_CENTER_WIDTH,
  MIN_CENTER_HEIGHT,
  MIN_GROUP_WIDTH,
  MIN_GROUP_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  MIN_PANEL_WIDTH,
  MIN_PANEL_HEIGHT,
  MIN_DOCKED_PANEL_WIDTH,
  fitWorkbench,
  applyHorizontalDrag,
  dragBottomPanel,
  minimumNode,
  splitExtent,
  activitySlots,
  type Sidebar,
  type HorizontalDrag,
  type SplitExtent,
  type WorkbenchMetrics,
} from '../workbench/layout-geometry.ts';
import type { WorkbenchScrollContainer } from '../components/scroll-container.ts';
import '../components/scroll-container.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { live } from 'lit/directives/live.js';
import '../components/icon.ts';
import '../components/internal-page.ts';
import '../components/page-inspector.ts';
import '../components/context-menu/wb-context-menu.ts';
import style from '../workbench/workbench.css?raw';
import { WorkbenchStore } from '../workbench/store.ts';
import { FocusHistory, type FocusLocation } from '../workbench/focus-history.ts';
import { pruneEmptyGroups } from '../../../shared/workbench-layout.ts';
import { terminalRows } from '../workbench/terminal-output.ts';
import { FramePool } from '../workbench/frames.ts';
import { SearchCoordinator } from '../workbench/search.ts';
import {
  activeTab,
  addTab,
  clone,
  defaultLayout,
  findGroup,
  focusTab,
  groups,
  internalTab,
  mergeGroups,
  moveTab,
  navigateTab,
  newPluginTab,
  relocatedUrl,
  splitGroup,
  titleOf,
  visit,
} from '../workbench/model.ts';
import {
  commands,
  effectiveKeys,
  editableTarget,
  matchesKey,
  shortcut,
} from '../workbench/commands.ts';
import { runtimeNames, pageStateNames } from '../workbench/types.ts';
import type {
  Bookmark,
  CatalogItem,
  ClosedTab,
  Group,
  InternalPage,
  LayoutNode,
  PluginTab,
  Tab,
  WorkspaceSnapshot,
} from '../workbench/types.ts';
import type { ContextMenuItem } from '../components/context-menu/menu-types.ts';
import type { FeedbackProgress, NotificationState } from '../../../shared/workbench-feedback.ts';
import {
  icon,
  iconButton,
  pluginCard,
  runtimeClass,
  tabNavigation,
  deepActiveElement,
  bookmarkList,
  bookmarkFolderButton,
  pluginOpenButtons,
} from '../workbench/ui.ts';
interface QuickResult {
  id: string;
  title: string;
  detail: string;
  icon: string;
  run: () => Promise<unknown>;
  openNew?: (groupId?: string) => Promise<unknown>;
  keepOpen?: boolean;
}
type Menu = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  trigger?: HTMLElement;
  topbarIndex?: number;
};
const viewNames = {
  search: '搜索',
  pages: '页面',
  bookmarks: '收藏',
  history: '关闭历史',
  plugins: '插件管理',
};
const menus = ['页面', '视图', '布局', '插件', '工具', '帮助'];
@customElement('app-root')
export class AppRoot extends LitElement {
  static styles = css`
    ${unsafeCSS(style)}
  `;
  readonly store = new WorkbenchStore();
  private pool?: FramePool;
  @state() private accessor uiContributions: UIContribution[] = [];
  private uiRegistryLoading = false;
  private uiRegistryLoaded = false;
  private uiCenterTab = '';
  private uiExplicitExpired = false;
  private uiWorkspace = '';
  private searcher?: SearchCoordinator;
  private observer?: ResizeObserver;
  private themeMedia = matchMedia('(prefers-color-scheme: dark)');
  @state() private accessor menu: Menu | null = null;
  @state() private accessor menuCount = 6;
  @state() private accessor quickQuery = '';
  @state() private accessor quickOpen = false;
  @state() private accessor quickIndex = 0;
  @state() private accessor sidebarQuery = '';
  @state() private accessor notificationOpen = false;
  @state() private accessor notificationFilter = 'all';
  @state() private accessor focusedOnly = false;
  @state() private accessor panelMaximized = false;
  @state() private accessor dragging = false;
  @state() private accessor showJobs = false;
  @state() private accessor outputFilter = 'all';
  @state() private accessor outputQuery = '';
  @state() private accessor outputPaused = false;
  @state() private accessor searchQuery = '';
  @state() private accessor searchCurrent = false;
  private terminalModule: Promise<unknown> | undefined;
  private ensureTerminal() {
    return (this.terminalModule ??= import('../components/terminal.ts'));
  }
  private metadataGeneration = 0;
  private metadataQuery = '';
  @state() private accessor remoteMetadata: {
    catalog: CatalogItem[];
    bookmarks: Bookmark[];
    history: ClosedTab[];
    cursors: Record<string, string | null>;
  } = { catalog: [], bookmarks: [], history: [], cursors: {} };
  private pausedRecords: import('../workbench/types.ts').OutputRecord[] = [];
  @state() private accessor inspectedTab: PluginTab | undefined = undefined;
  private queryTimer?: ReturnType<typeof setTimeout>;
  private dragTab = '';
  @state() private accessor openPagesCollapsed = false;
  @state() private accessor pluginPagesCollapsed = false;
  private sidebarDrop?: HTMLElement;
  private centerDrop?: { element: HTMLElement; groupId: string; index: number };
  private previousTheme = '';
  private resizeSnapshot?: WorkspaceSnapshot;
  private splitExtents = new Map<string, SplitExtent>();
  private centerCanvasHeight = MIN_CENTER_HEIGHT;
  private layoutMetrics(): WorkbenchMetrics {
    const hostStyle = getComputedStyle(this);
    const number = (value: string) => Number.parseFloat(value) || 0;
    const token = (name: string) => number(hostStyle.getPropertyValue(name));
    const activity = this.renderRoot.querySelector<HTMLElement>('.activity-bar');
    const activityStyle = activity && getComputedStyle(activity);
    const extent = (selector: string, axis: 'width' | 'height', fallback: string) =>
      this.renderRoot.querySelector(selector)?.getBoundingClientRect()[axis] || token(fallback);
    return {
      activityWidth: extent('.activity-bar', 'width', '--activity-width'),
      topbarHeight: extent('.topbar', 'height', '--topbar-height'),
      statusbarHeight: extent('.status-bar', 'height', '--statusbar-height'),
      splitterSize: extent('.center-splitter.horizontal', 'width', '--resize-handle-size'),
      activityItemHeight: extent('.activity-bar-item', 'height', '--activity-item-size'),
      activityGap: activityStyle
        ? number(activityStyle.rowGap) || token('--activity-gap')
        : token('--activity-gap'),
      activityPadding: activityStyle
        ? number(activityStyle.paddingTop) + number(activityStyle.paddingBottom) ||
          token('--activity-padding') * 2
        : token('--activity-padding') * 2,
    };
  }
  private geometry() {
    return fitWorkbench(
      (this.resizeSnapshot ?? this.store.workspace?.snapshot)?.layout,
      this.clientWidth || innerWidth,
      this.clientHeight || innerHeight,
      this.layoutMetrics(),
      this.focusedOnly,
      this.panelMaximized,
    );
  }
  private horizontalStart(snapshot = this.snapshot): HorizontalDrag {
    const metrics = this.layoutMetrics();
    const g = fitWorkbench(
      snapshot.layout,
      this.clientWidth || innerWidth,
      this.clientHeight || innerHeight,
      metrics,
    );
    return {
      availableWidth: g.shellWidth - metrics.activityWidth,
      mainSide: snapshot.layout.mainSidebar.side,
      panelDock: snapshot.layout.panel.dock,
      mainSidebar: { visible: snapshot.layout.mainSidebar.visible, size: g.mainWidth },
      auxiliarySidebar: { visible: snapshot.layout.auxiliarySidebar.visible, size: g.auxWidth },
      panel: { visible: snapshot.layout.panel.visible, size: g.panelWidth },
    };
  }
  private revealSidebar(snapshot: WorkspaceSnapshot, part: Sidebar) {
    const start = this.horizontalStart(snapshot);
    start[part].visible = false;
    applyHorizontalDrag(
      snapshot.layout,
      part,
      start,
      Math.max(MIN_SIDEBAR_WIDTH, snapshot.layout[part].size),
    );
  }
  private cancelResize?: () => void;
  private resizeHoverTimer?: ReturnType<typeof setTimeout>;
  private hoveredResizers: { key: string; nodeId?: string }[] = [];
  @state() private accessor highlightedResizers: ReadonlySet<string> = new Set();
  private focusHistory = new FocusHistory();
  private focusInitialized = false;
  private traversingFocus = false;
  private unreadSnapshot = new Set<string>();
  private notificationObserver?: IntersectionObserver;
  private notificationObserved = new WeakSet<Element>();
  private notificationVisible = new Set<string>();
  private dialogFocus?: HTMLElement;
  private dialogActive = false;
  @state() private accessor resizeCursor = 'col-resize';
  private visible(part: 'main' | 'aux' | 'panel') {
    const layout = (this.resizeSnapshot ?? this.snapshot).layout;
    return (
      !this.focusedOnly &&
      (part === 'main'
        ? layout.mainSidebar.visible
        : part === 'aux'
          ? layout.auxiliarySidebar.visible
          : layout.panel.visible)
    );
  }
  private recordFocus(location: FocusLocation) {
    this.store.focusedLocation = location;
    if (!this.traversingFocus) {
      this.focusHistory.record(location);
    }
    this.requestUpdate();
  }
  private focusExists = (target: FocusLocation) =>
    target.kind === 'sidebar' || target.kind === 'auxiliary' ||
    (target.kind === 'tab'
      ? this.snapshot.tabs.some((t) => t.id === target.id)
      : target.view === 'output' ||
        this.store.terminals.some((t) => t.id === target.terminalId && !t.archivedAt));
  private async traverseFocus(direction: number) {
    const target = this.focusHistory.go(direction, this.focusExists);
    if (!target) {
      return;
    }
    this.traversingFocus = true;
    this.focusedOnly = false;
    try {
      if (target.kind === 'tab') {
        await this.command('focusTab', target.id);
      } else if (target.kind === 'sidebar') {
        await this.setView(target.view);
      } else if (target.kind === 'auxiliary') {
        await this.store.update((s) => this.revealSidebar(s, 'auxiliarySidebar'));
        this.recordFocus(target);
        await this.updateComplete;
        this.renderRoot.querySelector<HTMLElement>('.auxiliary-sidebar')?.focus();
      } else {
        await this.selectPanel(target.view, target.terminalId);
      }
    } finally {
      this.traversingFocus = false;
      this.requestUpdate();
    }
  }
  private async selectPanel(view: 'output' | 'terminal', terminalId?: string) {
    if (view === 'terminal') {
      await this.ensureTerminal();
    }
    await this.store.update((s) => {
      s.layout.panel.activeView = view;
      s.layout.panel.visible = true;
    });
    await this.updateComplete;
    if (view === 'terminal') {
      await this.renderRoot
        .querySelector<import('../components/terminal.ts').WorkbenchTerminal>('wb-terminal')
        ?.activate(terminalId);
    } else {
      this.recordFocus({ kind: 'panel', view });
      this.renderRoot.querySelector<HTMLElement>('.output-content')?.focus();
    }
  }
  private decodedUrl(value: string) {
    try {
      return decodeURI(value).replace(/%([0-9a-f]{2})/gi, (part) => decodeURIComponent(part));
    } catch {
      return value;
    }
  }
  private urlDraft?: { tabId: string; display: string; encoded: string };
  private quickTrigger?: HTMLElement;
  connectedCallback() {
    super.connectedCallback();
    this.store.addEventListener('change', this.changed);
    this.store.addEventListener('server-event', this.uiRegistryEvent);
    this.store.addEventListener('core-restarted',this.uiRegistryEvent);
    this.addEventListener('ui-effect', this.uiEffect);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('pointerdown', this.dismissTopbarMenu, true);
    window.addEventListener('blur', this.dismissTopbarMenu);
    this.themeMedia.addEventListener('change', this.themeChanged);
    this.addEventListener('workbench-command', this.commandEvent as EventListener);
    this.addEventListener('terminal-focus', ((event: CustomEvent<string>) =>
      this.recordFocus({
        kind: 'panel',
        view: 'terminal',
        terminalId: event.detail,
      })) as EventListener);
    void this.store.start();
  }
  disconnectedCallback() {
    this.endTabDrag();
    this.cancelResize?.();
    this.leaveResize();
    this.store.removeEventListener('change', this.changed);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('pointerdown', this.dismissTopbarMenu, true);
    window.removeEventListener('blur', this.dismissTopbarMenu);
    this.themeMedia.removeEventListener('change', this.themeChanged);
    this.observer?.disconnect();
    this.notificationObserver?.disconnect();
    clearTimeout(this.queryTimer);
    this.searcher?.dispose();
    this.pool?.dispose();
    this.store.dispose();
    this.store.removeEventListener('server-event', this.uiRegistryEvent);
    this.store.removeEventListener('core-restarted',this.uiRegistryEvent);
    this.removeEventListener('ui-effect', this.uiEffect);
    super.disconnectedCallback();
  }
  private changed = () => {
    if (this.store.workspace && !this.uiRegistryLoaded) {
      void this.loadUIRegistry();
    }
    if (this.uiWorkspace !== this.store.workspace?.workspaceId) {
      this.uiWorkspace = this.store.workspace?.workspaceId ?? '';
      this.uiCenterTab = '';
      this.uiExplicitExpired = false;
    }
    const center = this.current?.id ?? '';
    if (this.uiCenterTab && this.uiCenterTab !== center) {
      this.inspectedTab = undefined;
      this.uiExplicitExpired = true;
      if (this.store.workspace?.snapshot.layout.auxiliarySidebar.context?.mode === 'explicit') {
        queueMicrotask(() =>
          this.act(() =>
            this.store.update((s) => {
              s.layout.auxiliarySidebar.context = { mode: 'follow' };
            }),
          ),
        );
      }
    }
    this.uiCenterTab = center;
    this.applyTheme();
    this.requestUpdate();
  };
  private themeChanged = () => this.applyTheme();
  private applyTheme() {
    const preference = this.store.preferences.values.theme ?? 'dark-2026';
    const theme =
      preference === 'system' ? (this.themeMedia.matches ? 'dark-2026' : 'light-2026') : preference;
    document.documentElement.dataset.theme = theme;
    if (theme !== this.previousTheme) {
      this.previousTheme = theme;
      this.pool?.theme();
    }
  }
  private commandEvent = (event: CustomEvent<{ id: string; args?: unknown }>) => {
    event.stopPropagation();
    this.act(() => this.command(event.detail.id, event.detail.args));
  };
  private act(work: () => Promise<unknown>) {
    void work().catch((e) => this.store.toast(this.store.message(e), 'error'));
  }
  protected updated(_changed: PropertyValues) {
    const output = this.renderRoot.querySelector<WorkbenchScrollContainer>('.output-content');
    if (output && this.followOutput) {
      void output.updateComplete.then(() => {
        const viewport = output.scrollElement;
        if (viewport && this.followOutput) {
          viewport.scrollTop = viewport.scrollHeight;
          output.refresh();
        }
      });
    }
    if (!this.focusInitialized && this.store.workspace && !this.store.loading) {
      this.focusInitialized = true;
      if (this.current) {
        this.recordFocus({ kind: 'tab', id: this.current.id });
      }
      if (this.visible('panel') && this.snapshot.layout.panel.activeView === 'terminal') {
        this.act(() => this.selectPanel('terminal'));
      }
    }
    if (this.store.workspace && !this.dialogActive && this.store.dialogState) {
      this.dialogActive = true;
      this.dialogFocus = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined;
      const field = this.renderRoot.querySelector<HTMLElement>(
        '.workbench-dialog input, .workbench-dialog select, .workbench-dialog button',
      );
      field?.focus();
      if (field instanceof HTMLInputElement) {
        field.select();
      }
    } else if (this.dialogActive && !this.store.dialogState) {
      this.dialogActive = false;
      this.dialogFocus?.focus();
    }
    this.observeNotifications();
    if (this.showJobs && this.store.unreadJobs.length) {
      this.act(() => this.store.ackJobs(this.store.unreadJobs.map((job) => job.id)));
    }
    if (this.store.workspace && !this.pool) {
      const container = this.renderRoot.querySelector<HTMLElement>('.frame-pool');
      if (container) {
        this.pool = new FramePool(
          container,
          this.store,
          requireValue(this.shadowRoot),
          this.command.bind(this),
        );
        this.pool.addEventListener('change', () => this.requestUpdate());
        this.searcher = new SearchCoordinator(this.pool);
        this.searcher.addEventListener('change', () => this.requestUpdate());
        this.observer = new ResizeObserver(() => {
          this.measureMenus();
          this.pool?.position();
          this.requestUpdate();
        });
        const bar = this.renderRoot.querySelector('.topbar');
        if (bar) {
          this.observer.observe(bar);
        }
        const status = this.renderRoot.querySelector('.status-bar');
        if (status) {
          this.observer.observe(status);
        }
        this.observer.observe(this);
        queueMicrotask(() => this.act(() => this.store.loadOutput('public')));
      }
    }
    if (this.store.workspace?.snapshot.layout.panel.activeView === 'terminal') {
      void this.ensureTerminal();
    }
    this.pool?.sync();
    this.measureMenus();
  }
  private measureMenus() {
    const topbar = this.renderRoot.querySelector('.topbar'),
      controls = this.renderRoot.querySelector('.topbar-controls'),
      measure = this.renderRoot.querySelector('.menu-measure');
    if (!topbar || !controls || !measure) {
      return;
    }
    const widths = [...measure.children].map((el) => el.getBoundingClientRect().width + 4);
    let available =
        topbar.clientWidth -
        controls.clientWidth -
        (this.renderRoot.querySelector('.focus-navigation')?.clientWidth ?? 0) -
        Math.min(400, Math.max(160, topbar.clientWidth * 0.3)) -
        36,
      count = 6;
    if (topbar.clientWidth < 768) {
      count = 0;
    } else if (widths.reduce((a, b) => a + b, 0) > available) {
      count = 0;
      available -= 32;
      for (const width of widths) {
        if (available < width) {
          break;
        }
        available -= width;
        count++;
      }
      if (count < 2) {
        count = 0;
      }
    }
    if (count !== this.menuCount) {
      this.menuCount = count;
      if (this.menu) {
        this.closeMenu();
      }
    }
  }
  private keydown = (event: KeyboardEvent) => {
    if (this.store.dialogState) {
      return;
    }
    if (event.isComposing || event.defaultPrevented) {
      return;
    }
    if (event.key === 'Escape') {
      if (this.quickOpen) {
        this.closeQuick();
        this.quickTrigger?.focus();
        return;
      }
      if (this.notificationOpen) {
        this.notificationOpen = false;
        return;
      }
      if (this.showJobs) {
        this.showJobs = false;
        return;
      }
      if (this.menu) {
        this.closeMenu();
        return;
      }
    }
    if (
      this.menu ||
      this.quickOpen ||
      this.renderRoot.querySelector('wb-internal-page')?.shadowRoot?.querySelector('[role=dialog]')
    ) {
      return;
    }
    if (editableTarget(event)) {
      return;
    }
    const command = commands.find(
      (c) =>
        !c.id.startsWith('terminal.') &&
        effectiveKeys(c, this.store.preferences.values.keybindings).some((k) =>
          matchesKey(k, event),
        ),
    );
    if (command) {
      event.preventDefault();
      this.act(() => this.command(command.id));
    }
  };
  private get snapshot() {
    return requireValue(this.store.workspace).snapshot;
  }
  private get current() {
    return this.store.workspace ? activeTab(this.snapshot) : undefined;
  }
  private async openInternal(page: InternalPage) {
    this.inspectedTab = undefined;
    await this.store.update((s) => {
      const existing = s.tabs.find((t) => t.kind === 'internal' && t.page === page);
      if (existing) {
        focusTab(s, existing.id);
      } else {
        addTab(s, internalTab(page));
      }
    });
    if (this.current) {
      this.recordFocus({ kind: 'tab', id: this.current.id });
    }
  }
  private async openPlugin(
    plugin: CatalogItem,
    url?: string,
    forceGroup?: string,
    forceNew = false,
  ) {
    const target =
      url ?? plugin.ui.entryUrl ?? `/web/page/plugin/${encodeURIComponent(plugin.pluginId)}/`;
    const resolved = await this.store.api.request<{
      url: string;
      pluginId: string;
      locator: PluginTab['locator'];
    }>('/url/resolve', { url: target, pluginId: plugin.pluginId });
    await this.store.update((s) => {
      const existing =
        !forceNew && s.tabs.find((t) => t.kind === 'plugin' && t.url === resolved.url);
      if (existing) {
        focusTab(s, existing.id);
        this.pool?.wake(existing.id);
      } else {
        addTab(
          s,
          newPluginTab(plugin.pluginId, plugin.title, resolved.url, resolved.locator),
          forceGroup,
        );
      }
    });
    if (this.current) {
      this.recordFocus({ kind: 'tab', id: this.current.id });
    }
  }
  private async navigate(
    id: string,
    url: string,
    mode: 'push' | 'replace' | 'traverse' = 'push',
    index?: number,
    report = false,
  ) {
    const tab = this.snapshot.tabs.find((t) => t.id === id);
    if (tab?.kind !== 'plugin') {
      return;
    }
    if (!report && !(await this.pool?.canLeave(id, 'navigate'))) {
      return;
    }
    const resolved = await this.store.api.request<{ url: string; locator: PluginTab['locator'] }>(
      '/url/resolve',
      { url, pluginId: tab.pluginId },
    );
    await this.store.update((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (target?.kind === 'plugin') {
        navigateTab(target, resolved.url, resolved.locator, mode, index);
      }
    });
    if (this.urlDraft?.tabId === id) {
      this.urlDraft = undefined;
    }
  }
  private async close(ids: string[], explicit = false) {
    const eligible = this.snapshot.tabs.filter(
      (t) => ids.includes(t.id) && (!t.pinned || explicit),
    );
    if (
      explicit &&
      eligible.some((t) => t.pinned) &&
      !(await this.store.confirm('关闭固定标签？'))
    ) {
      return;
    }
    const actual: string[] = [];
    for (const tab of eligible) {
      if (!(await this.pool?.canLeave(tab.id, 'close'))) {
        continue;
      }
      try {
        await this.pool?.checkpoint(tab.id);
      } catch (e) {
        if (
          !(await this.store.confirm(`状态保存失败：${this.store.message(e)}。仍要关闭此页面？`))
        ) {
          continue;
        }
      }
      actual.push(tab.id);
    }
    if (actual.length) {
      await this.store.closeTabs(actual);
    }
  }
  private async setView(view: keyof typeof viewNames) {
    this.recordFocus({ kind: 'sidebar', view });
    await this.store.update((s) => {
      s.layout.mainSidebar.view = view;
      s.layout.mainSidebar.selectedView = { kind: 'core', viewId: view };
      this.revealSidebar(s, 'mainSidebar');
    });
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('.sidebar-content')?.focus();
  }
  async command(id: string, args?: unknown): Promise<unknown> {
    if (id === 'focusBack' || id === 'focusForward') {
      return this.traverseFocus(id === 'focusBack' ? -1 : 1);
    }
    if (id === 'lastTerminalClosed') {
      await this.selectPanel('output');
      return this.store.update((s) => {
        s.layout.panel.visible = false;
      });
    }
    if (id === 'focusPage') {
      this.inspectedTab = undefined;
      const target = String(args);
      this.recordFocus({ kind: 'tab', id: target });
      return this.store.update((s) => focusTab(s, target));
    }
    const tab =
      typeof args === 'object' && args && 'tabId' in args
        ? this.snapshot.tabs.find((t) => t.id === (args as { tabId: string }).tabId)
        : this.current;
    if (id === 'quickOpen') {
      this.quickTrigger = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined;
      this.quickOpen = true;
      this.quickQuery = '';
      this.quickIndex = 0;
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLInputElement>('#quick-input')?.focus();
      return;
    }
    if (id === 'openUrl') {
      const value =
        typeof args === 'string'
          ? args
          : await this.store.prompt(
              '输入当前核心的插件 URL 或路径',
              tab?.kind === 'plugin' ? tab.url : '/web/page/plugin/',
            );
      if (!value) {
        return;
      }
      const result = await this.store.api.request<{ pluginId: string; url: string }>(
        '/url/resolve',
        { url: value },
      );
      const plugin = await this.store.getPlugin(result.pluginId);
      if (!plugin) {
        throw new Error('目标插件不在当前目录列表中');
      }
      return this.openPlugin(plugin, result.url);
    }
    if (id === 'openPluginExternal') {
      const plugin = args as CatalogItem;
      window.open(
        plugin.ui.entryUrl ?? `/web/page/plugin/${encodeURIComponent(plugin.pluginId)}/`,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    if (id === 'pluginOpenMenu') {
      const trigger = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined;
      const rect = (trigger ?? this).getBoundingClientRect();
      this.menu = {
        x: rect.left,
        y: rect.bottom,
        trigger,
        items: [
          this.menuAction('openPluginNew', '在新的标签页中打开', args),
          this.menuAction('openPluginExternal', '在新浏览器标签页中打开', args),
        ],
      };
      return;
    }
    if (id === 'openPluginNew') {
      return this.openPlugin(args as CatalogItem, undefined, undefined, true);
    }
    if (id === 'openPlugin') {
      return this.openPlugin(args as CatalogItem);
    }
    if (id === 'focusTab') {
      this.inspectedTab = undefined;
      const target = String(args);
      this.pool?.wake(target);
      await this.store.update((s) => focusTab(s, target));
      if (this.snapshot.tabs.some((t) => t.id === target)) {
        this.recordFocus({ kind: 'tab', id: target });
      }
      await this.updateComplete;
      [...this.renderRoot.querySelectorAll<HTMLElement>('[data-tab-id]')]
        .find((el) => el.dataset.tabId === target)
        ?.focus();
      return;
    }
    if (id === 'navigateTab' || id === 'reportNavigation') {
      const data = args as { tabId: string; url: string; replace?: boolean; index?: number };
      return this.navigate(
        data.tabId,
        data.url,
        data.index !== undefined ? 'traverse' : data.replace ? 'replace' : 'push',
        data.index,
        id === 'reportNavigation',
      );
    }
    if (id === 'closeTab' && tab) {
      return this.close([tab.id], true);
    }
    if (id === 'closeOthers' && tab) {
      return this.close(this.snapshot.tabs.filter((t) => t.id !== tab.id).map((t) => t.id));
    }
    if (id === 'closeAll') {
      return this.close(this.snapshot.tabs.map((t) => t.id));
    }
    if (id === 'nextTab' || id === 'previousTab') {
      const gs = findGroup(this.snapshot);
      const index = gs.tabIds.indexOf(gs.activeTabId ?? '');
      const next =
        gs.tabIds[(index + (id === 'nextTab' ? 1 : -1) + gs.tabIds.length) % gs.tabIds.length];
      if (next) {
        return this.command('focusTab', next);
      }
      return;
    }
    if (id === 'restoreClosed') {
      if (!this.store.history.some((h) => !h.restoredAt) && this.store.cursors.history) {
        await this.store.loadList('history', true);
      }
      const h = this.store.history.find((h) => !h.restoredAt);
      if (h) {
        return this.store.restore(
          this.store.history
            .filter((i) => i.batchId === h.batchId && !i.restoredAt)
            .map((i) => i.closeId),
          this.snapshot.layout.focusedGroupId,
        );
      }
      return this.store.toast('没有可恢复的关闭标签。');
    }
    if (id === 'restoreHistory') {
      await this.store.getPlugin((args as ClosedTab).tab.pluginId);
      return this.store.restore([(args as ClosedTab).closeId], this.snapshot.layout.focusedGroupId);
    }
    if (id === 'deleteHistory') {
      await this.store.api.request('/history/delete', { closeIds: [(args as ClosedTab).closeId] });
      return this.store.loadList('history');
    }
    if (id === 'refresh' && tab?.kind === 'plugin') {
      if (await this.pool?.canLeave(tab.id, 'refresh')) {
        this.pool?.refresh(tab.id);
      }
      return;
    }
    if (id === 'stopLoading' && tab?.kind === 'plugin') {
      this.pool?.stop(tab.id);
      return;
    }
    if ((id === 'back' || id === 'forward') && tab?.kind === 'plugin') {
      const index = tab.navigation.index + (id === 'back' ? -1 : 1),
        entry = tab.navigation.entries[index] as { url?: string } | undefined;
      if (entry?.url) {
        if (!(await this.pool?.canLeave(tab.id, 'navigate'))) {
          return;
        }
        if (await this.pool?.traverse(tab.id, id === 'back' ? -1 : 1)) {
          return;
        }
        return this.navigate(tab.id, entry.url, 'traverse', index);
      }
      return;
    }
    if (id === 'copyUrl' && tab?.kind === 'plugin') {
      await navigator.clipboard.writeText(tab.url);
      return this.store.toast('已复制页面 URL。', 'success');
    }
    if (id === 'openExternal' && tab?.kind === 'plugin') {
      window.open(tab.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (id === 'pin' && tab) {
      return this.store.update((s) => {
        const t = s.tabs.find((t) => t.id === tab.id);
        if (t) {
          t.pinned = !t.pinned;
        }
      });
    }
    if (id === 'rename' && tab) {
      const title = await this.store.prompt('标签名称，留空恢复页面标题', titleOf(tab));
      if (title !== null) {
        return this.store.update((s) => {
          const t = s.tabs.find((t) => t.id === tab.id);
          if (t) {
            t.customTitle = title.trim() || null;
          }
        });
      }
      return;
    }
    if (id === 'keepAlive' && tab?.kind === 'plugin') {
      return this.store.update((s) => {
        const t = s.tabs.find((t) => t.id === tab.id);
        if (t?.kind === 'plugin') {
          t.keepAlive = !t.keepAlive;
        }
      });
    }
    if (id === 'hibernate' && tab?.kind === 'plugin') {
      return this.pool?.hibernate(tab.id);
    }
    if (id === 'bookmark' && tab?.kind === 'plugin') {
      return this.bookmark(tab);
    }
    if (id === 'openBookmark') {
      const b = args as Bookmark;
      const plugin = await this.store.getPlugin(b.pluginId);
      if (!plugin) {
        throw new Error('收藏所属插件已不在目录中，请重新绑定。');
      }
      return this.openPlugin(
        plugin,
        relocatedUrl(b.locator, requireValue(this.store.bootstrap).installationId, b.url),
      );
    }
    if (id === 'moveBookmark') {
      const result = await this.store.api.request<{
        preferences: import('../workbench/types.ts').Preferences;
        bookmarks: Bookmark[];
      }>('/bookmarks/move', { ...(args as object), baseRevision: this.store.preferences.revision });
      this.store.preferences = result.preferences;
      this.store.bookmarks = result.bookmarks;
      this.store.changed();
      return;
    }
    if (id === 'bookmarkMenu') {
      const data = args as {
        x: number;
        y: number;
        folder?: { id: string; name: string };
        bookmark?: Bookmark;
      };
      const item = (
        id: string,
        label: string,
        command: string,
        value: unknown,
      ): ContextMenuItem => ({
        kind: 'action',
        id,
        label,
        action: async () => {
          await this.command(command, value);
        },
      });
      const items = [
        item(
          'edit',
          '编辑',
          data.folder ? 'renameBookmarkFolder' : 'editBookmark',
          data.folder ?? data.bookmark,
        ),
        item(
          'delete',
          '删除',
          data.folder ? 'deleteBookmarkFolder' : 'deleteBookmark',
          data.folder ?? data.bookmark,
        ),
      ];
      if (data.folder) {
        items.push(
          item('folder', '新建文件夹', 'newBookmarkFolder', { parentId: data.folder.id }),
          item('bookmark', '新建收藏项', 'newBookmark', { folderId: data.folder.id }),
        );
      }
      this.menu = { x: data.x, y: data.y, items };
      return;
    }
    if (id === 'newBookmark') {
      const values = await this.store.dialog('新建收藏项', [
        { name: 'title', label: '名称', value: '' },
        { name: 'url', label: 'URL', value: '' },
      ]);
      if (!values) {
        return;
      }
      const resolved = await this.store.api.request<{
        url: string;
        pluginId: string;
        locator: PluginTab['locator'];
      }>('/url/resolve', { url: values.url });
      await this.store.api.request('/bookmarks', {
        value: {
          ...resolved,
          originalTitle: values.title || resolved.url,
          folderId: (args as { folderId: string }).folderId,
          previewId: null,
        },
      });
      return this.store.loadList('bookmarks');
    }
    if (id === 'newBookmarkFolder') {
      const parentId =
        (args as { parentId?: string | null } | undefined)?.parentId ??
        this.store.focusedBookmarkFolder ??
        null;
      const name = await this.store.prompt('新建收藏文件夹');
      if (name?.trim()) {
        return this.store.setPreferences({
          bookmarkFolders: [
            ...(this.store.preferences.values.bookmarkFolders ?? []),
            { id: crypto.randomUUID(), name: name.trim(), parentId },
          ],
        });
      }
      return;
    }
    if (id === 'renameBookmarkFolder') {
      const folder = args as { id: string; name: string };
      const name = await this.store.prompt('文件夹名称', folder.name);
      if (name?.trim()) {
        return this.store.setPreferences({
          bookmarkFolders: (this.store.preferences.values.bookmarkFolders ?? []).map((f) =>
            f.id === folder.id ? { ...f, name: name.trim() } : f,
          ),
        });
      }
      return;
    }
    if (id === 'deleteBookmarkFolder') {
      const folder = args as { id: string; name: string };
      return this.store.setPreferences({
        bookmarkFolders: (this.store.preferences.values.bookmarkFolders ?? [])
          .filter((f) => f.id !== folder.id)
          .map((f) => (f.parentId === folder.id ? { ...f, parentId: null } : f)),
      });
    }
    if (id === 'deleteBookmark') {
      const b = args as Bookmark;
      await this.store.api.request(`/bookmarks/${b.id}/delete`, { baseRevision: b.revision });
      return this.store.loadList('bookmarks');
    }
    if (id === 'editBookmark') {
      const b = args as Bookmark;
      const values = await this.store.dialog('编辑收藏', [
        { name: 'title', label: '名称', value: b.customTitle ?? b.originalTitle },
        { name: 'url', label: 'URL', value: b.url },
        {
          name: 'folderId',
          label: '文件夹',
          value: b.folderId ?? '',
          options: [
            { value: '', label: '未分类' },
            ...(this.store.preferences.values.bookmarkFolders ?? []).map((f) => ({
              value: f.id,
              label: f.name,
            })),
          ],
        },
      ]);
      if (!values) {
        return;
      }
      const { title, url, folderId } = values;
      const result = await this.store.api.request<{ url: string; locator: PluginTab['locator'] }>(
        '/url/resolve',
        { url, pluginId: b.pluginId },
      );
      await this.store.api.request(`/bookmarks/${b.id}/update`, {
        value: {
          pluginId: b.pluginId,
          url: result.url,
          locator: result.locator,
          originalTitle: b.originalTitle,
          customTitle: title || null,
          folderId: folderId || null,
          previewId: url === b.url ? b.previewId : null,
        },
        baseRevision: b.revision,
      });
      return this.store.loadList('bookmarks');
    }
    if (['sidebar', 'auxiliary', 'panel'].includes(id)) {
      const part =
        id === 'sidebar' ? 'mainSidebar' : id === 'auxiliary' ? 'auxiliarySidebar' : 'panel';
      this.focusedOnly = false;
      const wasVisible = this.snapshot.layout[part].visible;
      await this.store.update((s) => {
        if (!wasVisible && part !== 'panel' && args !== 'topbar') {
          this.revealSidebar(s, part);
        } else {
          s.layout[part].visible = !wasVisible;
        }
      });
      if (id === 'panel' && !wasVisible) {
        await this.selectPanel(this.snapshot.layout.panel.activeView);
      }
      return;
    }
    if (id === 'focusGroup') {
      this.focusedOnly = !this.focusedOnly;
      this.pool?.position();
      return;
    }
    if (id === 'fullscreen') {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await this.requestFullscreen();
      }
      return;
    }
    if (['pages', 'search', 'bookmarks', 'history'].includes(id)) {
      if (id === 'search') {
        await this.setView('search');
        await this.openInternal('search');
        return;
      }
      return this.selectUIActivity(id);
    }
    if (['welcome', 'settings', 'keybindings', 'plugins'].includes(id)) {
      return this.openInternal(id as InternalPage);
    }
    if (id === 'connection') {
      return this.openInternal('settings');
    }
    if (id === 'splitRight' || id === 'splitDown') {
      return this.store.update((s) => {
        const groupId = typeof args === 'string' ? args : s.layout.focusedGroupId;
        s.layout.focusedGroupId = groupId;
        splitGroup(
          s,
          id === 'splitRight' ? 'horizontal' : 'vertical',
          findGroup(s).activeTabId ?? undefined,
        );
      });
    }
    if (id === 'merge') {
      return this.store.update(mergeGroups);
    }
    if (id === 'equalize') {
      return this.store.update((s) => {
        s.layout.center = visit(s.layout.center, (n) =>
          n.kind === 'split' ? { ...n, ratio: 0.5 } : n,
        );
      });
    }
    if (id === 'swapSidebars') {
      return this.store.update((s) => {
        s.layout.mainSidebar.side = s.layout.mainSidebar.side === 'left' ? 'right' : 'left';
      });
    }
    if (id === 'resetLayout') {
      return this.store.update(defaultLayout);
    }
    if (id === 'saveLayout') {
      const name = await this.store.prompt('为当前布局命名');
      if (name) {
        const layouts = JSON.parse(localStorage.getItem('scwc.layout-presets') ?? '{}');
        layouts[name] = this.snapshot.layout;
        localStorage.setItem('scwc.layout-presets', JSON.stringify(layouts));
        this.store.toast('布局预设已保存到此浏览器。', 'success');
      }
      return;
    }
    if (id === 'applyLayout') {
      const layouts = JSON.parse(localStorage.getItem('scwc.layout-presets') ?? '{}');
      const name = await this.store.prompt(`选择布局：${Object.keys(layouts).join('、')}`);
      if (name && layouts[name]) {
        return this.applyLayout(layouts[name]);
      }
      return;
    }
    if (id === 'pluginMenu') {
      this.openPluginMenu(args as CatalogItem);
      return;
    }
    if (id === 'pluginConfig') {
      const plugin = args as CatalogItem;
      this.uiExplicitExpired = false;
      const custom = this.uiContributions.find(
        (v) => v.pluginId === plugin.pluginId && v.surface === 'auxiliarySidebar',
      );
      const url = new URL(
        plugin.ui.entryUrl ?? `/web/page/plugin/${encodeURIComponent(plugin.pluginId)}/`,
        location.origin,
      );
      this.inspectedTab = newPluginTab(plugin.pluginId, plugin.title, url.href, {
        installationId: this.store.bootstrap?.installationId ?? '',
        pluginId: plugin.pluginId,
        path: '/',
        search: '',
        hash: '',
      });
      await this.store.update((s) => {
        s.layout.auxiliarySidebar.context = { mode: 'explicit', pluginId: plugin.pluginId };
        s.layout.auxiliarySidebar.selectedView = custom
          ? { kind: 'plugin', pluginId: custom.pluginId, viewId: custom.id }
          : { kind: 'core', viewId: 'currentPage' };
        this.revealSidebar(s, 'auxiliarySidebar');
      });
      return;
    }
    if (id === 'enablePlugin') {
      return this.store.pluginAction((args as CatalogItem).pluginId, 'enable');
    }
    if (id === 'buildPlugin') {
      return this.store.pluginAction((args as CatalogItem).pluginId, 'build-ui');
    }
    if (id.startsWith('plugin.')) {
      const supplied = args as { pluginId?: string } | undefined;
      const selectedId =
        supplied?.pluginId ??
        (tab?.kind === 'plugin'
          ? tab.pluginId
          : await this.store.prompt(
              `插件目录标识：${this.store.catalog.map((p) => p.pluginId).join('、')}`,
            ));
      const selected = this.store.catalog.find((p) => p.pluginId === selectedId);
      if (!selected) {
        throw new Error('请选择目录中的插件。');
      }
      const action = (
        {
          enable: 'enable',
          reload: 'reload',
          disable: 'disable',
          stop: 'once-disable',
          build: 'build-ui',
        } as Record<string, string>
      )[id.slice(7)];
      if (!action) {
        return;
      }
      if (
        ['reload', 'disable', 'once-disable'].includes(action) &&
        !(await this.store.confirm(
          `操作“${selected.title}”将影响它的所有页面连接及运行任务。继续？`,
        ))
      ) {
        return;
      }
      return this.store.pluginAction(selected.pluginId, action);
    }
    if (id === 'rescan') {
      return this.store.rescan();
    }
    if (id === 'jobs') {
      this.showJobs = !this.showJobs;
      return;
    }
    if (id === 'output') {
      return this.selectPanel('output');
    }
    if (id === 'selectTerminal') {
      return this.selectPanel('terminal');
    }
    if (id === 'closeTerminal') {
      return this.renderRoot
        .querySelector<import('../components/terminal.ts').WorkbenchTerminal>('wb-terminal')
        ?.closeCurrent();
    }
    if (id === 'newTerminal') {
      await this.ensureTerminal();
      await this.store.update((s) => {
        s.layout.panel.visible = true;
        s.layout.panel.activeView = 'terminal';
      });
      await this.updateComplete;
      return this.renderRoot
        .querySelector<import('../components/terminal.ts').WorkbenchTerminal>('wb-terminal')
        ?.create();
    }
    if (id === 'notifications') {
      this.toggleNotifications();
      return;
    }
    if (id === 'export') {
      this.download('scwc-workspace.json', this.store.exportDraft());
      return;
    }
    if (id === 'about') {
      this.store.toast(
        'SCWC Web 工作台 · 核心注册命令、独立插件页面、精确 URL 与可恢复工作区。未接入 SDK 的页面以兼容模式显示。',
      );
      return;
    }
    if (id === 'terminal.clear' || id === 'terminal.history') {
      await this.ensureTerminal();
      const terminal =
        this.renderRoot.querySelector<import('../components/terminal.ts').WorkbenchTerminal>(
          'wb-terminal',
        );
      if (terminal) {
        return terminal.clearCurrent(id === 'terminal.clear' ? 'clear-output' : 'clear-history');
      }
      return;
    }
  }
  private async bookmark(tab: PluginTab) {
    const existing = this.store.bookmarks.find(
      (b) =>
        b.pluginId === tab.pluginId &&
        b.url === tab.url &&
        b.locator.installationId === tab.locator.installationId,
    );
    if (existing) {
      return this.command('editBookmark', existing);
    }
    let previewId: string | undefined;
    try {
      previewId =
        (await this.pool?.runtimes
          .get(tab.id)
          ?.port?.request<string>('lifecycle.preview', {}, 1500)) ?? undefined;
    } catch {
      /* Preview is best effort; the URL remains authoritative. */
    }
    await this.store.api.request('/bookmarks', {
      value: {
        pluginId: tab.pluginId,
        url: tab.url,
        locator: tab.locator,
        originalTitle: titleOf(tab),
        previewId: previewId ?? null,
      },
    });
    await this.store.loadList('bookmarks');
    this.store.toast('已收藏当前页面。', 'success');
  }
  private download(name: string, body: string) {
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private applyLayout(layout: WorkspaceSnapshot['layout']) {
    return this.store.update((s) => {
      const saved = clone(layout);
      const tabs = s.tabs.map((t) => t.id),
        gs = groups(saved.center);
      for (const g of gs) {
        g.tabIds = [];
        g.activeTabId = null;
      }
      gs[0].tabIds = tabs;
      gs[0].activeTabId = tabs[0] ?? null;
      s.layout = { ...saved, focusedGroupId: gs[0].id };
    });
  }
  private menuAction(id: string, label?: string, args?: unknown): ContextMenuItem {
    const c = commands.find((c) => c.id === id);
    return {
      kind: 'action',
      id,
      label: label ?? c?.label ?? id,
      shortcut: shortcut(id, this.store.preferences.values.keybindings),
      action: () => this.command(id, args) as Promise<void>,
    };
  }
  private menuTree(index: number): ContextMenuItem[] {
    const tab = this.current;
    const target = tab ? { tabId: tab.id } : undefined;
    const items =
      [
        ['openUrl', 'copyUrl', 'refresh', 'restoreClosed', 'closeTab', 'closeOthers'],
        ['sidebar', 'auxiliary', 'panel', 'focusGroup', 'fullscreen'],
        [
          'splitRight',
          'splitDown',
          'equalize',
          'merge',
          'swapSidebars',
          'saveLayout',
          'applyLayout',
          'resetLayout',
        ],
        [
          'plugins',
          'rescan',
          'jobs',
          'plugin.enable',
          'plugin.reload',
          'plugin.disable',
          'plugin.stop',
          'plugin.build',
        ],
        ['newTerminal', 'output', 'notifications', 'export'],
        ['welcome', 'settings', 'keybindings', 'connection', 'about'],
      ][index] ?? [];
    return items.map((id) => {
      const item = this.menuAction(id, undefined, target);
      if (item.kind === 'action' && ['refresh', 'copyUrl'].includes(id)) {
        item.disabled = tab?.kind !== 'plugin';
      }
      return item;
    });
  }
  private openMenu(event: MouseEvent, index: number) {
    const trigger = event.currentTarget as HTMLElement,
      rect = (trigger ?? this).getBoundingClientRect();
    if (event.type === 'click' && this.menu?.topbarIndex === index) {
      this.closeMenu();
      return;
    }
    this.menu = {
      x: rect.left,
      y: rect.bottom + 4,
      items:
        index < 0
          ? menus.slice(this.menuCount).map((label, i) => ({
              kind: 'submenu',
              id: `main-${i + this.menuCount}`,
              label,
              children: this.menuTree(i + this.menuCount),
            }))
          : this.menuTree(index),
      trigger,
      topbarIndex: index,
    };
  }
  private hoverMenu(event: MouseEvent, index: number) {
    if (this.menu?.topbarIndex !== undefined && this.menu.topbarIndex !== index) {
      this.openMenu(event, index);
    }
  }
  private dismissTopbarMenu = (event: Event) => {
    if (this.menu?.topbarIndex === undefined) {
      return;
    }
    const path = event.composedPath();
    const menuElement = this.renderRoot.querySelector('wb-context-menu');
    if (
      (menuElement && path.includes(menuElement)) ||
      (this.menu.trigger && path.includes(this.menu.trigger))
    ) {
      return;
    }
    this.closeMenu(false);
  };
  private closeMenu(restoreFocus = true) {
    const trigger = this.menu?.trigger;
    this.menu = null;
    if (restoreFocus) {
      queueMicrotask(() => trigger?.isConnected && trigger.focus());
    }
  }
  private findItem(items: ContextMenuItem[], id: string): ContextMenuItem | undefined {
    for (const item of items) {
      if (item.id === id) {
        return item;
      }
      if (item.kind === 'submenu') {
        const found = this.findItem(item.children, id);
        if (found) {
          return found;
        }
      }
    }
  }
  private selectMenu(event: CustomEvent<{ id: string; value?: string }>) {
    const item = this.findItem(this.menu?.items ?? [], event.detail.id);
    if (
      !item ||
      item.kind === 'separator' ||
      item.kind === 'submenu' ||
      ('disabled' in item && item.disabled)
    ) {
      return;
    }
    if (!('keepOpen' in item && item.keepOpen)) {
      this.closeMenu();
    }
    if (item.kind === 'action') {
      this.act(() => Promise.resolve(item.action()));
    }
    if (item.kind === 'checkbox') {
      this.act(() => Promise.resolve(item.action(!item.checked)));
    }
    if (item.kind === 'input') {
      this.act(() => Promise.resolve(item.action(event.detail.value ?? '')));
    }
  }
  private tabMenu(event: MouseEvent, tab: Tab, group: Group) {
    event.preventDefault();
    event.stopPropagation();
    const target = { tabId: tab.id };
    const items: ContextMenuItem[] = [
      this.menuAction('pin', tab.pinned ? '取消固定' : '固定标签', target),
      this.menuAction('rename', undefined, target),
    ];
    if (tab.kind === 'plugin') {
      items.push(
        this.menuAction('bookmark', undefined, target),
        this.menuAction('copyUrl', undefined, target),
        this.menuAction('refresh', undefined, target),
        this.menuAction('keepAlive', tab.keepAlive ? '取消保持运行' : '保持运行', target),
        this.menuAction('hibernate', undefined, target),
      );
    }
    items.push(
      { kind: 'separator', id: 'tab-separator' },
      {
        kind: 'submenu',
        id: 'move',
        label: '移动到分组',
        disabled: groups(this.snapshot.layout.center).length <= 1,
        children: groups(this.snapshot.layout.center)
          .filter((g) => g.id !== group.id)
          .map((g, i) => ({
            kind: 'action',
            id: `move-${g.id}`,
            label: `分组 ${i + 1}`,
            action: () => this.store.update((s) => moveTab(s, tab.id, g.id)),
          })),
      },
      {
        kind: 'action',
        id: 'move-before',
        label: '向前移动标签',
        action: () =>
          this.store.update((s) =>
            moveTab(s, tab.id, group.id, Math.max(0, group.tabIds.indexOf(tab.id) - 1)),
          ),
      },
      {
        kind: 'action',
        id: 'move-after',
        label: '向后移动标签',
        action: () =>
          this.store.update((s) => moveTab(s, tab.id, group.id, group.tabIds.indexOf(tab.id) + 1)),
      },
      this.menuAction('closeTab', undefined, target),
      this.menuAction('closeOthers', undefined, target),
    );
    this.menu = {
      x: event.clientX,
      y: event.clientY,
      items,
      trigger: event.currentTarget as HTMLElement,
    };
  }
  private openPluginMenu(plugin: CatalogItem) {
    const trigger = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined;
    const rect = trigger?.getBoundingClientRect();
    const actions: [string, string][] = [
      ['enable', '启用'],
      ['reload', '重启后端'],
      ['once-disable', '临时停止'],
      ['disable', '禁用'],
      ['build-ui', '构建页面'],
    ];
    this.menu = {
      x: Math.max(8, (rect?.right ?? innerWidth - 340) - 240),
      y: rect?.bottom ?? 100,
      trigger,
      items: actions.map(([action, label]) => ({
        kind: 'action',
        id: action,
        label,
        disabled:
          action === 'build-ui'
            ? plugin.ui.buildCapability !== 'supported'
            : action === 'enable'
              ? plugin.runtime.status === 'ready'
              : ['reload', 'once-disable'].includes(action)
                ? plugin.runtime.status !== 'ready'
                : false,
        action: () =>
          this.command(
            (
              {
                enable: 'plugin.enable',
                reload: 'plugin.reload',
                'once-disable': 'plugin.stop',
                disable: 'plugin.disable',
                'build-ui': 'plugin.build',
              } as Record<string, string>
            )[action],
            { pluginId: plugin.pluginId },
          ) as Promise<void>,
      })),
    };
  }
  private resizeTargets(event: PointerEvent) {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[data-resize-key]')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        event.clientX >= rect.left - 5 &&
        event.clientX <= rect.right + 5 &&
        event.clientY >= rect.top - 5 &&
        event.clientY <= rect.bottom + 5
      );
    });
  }
  private hoverResize(event: PointerEvent) {
    if (this.dragging) {
      return;
    }
    const hovered = event.composedPath().find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.hasAttribute('data-resize-key'),
    );
    if (!hovered) {
      this.leaveResize();
      return;
    }
    const targets = this.resizeTargets(event);
    const axes = new Set(targets.map((el) => el.getAttribute('aria-orientation')));
    for (const el of this.renderRoot.querySelectorAll<HTMLElement>('[data-resize-key]')) {
      el.style.cursor = '';
    }
    if (axes.size > 1) {
      for (const el of targets) {
        el.style.cursor = 'move';
      }
    }
    const parts = (axes.size > 1 ? targets : [hovered]).map((el) => ({
      key: el.dataset.resizeKey ?? '',
      nodeId: el.dataset.resizeNode,
    }));
    if (
      parts.length === this.hoveredResizers.length &&
      parts.every(
        (part, index) =>
          part.key === this.hoveredResizers[index].key &&
          part.nodeId === this.hoveredResizers[index].nodeId,
      )
    ) {
      return;
    }
    clearTimeout(this.resizeHoverTimer);
    this.hoveredResizers = parts;
    this.setResizeHighlights([]);
    this.resizeHoverTimer = setTimeout(() => {
      this.resizeHoverTimer = undefined;
      this.setResizeHighlights(parts);
    }, 1000);
  }
  private setResizeHighlights(parts: { key: string; nodeId?: string }[]) {
    const next = new Set(parts.map((part) => `${part.key}:${part.nodeId ?? ''}`));
    if (
      next.size !== this.highlightedResizers.size ||
      [...next].some((key) => !this.highlightedResizers.has(key))
    ) {
      this.highlightedResizers = next;
    }
  }
  private resizeHighlighted(key: string, nodeId?: string) {
    return this.highlightedResizers.has(`${key}:${nodeId ?? ''}`);
  }
  private leaveResize() {
    if (!this.dragging) {
      clearTimeout(this.resizeHoverTimer);
      this.resizeHoverTimer = undefined;
      this.hoveredResizers = [];
      this.setResizeHighlights([]);
      for (const el of this.renderRoot.querySelectorAll<HTMLElement>('[data-resize-key]')) {
        el.style.cursor = '';
      }
    }
  }
  private resize(
    event: PointerEvent,
    key: 'main' | 'aux' | 'panel' | 'sidebar-split' | 'split' | 'terminal-list',
    nodeId?: string,
  ) {
    event.preventDefault();
    if (event.button !== 0 || this.dragging) {
      return;
    }
    const initial = clone(this.snapshot),
      startX = event.clientX,
      startY = event.clientY;
    const targets = this.resizeTargets(event).map((el) => ({
      key: el.dataset.resizeKey ?? key,
      nodeId: el.dataset.resizeNode,
    }));
    if (!targets.some((target) => target.key === key && target.nodeId === nodeId)) {
      targets.push({ key, nodeId });
    }
    let parts = [
      ...new Map(targets.map((target) => [`${target.key}:${target.nodeId}`, target])).values(),
    ];
    const orientation = (part: (typeof parts)[number]) =>
      part.key === 'sidebar-split' ||
      (part.key === 'panel' && initial.layout.panel.dock === 'bottom') ||
      (part.key === 'split' &&
        this.renderRoot
          .querySelector(`[data-split="${part.nodeId}"]`)
          ?.classList.contains('vertical'))
        ? 'row-resize'
        : 'col-resize';
    const primaryAxis = orientation({ key, nodeId });
    parts = parts.filter(
      (part) => orientation(part) !== primaryAxis || (part.key === key && part.nodeId === nodeId),
    );
    this.resizeCursor = new Set(parts.map(orientation)).size > 1 ? 'move' : orientation(parts[0]);
    const oldCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = this.resizeCursor;
    clearTimeout(this.resizeHoverTimer);
    this.resizeHoverTimer = undefined;
    this.hoveredResizers = [];
    this.setResizeHighlights(parts);
    this.dragging = true;
    this.resizeSnapshot = clone(initial);
    const side = initial.layout.mainSidebar.side;
    const initialGeometry = this.geometry();
    const initiallyMaximized = this.panelMaximized;
    const initialSplitExtents = new Map(this.splitExtents);
    const horizontalStart = this.horizontalStart(initial);
    const rects = new Map(
      parts.map((part) => [
        part.nodeId,
        this.renderRoot
          .querySelector<HTMLElement>(`[data-split="${part.nodeId}"]`)
          ?.getBoundingClientRect(),
      ]),
    );
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    const move = (e: PointerEvent) => {
      const s = this.resizeSnapshot;
      if (!s) {
        return;
      }
      const dx = e.clientX - startX,
        dy = e.clientY - startY;
      for (const part of parts) {
        if (part.key === 'main') {
          applyHorizontalDrag(s.layout, 'mainSidebar', horizontalStart, side === 'left' ? dx : -dx);
        }
        if (part.key === 'aux') {
          applyHorizontalDrag(
            s.layout,
            'auxiliarySidebar',
            horizontalStart,
            side === 'left' ? -dx : dx,
          );
        }
        if (part.key === 'panel') {
          const before = initial.layout.panel;
          if (before.dock === 'bottom') {
            const result = dragBottomPanel(
              {
                visible: before.visible,
                height: initialGeometry.panelHeight,
                maximized: initiallyMaximized,
                availableHeight: initialGeometry.bodyHeight,
              },
              -dy,
            );
            s.layout.panel.visible = result.visible;
            s.layout.panel.height = result.height;
            this.panelMaximized = result.maximized;
          } else {
            applyHorizontalDrag(
              s.layout,
              'panel',
              horizontalStart,
              before.dock === 'left' ? dx : -dx,
            );
            this.panelMaximized = false;
          }
        }
        if (part.key === 'sidebar-split') {
          s.layout.mainSidebar.openPagesRatio = clamp(
            initial.layout.mainSidebar.openPagesRatio +
              dy / (this.renderRoot.querySelector('.sidebar-content')?.clientHeight ?? 400),
            0.3,
            0.8,
          );
        }
        if (part.key === 'terminal-list') {
          s.layout.panel.terminalListSize = clamp(
            initial.layout.panel.terminalListSize - dx,
            160,
            320,
          );
        }
        const rect = rects.get(part.nodeId);
        if (part.key === 'split' && rect) {
          s.layout.center = visit(s.layout.center, (n) => {
            if (n.kind !== 'split' || n.id !== part.nodeId) {
              return n;
            }
            const horizontal = n.axis === 'horizontal';
            const available =
              (horizontal ? rect.width : rect.height) - this.layoutMetrics().splitterSize;
            const axis = horizontal ? 'width' : 'height';
            if (available <= 0) {
              return n;
            }
            const first = clamp(
              horizontal ? e.clientX - rect.left : e.clientY - rect.top,
              minimumNode(n.first, this.layoutMetrics().splitterSize)[axis],
              available - minimumNode(n.second, this.layoutMetrics().splitterSize)[axis],
            );
            return { ...n, ratio: first / available };
          });
        }
      }
      this.requestUpdate();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      document.documentElement.style.cursor = oldCursor;
      this.dragging = false;
      this.cancelResize = undefined;
      this.leaveResize();
    };
    const finish = (event: PointerEvent) => {
      const final = this.resizeSnapshot;
      this.resizeSnapshot = undefined;
      cleanup();
      this.hoverResize(event);
      if (final) {
        this.act(() =>
          this.store.update((s) => {
            s.layout = final.layout;
          }),
        );
      }
    };
    const cancel = () => {
      this.panelMaximized = initiallyMaximized;
      this.splitExtents = initialSplitExtents;
      this.resizeSnapshot = undefined;
      cleanup();
      this.requestUpdate();
    };
    this.cancelResize = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
  }
  private resizeKey(
    event: KeyboardEvent,
    key: 'main' | 'aux' | 'panel' | 'sidebar-split',
    direction = 1,
  ) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const delta = (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) * direction;
    this.act(() =>
      this.store.update((s) => {
        if (key === 'main' || key === 'aux') {
          const part = key === 'main' ? 'mainSidebar' : 'auxiliarySidebar';
          const growth = key === 'main' ? delta : -delta;
          const start = this.horizontalStart(s);
          applyHorizontalDrag(
            s.layout,
            part,
            start,
            start[part].visible ? growth * 16 : growth > 0 ? MIN_SIDEBAR_WIDTH : 0,
          );
        }
        if (key === 'panel') {
          if (s.layout.panel.dock === 'bottom') {
            const g = this.geometry();
            const result = dragBottomPanel(
              {
                visible: s.layout.panel.visible,
                height: g.panelHeight,
                maximized: this.panelMaximized,
                availableHeight: g.bodyHeight,
              },
              s.layout.panel.visible ? -delta * 16 : delta < 0 ? MIN_PANEL_HEIGHT : 0,
            );
            s.layout.panel.visible = result.visible;
            s.layout.panel.height = result.height;
            this.panelMaximized = result.maximized;
          } else {
            const growth = s.layout.panel.dock === 'left' ? delta : -delta;
            const start = this.horizontalStart(s);
            applyHorizontalDrag(
              s.layout,
              'panel',
              start,
              start.panel.visible ? growth * 16 : growth > 0 ? MIN_DOCKED_PANEL_WIDTH : 0,
            );
          }
        }
        if (key === 'sidebar-split') {
          s.layout.mainSidebar.openPagesRatio = Math.max(
            0.3,
            Math.min(0.8, s.layout.mainSidebar.openPagesRatio + delta * 0.05),
          );
        }
      }),
    );
  }
  private shellStyle() {
    const layout = (this.resizeSnapshot ?? this.snapshot).layout;
    const g = this.geometry();
    const widths: Record<string, string> = {
      activity: `${this.layoutMetrics().activityWidth}px`,
      main: `${g.mainWidth}px`,
      aux: `${g.auxWidth}px`,
      center: `${g.centerWidth}px`,
      panel: `${g.panelWidth}px`,
    };
    let columns =
      layout.mainSidebar.side === 'left'
        ? ['activity', 'main', 'center', 'aux']
        : ['aux', 'center', 'main', 'activity'];
    if (layout.panel.dock !== 'bottom') {
      const i =
        layout.panel.align === 'full'
          ? layout.panel.dock === 'left'
            ? 0
            : columns.length
          : columns.indexOf('center') + (layout.panel.dock === 'right' ? 1 : 0);
      columns.splice(i, 0, 'panel');
    }
    const rows = [`"${columns.join(' ')}"`];
    if (layout.panel.dock === 'bottom') {
      rows.push(
        `"${columns.map((n) => (n === 'activity' ? n : layout.panel.align === 'full' || n === 'center' ? 'panel' : n)).join(' ')}"`,
      );
    }
    return {
      'grid-template-columns': columns.map((c) => widths[c]).join(' '),
      'grid-template-rows':
        layout.panel.dock === 'bottom'
          ? `${g.centerHeight}px ${g.panelHeight}px`
          : `${g.bodyHeight}px`,
      'grid-template-areas': rows.join(' '),
      '--main-visible-width': widths.main,
      '--aux-visible-width': widths.aux,
      '--terminal-list-width': `${layout.panel.terminalListSize}px`,
    };
  }
  private followOutput = true;
  render() {
    const metrics = this.layoutMetrics();
    const geometry = this.geometry();
    const center = this.store.workspace
      ? (this.resizeSnapshot ?? this.snapshot).layout.center
      : undefined;
    const minimum = center
      ? minimumNode(
          this.focusedOnly ? findGroup(this.snapshot) : center,
          this.layoutMetrics().splitterSize,
        )
      : { width: MIN_CENTER_WIDTH, height: MIN_CENTER_HEIGHT };
    const centerWidth = Math.max(MIN_CENTER_WIDTH, geometry.centerWidth, minimum.width);
    const centerHeight = Math.max(
      MIN_CENTER_HEIGHT,
      geometry.centerHeight || this.centerCanvasHeight,
      minimum.height,
    );
    if (geometry.centerHeight > 0) {
      this.centerCanvasHeight = centerHeight;
    }
    return html`<wb-scroll-container
        drag-only
        class="application-scroll"
        wheel-direction="none"
        shift-wheel-direction="none"
        @scroll=${() => this.pool?.position()}
      >
        <a
          href="#workspace-center"
          class="skip-nav"
          @click=${(e: Event) => {
            e.preventDefault();
            this.renderRoot.querySelector<HTMLElement>('#workspace-center')?.focus();
          }}
          >跳过导航，进入页面区域</a
        >
        <div
          @pointerover=${this.hoverResize}
          @pointermove=${this.hoverResize}
          @pointerout=${this.leaveResize}
          @pointerleave=${this.leaveResize}
          style=${styleMap({
            width: `${geometry.shellWidth}px`,
            height: `${geometry.height}px`,
            'grid-template-rows': `${metrics.topbarHeight}px minmax(0, 1fr) ${metrics.statusbarHeight}px`,
            '--center-min-width': `${MIN_CENTER_WIDTH}px`,
            '--group-min-width': `${MIN_GROUP_WIDTH}px`,
            '--group-min-height': `${MIN_GROUP_HEIGHT}px`,
            '--panel-min-width': `${MIN_PANEL_WIDTH}px`,
          })}
          class=${`workbench ${this.dragging ? 'is-dragging' : ''} ${this.focusedOnly ? 'is-focused' : ''}`}
        >
          ${this.renderTopbar()}
          ${this.store.loading
            ? html`<main class="boot-screen" aria-busy="true">
                <div class="skeleton large"></div>
                <p>正在连接本机工作台…</p>
              </main>`
            : this.store.error
              ? html`<main class="boot-screen">
                  <div class="error-symbol">${icon('network')}</div>
                  <h1>无法连接工作台</h1>
                  <p role="alert">${this.store.error}</p>
                  <p class="muted">
                    请从核心服务的 ${location.origin}/web/ 地址打开，确认服务与令牌有效。
                  </p>
                  <button class="btn primary" @click=${() => void this.store.start()}>
                    重新连接
                  </button>
                  <details>
                    <summary>手动输入当前核心令牌</summary>
                    <form
                      @submit=${(e: SubmitEvent) => {
                        e.preventDefault();
                        const input = requireValue(
                          (e.currentTarget as HTMLFormElement).querySelector('input'),
                        );
                        this.act(() => this.store.authenticate(input.value));
                      }}
                    >
                      <input type="password" aria-label="核心令牌" autocomplete="off" /><button
                        class="btn secondary"
                        type="submit"
                      >
                        连接
                      </button>
                    </form>
                  </details>
                </main>`
              : html`<div
                  class="shell-body"
                  data-side=${this.snapshot.layout.mainSidebar.side}
                  data-panel-dock=${this.snapshot.layout.panel.dock}
                  data-panel-align=${this.snapshot.layout.panel.align}
                  data-main-visible=${this.visible('main')}
                  data-aux-visible=${this.visible('aux')}
                  data-panel-visible=${this.visible('panel')}
                  data-panel-maximized=${this.panelMaximized && this.visible('panel')}
                  style=${styleMap(this.shellStyle())}
                >
                  ${this.renderActivity()}${this.renderSidebar()}
                  ${!this.visible('main')
                    ? html`<div
                        class="resize-handle hidden-main-resize"
                        data-resize-key="main"
                        ?data-resize-active=${this.resizeHighlighted('main')}
                        role="separator"
                        aria-label="展开和调整主侧栏宽度"
                        aria-orientation="vertical"
                        tabindex="0"
                        @pointerdown=${(e: PointerEvent) => this.resize(e, 'main')}
                        @keydown=${(e: KeyboardEvent) =>
                          this.resizeKey(
                            e,
                            'main',
                            this.snapshot.layout.mainSidebar.side === 'left' ? 1 : -1,
                          )}
                      ></div>`
                    : nothing}
                  ${!this.visible('aux')
                    ? html`<div
                        class="resize-handle hidden-aux-resize"
                        data-resize-key="aux"
                        ?data-resize-active=${this.resizeHighlighted('aux')}
                        role="separator"
                        aria-label="展开和调整辅助侧栏宽度"
                        aria-orientation="vertical"
                        tabindex="0"
                        @pointerdown=${(e: PointerEvent) => this.resize(e, 'aux')}
                        @keydown=${(e: KeyboardEvent) =>
                          this.resizeKey(
                            e,
                            'aux',
                            this.snapshot.layout.mainSidebar.side === 'left' ? 1 : -1,
                          )}
                      ></div>`
                    : nothing}
                  ${!this.visible('panel')
                    ? html`<div
                        class=${`resize-handle hidden-panel-resize ${this.snapshot.layout.panel.dock}`}
                        data-resize-key="panel"
                        ?data-resize-active=${this.resizeHighlighted('panel')}
                        role="separator"
                        aria-label=${this.snapshot.layout.panel.dock === 'bottom'
                          ? '展开和调整底部面板高度'
                          : '展开和调整停靠面板宽度'}
                        aria-orientation=${this.snapshot.layout.panel.dock === 'bottom'
                          ? 'horizontal'
                          : 'vertical'}
                        tabindex="0"
                        @pointerdown=${(e: PointerEvent) => this.resize(e, 'panel')}
                        @keydown=${(e: KeyboardEvent) => this.resizeKey(e, 'panel')}
                      ></div>`
                    : nothing}
                  <main
                    id="workspace-center"
                    tabindex="-1"
                    class="center-area"
                    ?hidden=${this.panelMaximized && this.visible('panel')}
                  >
                    <wb-scroll-container
                      drag-only
                      class="center-scroll"
                      wheel-direction="none"
                      shift-wheel-direction="none"
                      @scroll=${() => this.pool?.position()}
                    >
                      <div
                        class="center-canvas"
                        style=${styleMap({
                          width: `${centerWidth}px`,
                          height: `${centerHeight}px`,
                        })}
                      >
                        ${this.renderNode(requireValue(center), centerWidth, centerHeight)}
                      </div>
                    </wb-scroll-container>
                  </main>
                  <aside
                    class="auxiliary-sidebar"
                    data-visible=${this.visible('aux')}
                    aria-label="页面信息"
                    tabindex="-1"
                    @pointerdown=${(e: PointerEvent) => {
                      if (!(e.target as HTMLElement).closest('[data-resize-key]')) {
                        this.recordFocus({ kind: 'auxiliary' });
                      }
                    }}
                    @focusin=${() => this.recordFocus({ kind: 'auxiliary' })}
                    @ui-surface-action=${(e: CustomEvent<{ kind: string }>) => {
                      if (e.detail.kind === 'click' || e.detail.kind === 'contextmenu') {
                        this.recordFocus({ kind: 'auxiliary' });
                      }
                    }}
                  >
                    <div
                      class="resize-handle aux-resize"
                      data-resize-key="aux"
                      ?data-resize-active=${this.resizeHighlighted('aux')}
                      role="separator"
                      tabindex="0"
                      aria-label="调整辅助侧栏宽度"
                      aria-orientation="vertical"
                      @pointerdown=${(e: PointerEvent) => this.resize(e, 'aux')}
                      @keydown=${(e: KeyboardEvent) =>
                        this.resizeKey(
                          e,
                          'aux',
                          this.snapshot.layout.mainSidebar.side === 'left' ? 1 : -1,
                        )}
                    ></div>
                    ${this.renderAuxiliaryUI()}
                  </aside>
                  ${this.renderPanel()}
                  <div class="frame-pool" aria-label="插件页面实例"></div>
                </div>`}
          ${this.renderStatus()}
        </div>
      </wb-scroll-container>
      ${this.quickOpen ? this.renderQuickOpen() : nothing}${this.notificationOpen
        ? this.renderNotifications()
        : nothing}${this.showJobs ? this.renderJobs() : nothing}${this.renderToasts()}
      ${this.menu
        ? html`<wb-context-menu
            .x=${this.menu.x}
            .y=${this.menu.y}
            .items=${this.menu.items}
            .noBackdrop=${this.menu.topbarIndex !== undefined}
            presentation="custom"
            @wb-menu-close=${() => this.closeMenu()}
            @wb-menu-select=${this.selectMenu}
            @wb-menu-input-submit=${this.selectMenu}
            @contextmenu=${(e: Event) => e.preventDefault()}
          ></wb-context-menu>`
        : nothing}
      ${this.store.dialogState ? this.renderDialog() : nothing}
      ${this.dragging
        ? html`<div class="resize-shield" style=${`cursor:${this.resizeCursor}`}></div>`
        : nothing} `;
  }
  private contributionIcon(id: string) {
    const view = this.uiContributions.find((v) => 'plugin:' + v.pluginId + ':' + v.id === id);
    return view?.icon?.kind === 'asset'
      ? html`<img src=${view.icon.path} alt="" style="width:20px;height:20px;object-fit:contain" />`
      : icon(view?.icon?.kind === 'builtin' ? view.icon.name : 'extensions');
  }
  private uiRegistryEvent = (event: Event) => {
    if(event.type==='core-restarted'){this.uiRegistryLoaded=false;void this.loadUIRegistry();return;}
    const type = (event as CustomEvent).detail?.type;
    if (type === 'ui.registry.changed' || type === 'catalog.changed') {
      void this.loadUIRegistry();
    }
  };
  private async loadUIRegistry() {
    if (this.uiRegistryLoading) {
      return;
    }
    this.uiRegistryLoading = true;
    try {
      const result = await this.store.api.request<{ items: UIContribution[] }>('/ui/registry');
      this.uiContributions = result.items;
      this.uiRegistryLoaded = true;
    } catch {
      /* Reconnect retries through the next store change. */
    } finally {
      this.uiRegistryLoading = false;
    }
  }
  private async selectUIActivity(id: string) {
    if (!id.startsWith('plugin:')) {
      return this.setView(id as keyof typeof viewNames);
    }
    const view = this.uiContributions.find((v) => 'plugin:' + v.pluginId + ':' + v.id === id);
    if (view) {
      await this.store.update((s) => {
        s.layout.mainSidebar.selectedView = {
          kind: 'plugin',
          pluginId: view.pluginId,
          viewId: view.id,
        };
        this.revealSidebar(s, 'mainSidebar');
      });
    }
  }
  private uiEffect = (event: Event) => {
    this.act(() => this.applyUIEffect(event));
  };
  private async applyUIEffect(event: Event) {
    const effect = (
      event as CustomEvent<ClientEffect & { pluginId: string; sourceTabId?: string | null }>
    ).detail;
    if (effect.type === 'settings.open') {
      const plugin = this.store.catalog.find((p) => p.pluginId === effect.pluginId);
      if (plugin) {
        if (effect.sourceTabId && this.current?.id === effect.sourceTabId) {
          this.inspectedTab = undefined;
          this.uiExplicitExpired = false;
          const custom = this.uiContributions.find(
            (v) => v.pluginId === plugin.pluginId && v.surface === 'auxiliarySidebar',
          );
          await this.store.update((s) => {
            s.layout.auxiliarySidebar.context = { mode: 'follow' };
            s.layout.auxiliarySidebar.selectedView = custom
              ? { kind: 'plugin', pluginId: custom.pluginId, viewId: custom.id }
              : { kind: 'core', viewId: 'currentPage' };
            this.revealSidebar(s, 'auxiliarySidebar');
          });
        } else {
          await this.command('pluginConfig', plugin);
        }
      }
    }
    if (effect.type === 'page.open') {
      await this.openPlugin(
        requireValue(this.store.catalog.find((p) => p.pluginId === effect.pluginId)),
        new URL(
          String(effect.args[0]).replace(/^\/+/, ''),
          `${location.origin}/web/page/plugin/${encodeURIComponent(effect.pluginId)}/`,
        ).href,
      );
    }
    if (effect.type === 'view.open' || effect.type === 'view.refresh') {
      const view = this.uiContributions.find(
        (v) =>
          v.pluginId === effect.pluginId && v.surface === effect.args[0] && v.id === effect.args[1],
      );
      if (!view) {
        return;
      }
      await this.store.update((s) => {
        if (view.surface === 'mainSidebar') {
          s.layout.mainSidebar.selectedView = {
            kind: 'plugin',
            pluginId: view.pluginId,
            viewId: view.id,
          };
          this.revealSidebar(s, 'mainSidebar');
        } else {
          s.layout.auxiliarySidebar.selectedView = {
            kind: 'plugin',
            pluginId: view.pluginId,
            viewId: view.id,
          };
          this.revealSidebar(s, 'auxiliarySidebar');
        }
      });
      if (effect.type === 'view.refresh') {
        await this.updateComplete;
        for (const view of this.renderRoot.querySelectorAll<DeclarativeView>(
          'wb-declarative-view',
        )) {
          if (
            view.pluginId === effect.pluginId &&
            view.surface === effect.args[0] &&
            view.viewId === effect.args[1]
          ) {
            await view.refresh();
          }
        }
      }
    }
  }
  private renderAuxiliaryUI() {
    const context = this.snapshot.layout.auxiliarySidebar.context;
    const explicit = !this.uiExplicitExpired && context?.mode === 'explicit';
    const selectedPlugin = explicit
      ? this.store.catalog.find((p) => p.pluginId === context.pluginId)
      : undefined;
    const placeholder = selectedPlugin
      ? newPluginTab(
          selectedPlugin.pluginId,
          selectedPlugin.title,
          selectedPlugin.ui.entryUrl ?? '',
          {
            installationId: this.store.bootstrap?.installationId ?? '',
            pluginId: selectedPlugin.pluginId,
            path: '/',
            search: '',
            hash: '',
          },
        )
      : undefined;
    const tab = this.inspectedTab ?? placeholder ?? this.current,
      pluginId = tab?.kind === 'plugin' ? tab.pluginId : undefined;
    const custom = this.uiContributions.find(
      (v) => v.surface === 'auxiliarySidebar' && v.pluginId === pluginId,
    );
    const selected = this.snapshot.layout.auxiliarySidebar.selectedView;
    const pluginTitle = this.store.catalog.find((item) => item.pluginId === pluginId)?.title ?? pluginId;
    const showCustom = Boolean(
      custom &&
      (custom.hideCurrentPage ||
        (selected?.kind === 'plugin' &&
          selected.pluginId === custom.pluginId &&
          selected.viewId === custom.id)),
    );
    return html`<div class="sidebar-header auxiliary-header" data-tabs=${Boolean(custom && !custom.hideCurrentPage)}>
      ${custom && !custom.hideCurrentPage
        ? html`<div class="auxiliary-tabs" role="tablist" aria-label="辅助侧栏页面"
            @keydown=${(event: KeyboardEvent) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
              }
              event.preventDefault();
              const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]')];
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next]?.click();
              buttons[next]?.focus();
            }}>
            <button
              class="tab-item auxiliary-page-info"
              role="tab"
              title="页面信息"
              aria-selected=${!showCustom}
              tabindex=${showCustom ? -1 : 0}
              @click=${() =>
                this.act(() =>
                  this.store.update((s) => {
                    s.layout.auxiliarySidebar.selectedView = {
                      kind: 'core',
                      viewId: 'currentPage',
                    };
                  }),
                )}
            >
              <span class="tab-label">页面信息</span></button
            ><button
              class="tab-item auxiliary-plugin-tab"
              role="tab"
              title=${pluginTitle ?? ''}
              aria-selected=${showCustom}
              tabindex=${showCustom ? 0 : -1}
              @click=${() =>
                this.act(() =>
                  this.store.update((s) => {
                    s.layout.auxiliarySidebar.selectedView = {
                      kind: 'plugin',
                      pluginId: custom.pluginId,
                      viewId: custom.id,
                    };
                  }),
                )}
            >
              <span class="tab-label">${pluginTitle}</span>
            </button>
          </div>`
        : html`<strong title=${showCustom ? pluginTitle ?? '' : '页面信息'}>${showCustom ? pluginTitle : '页面信息'}</strong>`}
      ${iconButton('close', '隐藏辅助侧栏', () => this.act(() => this.command('auxiliary')))}
      </div>
      ${showCustom && custom
        ? html`<wb-declarative-view
            .store=${this.store}
            .pool=${this.pool}
            .pluginId=${custom.pluginId}
            surface="auxiliarySidebar"
            .viewId=${custom.id}
            .sourceTabId=${this.inspectedTab || explicit
              ? null
              : tab?.kind === 'plugin'
                ? tab.id
                : null}
          ></wb-declarative-view>`
        : html`<wb-page-inspector .store=${this.store} .tab=${tab}></wb-page-inspector>`}`;
  }
  private renderTopbar() {
    const disabled = !this.store.workspace;
    const right = this.store.workspace?.snapshot.layout.mainSidebar.side === 'right';
    const leftVisible = !disabled && this.visible(right ? 'aux' : 'main');
    const rightVisible = !disabled && this.visible(right ? 'main' : 'aux');
    return html`<header class="topbar">
      <nav class="topbar-menu-area" aria-label="主菜单">
        ${menus
          .slice(0, this.menuCount)
          .map(
            (label, index) =>
              html`<button
                class="topbar-menu-item"
                ?disabled=${disabled}
                aria-haspopup="menu"
                aria-expanded=${this.menu?.topbarIndex === index}
                @click=${(e: MouseEvent) => this.openMenu(e, index)}
                @mouseenter=${(e: MouseEvent) => this.hoverMenu(e, index)}
              >
                ${label}
              </button>`,
          )}${this.menuCount < menus.length
          ? html`<button
              class="topbar-menu-item overflow"
              aria-label="更多主菜单"
              ?disabled=${disabled}
              aria-haspopup="menu"
              aria-expanded=${this.menu?.topbarIndex === -1}
              @click=${(e: MouseEvent) => this.openMenu(e, -1)}
              @mouseenter=${(e: MouseEvent) => this.hoverMenu(e, -1)}
            >
              ${icon('more')}
            </button>`
          : nothing}
      </nav>
      <div class="focus-navigation">
        ${iconButton(
          'arrow-left',
          '返回上一个聚焦位置',
          () => this.act(() => this.command('focusBack')),
          disabled || !this.focusHistory.canGo(-1, this.focusExists),
        )}
        ${iconButton(
          'arrow-right',
          '前进到下一个聚焦位置',
          () => this.act(() => this.command('focusForward')),
          disabled || !this.focusHistory.canGo(1, this.focusExists),
        )}
      </div>
      <button
        class="topbar-search"
        ?disabled=${disabled}
        @click=${() => this.act(() => this.command('quickOpen'))}
      >
        ${icon('search')}<span>搜索页面、插件与操作…</span><kbd>F1</kbd>
      </button>
      <div class="topbar-controls">
        ${iconButton(
          leftVisible ? 'layout-sidebar-left' : 'layout-sidebar-left-off',
          right ? '切换辅助侧栏' : '切换主侧栏',
          () => this.act(() => this.command(right ? 'auxiliary' : 'sidebar', 'topbar')),
          disabled,
        )}${iconButton(
          !disabled && this.visible('panel') ? 'layout-panel' : 'layout-panel-off',
          '切换底部面板',
          () => this.act(() => this.command('panel')),
          disabled,
        )}${iconButton(
          rightVisible ? 'layout-sidebar-right' : 'layout-sidebar-right-off',
          right ? '切换主侧栏' : '切换辅助侧栏',
          () => this.act(() => this.command(right ? 'sidebar' : 'auxiliary', 'topbar')),
          disabled,
        )}
      </div>
      <div class="menu-measure" aria-hidden="true">
        ${menus.map((label) => html`<span class="topbar-menu-item">${label}</span>`)}
      </div>
    </header>`;
  }
  private renderActivity() {
    const selected = this.snapshot.layout.mainSidebar.selectedView;
    const view =
      selected?.kind === 'plugin'
        ? 'plugin:' + selected.pluginId + ':' + selected.viewId
        : this.snapshot.layout.mainSidebar.view;
    const entries = [
      ...Object.entries(viewNames),
      ...this.uiContributions
        .filter((v) => v.surface === 'mainSidebar')
        .map((v) => ['plugin:' + v.pluginId + ':' + v.id, v.title]),
    ];
    const slots = activitySlots(this.geometry().bodyHeight, entries.length, this.layoutMetrics());
    return html`<nav class="activity-bar" aria-label="工作台视图">
      ${entries
        .slice(0, slots.visible)
        .map(
          ([id, label]) =>
            html`<button
              class="activity-bar-item"
              title=${label}
              aria-label=${label}
              aria-pressed=${this.visible('main') && view === id}
              @click=${() =>
                this.act(() =>
                  this.visible('main') && view === id
                    ? this.command('sidebar')
                    : this.selectUIActivity(id),
                )}
            >
              ${id.startsWith('plugin:') ? this.contributionIcon(id) : icon(id)}
            </button>`,
        )}
      ${slots.overflow
        ? html`<button
            class="activity-bar-item"
            title="更多视图"
            aria-label="更多视图"
            @click=${(event: MouseEvent) => {
              const trigger = event.currentTarget as HTMLElement;
              const rect = trigger.getBoundingClientRect();
              this.menu = {
                x: rect.right,
                y: rect.top,
                trigger,
                items: entries.slice(slots.visible).map(([id, label]) => ({
                  kind: 'checkbox' as const,
                  id,
                  label,
                  checked: this.visible('main') && view === id,
                  action: () => this.selectUIActivity(id),
                })),
              };
            }}
          >
            ${icon('more')}
          </button>`
        : nothing}
      <div class="activity-bar-bottom">
        ${iconButton('keyboard', '快捷键设置', () =>
          this.act(() => this.command('keybindings')),
        )}${iconButton('settings', '设置', () => this.act(() => this.command('settings')))}
      </div>
    </nav>`;
  }
  private renderSidebar() {
    const layout = (this.resizeSnapshot ?? this.snapshot).layout,
      view = layout.mainSidebar.view,
      query = this.sidebarQuery.toLowerCase();
    const pluginPages = this.store.catalog.filter(
      (p) =>
        !['none', 'unknown'].includes(p.ui.detection) &&
        (!query || `${p.title} ${p.description ?? ''}`.toLowerCase().includes(query)),
    );
    const custom = this.uiContributions.find(
      (v) =>
        v.surface === 'mainSidebar' &&
        layout.mainSidebar.selectedView?.kind === 'plugin' &&
        v.pluginId === layout.mainSidebar.selectedView.pluginId &&
        v.id === layout.mainSidebar.selectedView.viewId,
    );
    if (custom) {
      return html`<aside class="main-sidebar" data-visible=${this.visible('main')}>
        <div
          class="resize-handle main-resize"
          data-resize-key="main"
          ?data-resize-active=${this.resizeHighlighted('main')}
          role="separator"
          tabindex="0"
          aria-label="调整主侧栏宽度"
          aria-orientation="vertical"
          @pointerdown=${(e: PointerEvent) => this.resize(e, 'main')}
          @keydown=${(e: KeyboardEvent) =>
            this.resizeKey(e, 'main', layout.mainSidebar.side === 'left' ? 1 : -1)}
        ></div>
        <div class="sidebar-header"><strong>${custom.title}</strong></div>
        <wb-declarative-view
          .store=${this.store}
          .pool=${this.pool}
          .pluginId=${custom.pluginId}
          surface="mainSidebar"
          .viewId=${custom.id}
          .sourceTabId=${this.current?.kind === 'plugin' &&
          this.current.pluginId === custom.pluginId
            ? this.current.id
            : null}
        ></wb-declarative-view>
      </aside>`;
    }
    return html`<aside
      class="main-sidebar"
      data-visible=${this.visible('main')}
      aria-label="主侧栏"
      @pointerdown=${(e: PointerEvent) => {
        if (!(e.target as HTMLElement).closest('[data-resize-key]')) {
          this.recordFocus({ kind: 'sidebar', view });
        }
      }}
    >
      <div
        class="resize-handle main-resize"
        data-resize-key="main"
        ?data-resize-active=${this.resizeHighlighted('main')}
        role="separator"
        tabindex="0"
        aria-label="调整主侧栏宽度"
        aria-orientation="vertical"
        @pointerdown=${(e: PointerEvent) => this.resize(e, 'main')}
        @keydown=${(e: KeyboardEvent) =>
          this.resizeKey(e, 'main', layout.mainSidebar.side === 'left' ? 1 : -1)}
      ></div>
      <div class="sidebar-header">
        <strong>${viewNames[view]}</strong>
        <div>
          ${iconButton('external', '在中心打开', () =>
            this.act(() =>
              view === 'pages' ? this.openInternal('pages') : this.openInternal(view),
            ),
          )}${iconButton('more', '侧栏布局选项', () => {
            const trigger = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined,
              rect = (trigger ?? this).getBoundingClientRect();
            this.menu = {
              x: rect.left,
              y: rect.bottom,
              trigger,
              items: [
                this.menuAction('swapSidebars'),
                this.menuAction('sidebar'),
                this.menuAction('resetLayout'),
              ],
            };
          })}
        </div>
      </div>
      <div class="sidebar-search">
        ${icon('search')}<input
          aria-label=${`搜索${viewNames[view]}`}
          placeholder=${view === 'search' ? '搜索页面与插件内容…' : `筛选${viewNames[view]}…`}
          .value=${live(this.sidebarQuery)}
          @input=${(e: Event) => {
            this.sidebarQuery = (e.target as HTMLInputElement).value;
            if (view === 'search') {
              this.setSearch(this.sidebarQuery);
            }
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && view === 'search') {
              this.act(() => this.openInternal('search'));
            }
          }}
        />
        ${view === 'bookmarks'
          ? bookmarkFolderButton(this.store, (id, args) => this.act(() => this.command(id, args)))
          : nothing}
      </div>
      <div class="sidebar-content" tabindex="-1">
        ${view === 'pages'
          ? html`<section
                class="sidebar-section"
                style=${this.openPagesCollapsed
                  ? 'flex:0 0 auto'
                  : this.pluginPagesCollapsed
                    ? 'flex:1'
                    : `flex:0 0 ${layout.mainSidebar.openPagesRatio * 100}%`}
              >
                <div class="section-heading">
                  ${iconButton(
                    this.openPagesCollapsed ? 'chevron-right' : 'chevron-down',
                    '折叠或展开打开的页面',
                    () => {
                      this.openPagesCollapsed = !this.openPagesCollapsed;
                    },
                  )}打开的页面<span class="badge">${this.snapshot.tabs.length}</span>
                </div>
                <wb-scroll-container
                  class="sidebar-section-body"
                  ?hidden=${this.openPagesCollapsed}
                >
                  ${groups(this.snapshot.layout.center).map(
                    (g, index) =>
                      html`<div
                          class="group-label"
                          @dragover=${(e: DragEvent) => this.sidebarDragOver(e)}
                          @drop=${(e: DragEvent) => this.sidebarDropTab(e, g)}
                        >
                          分组 ${index + 1}
                        </div>
                        ${g.tabIds
                          .map((id) => this.snapshot.tabs.find((t) => t.id === id))
                          .filter((t): t is Tab => Boolean(t))
                          .filter((t) => !query || titleOf(t).toLowerCase().includes(query))
                          .map(
                            (tab) =>
                              html`<div
                                class="sidebar-list-item"
                                draggable="true"
                                @dragstart=${(e: DragEvent) => {
                                  this.startTabDrag(e, tab.id);
                                }}
                                @dragend=${() => this.endTabDrag()}
                                @dragover=${(e: DragEvent) => this.sidebarDragOver(e, true)}
                                @dragleave=${(e: DragEvent) => {
                                  if (
                                    !(e.currentTarget as HTMLElement).contains(
                                      e.relatedTarget as Node,
                                    )
                                  ) {
                                    this.sidebarDrop?.removeAttribute('data-tab-drop');
                                  }
                                }}
                                @drop=${(e: DragEvent) => this.sidebarDropTab(e, g, tab.id)}
                                aria-selected=${this.current?.id === tab.id}
                                @contextmenu=${(e: MouseEvent) => this.tabMenu(e, tab, g)}
                              >
                                <button
                                  class="list-main"
                                  @click=${() => this.act(() => this.command('focusTab', tab.id))}
                                >
                                  ${icon(
                                    tab.kind === 'plugin' ? 'pages' : tab.page,
                                  )}<span>${titleOf(tab)}</span>${tab.pinned
                                    ? icon('pin')
                                    : nothing}</button
                                >${iconButton('close', `关闭 ${titleOf(tab)}`, () =>
                                  this.act(() => this.close([tab.id], true)),
                                )}
                              </div>`,
                          )}`,
                  )}
                </wb-scroll-container>
              </section>
              <div
                class="sidebar-splitter"
                ?hidden=${this.openPagesCollapsed || this.pluginPagesCollapsed}
                data-resize-key="sidebar-split"
                ?data-resize-active=${this.resizeHighlighted('sidebar-split')}
                role="separator"
                tabindex="0"
                aria-label="调整打开页面与插件列表比例"
                aria-orientation="horizontal"
                @pointerdown=${(e: PointerEvent) => this.resize(e, 'sidebar-split')}
                @keydown=${(e: KeyboardEvent) => this.resizeKey(e, 'sidebar-split')}
              ></div>
              <section
                class="sidebar-section plugin-section"
                style=${this.pluginPagesCollapsed ? 'flex:0 0 auto' : ''}
              >
                <div class="section-heading">
                  ${iconButton(
                    this.pluginPagesCollapsed ? 'chevron-right' : 'chevron-down',
                    '折叠或展开插件页面',
                    () => {
                      this.pluginPagesCollapsed = !this.pluginPagesCollapsed;
                    },
                  )}插件页面<span class="badge">${pluginPages.length}</span
                  ><span class="spacer"></span>${iconButton('refresh', '重新扫描插件目录', () =>
                    this.act(() => this.command('rescan')),
                  )}
                </div>
                <wb-scroll-container
                  class="sidebar-section-body"
                  ?hidden=${this.pluginPagesCollapsed}
                >
                  ${pluginPages.map(
                    (p) =>
                      html`<div class="sidebar-plugin">
                        <button
                          class="list-main"
                          ?disabled=${p.runtime.status !== 'ready' || p.ui.state !== 'ready'}
                          @click=${() => this.act(() => this.openPlugin(p))}
                        >
                          <span
                            ><strong>${p.title}</strong
                            ><small
                              >${p.runtime.pid !== null
                                ? `PID ${p.runtime.pid} · `
                                : ''}${runtimeNames[p.runtime.status] ?? p.runtime.status}</small
                            ></span
                          ></button
                        ><i class=${`dot ${runtimeClass(p.runtime.status)}`}></i>${iconButton(
                          'more',
                          `${p.title} 的操作`,
                          () => this.openPluginMenu(p),
                        )}
                        ${pluginOpenButtons(
                          p,
                          (id, args) => this.act(() => this.command(id, args)),
                          true,
                        )}
                      </div>`,
                  )}${!pluginPages.length
                    ? html`<div class="sidebar-empty">
                        暂无已确认的插件页面。<button
                          class="text-button"
                          @click=${() => this.act(() => this.openInternal('plugins'))}
                        >
                          打开插件管理 ${icon('arrow')}
                        </button>
                      </div>`
                    : nothing}${this.store.cursors.catalog
                    ? html`<button
                        class="text-button"
                        @click=${() => this.act(() => this.store.loadList('catalog', true))}
                      >
                        加载更多插件
                      </button>`
                    : nothing}
                </wb-scroll-container>
              </section>`
          : nothing}
        ${view === 'plugins'
          ? html`<wb-scroll-container class="sidebar-section-body sidebar-cards">
              ${this.store.catalog
                .filter((p) => `${p.title} ${p.pluginId}`.toLowerCase().includes(query))
                .map((p) =>
                  pluginCard(p, (id, args) => this.act(() => this.command(id, args)), true),
                )}
            </wb-scroll-container>`
          : nothing}
        ${view === 'bookmarks'
          ? html`<wb-scroll-container
              class="sidebar-section-body"
              @click=${(e: MouseEvent) => {
                if (e.target === e.currentTarget) {
                  (e.currentTarget as HTMLElement)
                    .querySelector<HTMLElement>('.bookmark-tree')
                    ?.focus();
                }
              }}
            >
              ${bookmarkList(
                this.store,
                (id, args) => this.act(() => this.command(id, args)),
                query,
                true,
              )}${this.store.cursors.bookmarks
                ? html`<button
                    class="text-button"
                    @click=${() => this.act(() => this.store.loadList('bookmarks', true))}
                  >
                    加载更多
                  </button>`
                : nothing}
            </wb-scroll-container>`
          : nothing}
        ${view === 'history'
          ? html`<wb-scroll-container class="sidebar-section-body">
              ${this.store.history
                .filter((h) => `${titleOf(h.tab)} ${h.tab.url}`.toLowerCase().includes(query))
                .map(
                  (h) =>
                    html`<button
                      class="history-item"
                      title=${h.tab.url}
                      @click=${() => this.act(() => this.command('restoreHistory', h))}
                    >
                      ${icon('history')}<span
                        ><strong>${titleOf(h.tab)}</strong
                        ><small
                          >${new Date(h.closedAt).toLocaleString()}${h.restoredAt
                            ? ' · 已恢复'
                            : ''}</small
                        ></span
                      >${icon('back')}
                    </button>`,
                )}${!this.store.history.length
                ? html`<div class="sidebar-empty">暂无关闭的插件标签。</div>`
                : nothing}${this.store.cursors.history
                ? html`<button
                    class="text-button"
                    @click=${() => this.act(() => this.store.loadList('history', true))}
                  >
                    加载更多
                  </button>`
                : nothing}
            </wb-scroll-container>`
          : nothing}
        ${view === 'search'
          ? html`<wb-scroll-container class="sidebar-section-body">
              ${this.renderSearchResults(this.sidebarQuery, true)}
            </wb-scroll-container>`
          : nothing}
      </div>
      <div class="sidebar-footer"></div>
    </aside>`;
  }
  private clearSidebarDrop() {
    this.sidebarDrop?.removeAttribute('data-tab-drop');
    this.sidebarDrop = undefined;
    this.dragTab = '';
  }
  private sidebarDragOver(e: DragEvent, row = false) {
    if (!this.dragTab) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.clearCenterDrop();
    this.sidebarDrop?.removeAttribute('data-tab-drop');
    const target = e.currentTarget as HTMLElement;
    this.sidebarDrop = target;
    target.dataset.tabDrop =
      row &&
      e.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2
        ? 'after'
        : 'before';
  }
  private sidebarDropTab(e: DragEvent, group: Group, target?: string) {
    e.preventDefault();
    e.stopPropagation();
    const source = this.dragTab;
    const after = this.sidebarDrop?.dataset.tabDrop === 'after';
    const remaining = group.tabIds.filter((id) => id !== source);
    const index = target ? remaining.indexOf(target) + Number(after) : remaining.length;
    this.endTabDrag();
    if (source && source !== target) {
      this.act(() => this.store.update((s) => moveTab(s, source, group.id, index)));
    }
  }
  private clearCenterDrop() {
    this.centerDrop?.element.removeAttribute('data-tab-drop');
    this.centerDrop = undefined;
  }
  private endTabDrag() {
    this.clearCenterDrop();
    this.clearSidebarDrop();
    this.classList.remove('tab-dragging');
  }
  private startTabDrag(event: DragEvent, id: string) {
    this.endTabDrag();
    this.dragTab = id;
    event.dataTransfer?.setData('text/x-scwc-tab', id);
    this.classList.add('tab-dragging');
  }
  private orderedTabs(group: Group) {
    return [...group.tabIds].sort(
      (a, b) =>
        Number(this.snapshot.tabs.find((tab) => tab.id === b)?.pinned) -
        Number(this.snapshot.tabs.find((tab) => tab.id === a)?.pinned),
    );
  }
  private centerDragOver(event: DragEvent, group: Group, targetId?: string) {
    this.clearCenterDrop();
    const source = this.snapshot.tabs.find((tab) => tab.id === this.dragTab);
    if (!source) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sidebarDrop?.removeAttribute('data-tab-drop');
    this.sidebarDrop = undefined;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (source.id === targetId) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const bar = target.closest<HTMLElement>('.tab-bar') ?? target;
    const ids = this.orderedTabs(group).filter((id) => id !== source.id);
    const rect = target.getBoundingClientRect();
    const vertical = ['left', 'right'].includes(group.tabBarPosition);
    const after = vertical
      ? event.clientY >= rect.top + rect.height / 2
      : event.clientX >= rect.left + rect.width / 2;
    let index = targetId ? ids.indexOf(targetId) + Number(after) : ids.length;
    // 插入线与固定标签始终排在前面的实际渲染顺序一致。
    const pinned = ids.filter(
      (id) => this.snapshot.tabs.find((tab) => tab.id === id)?.pinned,
    ).length;
    index = source.pinned ? Math.min(index, pinned) : Math.max(index, pinned);
    const anchorId = ids[index] ?? ids[ids.length - 1];
    const element =
      [...bar.querySelectorAll<HTMLElement>('.tab-item')].find(
        (tab) => tab.dataset.tabId === anchorId,
      ) ?? bar;
    element.dataset.tabDrop = index < ids.length ? 'before' : 'after';
    this.centerDrop = { element, groupId: group.id, index };
  }
  private centerDropTab(event: DragEvent, group: Group, targetId?: string) {
    this.centerDragOver(event, group, targetId);
    event.preventDefault();
    event.stopPropagation();
    const source = this.dragTab;
    const drop = this.centerDrop;
    this.endTabDrag();
    if (source && drop?.groupId === group.id) {
      this.act(() =>
        this.store.update((s) => {
          const destination = findGroup(s, group.id);
          destination.tabIds = this.orderedTabs(destination);
          moveTab(s, source, group.id, drop.index);
        }),
      );
    }
  }
  private renderNode(node: LayoutNode, width: number, height: number): unknown {
    if (node.kind === 'split') {
      if (this.focusedOnly) {
        return this.renderNode(findGroup(this.snapshot), width, height);
      }
      const horizontal = node.axis === 'horizontal';
      const sizes = splitExtent(
        node,
        horizontal ? width : height,
        this.layoutMetrics().splitterSize,
        this.splitExtents.get(node.id),
        this.splitExtents,
      );
      this.splitExtents.set(node.id, sizes);
      const second = sizes.available - sizes.first;
      return html`<div class=${`center-split ${node.axis}`} data-split=${node.id}>
        <div class="split-child" style=${`flex:0 0 ${sizes.first}px`}>
          ${this.renderNode(
            node.first,
            horizontal ? sizes.first : width,
            horizontal ? height : sizes.first,
          )}
        </div>
        <div
          class=${`center-splitter ${node.axis}`}
          data-resize-key="split"
          data-resize-node=${node.id}
          ?data-resize-active=${this.resizeHighlighted('split', node.id)}
          role="separator"
          tabindex="0"
          aria-label="调整页面分组比例"
          aria-orientation=${node.axis === 'horizontal' ? 'vertical' : 'horizontal'}
          @pointerdown=${(e: PointerEvent) => this.resize(e, 'split', node.id)}
          @keydown=${(e: KeyboardEvent) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault();
              this.act(() =>
                this.store.update((s) => {
                  s.layout.center = visit(s.layout.center, (n) =>
                    n.kind === 'split' && n.id === node.id
                      ? {
                          ...n,
                          ratio: Math.max(
                            minimumNode(n.first, this.layoutMetrics().splitterSize)[
                              horizontal ? 'width' : 'height'
                            ] / sizes.available,
                            Math.min(
                              1 -
                                minimumNode(n.second, this.layoutMetrics().splitterSize)[
                                  horizontal ? 'width' : 'height'
                                ] /
                                  sizes.available,
                              sizes.first / sizes.available +
                                (['ArrowRight', 'ArrowDown'].includes(e.key) ? 16 : -16) /
                                  sizes.available,
                            ),
                          ),
                        }
                      : n,
                  );
                }),
              );
            }
          }}
        ></div>
        <div class="split-child" style=${`flex:0 0 ${second}px`}>
          ${this.renderNode(node.second, horizontal ? second : width, horizontal ? height : second)}
        </div>
      </div>`;
    }
    const active = this.snapshot.tabs.find((t) => t.id === node.activeTabId);
    const focused = node.id === this.snapshot.layout.focusedGroupId;
    return html`<section
      class="center-group"
      data-position=${node.tabBarPosition}
      data-group=${node.id}
      aria-label="页面分组"
      @pointerdown=${() => {
        this.inspectedTab = undefined;
        if (active) {
          this.recordFocus({ kind: 'tab', id: active.id });
        }
        if (!focused) {
          this.act(() =>
            this.store.update((s) => {
              if (active) {
                focusTab(s, active.id);
              } else {
                s.layout.focusedGroupId = node.id;
              }
            }),
          );
        }
      }}
      @dragover=${(e: DragEvent) => {
        this.clearCenterDrop();
        if (this.dragTab) {
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
        }
      }}
      @drop=${(e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.dragTab) {
          const source = this.dragTab;
          this.act(() => this.store.update((s) => moveTab(s, source, node.id)));
        }
        this.endTabDrag();
      }}
    >
      <div class="group-tab-strip">
        <wb-scroll-container
          class="tab-bar"
          thin
          wheel-direction=${['left', 'right'].includes(node.tabBarPosition)
            ? 'vertical'
            : 'horizontal'}
          shift-wheel-direction=${['left', 'right'].includes(node.tabBarPosition)
            ? 'vertical'
            : 'horizontal'}
          role="tablist"
          aria-label="页面标签"
          aria-orientation=${['left', 'right'].includes(node.tabBarPosition)
            ? 'vertical'
            : 'horizontal'}
          @dragover=${(e: DragEvent) => this.centerDragOver(e, node)}
          @drop=${(e: DragEvent) => this.centerDropTab(e, node)}
          @dragleave=${(e: DragEvent) => {
            if (
              !(e.relatedTarget instanceof Node) ||
              !(e.currentTarget as Node).contains(e.relatedTarget)
            ) {
              this.clearCenterDrop();
            }
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)
            ) {
              return;
            }
            e.preventDefault();
            const current = node.tabIds.indexOf(node.activeTabId ?? '');
            const index =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? node.tabIds.length - 1
                  : (current +
                      (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) +
                      node.tabIds.length) %
                    node.tabIds.length;
            this.act(() => this.command('focusTab', node.tabIds[index]));
          }}
        >
          ${repeat(
            this.orderedTabs(node),
            (id) => id,
            (id) => {
              const tab = this.snapshot.tabs.find((t) => t.id === id);
              if (!tab) {
                return nothing;
              }
              const runtime = this.pool?.runtimes.get(id);
              return html`<div
                class="tab-item"
                role="tab"
                data-tab-id=${tab.id}
                data-pinned=${tab.pinned}
                title=${tab.kind === 'plugin' ? `${titleOf(tab)}\n${tab.url}` : titleOf(tab)}
                aria-selected=${id === node.activeTabId}
                tabindex=${id === node.activeTabId ? 0 : -1}
                draggable="true"
                @dragstart=${(e: DragEvent) => {
                  this.startTabDrag(e, id);
                }}
                @dragend=${() => {
                  this.endTabDrag();
                }}
                @dragover=${(e: DragEvent) => {
                  this.centerDragOver(e, node, id);
                }}
                @drop=${(e: DragEvent) => {
                  this.centerDropTab(e, node, id);
                }}
                @click=${() => this.act(() => this.command('focusTab', id))}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.act(() => this.command('focusTab', id));
                  }
                }}
                @auxclick=${(e: MouseEvent) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    this.act(() => this.close([id], true));
                  }
                }}
                @contextmenu=${(e: MouseEvent) => this.tabMenu(e, tab, node)}
              >
                ${icon(
                  tab.kind === 'plugin'
                    ? runtime?.state === 'navigating'
                      ? 'loading'
                      : 'pages'
                    : tab.page,
                )}<span class="tab-label">${titleOf(tab)}</span>${runtime?.dirty
                  ? html`<span class="dirty-indicator" title="有未保存更改"></span>`
                  : nothing}<button
                  class="tab-close"
                  aria-label=${`关闭 ${titleOf(tab)}`}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.act(() => this.close([id], true));
                  }}
                >
                  ${icon('close')}
                </button>
              </div>`;
            },
          )}
        </wb-scroll-container>
        <div class="tab-bar-actions">
          ${!node.tabIds.length && groups(this.snapshot.layout.center).length > 1
            ? iconButton('close', '关闭空分组', () =>
                this.act(() => this.store.update(pruneEmptyGroups)),
              )
            : nothing}
          ${iconButton('split', '向右拆分', () =>
            this.act(() => this.command('splitRight', node.id)),
          )}${iconButton('more', '分组操作', () => {
            const trigger = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined,
              rect = (trigger ?? this).getBoundingClientRect();
            this.menu = {
              x: rect.left,
              y: rect.bottom,
              trigger,
              items: [
                this.menuAction('splitRight', undefined, node.id),
                this.menuAction('splitDown', undefined, node.id),
                this.menuAction('equalize'),
                this.menuAction('merge'),
                {
                  kind: 'submenu',
                  id: 'tab-position',
                  label: '标签栏位置',
                  children: ['top', 'bottom', 'left', 'right'].map((position, i) => ({
                    kind: 'action',
                    id: position,
                    label: ['顶部', '底部', '左侧', '右侧'][i],
                    action: () =>
                      this.store.update((s) => {
                        findGroup(s, node.id).tabBarPosition = position as Group['tabBarPosition'];
                      }),
                  })),
                },
              ],
            };
          })}
        </div>
      </div>
      <div class="page-viewport">
        <div class="page-container" data-page-slot=${node.id}>
          ${!active
            ? html`<div class="empty empty-group">
                ${icon('pages')}
                <p>打开一个页面开始工作</p>
                <div class="btn-group">
                  <button
                    class="btn primary"
                    @click=${() => this.act(() => this.command('plugins'))}
                  >
                    浏览插件</button
                  ><button
                    class="btn secondary"
                    @click=${() => this.act(() => this.command('quickOpen'))}
                  >
                    快速访问 <kbd>F1</kbd>
                  </button>
                </div>
              </div>`
            : active.kind === 'internal'
              ? active.page === 'search'
                ? html`<wb-scroll-container class="internal-scroll"
                    ><div class="internal-view search-view">
                      <div class="page-heading">
                        <span class="eyebrow">SEARCH</span>
                        <h1>搜索工作台</h1>
                        <p>查找页面、收藏与在线插件内容。</p>
                      </div>
                      <div class="page-search">
                        ${icon('search')}<input
                          aria-label="搜索工作台"
                          placeholder="输入关键词…"
                          .value=${live(this.searchQuery)}
                          @input=${(e: Event) =>
                            this.setSearch((e.target as HTMLInputElement).value)}
                        />
                      </div>
                      <label class="search-scope"
                        ><input
                          type="checkbox"
                          .checked=${this.searchCurrent}
                          @change=${(e: Event) => {
                            this.searchCurrent = (e.target as HTMLInputElement).checked;
                            this.setSearch(this.searchQuery);
                          }}
                        />仅搜索最近激活的插件页内容</label
                      >${this.renderSearchResults(this.searchQuery)}
                    </div></wb-scroll-container
                  >`
                : html`<wb-internal-page
                    .store=${this.store}
                    .page=${active.page}
                  ></wb-internal-page>`
              : this.renderPageState(active)}
        </div>
      </div>
    </section>`;
  }
  private renderPageState(tab: PluginTab) {
    const plugin = this.store.catalog.find((p) => p.pluginId === tab.pluginId),
      r = this.pool?.runtimes.get(tab.id);
    if (plugin?.runtime.status !== 'ready' || plugin.ui.state !== 'ready') {
      return html`<div class="empty">
        <div class="large-icon">${icon('plugins')}</div>
        <h2>${titleOf(tab)}</h2>
        <p>
          ${plugin
            ? (runtimeNames[plugin.runtime.status] ?? '插件页面不可用')
            : '插件不在当前目录中'}
        </p>
        <p class="muted">逻辑标签与保存的状态仍然保留。</p>
        ${plugin
          ? html`<button
              class="btn primary"
              @click=${() =>
                this.act(() =>
                  this.store.pluginAction(
                    plugin.pluginId,
                    plugin.runtime.status === 'ready' ? 'build-ui' : 'enable',
                  ),
                )}
            >
              ${plugin.runtime.status === 'ready' ? '构建页面' : '启用插件'}
            </button>`
          : nothing}
      </div>`;
    }
    if (!r) {
      return html`<div class="empty">
        <div class="large-icon">${icon('sleep')}</div>
        <h2>页面已休眠</h2>
        <p>唤醒后将重新连接并恢复可用状态。</p>
        <button class="btn primary" @click=${() => this.pool?.wake(tab.id)}>唤醒页面</button>
      </div>`;
    }
    if (r.state === 'bridge-unavailable') {
      return html`<div class="compatibility-banner">
        ${icon('info')}兼容模式：页面桥接尚未就绪。<button
          class="text-button"
          @click=${() => this.act(() => this.command('refresh', { tabId: tab.id }))}
        >
          重新连接
        </button>
      </div>`;
    }
    if (['error', 'restore-error'].includes(r.state)) {
      return html`<div class="page-state-overlay">
        <div class="empty">
          <h2>页面需要处理</h2>
          <p class="error">${r.error ?? '加载失败'}</p>
          <div class="btn-group">
            <button class="btn secondary" @click=${() => this.act(() => this.command('export'))}>
              导出草稿</button
            ><button class="btn primary" @click=${() => this.pool?.refresh(tab.id)}>
              重新加载
            </button>
          </div>
        </div>
      </div>`;
    }
    return nothing;
  }
  private renderPanel() {
    const panel = (this.resizeSnapshot ?? this.snapshot).layout.panel,
      visible = this.visible('panel');
    const geometry = this.geometry();
    const panelHeight = this.panelMaximized
      ? geometry.bodyHeight
      : panel.dock === 'bottom'
        ? geometry.panelHeight
        : geometry.bodyHeight;
    const panelMinimum = MIN_PANEL_WIDTH;
    const panelWidth = this.panelMaximized
      ? panel.align === 'full'
        ? geometry.shellWidth - this.layoutMetrics().activityWidth
        : geometry.centerWidth + geometry.panelWidth
      : panel.dock === 'bottom'
        ? panel.align === 'full'
          ? geometry.shellWidth - this.layoutMetrics().activityWidth
          : geometry.centerWidth
        : geometry.panelWidth;
    const panelElement = this.renderRoot.querySelector('.bottom-panel');
    const panelStyle = panelElement && getComputedStyle(panelElement);
    const border = (value: string | undefined) => Number.parseFloat(value ?? '') || 0;
    const borderWidth = border(panelStyle?.borderLeftWidth) + border(panelStyle?.borderRightWidth);
    const borderHeight = border(panelStyle?.borderTopWidth) + border(panelStyle?.borderBottomWidth);
    const records = (this.store.outputs.get('public') ?? []).filter(
      (r) =>
        (this.outputFilter === 'all' || r.level === this.outputFilter) &&
        (!this.outputQuery || r.text.toLowerCase().includes(this.outputQuery.toLowerCase())),
    );
    return html`<section
      class=${`bottom-panel ${this.panelMaximized ? 'panel-maximized' : ''}`}
      data-visible=${visible}
      data-dock=${panel.dock}
      aria-label="输出与终端面板"
      @pointerdown=${(e: PointerEvent) => {
        if (
          panel.activeView === 'output' &&
          !(e.target as HTMLElement).closest('[data-resize-key]')
        ) {
          this.recordFocus({ kind: 'panel', view: 'output' });
        }
      }}
    >
      <div
        class=${`resize-handle panel-resize ${panel.dock}`}
        data-resize-key="panel"
        ?data-resize-active=${this.resizeHighlighted('panel')}
        role="separator"
        tabindex="0"
        aria-label="调整面板尺寸"
        aria-orientation=${panel.dock === 'bottom' ? 'horizontal' : 'vertical'}
        @pointerdown=${(e: PointerEvent) => this.resize(e, 'panel')}
        @keydown=${(e: KeyboardEvent) => this.resizeKey(e, 'panel')}
      ></div>
      <wb-scroll-container
        drag-only
        class="panel-scroll"
        wheel-direction="none"
        shift-wheel-direction="none"
      >
        <div
          class="panel-canvas"
          style=${styleMap({
            width: `${Math.max(panelMinimum, panelWidth - borderWidth)}px`,
            height: `${Math.max(MIN_PANEL_HEIGHT, panelHeight) - borderHeight}px`,
          })}
        >
          <div class="panel-tab-bar">
            <div class="panel-tabs" role="tablist" @keydown=${tabNavigation}>
              ${[
                ['output', '输出'],
                ['terminal', '终端'],
              ].map(
                ([id, label]) =>
                  html`<button
                    role="tab"
                    tabindex=${panel.activeView === id ? 0 : -1}
                    aria-selected=${panel.activeView === id}
                    @click=${() => this.act(() => this.selectPanel(id as 'output' | 'terminal'))}
                  >
                    ${icon(id)}${label}${id === 'terminal' &&
                    this.store.terminals.filter((t) => !t.archivedAt).length
                      ? html`<span class="badge"
                          >${this.store.terminals.filter((t) => !t.archivedAt).length}</span
                        >`
                      : nothing}
                  </button>`,
              )}
            </div>
            <div class="panel-actions">
              ${panel.activeView === 'terminal' &&
              this.store.terminals.filter((t) => !t.archivedAt).length === 1
                ? iconButton('trash', '关闭当前终端', () =>
                    this.act(() => this.command('closeTerminal')),
                  )
                : nothing}
              ${iconButton('plus', '新建命令终端', () =>
                this.act(() => this.command('newTerminal')),
              )}${iconButton(
                this.panelMaximized ? 'collapse' : 'expand',
                '最大化 / 还原面板',
                () => {
                  this.panelMaximized = !this.panelMaximized;
                },
              )}${iconButton('more', '面板停靠选项', () => {
                const trigger = this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined,
                  rect = (trigger ?? this).getBoundingClientRect();
                this.menu = {
                  x: rect.left,
                  y: rect.bottom,
                  trigger,
                  items: [
                    ...(['bottom', 'left', 'right'] as const).map((dock, i) => ({
                      kind: 'checkbox' as const,
                      id: dock,
                      label: ['停靠底部', '停靠左侧', '停靠右侧'][i],
                      checked: panel.dock === dock,
                      action: () =>
                        this.store.update((s) => {
                          s.layout.panel.dock = dock;
                        }),
                    })),
                    {
                      kind: 'checkbox',
                      id: 'panel-align',
                      label: '全宽对齐',
                      checked: panel.align === 'full',
                      action: () =>
                        this.store.update((s) => {
                          s.layout.panel.align =
                            s.layout.panel.align === 'full' ? 'center' : 'full';
                        }),
                    },
                  ],
                };
              })}${iconButton('close', '隐藏面板', () => this.act(() => this.command('panel')))}
            </div>
          </div>
          <div class="panel-content" ?hidden=${panel.activeView !== 'output'}>
            <div class="output-view">
              <div class="output-toolbar">
                <label class="output-channel">${icon('output')}公共输出</label
                ><span class="spacer"></span
                ><input
                  aria-label="搜索公共输出"
                  placeholder="筛选输出…"
                  .value=${live(this.outputQuery)}
                  @input=${(e: Event) => (this.outputQuery = (e.target as HTMLInputElement).value)}
                /><select
                  aria-label="输出级别"
                  .value=${this.outputFilter}
                  @change=${(e: Event) =>
                    (this.outputFilter = (e.target as HTMLSelectElement).value)}
                >
                  <option value="all">全部级别</option>
                  <option value="info">信息</option>
                  <option value="warn">警告</option>
                  <option value="error">错误</option></select
                >${iconButton(
                  this.outputPaused ? 'play' : 'sleep',
                  this.outputPaused ? '恢复显示' : '暂停自动显示',
                  () => {
                    this.outputPaused = !this.outputPaused;
                    if (this.outputPaused) {
                      this.pausedRecords = [...records];
                    }
                  },
                )}${iconButton('copy', '复制当前输出', () =>
                  this.act(() =>
                    navigator.clipboard.writeText(records.map((r) => r.text).join('\n')),
                  ),
                )}
              </div>
              <wb-scroll-container
                class="output-content"
                scroll-behavior="instant"
                line-scroll
                whole-lines
                role="log"
                tabindex="0"
                aria-label="公共输出"
                @scroll=${(event: Event) => {
                  if (event.target !== event.currentTarget) {
                    return;
                  }
                  const output = (event.currentTarget as WorkbenchScrollContainer).scrollElement;
                  if (output && output.clientHeight > 0) {
                    this.followOutput =
                      output.scrollHeight - output.scrollTop - output.clientHeight <= 2;
                  }
                }}
                @focus=${() => this.recordFocus({ kind: 'panel', view: 'output' })}
              >
                ${this.store.outputGaps.has('public')
                  ? html`<p class="notice">更早的输出已截断。</p>`
                  : nothing}${!records.length
                  ? html`<div class="empty compact">
                      <p>暂无公共输出</p>
                      <span>核心与插件后台日志将在这里显示。</span>
                    </div>`
                  : repeat(
                      terminalRows(this.outputPaused ? this.pausedRecords : records),
                      (r) => r.seq,
                      (r) =>
                        html`<div class="output-line">
                          <time>${new Date(r.timestamp).toLocaleTimeString()}</time>
                          <span class=${`level ${r.level ?? 'info'}`}>${r.level ?? 'info'}</span>
                          <span class="output-text"
                            >${r.segments.map(
                              (segment) =>
                                html`<span style=${styleMap(segment.style)}>${segment.text}</span>`,
                            )}</span
                          >
                        </div>`,
                    )}
              </wb-scroll-container>
            </div>
          </div>
          <div class="panel-content terminal-panel" ?hidden=${panel.activeView !== 'terminal'}>
            <wb-terminal .store=${this.store}></wb-terminal>
          </div>
        </div>
      </wb-scroll-container>
    </section>`;
  }
  private renderStatus() {
    const tab = this.current,
      plugin =
        tab?.kind === 'plugin'
          ? this.store.catalog.find((p) => p.pluginId === tab.pluginId)
          : undefined,
      runtime = tab && this.pool?.runtimes.get(tab.id);
    const unread = this.store.notificationItems.filter((n) => !n.readAt).length;
    return html`<footer class="status-bar">
      <div class="status-bar-left">
        <button
          class="status-item"
          title="连接状态"
          @click=${() => this.act(() => this.store.reconnect())}
        >
          <i
            class=${`dot ${this.store.connection === 'connected' ? 'success' : this.store.connection === 'connecting' ? 'warn' : 'error'}`}
          ></i
          ><span
            >${this.store.connection === 'connected'
              ? '已连接'
              : this.store.connection === 'connecting'
                ? '连接中'
                : '已断开'}</span
          ></button
        >${plugin
          ? html`<span class="status-plugin"
              >${icon('plugins')}${plugin.title}${plugin.runtime.pid
                ? html`<span class="mono">PID ${plugin.runtime.pid}</span>`
                : nothing}</span
            >`
          : nothing}
      </div>
      ${this.uiContributions
        .filter((v) => v.surface === 'statusBar' && (v.alignment ?? 'left') === 'left')
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .map(
          (v) =>
            html`<wb-plugin-status
              .store=${this.store}
              .pool=${this.pool}
              .contribution=${v}
              .sourceTabId=${this.current?.kind === 'plugin' && this.current.pluginId === v.pluginId
                ? this.current.id
                : null}
            ></wb-plugin-status>`,
        )}
      <div class="status-bar-center">
        <div class="browser-controls">
          ${iconButton(
            'back',
            '后退',
            () => this.act(() => this.command('back')),
            tab?.kind !== 'plugin' || tab.navigation.index <= 0,
          )}${iconButton(
            'forward',
            '前进',
            () => this.act(() => this.command('forward')),
            tab?.kind !== 'plugin' || tab.navigation.index >= tab.navigation.entries.length - 1,
          )}${iconButton(
            runtime?.state === 'navigating' ? 'chrome-close' : 'refresh',
            runtime?.state === 'navigating' ? '停止页面加载' : '刷新页面',
            () =>
              this.act(() =>
                this.command(runtime?.state === 'navigating' ? 'stopLoading' : 'refresh'),
              ),
            tab?.kind !== 'plugin',
          )}
        </div>
        <input
          class="status-url-input"
          aria-label="当前插件 URL"
          ?disabled=${tab?.kind !== 'plugin'}
          .value=${live(
            tab?.kind === 'plugin'
              ? this.urlDraft?.tabId === tab.id
                ? this.urlDraft.display
                : this.decodedUrl(tab.url)
              : tab
                ? '内置页面'
                : '没有活动页面',
          )}
          @input=${(e: Event) => {
            if (tab?.kind !== 'plugin') {
              return;
            }
            const display = (e.currentTarget as HTMLInputElement).value;
            let encoded = display;
            try {
              encoded = new URL(display, tab.url).href;
            } catch {
              /* Keep incomplete edits. */
            }
            this.urlDraft = { tabId: tab.id, display, encoded };
          }}
          @blur=${(e: FocusEvent) => {
            const input = e.currentTarget as HTMLInputElement;
            input.value = this.decodedUrl(input.value);
            if (this.urlDraft && this.urlDraft.tabId === tab?.id) {
              this.urlDraft.display = input.value;
            }
          }}
          @copy=${(e: ClipboardEvent) => {
            const input = e.currentTarget as HTMLInputElement;
            if (
              input.selectionStart === 0 &&
              input.selectionEnd === input.value.length &&
              tab?.kind === 'plugin'
            ) {
              e.preventDefault();
              e.clipboardData?.setData(
                'text/plain',
                this.urlDraft?.tabId === tab.id && this.urlDraft.display === input.value
                  ? this.urlDraft.encoded
                  : input.value === this.decodedUrl(tab.url)
                    ? tab.url
                    : new URL(input.value, location.origin).href,
              );
            }
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && tab?.kind === 'plugin') {
              e.preventDefault();
              const input = e.currentTarget as HTMLInputElement;
              const value =
                this.urlDraft?.tabId === tab.id
                  ? this.urlDraft.encoded
                  : input.value === this.decodedUrl(tab.url)
                    ? tab.url
                    : input.value;
              this.act(() => this.navigate(tab.id, value));
            }
            if (e.key === 'Escape' && tab?.kind === 'plugin') {
              this.urlDraft = undefined;
              (e.currentTarget as HTMLInputElement).value = this.decodedUrl(tab.url);
            }
          }}
        />${iconButton(
          'copy',
          '复制当前 URL',
          () => this.act(() => this.command('copyUrl')),
          tab?.kind !== 'plugin',
        )}${iconButton(
          tab?.kind === 'plugin' &&
            this.store.bookmarks.some((b) => b.pluginId === tab.pluginId && b.url === tab.url)
            ? 'star-full'
            : 'star-empty',
          '收藏当前页面',
          () => this.act(() => this.command('bookmark')),
          tab?.kind !== 'plugin',
        )}${iconButton(
          'external',
          '在浏览器打开',
          () => this.act(() => this.command('openExternal')),
          tab?.kind !== 'plugin',
        )}
      </div>
      <div class="status-bar-right">
        ${this.uiContributions
          .filter((v) => v.surface === 'statusBar' && v.alignment === 'right')
          .map(
            (v) =>
              html`<wb-plugin-status
                .store=${this.store}
                .pool=${this.pool}
                .contribution=${v}
                .sourceTabId=${this.current?.kind === 'plugin' &&
                this.current.pluginId === v.pluginId
                  ? this.current.id
                  : null}
              ></wb-plugin-status>`,
          )}
        ${runtime
          ? html`<span class="status-runtime"
              >${pageStateNames[runtime.state] ?? runtime.state} · 已观测 ${runtime.requests}
              请求</span
            >`
          : nothing}<button
          class="status-item task-button"
          data-state=${this.store.recentJobStatus ?? 'idle'}
          aria-label=${`任务，${this.store.runningJobs.length} 个执行中，${this.store.unreadJobs.length} 个已完成未读`}
          title="任务"
          aria-expanded=${this.showJobs}
          @click=${() => (this.showJobs = !this.showJobs)}
        >
          ${icon(
            this.store.recentJobStatus === 'succeeded'
              ? 'pass'
              : this.store.recentJobStatus
                ? 'error'
                : 'tasklist',
          )}${!this.store.recentJobStatus
            ? html`<span class="task-unread-dots" aria-hidden="true">
                ${(['succeeded', 'cancelled', 'failed'] as const).map((status) =>
                  this.store.unreadJobs.some((job) => job.status === status)
                    ? html`<span class="task-unread-dot" data-status=${status}></span>`
                    : nothing,
                )}
              </span>`
            : nothing}</button
        ><button
          class="status-item notification-button"
          aria-label=${`通知，${unread} 条未读`}
          @click=${() => this.toggleNotifications()}
        >
          ${icon(unread ? 'bell-dot' : 'bell')}${unread
            ? html`<span class="badge accent">${unread}</span>`
            : nothing}
        </button>
      </div>
    </footer>`;
  }
  private closeQuick() {
    this.quickOpen = false;
    this.searcher?.cancel();
    this.quickTrigger?.focus();
  }
  private async loadMetadata(query: string, more?: 'catalog' | 'bookmarks' | 'history') {
    const prefix = query.trim()[0],
      search = (['>', '@', '*', '#'].includes(prefix) ? query.trim().slice(1) : query).trim();
    const generation = more ? this.metadataGeneration : ++this.metadataGeneration;
    if (!more) {
      this.metadataQuery = query;
      this.remoteMetadata = { catalog: [], bookmarks: [], history: [], cursors: {} };
    }
    if (!search || ['>', '@'].includes(prefix)) {
      return;
    }
    const keys = more
      ? [more]
      : prefix === '*'
        ? (['bookmarks'] as const)
        : prefix === '#'
          ? (['history'] as const)
          : (['catalog', 'bookmarks', 'history'] as const);
    await Promise.all(
      keys.map(async (key) => {
        try {
          const page = await this.store.api.list<CatalogItem | Bookmark | ClosedTab>(
            key === 'catalog' ? '/plugins' : `/${key}`,
            more ? this.remoteMetadata.cursors[key] : null,
            { search },
          );
          if (generation !== this.metadataGeneration || query !== this.metadataQuery) {
            return;
          }
          this.remoteMetadata = {
            ...this.remoteMetadata,
            [key]: more ? [...this.remoteMetadata[key], ...page.items] : page.items,
            cursors: { ...this.remoteMetadata.cursors, [key]: page.nextCursor },
          };
        } catch {
          /* A failed source does not hide local or page results. */
        }
      }),
    );
  }
  private metadataResults(query: string) {
    const trimmed = query.trim(),
      prefix = trimmed[0],
      q = (['>', '@', '*', '#'].includes(prefix) ? trimmed.slice(1) : trimmed).trim().toLowerCase();
    const results: QuickResult[] = [];
    const remote = this.metadataQuery === query ? this.remoteMetadata : undefined;
    const bookmarks = [
      ...new Map(
        [...this.store.bookmarks, ...(remote?.bookmarks ?? [])].map((b) => [b.id, b]),
      ).values(),
    ];
    const history = [
      ...new Map(
        [...this.store.history, ...(remote?.history ?? [])].map((h) => [h.closeId, h]),
      ).values(),
    ];
    const catalog = [
      ...new Map(
        [...this.store.catalog, ...(remote?.catalog ?? [])].map((p) => [p.pluginId, p]),
      ).values(),
    ];
    const match = (value: string) => !q || value.toLowerCase().includes(q);
    if (prefix === '>') {
      for (const c of commands.filter((c) => match(`${c.label} ${c.id} ${c.category}`))) {
        results.push({
          id: c.id,
          title: c.label,
          detail: `${c.category} · ${shortcut(c.id, this.store.preferences.values.keybindings)}`,
          icon: 'command',
          run: () => this.command(c.id),
        });
      }
      return results;
    }
    if (!['*', '#'].includes(prefix)) {
      for (const t of this.store.workspace?.snapshot.tabs ?? []) {
        if (
          match(`${titleOf(t)} ${t.kind === 'plugin' ? t.url : ''}`) &&
          !(t.kind === 'internal' && ['settings', 'keybindings', 'search'].includes(t.page))
        ) {
          results.push({
            id: `tab-${t.id}`,
            title: titleOf(t),
            detail: '已打开的页面',
            icon: t.kind === 'plugin' ? 'pages' : t.page,
            run: () => this.command('focusTab', t.id),
            openNew:
              t.kind === 'plugin'
                ? async (group) => {
                    const plugin = await this.store.getPlugin(t.pluginId);
                    if (!plugin) {
                      throw new Error('插件不可用');
                    }
                    return this.openPlugin(plugin, t.url, group);
                  }
                : undefined,
          });
        }
      }
    }
    if (!['@', '#'].includes(prefix)) {
      for (const b of bookmarks) {
        if (match(`${b.customTitle ?? b.originalTitle} ${b.url}`)) {
          results.push({
            id: `bookmark-${b.id}`,
            title: b.customTitle ?? b.originalTitle,
            detail: `收藏 · ${b.url}`,
            icon: 'bookmarks',
            run: () => this.command('openBookmark', b),
            openNew: async (group) => {
              const plugin = await this.store.getPlugin(b.pluginId);
              if (!plugin) {
                throw new Error('插件不可用');
              }
              return this.openPlugin(
                plugin,
                relocatedUrl(b.locator, this.store.bootstrap?.installationId ?? '', b.url),
                group,
              );
            },
          });
        }
      }
    }
    if (!['@', '*'].includes(prefix)) {
      for (const h of history) {
        if (match(`${titleOf(h.tab)} ${h.tab.url}`)) {
          results.push({
            id: `history-${h.closeId}`,
            title: titleOf(h.tab),
            detail: `关闭历史 · ${new Date(h.closedAt).toLocaleString()}`,
            icon: 'history',
            run: () => this.command('restoreHistory', h),
            openNew: async (group) => {
              await this.store.getPlugin(h.tab.pluginId);
              return this.store.restore([h.closeId], group ?? this.snapshot.layout.focusedGroupId);
            },
          });
        }
      }
    }
    if (!['@', '*', '#'].includes(prefix)) {
      for (const p of catalog) {
        if (match(`${p.title} ${p.description ?? ''} ${p.pluginId}`)) {
          results.push({
            id: `plugin-${p.pluginId}`,
            title: p.title,
            detail: `插件 · ${runtimeNames[p.runtime.status] ?? p.runtime.status}`,
            icon: 'plugins',
            openNew: (group) => this.openPlugin(p, undefined, group),
            run: () =>
              p.runtime.status === 'ready' && p.ui.state === 'ready'
                ? this.openPlugin(p)
                : this.openInternal('plugins'),
          });
        }
      }
    }
    if (trimmed.startsWith('/') || /^https?:/.test(trimmed)) {
      results.unshift({
        id: 'url',
        title: '打开此插件 URL',
        detail: trimmed,
        icon: 'link',
        run: () => this.command('openUrl', trimmed),
      });
    }
    return results;
  }
  private async runResult(result: QuickResult, event?: MouseEvent | KeyboardEvent) {
    if (result.openNew && (event?.altKey || event?.ctrlKey || event?.metaKey)) {
      if (event.altKey) {
        await this.store.update((s) => splitGroup(s, 'horizontal'));
        return result.openNew(this.snapshot.layout.focusedGroupId);
      }
      return result.openNew();
    }
    return result.run();
  }
  private setSearch(query: string) {
    this.searchQuery = query;
    clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => {
      if (/^[>@*#]/.test(query.trim())) {
        this.searcher?.cancel();
      } else {
        this.searcher?.run(
          query,
          this.searchCurrent ? (this.snapshot.focusedPluginTabId ?? undefined) : undefined,
        );
      }
      void this.loadMetadata(query);
    }, 250);
    this.requestUpdate();
  }
  private renderSearchResults(query: string, compact = false) {
    if (!query.trim()) {
      return html`<div class="sidebar-empty">
        输入关键词，搜索页面、插件、收藏与关闭历史。
        <p>使用 &gt; 执行操作，@ 查找标签，* 查找收藏，# 查找关闭历史。</p>
      </div>`;
    }
    const results = this.metadataResults(query);
    return html`<div class=${compact ? 'search-results compact-results' : 'search-results'}>
      <div class="section-heading">工作台 <span class="badge">${results.length}</span></div>
      ${results.slice(0, compact ? 20 : 100).map(
        (result) =>
          html`<button
            class="search-result"
            @click=${(e: MouseEvent) => this.act(() => this.runResult(result, e))}
          >
            ${icon(result.icon)}<span
              ><strong>${result.title}</strong><small>${result.detail}</small></span
            >${icon('arrow')}
          </button>`,
      )}${!results.length
        ? html`<div class="sidebar-empty">没有匹配的工作台记录。</div>`
        : nothing}${this.metadataQuery === query
        ? (['catalog', 'bookmarks', 'history'] as const)
            .filter((key) => this.remoteMetadata.cursors[key])
            .map(
              (key) =>
                html`<button class="text-button" @click=${() => void this.loadMetadata(query, key)}>
                  加载更多${key === 'catalog' ? '插件' : key === 'bookmarks' ? '收藏' : '历史'}结果
                </button>`,
            )
        : nothing}${this.renderOnlineSearch(query)}
    </div>`;
  }
  private renderOnlineSearch(query: string) {
    if (this.searcher?.query !== query.trim() || /^[>@*#]/.test(query.trim())) {
      return nothing;
    }
    return html`${(this.searcher?.sources ?? []).map(
      (source) =>
        html`<section class="search-source">
          <div class="section-heading">
            在线页面 ·
            ${titleOf(
              this.snapshot.tabs.find((t) => t.id === source.tabId) ?? internalTab('welcome'),
            )}${source.total !== undefined
              ? html`<span class="badge">${source.total}</span>`
              : nothing}
          </div>
          ${source.items.map(
            (item) =>
              html`<button
                class="search-result"
                @click=${() =>
                  this.act(() =>
                    item.url
                      ? this.navigate(source.tabId, item.url)
                      : this.command('focusTab', source.tabId),
                  )}
              >
                ${icon('search')}<span
                  ><strong>${item.title}</strong><small>${item.description ?? ''}</small></span
                >
              </button>`,
          )}${source.error
            ? html`<p class="notice error">${source.error}</p>`
            : nothing}${source.loading
            ? html`<p class="sidebar-empty" aria-busy="true">正在搜索…</p>`
            : !source.done
              ? html`<button class="text-button" @click=${() => void this.searcher?.more(source)}>
                  ${source.error ? '重试此来源' : '加载更多'}
                </button>`
              : !source.items.length
                ? html`<p class="sidebar-empty">该页面没有结果。</p>`
                : nothing}
        </section>`,
    )}`;
  }
  private renderQuickOpen() {
    const online: QuickResult[] =
      this.searcher?.query === this.quickQuery.trim() && !/^[>@*#]/.test(this.quickQuery.trim())
        ? (this.searcher?.sources ?? []).flatMap((source) =>
            source.items.map((item) => ({
              id: `page-${source.id}-${item.id}`,
              title: item.title,
              detail: `在线页面 · ${titleOf(this.snapshot.tabs.find((t) => t.id === source.tabId) ?? internalTab('welcome'))} · ${item.description ?? ''}`,
              icon: 'search',
              run: () =>
                item.url
                  ? this.navigate(source.tabId, item.url)
                  : this.command('focusTab', source.tabId),
            })),
          )
        : [];
    const modes: QuickResult[] = this.quickQuery.trim()
      ? []
      : [
          { prefix: '>', title: '执行操作', icon: 'command' },
          { prefix: '@', title: '查找标签', icon: 'pages' },
          { prefix: '*', title: '查找收藏', icon: 'bookmarks' },
          { prefix: '#', title: '查找关闭历史', icon: 'history' },
        ].map(({ prefix, title, icon }) => ({
          id: `mode-${prefix}`,
          title: `${prefix} ${title}`,
          detail: `输入 ${prefix} ${title}`,
          icon,
          keepOpen: true,
          run: async () => {
            this.quickOpen = true;
            this.quickQuery = prefix;
            this.quickIndex = 0;
            this.setSearch(prefix);
            await this.updateComplete;
            this.renderRoot.querySelector<HTMLInputElement>('#quick-input')?.focus();
          },
        }));
    const results = [...modes, ...this.metadataResults(this.quickQuery), ...online].slice(0, 100);
    this.quickIndex = Math.min(Math.max(0, this.quickIndex), Math.max(0, results.length - 1));
    return html`<div
      class="modal-backdrop quick-backdrop"
      @click=${(e: MouseEvent) => {
        if (e.composedPath()[0] === e.currentTarget) {
          this.closeQuick();
          this.quickTrigger?.focus();
        }
      }}
    >
      <section
        class="quick-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="快速访问"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Tab') {
            const dialog = e.currentTarget as HTMLElement,
              focusable = [
                ...dialog.querySelectorAll<HTMLElement>(
                  'input,button:not([tabindex="-1"]):not(:disabled)',
                ),
              ],
              i = focusable.indexOf(
                (this.shadowRoot ? deepActiveElement(this.shadowRoot) : undefined) ?? this,
              );
            e.preventDefault();
            focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
          }
        }}
      >
        <div class="quick-input-wrap">
          ${icon('search')}<input
            id="quick-input"
            role="combobox"
            aria-label="搜索页面、插件或操作"
            aria-expanded="true"
            aria-controls="quick-results"
            aria-activedescendant=${`quick-${this.quickIndex}`}
            placeholder="搜索页面、插件、收藏… 输入 > 执行操作"
            .value=${live(this.quickQuery)}
            @input=${(e: Event) => {
              this.quickQuery = (e.target as HTMLInputElement).value;
              this.quickIndex = 0;
              this.setSearch(this.quickQuery);
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.isComposing) {
                return;
              }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.quickIndex =
                  (this.quickIndex +
                    (e.key === 'ArrowDown' ? 1 : -1) +
                    Math.max(1, results.length)) %
                  Math.max(1, results.length);
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const result = results[this.quickIndex];
                if (result) {
                  if (!result.keepOpen) {
                    this.closeQuick();
                  }
                  this.act(() => this.runResult(result, e));
                }
              }
            }}
          /><kbd>ESC</kbd>
        </div>
        <wb-scroll-container class="quick-results" id="quick-results" role="listbox">
          ${results.map(
            (result, i) =>
              html`<button
                id=${`quick-${i}`}
                role="option"
                aria-selected=${i === this.quickIndex}
                tabindex="-1"
                class="search-result"
                @mouseenter=${() => (this.quickIndex = i)}
                @click=${(e: MouseEvent) => {
                  if (!result.keepOpen) {
                    this.closeQuick();
                  }
                  this.act(() => this.runResult(result, e));
                }}
              >
                ${icon(result.icon)}<span
                  ><strong>${result.title}</strong><small>${result.detail}</small></span
                >${i === this.quickIndex ? icon('arrow') : nothing}
              </button>`,
          )}${!results.length
            ? html`<div class="empty compact">没有匹配的工作台记录。</div>`
            : nothing}${this.searcher?.query === this.quickQuery.trim()
            ? (this.searcher.sources ?? [])
                .filter((source) => !source.done)
                .map(
                  (source) =>
                    html`<button
                      class="text-button"
                      ?disabled=${source.loading}
                      @click=${() => void this.searcher?.more(source)}
                    >
                      ${source.loading
                        ? '正在搜索…'
                        : source.error
                          ? '重试在线页面搜索'
                          : '加载更多在线页面结果'}
                    </button>`,
                )
            : nothing}
        </wb-scroll-container>
        <div class="quick-footer">
          <span>↑ ↓ 选择 · Enter 打开 · Ctrl/⌘+Enter 新标签 · Alt+Enter 拆分</span
          ><button
            class="text-button"
            @click=${() => {
              this.closeQuick();
              this.act(() => this.openInternal('search'));
            }}
          >
            查看全部结果 ${icon('arrow')}
          </button>
        </div>
      </section>
    </div>`;
  }
  private renderNotifications() {
    const all = this.store.notificationItems,
      items = all.filter((n) =>
        this.notificationFilter === 'unread'
          ? !n.readAt || this.unreadSnapshot.has(n.id)
          : this.notificationFilter === 'error'
            ? n.level === 'error'
            : this.notificationFilter === 'all' || n.source === this.notificationFilter,
      );
    return html`<div class="notification-backdrop" @click=${() => this.toggleNotifications()}></div>
      <section class="notification-center" role="dialog" aria-label="通知中心">
        <div class="sidebar-header">
          <strong>通知中心</strong><span class="spacer"></span>${iconButton(
            'check',
            '全部标记已读',
            () =>
              this.act(async () => {
                await this.store.ackNotifications(all.filter((n) => !n.readAt).map((n) => n.id));
              }),
          )}${iconButton('close', '关闭通知中心', () => this.toggleNotifications())}
        </div>
        <wb-scroll-container class="notification-filters">
          ${[
            ['all', '全部'],
            ['unread', '未读'],
            ['error', '错误'],
            ['plugin', '插件后端'],
            ['page', '页面'],
          ].map(
            ([v, l]) =>
              html`<button
                class="btn ghost small"
                aria-pressed=${this.notificationFilter === v}
                @click=${() => {
                  this.notificationFilter = v;
                  this.unreadSnapshot = new Set(
                    this.store.notificationItems.filter((n) => !n.readAt).map((n) => n.id),
                  );
                }}
              >
                ${l}
              </button>`,
          )}
        </wb-scroll-container>
        <wb-scroll-container class="notification-list">
          ${repeat(
            items,
            (n) => n.id,
            (n) =>
              html`<article
                data-notification-id=${n.id}
                class=${`notification ${!n.readAt ? 'unread' : 'read'}`}
              >
                <span class=${n.level}>${icon(n.level === 'warn' ? 'warning' : n.level)}</span>
                <div>
                  <strong>${n.title}</strong>${n.count > 1
                    ? html`<span class="badge">×${n.count}</span>`
                    : nothing}
                  <p>${n.message}</p>
                  <small
                    >${n.pluginId ?? n.source} · ${new Date(n.updatedAt).toLocaleString()}</small
                  >${this.renderNotificationActions(n)}
                </div>
                <div class="notification-actions">
                  ${!n.readAt
                    ? iconButton('check', '标记已读', () =>
                        this.act(async () => {
                          await this.store.ackNotifications([n.id]);
                        }),
                      )
                    : nothing}${iconButton('close', '删除通知', () =>
                    this.act(async () => {
                      await this.store.deleteNotifications([n.id]);
                    }),
                  )}
                </div>
                ${this.renderProgress(n.progress)}
              </article>`,
          )}${!items.length
            ? html`<div class="empty compact">
                ${icon('bell')}
                <p>没有通知</p>
                <span>新的工作台消息将在这里显示。</span>
              </div>`
            : nothing}${this.store.cursors.notifications
            ? html`<button
                class="text-button"
                @click=${() => this.act(() => this.store.loadList('notifications', true))}
              >
                加载更多
              </button>`
            : nothing}
        </wb-scroll-container>
      </section>`;
  }
  private renderJobs() {
    return html`<div
      class="modal-backdrop"
      @click=${(e: MouseEvent) => {
        if (e.composedPath()[0] === e.currentTarget) {
          this.showJobs = false;
        }
      }}
    >
      <section class="jobs-dialog" role="dialog" aria-modal="true" aria-label="任务">
        <div class="sidebar-header">
          <strong>任务</strong>${iconButton('close', '关闭任务视图', () => (this.showJobs = false))}
        </div>
        <wb-scroll-container class="jobs-list">
          ${repeat(
            [...this.store.jobs.values()].reverse(),
            (job) => job.id,
            (job) =>
              html`<article class="job-card">
                <div>
                  <strong>${job.title ?? `${job.pluginId || '插件目录'} · ${job.type}`}</strong
                  ><span
                    class=${`badge ${job.status === 'failed' ? 'error' : job.status === 'succeeded' ? 'success' : 'warn'}`}
                    >${job.status}</span
                  >
                </div>
                <p class="muted">阶段：${job.phase}</p>
                ${job.content ? html`<p class="job-content">${job.content}</p>` : nothing}
                ${this.renderProgress(job.progress)}
                ${job.error ? html`<p class="error">${job.error}</p>` : nothing}
                <wb-scroll-container class="job-log">
                  <pre>${job.logs.map((l) => l.text ?? l.message ?? '').join('\n')}</pre>
                </wb-scroll-container>
                ${['queued', 'running'].includes(job.status)
                  ? html`<button
                      class="btn secondary"
                      @click=${async () => {
                        if (await this.store.confirm('取消此共享任务将影响所有订阅窗口。继续？')) {
                          this.act(async () => {
                            const next = await this.store.api.request<typeof job>(
                              `/jobs/${job.id}/cancel`,
                              { baseRevision: job.revision },
                            );
                            this.store.applyJob(next);
                            this.store.changed();
                          });
                        }
                      }}
                    >
                      取消共享任务
                    </button>`
                  : nothing}
              </article>`,
          )}${!this.store.jobs.size
            ? html`<div class="empty compact">
                ${icon('code')}
                <p>当前会话暂无任务</p>
                <span>插件、构建与自定义任务将在这里显示。</span>
              </div>`
            : nothing}
        </wb-scroll-container>
      </section>
    </div>`;
  }
  private renderToasts() {
    return html`<div class="toast-container" aria-live="polite">
      ${repeat(
        this.store.toasts,
        (t) => t.id,
        (t) =>
          html`<div
            class=${`toast ${t.level} ${t.focused ? 'focused' : ''}`}
            tabindex="0"
            @click=${(e: MouseEvent) => (e.currentTarget as HTMLElement).focus()}
            @focusin=${() => this.store.focusToast(t.id, true)}
            @focusout=${(e: FocusEvent) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                this.store.focusToast(t.id, false);
              }
            }}
            role=${t.level === 'error' ? 'alert' : 'status'}
          >
            <span>${icon(t.level === 'warn' ? 'warning' : t.level)}</span>
            <div class="toast-body">
              <strong>${t.text}</strong>${t.notification.message
                ? html`<p>${t.notification.message}</p>`
                : nothing}${this.renderNotificationActions(t.notification)}
            </div>
            ${iconButton('close', '关闭提示', () => this.store.dismissToast(t.id))}
            ${this.renderProgress(t.notification.progress)}
          </div>`,
      )}
    </div>`;
  }
  private renderProgress(progress: FeedbackProgress | undefined) {
    if (progress === undefined || progress === false) {
      return nothing;
    }
    return html`<div
      class=${`feedback-progress ${progress === null ? 'indeterminate' : ''}`}
      role="progressbar"
      aria-label="进度"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow=${typeof progress === 'number' ? progress : nothing}
      aria-valuetext=${progress === null ? '加载中' : `${progress}%`}
    >
      <span style=${styleMap({ width: progress === null ? '35%' : `${progress}%` })}></span>
    </div>`;
  }
  private renderNotificationActions(notification: NotificationState) {
    return html`<div class="notification-buttons">
      ${notification.actions.map(
        (action) => html`<button
          class="btn secondary small"
          @click=${(event: MouseEvent) => {
            event.stopPropagation();
            this.act(async () => {
              if (action.type === 'callback' && action.id) {
                await this.store.api.request(
                  `/notifications/${notification.id}/actions/${action.id}`,
                  {},
                );
              } else if (action.path) {
                await this.command(
                  'openUrl',
                  `/web/page/plugin/${encodeURIComponent(notification.pluginId ?? '')}${action.path}`,
                );
              }
            });
          }}
        >
          ${action.label ?? '打开关联页面'}
        </button>`,
      )}
    </div>`;
  }
  private toggleNotifications() {
    this.notificationOpen = !this.notificationOpen;
    this.unreadSnapshot = new Set(
      this.store.notificationItems.filter((n) => !n.readAt).map((n) => n.id),
    );
    this.notificationObserver?.disconnect();
    this.notificationObserver = undefined;
    this.notificationObserved = new WeakSet();
  }
  private observeNotifications() {
    if (!this.notificationOpen || typeof IntersectionObserver === 'undefined') {
      if (this.notificationVisible.size) {
        this.notificationVisible.clear();
        this.store.setVisibleNotifications([]);
      }
      this.notificationObserver?.disconnect();
      this.notificationObserver = undefined;
      this.notificationObserved = new WeakSet();
      return;
    }
    const root = this.renderRoot.querySelector('.notification-list');
    if (!root) {
      return;
    }
    this.notificationObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.notificationId;
          if (!id) {
            continue;
          }
          if (entry.isIntersecting && entry.intersectionRatio > 0) {
            this.notificationVisible.add(id);
          } else {
            this.notificationVisible.delete(id);
          }
        }
        this.store.setVisibleNotifications([...this.notificationVisible]);
        const ids = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio > 0)
          .map((e) => (e.target as HTMLElement).dataset.notificationId ?? '')
          .filter((id) =>
            this.store.notificationItems.some(
              (n) => n.id === id && !n.readAt && n.autoRead !== false,
            ),
          );
        if (ids.length) {
          if (this.notificationFilter === 'unread') {
            for (const id of ids) {
              this.unreadSnapshot.add(id);
            }
          }
          this.act(() => this.store.ackNotifications(ids));
        }
      },
      { root, threshold: 0.01 },
    );
    const present = new Set(
      [...root.querySelectorAll<HTMLElement>('[data-notification-id]')].map(
        (node) => node.dataset.notificationId,
      ),
    );
    const removed = [...this.notificationVisible].filter((id) => !present.has(id));
    if (removed.length) {
      for (const id of removed) {
        this.notificationVisible.delete(id);
      }
      this.store.setVisibleNotifications([...this.notificationVisible]);
    }
    for (const element of root.querySelectorAll('[data-notification-id]')) {
      if (!this.notificationObserved.has(element)) {
        this.notificationObserved.add(element);
        this.notificationObserver.observe(element);
      }
    }
  }
  private renderDialog() {
    const dialog = this.store.dialogState;
    if (!dialog) {
      return nothing;
    }
    const rect = this.renderRoot.querySelector('.center-area')?.getBoundingClientRect();
    return html`<div
      class="dialog-backdrop"
      style=${rect
        ? styleMap({
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          })
        : nothing}
    >
      <wb-scroll-container
        class="workbench-dialog"
        style=${styleMap({ maxHeight: `${Math.max(0, (rect?.height ?? innerHeight) - 32)}px` })}
      >
        <form
          class="dialog-form"
          role="dialog"
          aria-modal="true"
          aria-label=${dialog.title}
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            dialog.resolve(
              Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)) as Record<
                string,
                string
              >,
            );
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              dialog.resolve(null);
            }
            if (event.key === 'Tab') {
              const items = [
                ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
                  'input,select,button',
                ),
              ];
              const first = items[0],
                last = items[items.length - 1];
              if (event.shiftKey && this.shadowRoot?.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && this.shadowRoot?.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <h2>${dialog.title}</h2>
          ${dialog.fields.map(
            (field) =>
              html`<label
                >${field.label}${field.options
                  ? html`<select name=${field.name} .value=${field.value}>
                      ${field.options.map(
                        (option) => html`<option value=${option.value}>${option.label}</option>`,
                      )}
                    </select>`
                  : html`<input
                      name=${field.name}
                      .value=${field.value}
                      autocomplete="off"
                    />`}</label
              >`,
          )}
          <div class="dialog-actions">
            <button type="button" class="btn secondary" @click=${() => dialog.resolve(null)}>
              取消</button
            ><button type="submit" class="btn primary">确定</button>
          </div>
        </form>
      </wb-scroll-container>
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    'app-root': AppRoot;
  }
}
