import {
  uiRequired,
  UIError,
  uiAssert,
  type FieldValue,
  type IconRef,
} from '../../declarative-ui.ts';
import {
  TREE_LIMITS,
  type CompiledTree,
  type TreeCommand,
  type TreeFieldAdapter,
  type TreeRequest,
  type TreeResponse,
  type TreeRowPart,
  type TreeRowView,
  type TreeViewState,
  type TreeWireEvent,
} from '../../tree.ts';
import {
  TreeDataStore,
  emptyList,
  matchTreeText,
  normalizeTreeMove,
  reconcileTreeState,
  selectTreeRows,
  treeSelectionValue,
  treeValueIds,
  visibleTreeRows,
  type VisibleTreeRow,
} from '../../tree-model.ts';
import type { SCWCScrollContainer } from '../scroll-container/scroll-container.ts';
import { attachTooltip } from '../tooltip.ts';
import { scheduleFrame } from '../../utils/frame.ts';

type RequestBody = TreeRequest extends infer R
  ? R extends TreeRequest
    ? Omit<R, 'instanceId' | 'renderRevision' | 'treeId' | 'dataEpoch' | 'requestId'>
    : never
  : never;
export interface TreeBridge {
  request(body: RequestBody, requestId: string): Promise<TreeResponse>;
  event(bindingId: string, event: TreeWireEvent, modifiers?: TreeEventModifiers): void;
}
type TreeEventModifiers = { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
const modifiers = (event?: MouseEvent | KeyboardEvent): TreeEventModifiers => ({
  alt: !!event?.altKey,
  ctrl: !!event?.ctrlKey,
  meta: !!event?.metaKey,
  shift: !!event?.shiftKey,
});
let nextTree = 0;
/** DOM is a disposable projection. Identity, selection and pending work live here. */
export class JSONTree implements TreeFieldAdapter {
  readonly definition: CompiledTree;
  readonly host: HTMLElement;
  store: TreeDataStore;
  state: TreeViewState;
  private bridge: TreeBridge;
  private scroll: SCWCScrollContainer;
  private list: HTMLElement;
  private search: HTMLInputElement;
  private status: HTMLElement;
  private live: HTMLElement;
  private rows: VisibleTreeRow[] = [];
  private projection?: TreeDataStore;
  private searchPage?: { nextCursor: string | null; version: string };
  private searchGeneration = 0;
  private searchBefore?: { top: number; focus: string | null };
  private rowCache = new Map<string, { revision: number; view?: TreeRowView; error?: string }>();
  private windowIds = new Set<string>();
  private requests = new Map<string, { key: string; generation: number }>();
  private tasks: (() => Promise<void>)[] = [];
  private running = 0;
  private branchSequence = new Map<string | null, number>();
  private disposed = false;
  private observer?: ResizeObserver;
  private mutation?: MutationObserver;
  private frame?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private hover?: ReturnType<typeof setTimeout>;
  private autoScroll?: () => void;
  private tooltipCleanups: (() => void)[] = [];
  private listeners: (() => void)[] = [];
  private dragging?: string[];
  private drop?: {
    row: string;
    position: 'before' | 'after' | 'inside';
    targetParentId: string | null;
    beforeId: string | null;
  };
  private pendingMove = false;
  private anchor?: { id: string; offset: number; parents: string[] };
  private domIds = new Map<string, string>();
  private message = '';
  private prefix = `scwc-tree-${++nextTree}-`;
  private height = 0;
  private initialized = false;
  constructor(host: HTMLElement, definition: CompiledTree, bridge: TreeBridge) {
    this.host = host;
    this.definition = definition;
    this.bridge = bridge;
    this.store = new TreeDataStore(
      definition.dataEpoch,
      definition.nodes ?? (definition.controllers.children ? undefined : []),
    );
    this.store.version = definition.controllers.children ? null : 'static:0';
    const options = definition.options;
    const value =
      typeof options.value === 'string' && options.value.includes('${')
        ? options.selectionMode === 'multiple'
          ? []
          : ''
        : (options.value ?? (options.selectionMode === 'multiple' ? [] : ''));
    this.state = {
      expandedIds: new Set(options.defaultExpandedKeys ?? []),
      selectedIds: new Set(treeValueIds(value, options.selectionMode)),
      focusedId: null,
      rangeAnchorId: null,
      query: '',
    };
    host.classList.add('ui-tree-host', `tree-guides-${options.indentGuides ?? 'onHover'}`);
    host.style.setProperty('--tree-indent', `${options.indent ?? 8}px`);
    host.style.height = options.height === 'fill' ? '100%' : `${options.height ?? 280}px`;
    const toolbar = document.createElement('div');
    toolbar.className = 'tree-toolbar';
    const title = document.createElement('span');
    title.className = 'tree-title';
    title.textContent = definition.label;
    toolbar.append(title);
    const button = (label: string, icon: string, run: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', label);
      const glyph = document.createElement('wb-icon');
      glyph.setAttribute('name', icon);
      element.append(glyph);
      element.addEventListener('click', run);
      toolbar.append(element);
      this.tooltipCleanups.push(
        attachTooltip(element, () => label, { group: `${this.prefix}toolbar` }),
      );
      return element;
    };
    if (options.search !== false) {
      button('查找 (Ctrl/Cmd+F)', 'search', () => this.openSearch());
    }
    button('刷新树', 'refresh', () => void this.command({ type: 'refresh', parentId: null }));
    button('展开已加载分支', 'expand-all', () => void this.command({ type: 'expandAll' }));
    button('全部收起', 'collapse-all', () => void this.command({ type: 'collapseAll' }));
    this.search = document.createElement('input');
    this.search.className = 'tree-search';
    this.search.type = 'search';
    this.search.placeholder =
      options.search === false ? '' : (options.search?.placeholder ?? '搜索节点');
    this.search.setAttribute('aria-label', `${definition.label}：搜索`);
    this.search.hidden = options.search === false || !options.search?.visible;
    this.scroll = document.createElement('wb-scroll-container') as SCWCScrollContainer;
    this.scroll.className = 'tree-scroll';
    this.scroll.stepDistance = 0;
    this.scroll.wheelDirection = 'vertical';
    this.list = document.createElement('div');
    this.list.className = 'tree-list';
    this.list.setAttribute('role', 'tree');
    this.list.setAttribute('aria-label', definition.label);
    this.list.setAttribute('aria-multiselectable', String(options.selectionMode === 'multiple'));
    this.scroll.append(this.list);
    this.status = document.createElement('div');
    this.status.className = 'tree-status';
    this.live = document.createElement('div');
    this.live.className = 'tree-live';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    host.replaceChildren(toolbar, this.search, this.scroll, this.status, this.live);
    this.listen(this.list, 'click', (event) => this.pointer(event as MouseEvent));
    this.listen(this.list, 'dblclick', (event) => this.pointer(event as MouseEvent));
    this.listen(this.list, 'contextmenu', (event) => this.pointer(event as MouseEvent));
    this.listen(this.list, 'keydown', (event) => this.keyboard(event as KeyboardEvent));
    this.listen(this.list, 'focus', () => {
      if (this.state.focusedId) {
        this.notify('focus', this.state.focusedId);
      }
    });
    this.listen(this.list, 'blur', () => {
      if (this.state.focusedId) {
        this.notify('blur', this.state.focusedId);
      }
    });
    this.listen(this.list, 'dragstart', (event) => this.dragStart(event as DragEvent));
    this.listen(this.list, 'dragover', (event) => this.dragOver(event as DragEvent));
    this.listen(this.list, 'drop', (event) => {
      event.preventDefault();
      if (this.dragging && this.drop) {
        void this.move(this.dragging, this.drop.targetParentId, this.drop.beforeId);
      }
      this.endDrag();
    });
    this.listen(this.list, 'dragend', () => this.endDrag());
    this.listen(this.list, 'dragleave', (event) => {
      if (!this.list.contains((event as DragEvent).relatedTarget as Node)) {
        this.clearDrop();
      }
    });
    this.listen(this.search, 'input', () => {
      clearTimeout(this.timer);
      this.cancelSearch();
      const query = this.search.value;
      this.timer = setTimeout(
        () => void this.filter(query),
        options.search === false ? 0 : (options.search?.debounce ?? 150),
      );
    });
    this.listen(this.search, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'ArrowDown') {
        key.preventDefault();
        this.focus();
      } else if (key.key === 'Escape') {
        key.preventDefault();
        if (this.search.value) {
          void this.filter('');
        } else {
          this.search.hidden = true;
          this.focus();
        }
      }
    });
    this.scroll.contentScroll = () => this.queuePaint();
    this.tooltipCleanups.push(
      attachTooltip(this.list, (row) => row.dataset.treeTooltip ?? '', {
        delegate: '[data-tree-tooltip]',
        group: `${this.prefix}items`,
        placements: ['right', 'left', 'bottom', 'top', 'current'],
        matchAnchorHeight: true,
      }),
    );
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.update());
      this.observer.observe(this.scroll);
    }
    if (typeof MutationObserver === 'function') {
      this.mutation = new MutationObserver(() => this.update());
      let ancestor: Element | null = host;
      while (ancestor) {
        this.mutation.observe(ancestor, {
          attributes: true,
          attributeFilter: ['hidden', 'style', 'class'],
        });
        ancestor = ancestor.parentElement;
      }
    }
    this.update();
    this.rebuild();
    void this.initialize().catch((error) => this.fail(error));
  }
  private listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler);
    this.listeners.push(() => target.removeEventListener(type, handler));
  }
  private get data() {
    return this.projection ?? this.store;
  }
  private get options() {
    return {
      ...this.definition.options,
      disabled:
        this.definition.options.disabled === true ||
        (this.host as HTMLElement & { disabled?: boolean }).disabled === true ||
        this.host.hasAttribute('disabled'),
      readonly:
        this.definition.options.readonly === true ||
        (this.host as HTMLElement & { readOnly?: boolean }).readOnly === true ||
        this.host.hasAttribute('readonly'),
    };
  }
  private async initialize() {
    if (
      this.options.disabled ||
      this.initialized ||
      this.host.getBoundingClientRect().height === 0
    ) {
      return;
    }
    this.initialized = true;
    if (this.definition.nodes === undefined && this.definition.controllers.children) {
      await this.load(null);
    }
    for (const id of new Set([...this.state.selectedIds, ...this.state.expandedIds])) {
      if (!this.store.nodes.has(id)) {
        await this.resolve(id);
      }
    }
    for (const id of this.state.expandedIds) {
      if (this.store.nodes.has(id) && this.store.children.get(id)?.status === 'unloaded') {
        this.enqueue(() => this.load(id));
      }
    }
    this.rebuild();
  }
  private enqueue(task: () => Promise<void>) {
    this.tasks.push(task);
    this.drain();
  }
  private drain() {
    while (!this.disposed && this.running < 3 && this.tasks.length) {
      this.running++;
      const task = uiRequired(this.tasks.shift());
      void task()
        .catch((error) => this.fail(error))
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
  private async request(body: RequestBody, key = '', generation = 0) {
    const id = crypto.randomUUID();
    this.requests.set(id, { key, generation });
    try {
      const response = await this.bridge.request(
        {
          ...body,
          viewState: {
            expandedIds: [...this.state.expandedIds],
            selectedIds: [...this.state.selectedIds],
            focusedId: this.state.focusedId,
          },
        },
        id,
      );
      uiAssert(
        !this.disposed &&
          response.dataEpoch === this.definition.dataEpoch &&
          response.treeId === this.definition.treeId &&
          response.requestId === id,
        'TREE_STALE_RESPONSE',
        '树响应版本已过期',
      );
      if (response.error) {
        throw new UIError(response.error.code, response.error.message);
      }
      return response;
    } finally {
      this.requests.delete(id);
    }
  }
  private cancel(key: string) {
    for (const [id, task] of this.requests) {
      if (task.key === key) {
        void this.bridge
          .request({ kind: 'cancel', targetRequestId: id }, crypto.randomUUID())
          .catch(() => undefined);
      }
    }
  }
  private get rowHeight() {
    return this.options.rowHeight ?? 22;
  }
  private async load(parentId: string | null, more = false, refresh = false): Promise<void> {
    const key = `children:${parentId ?? '$root'}`;
    if ([...this.requests.values()].some((task) => task.key === key) && !refresh) {
      return;
    }
    if (refresh) {
      this.cancel(key);
    }
    if (refresh && parentId === null) {
      for (const [parent, generation] of this.branchSequence) {
        if (parent !== null) {
          this.cancel(`children:${parent}`);
          this.branchSequence.set(parent, generation + 1);
        }
      }
      this.cancel('render');
      this.cancelSearch();
      this.rowCache.clear();
    }
    const list = this.store.children.get(parentId) ?? emptyList();
    const generation = Math.max(this.branchSequence.get(parentId) ?? 0, list.generation) + 1;
    this.branchSequence.set(parentId, generation);
    this.store.children.set(parentId, { ...list, status: 'loading', generation });
    this.rebuild();
    try {
      const response = await this.request(
        { kind: 'children', parentId, generation, cursor: more ? list.nextCursor : null, refresh },
        key,
        generation,
      );
      if (this.branchSequence.get(parentId) !== generation) {
        return;
      }
      if (response.patch) {
        this.apply(response.patch);
      }
      this.message = '';
      this.status.removeAttribute('data-error');
      if (refresh && parentId === null) {
        for (const id of this.state.expandedIds) {
          if (this.store.children.get(id)?.status === 'unloaded') {
            await this.load(id);
          }
        }
      }
    } catch (error) {
      if (this.branchSequence.get(parentId) !== generation || this.disposed) {
        return;
      }
      if (error instanceof UIError && error.code === 'TREE_VERSION_CONFLICT' && parentId !== null) {
        // One bounded snapshot recovery. A continuously changing root remains a retry row.
        await this.load(null, false, true);
        return;
      }
      this.store.children.set(parentId, {
        ...list,
        status: 'error',
        generation,
        error: {
          code: error instanceof UIError ? error.code : 'TREE_LOAD_FAILED',
          message: error instanceof Error ? error.message : '加载失败',
        },
      });
      this.notify('loadError', parentId, undefined, 'retry');
      this.fail(error);
    }
    this.rebuild();
  }
  private apply(patch: NonNullable<TreeResponse['patch']>) {
    this.rememberAnchor();
    this.store.apply(patch);
    for (const id of patch.remove ?? []) {
      this.state.selectedIds.delete(id);
      this.state.expandedIds.delete(id);
      this.rowCache.delete(id);
    }
    if (this.state.focusedId && !this.data.nodes.has(this.state.focusedId)) {
      this.state.focusedId =
        this.anchor?.parents.find((id) => this.data.nodes.has(id)) ??
        this.store.children.get(null)?.ids[0] ??
        null;
    }
    this.rebuild(true);
    // Data reconciliation updates collection, without synthesizing the business change program.
    this.host.dispatchEvent(new CustomEvent('tree-reconcile'));
  }
  private rememberAnchor() {
    const row = this.rows[Math.floor(this.scroll.scrollState.scrollTop / this.rowHeight)];
    if (row?.kind === 'node') {
      this.anchor = {
        id: row.id,
        offset: this.scroll.scrollState.scrollTop - row.index * this.rowHeight,
        parents: this.data.ancestors(row.id),
      };
    }
  }
  private rebuild(restore = false) {
    if (this.disposed) {
      return;
    }
    const visibleState = this.projection
      ? { ...this.state, expandedIds: new Set(this.projection.nodes.keys()) }
      : this.state;
    this.rows = visibleTreeRows(
      this.data,
      visibleState,
      this.projection ? { ...this.options, search: { mode: 'highlight' } } : this.options,
    );
    this.scroll.metrics = { scrollHeight: this.rows.length * this.rowHeight };
    if (restore && this.anchor) {
      const row =
        this.rows.find((row) => row.id === this.anchor?.id) ??
        this.rows.find((row) => this.anchor?.parents.includes(row.id));
      if (row) {
        this.scroll.scrollTo({
          top: row.index * this.rowHeight + this.anchor.offset,
          behavior: 'instant',
        });
      }
    }
    this.paint();
  }
  update() {
    if (this.disposed) {
      return;
    }
    const disabled = this.options.disabled;
    this.list.tabIndex = disabled ? -1 : 0;
    this.list.setAttribute('aria-disabled', String(disabled));
    for (const button of this.host.querySelectorAll<HTMLButtonElement>('.tree-toolbar button')) {
      button.disabled = disabled;
    }
    this.search.disabled = disabled;
    const height = this.scroll.getBoundingClientRect().height;
    if (height > 0 && this.height !== height) {
      this.height = height;
      this.scroll.refresh();
      this.queuePaint();
    }
    if (height > 0 && !this.initialized) {
      void this.initialize().catch((error) => this.fail(error));
    }
  }
  private queuePaint() {
    if (this.frame || this.disposed) {
      return;
    }
    this.frame = scheduleFrame(() => {
      this.frame = undefined;
      this.paint();
    });
  }
  private id(id: string) {
    if (!this.domIds.has(id)) {
      this.domIds.set(id, this.prefix + this.domIds.size);
    }
    return uiRequired(this.domIds.get(id));
  }
  private icon(icon?: IconRef) {
    const node = document.createElement('span');
    node.className = 'tree-icon';
    node.setAttribute('aria-hidden', 'true');
    if (icon?.kind === 'asset') {
      const image = document.createElement('img');
      image.src = icon.path;
      image.alt = '';
      node.append(image);
    } else {
      const glyph = document.createElement('wb-icon');
      glyph.setAttribute('name', icon?.kind === 'builtin' ? icon.name : 'file');
      glyph.setAttribute('size', 'sm');
      node.append(glyph);
    }
    return node;
  }
  private text(text: string, className = '') {
    const node = document.createElement('span');
    node.className = className;
    const ranges = matchTreeText(
      text,
      this.state.query,
      this.options.search === false ? 'fuzzy' : this.options.search?.match,
    );
    let end = 0;
    for (const [start, stop] of ranges) {
      node.append(document.createTextNode(text.slice(end, start)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(start, stop);
      node.append(mark);
      end = stop;
    }
    node.append(document.createTextNode(text.slice(end)));
    return node;
  }
  private part(part: TreeRowPart): HTMLElement {
    if (part.type === 'icon') {
      return this.icon(part.icon);
    }
    if (part.type === 'stack') {
      const node = document.createElement('span');
      node.className = 'tree-part-stack';
      node.style.gap = `${part.gap ?? 4}px`;
      for (const child of part.children) {
        node.append(this.part(child));
      }
      return node;
    }
    return this.text(
      part.text,
      `tree-part tree-${part.type === 'badge' ? 'badge' : (part.tone ?? 'normal')} tree-${part.tone ?? 'normal'}`,
    );
  }
  private paint() {
    if (this.disposed) {
      return;
    }
    if (this.host.getBoundingClientRect().height === 0) {
      return;
    }
    const options = this.options,
      state = this.scroll.scrollState;
    const height = this.height || state.clientHeight;
    if (height === 0 && this.host.getBoundingClientRect().height === 0) {
      return;
    }
    const overscan = typeof options.virtual === 'object' ? (options.virtual.overscan ?? 8) : 8;
    const start =
      options.virtual === false
        ? 0
        : Math.max(0, Math.floor(state.scrollTop / this.rowHeight) - overscan);
    const end =
      options.virtual === false
        ? this.rows.length
        : Math.min(
            this.rows.length,
            Math.ceil((state.scrollTop + (height || 220)) / this.rowHeight) + overscan,
          );
    const visible = this.rows.slice(start, end);
    const focusRow = this.rows.find(
      (row) => row.kind === 'node' && row.id === this.state.focusedId,
    );
    if (focusRow && !visible.includes(focusRow)) {
      visible.push(focusRow);
    }
    this.windowIds = new Set(visible.filter((row) => row.kind === 'node').map((row) => row.id));
    for (const task of this.requests.values()) {
      if (
        task.key.startsWith('render:') &&
        !task.key
          .slice(7)
          .split('\u0000')
          .some((id) => this.windowIds.has(id))
      ) {
        this.cancel(task.key);
      }
    }
    const active =
      this.host.getRootNode() instanceof ShadowRoot
        ? (this.host.getRootNode() as ShadowRoot).activeElement
        : document.activeElement;
    const focusedAction =
      active instanceof HTMLElement && this.list.contains(active)
        ? {
            id: active.closest<HTMLElement>('[data-tree-id]')?.dataset.treeId,
            action: active.dataset.treeAction,
          }
        : undefined;
    const fragment = document.createDocumentFragment(),
      render: { id: string; revision: number }[] = [];
    for (const row of visible) {
      const element = document.createElement('div');
      element.className = 'tree-row';
      element.style.top = `${row.index * this.rowHeight}px`;
      element.style.height = `${this.rowHeight}px`;
      element.style.paddingLeft = `${8 + (row.depth - 1) * (options.indent ?? 8)}px`;
      element.style.setProperty(
        '--tree-guides-width',
        `${(row.depth - 1) * (options.indent ?? 8)}px`,
      );
      if (row.kind !== 'node') {
        element.dataset.treeAux = row.kind;
        element.dataset.treeParent = row.parentId ?? '';
        if (row.kind === 'loading') {
          element.textContent = '正在加载…';
          element.setAttribute('role', 'status');
        } else {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = row.kind === 'retry' ? '加载失败，重试' : '加载更多';
          button.tabIndex = -1;
          element.append(button);
        }
        fragment.append(element);
        continue;
      }
      const record = uiRequired(this.data.nodes.get(row.id)),
        item = record.item,
        effective = this.data.snapshot(row.id, options),
        expanded =
          this.state.expandedIds.has(row.id) ||
          (!!this.state.query && this.rows.some((child) => child.parentId === row.id));
      element.id = this.id(row.id);
      element.dataset.treeId = row.id;
      element.setAttribute('role', 'treeitem');
      element.setAttribute('aria-level', String(row.depth));
      element.setAttribute('aria-posinset', String(row.posinset));
      element.setAttribute('aria-setsize', String(row.setsize));
      element.setAttribute('aria-selected', String(this.state.selectedIds.has(row.id)));
      element.setAttribute('aria-disabled', String(effective.disabled));
      element.setAttribute('aria-label', item.label);
      if (effective.hasChildren) {
        element.setAttribute('aria-expanded', String(expanded));
      }
      element.dataset.focus = String(this.state.focusedId === row.id);
      element.dataset.readonly = String(effective.readonly);
      element.draggable =
        !!options.dragDrop &&
        !effective.disabled &&
        !effective.readonly &&
        item.draggable !== false &&
        !this.state.query &&
        !this.pendingMove;
      if (this.drop?.row === row.id) {
        element.dataset.drop = this.drop.position;
      }
      const twistie = document.createElement('span');
      twistie.className = 'tree-twistie';
      twistie.dataset.treeTwistie = '';
      if (effective.hasChildren) {
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.setAttribute('aria-label', expanded ? '收起' : '展开');
        button.disabled = effective.disabled;
        button.append(
          this.icon({
            kind: 'builtin',
            name: expanded ? 'chevron-down-compact' : 'chevron-right-compact',
          }),
        );
        twistie.append(button);
      }
      element.append(twistie);
      const content = document.createElement('span');
      content.className = 'tree-content';
      const cached = this.rowCache.get(row.id),
        view = cached?.revision === record.nodeRevision ? cached.view : undefined;
      if (view) {
        for (const part of view.content) {
          content.append(this.part(part));
        }
        if (view.ariaLabel) {
          element.setAttribute('aria-label', view.ariaLabel);
        }
      } else {
        content.append(
          this.icon(
            expanded && item.expandedIcon
              ? item.expandedIcon
              : (item.icon ?? {
                  kind: 'builtin',
                  name: effective.hasChildren ? (expanded ? 'folder-opened' : 'folder') : 'file',
                }),
          ),
          this.text(item.label, 'tree-label'),
        );
        if (item.description) {
          content.append(this.text(item.description, 'tree-description'));
        }
      }
      element.append(content);
      if (view?.actions?.length) {
        const actions = document.createElement('span');
        actions.className = 'tree-actions';
        for (const action of view.actions) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.treeAction = action.id;
          button.setAttribute('aria-label', action.label);
          button.disabled = effective.disabled || !!action.disabled;
          button.tabIndex = this.state.focusedId === row.id ? 0 : -1;
          button.append(this.icon(action.icon));
          actions.append(button);
        }
        element.append(actions);
      }
      const tooltip = view?.tooltip ?? item.tooltip;
      if (tooltip) {
        element.dataset.treeTooltip = tooltip;
      }
      fragment.append(element);
      if (
        this.definition.controllers.render &&
        cached?.revision !== record.nodeRevision &&
        !effective.disabled
      ) {
        render.push({ id: row.id, revision: record.nodeRevision });
      }
    }
    this.list.replaceChildren(fragment);
    if (focusRow) {
      this.list.setAttribute('aria-activedescendant', this.id(focusRow.id));
    } else {
      this.list.removeAttribute('aria-activedescendant');
    }
    // One delegated tooltip remains attached across virtual row recycling.
    this.status.textContent =
      this.message ||
      (this.pendingMove
        ? '正在保存移动…'
        : this.state.query
          ? this.definition.controllers.search
            ? `${this.rows.filter((row) => row.kind === 'node').length} 个搜索路径节点${this.searchPage?.nextCursor ? '，按 End 后加载更多' : ''} · 搜索中禁止拖动`
            : `${this.rows.filter((row) => row.kind === 'node').length} 个可见节点 · 仅搜索已加载节点${this.rows.length ? '' : '，已加载内容中无匹配项'} · 搜索中禁止拖动`
          : `${this.data.nodes.size} 个已加载节点 · ${this.state.selectedIds.size} 项选中`);
    if (focusedAction?.id && focusedAction.action) {
      [...this.list.querySelectorAll<HTMLButtonElement>('[data-tree-action]')]
        .find(
          (button) =>
            button.dataset.treeAction === focusedAction.action &&
            button.closest<HTMLElement>('[data-tree-id]')?.dataset.treeId === focusedAction.id,
        )
        ?.focus({ preventScroll: true });
    }
    if (render.length) {
      for (const node of render) {
        this.rowCache.set(node.id, { revision: node.revision });
      }
      for (let index = 0; index < render.length; index += TREE_LIMITS.render) {
        const batch = render.slice(index, index + TREE_LIMITS.render);
        this.enqueue(async () => {
          const current = batch.filter(
            (node) =>
              this.data.nodes.get(node.id)?.nodeRevision === node.revision &&
              this.windowIds.has(node.id),
          );
          for (const node of batch) {
            if (!current.includes(node)) {
              this.rowCache.delete(node.id);
            }
          }
          if (!current.length) {
            return;
          }
          try {
            const response = await this.request(
              { kind: 'render', nodes: current },
              `render:${current.map((node) => node.id).join('\u0000')}`,
            );
            for (const row of response.rows ?? []) {
              if (this.data.nodes.get(row.id)?.nodeRevision === row.revision) {
                this.rowCache.set(row.id, row);
              }
            }
          } catch (error) {
            for (const node of current) {
              if (!this.windowIds.has(node.id)) {
                this.rowCache.delete(node.id);
                continue;
              }
              this.rowCache.set(node.id, {
                revision: node.revision,
                error: error instanceof Error ? error.message : '行渲染失败',
              });
            }
          }
          this.queuePaint();
        });
      }
    }
  }
  private notify(
    type: TreeWireEvent['type'],
    nodeId: string | null,
    event?: MouseEvent | KeyboardEvent,
    reason: TreeWireEvent['reason'] = event instanceof KeyboardEvent
      ? 'keyboard'
      : event
        ? 'pointer'
        : 'api',
    actionId?: string,
  ) {
    const item = nodeId ? this.data.nodes.get(nodeId)?.item : undefined;
    const binding =
      type === 'action'
        ? this.rowCache
            .get(uiRequired(nodeId))
            ?.view?.actions?.find((action) => action.id === actionId)?.bindingId
        : (item?.bindings?.[type as keyof NonNullable<typeof item.bindings>] ??
          this.definition.defaults[type]);
    this.bridge.event(
      binding ?? '$state',
      {
        treeId: this.definition.treeId,
        dataEpoch: this.definition.dataEpoch,
        type,
        nodeId,
        selectedIds: [...this.state.selectedIds],
        focusedId: this.state.focusedId,
        query: this.state.query,
        ...(nodeId ? { expanded: this.state.expandedIds.has(nodeId) } : {}),
        reason,
        ...(actionId ? { actionId } : {}),
      },
      modifiers(event),
    );
  }
  private pointer(event: MouseEvent) {
    const target = event.target as HTMLElement,
      row = target.closest<HTMLElement>('.tree-row');
    if (!row || this.options.disabled) {
      return;
    }
    const id = row.dataset.treeId;
    if (!id) {
      if (event.type === 'click' && row.dataset.treeAux !== 'loading') {
        void this.load(row.dataset.treeParent || null, row.dataset.treeAux === 'more');
      }
      return;
    }
    if (this.data.snapshot(id, this.options).disabled) {
      return;
    }
    const action = target.closest<HTMLElement>('[data-tree-action]');
    if (action) {
      event.stopPropagation();
      if ((action as HTMLButtonElement).disabled) {
        return;
      }
      if (event.type === 'click') {
        this.notify('action', id, event, 'pointer', action.dataset.treeAction);
      }
      return;
    }
    this.list.focus({ preventScroll: true });
    if (target.closest('[data-tree-twistie]')) {
      if (event.type === 'click') {
        void this.expand(id, !this.state.expandedIds.has(id), event);
      }
      return;
    }
    if (event.type === 'contextmenu') {
      event.preventDefault();
    }
    let changed = false;
    try {
      if (
        event.type !== 'dblclick' &&
        !(event.type === 'contextmenu' && this.state.selectedIds.has(id))
      ) {
        changed = selectTreeRows(
          this.data,
          this.state,
          this.rows,
          id,
          this.options,
          modifiers(event),
        );
      } else {
        this.state.focusedId = id;
      }
    } catch (error) {
      this.fail(error);
      return;
    }
    this.paint();
    if (changed) {
      this.host.dispatchEvent(new Event('change', { bubbles: true }));
      this.notify('change', id, event);
    }
    const branch = this.data.snapshot(id).hasChildren;
    if (
      branch &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      ((event.type === 'click' && (this.options.expandOn ?? 'click') === 'click') ||
        (event.type === 'dblclick' && this.options.expandOn === 'doubleClick'))
    ) {
      void this.expand(id, !this.state.expandedIds.has(id), event);
    }
    this.notify(event.type as 'click' | 'dblclick' | 'contextmenu', id, event);
    if (event.type === 'dblclick' && !branch) {
      this.notify('activate', id, event);
    }
  }
  private async expand(
    id: string,
    expanded: boolean,
    event?: MouseEvent | KeyboardEvent,
    silent = false,
  ) {
    uiAssert(
      !this.options.disabled && !this.data.snapshot(id, this.options).disabled,
      'TREE_DISABLED',
      '节点已禁用',
    );
    this.rememberAnchor();
    if (expanded) {
      this.state.expandedIds.add(id);
    } else {
      this.state.expandedIds.delete(id);
      this.cancel(`children:${id}`);
      this.branchSequence.set(id, (this.branchSequence.get(id) ?? 0) + 1);
      const list = this.store.children.get(id);
      if (list?.status === 'loading') {
        this.store.children.set(id, { ...list, status: 'unloaded' });
      }
      if (this.state.focusedId && this.data.ancestors(this.state.focusedId).includes(id)) {
        this.state.focusedId = id;
      }
    }
    this.rebuild(true);
    if (!silent) {
      this.notify(expanded ? 'expand' : 'collapse', id, event);
    }
    if (
      expanded &&
      !this.projection &&
      ['unloaded', 'error'].includes(this.store.children.get(id)?.status ?? 'loaded')
    ) {
      await this.load(id);
    }
  }
  private keyboard(event: KeyboardEvent) {
    if (event.isComposing || this.options.disabled) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.dataset.treeAction) {
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault();
        this.list.focus();
      }
      return;
    }
    const business = this.rows.filter((row) => row.kind === 'node'),
      id = this.state.focusedId ?? business[0]?.id;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.openSearch();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.dragging) {
        this.endDrag();
      } else if (this.state.query) {
        void this.filter('');
      } else if (!this.search.hidden) {
        this.search.hidden = true;
        this.focus();
      }
      return;
    }
    if (!id) {
      return;
    }
    const index = business.findIndex((row) => row.id === id);
    const page = Math.max(1, Math.floor((this.height || 220) / this.rowHeight));
    const offset: Record<string, number> = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      Home: 0,
      End: business.length - 1,
      PageUp: index - page,
      PageDown: index + page,
    };
    let next: string | undefined;
    if (event.key in offset) {
      next = business[Math.max(0, Math.min(business.length - 1, offset[event.key]))]?.id;
    } else if (
      event.key === 'ArrowRight' &&
      this.data.snapshot(id).hasChildren &&
      !this.data.snapshot(id, this.options).disabled
    ) {
      if (!this.state.expandedIds.has(id)) {
        void this.expand(id, true, event);
      } else {
        next = this.data.nodes.get(id)?.childIds[0];
      }
    } else if (event.key === 'ArrowLeft') {
      if (this.state.expandedIds.has(id)) {
        void this.expand(id, false, event);
      } else {
        next = this.data.nodes.get(id)?.parentId ?? undefined;
      }
    } else if (event.key === 'Enter') {
      if (this.data.snapshot(id).hasChildren) {
        void this.expand(id, !this.state.expandedIds.has(id), event);
      } else {
        this.notify('activate', id, event);
      }
    } else if (event.key === ' ') {
      if (this.options.selectionMode === 'multiple') {
        event.preventDefault();
        const changed = selectTreeRows(this.data, this.state, this.rows, id, this.options, {
          ctrl: true,
        });
        if (changed) {
          this.host.dispatchEvent(new Event('change', { bubbles: true }));
          this.notify('change', id, event);
        }
        this.paint();
        return;
      }
      next = id;
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a' &&
      this.options.selectionMode === 'multiple' &&
      !this.options.readonly
    ) {
      const ids = business
        .filter((row) => {
          const effective = this.data.snapshot(row.id, this.options);
          return (
            !effective.disabled &&
            !effective.readonly &&
            uiRequired(this.data.nodes.get(row.id)).item.selectable !== false
          );
        })
        .map((row) => row.id);
      if (ids.length > TREE_LIMITS.selected) {
        this.fail(new Error('最多选择 500 个节点'));
      } else {
        const changed = JSON.stringify([...this.state.selectedIds]) !== JSON.stringify(ids);
        this.state.selectedIds = new Set(ids);
        if (changed) {
          this.host.dispatchEvent(new Event('change', { bubbles: true }));
          this.notify('change', id, event);
        }
        this.paint();
      }
    } else if (event.key === 'F2') {
      this.list
        .querySelector<HTMLButtonElement>(`#${this.id(id)} [data-tree-action]:not(:disabled)`)
        ?.focus();
    } else if (event.key === 'Tab') {
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (next) {
      let changed = false;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key !== ' ') {
        this.state.focusedId = next;
      } else {
        try {
          changed = selectTreeRows(
            this.data,
            this.state,
            this.rows,
            next,
            this.options,
            modifiers(event),
          );
        } catch (error) {
          this.fail(error);
        }
      }
      this.revealVisible(next);
      if (changed) {
        this.host.dispatchEvent(new Event('change', { bubbles: true }));
        this.notify('change', next, event);
      }
      this.notify('focus', next, event);
    }
    if (event.key === 'End') {
      const last = this.rows[this.rows.length - 1];
      if (last?.kind === 'more') {
        void this.load(last.parentId, true);
      }
      if (this.searchPage?.nextCursor) {
        void this.remoteSearch(true);
      }
    }
  }
  private revealVisible(id: string) {
    this.state.focusedId = id;
    const row = this.rows.find((row) => row.id === id);
    if (!row) {
      return;
    }
    const state = this.scroll.scrollState,
      top = row.index * this.rowHeight;
    if (top < state.scrollTop) {
      this.scroll.scrollTo({ top, behavior: 'instant' });
    } else if (top + this.rowHeight > state.scrollTop + (this.height || state.clientHeight)) {
      this.scroll.scrollTo({
        top: top + this.rowHeight - (this.height || state.clientHeight),
        behavior: 'instant',
      });
    }
    this.paint();
  }
  private openSearch() {
    if (this.options.search === false || this.options.disabled) {
      return;
    }
    this.search.hidden = false;
    this.search.focus();
    this.search.select();
  }
  private cancelSearch() {
    this.searchGeneration++;
    this.cancel('search');
  }
  private async filter(query: string) {
    if (this.options.disabled || this.options.search === false) {
      return;
    }
    this.cancelSearch();
    if (!this.state.query && query) {
      this.searchBefore = { top: this.scroll.scrollState.scrollTop, focus: this.state.focusedId };
    }
    this.state.query = query;
    this.search.value = query;
    this.endDrag();
    if (!query) {
      this.projection = undefined;
      this.searchPage = undefined;
      for (const id of this.state.selectedIds) {
        if (!this.store.nodes.has(id)) {
          try {
            await this.resolve(id);
          } catch (error) {
            this.fail(error);
          }
        }
      }
      this.state.focusedId = this.searchBefore?.focus ?? this.state.focusedId;
      this.rebuild();
      if (this.searchBefore) {
        this.scroll.scrollTo({ top: this.searchBefore.top, behavior: 'instant' });
      }
      this.searchBefore = undefined;
    } else if (this.definition.controllers.search) {
      // A new query must not display the previous remote projection while its
      // first page is in flight. The normal tree remains available locally.
      this.projection = undefined;
      this.searchPage = undefined;
      this.rebuild();
      await this.remoteSearch();
    } else {
      this.rebuild();
      if (!this.rows.some((row) => row.id === this.state.focusedId)) {
        this.state.focusedId = this.rows.find((row) => row.kind === 'node')?.id ?? null;
      }
      this.paint();
    }
    this.notify('filter', null);
  }
  private async remoteSearch(more = false) {
    const queryGeneration = this.searchGeneration,
      query = this.state.query;
    try {
      this.message = '';
      const response = await this.request(
        {
          kind: 'search',
          query,
          queryGeneration,
          cursor: more ? (this.searchPage?.nextCursor ?? null) : null,
        },
        'search',
        queryGeneration,
      );
      if (queryGeneration !== this.searchGeneration || !response.page) {
        return;
      }
      const projection =
        more && this.projection
          ? this.projection.clone()
          : new TreeDataStore(this.definition.dataEpoch);
      for (const hit of response.page.hits) {
        let parentId: string | null = null;
        for (const item of hit.path) {
          const old = projection.nodes.get(item.id);
          uiAssert(!old || old.parentId === parentId, 'TREE_INVALID_PARENT', '搜索路径父级冲突');
          if (!old) {
            projection.nodes.set(item.id, { item, parentId, childIds: [], nodeRevision: 1 });
            const list = projection.children.get(parentId) ?? emptyList('loaded');
            projection.children.set(parentId, {
              ...list,
              ids: [...list.ids, item.id],
              status: 'loaded',
              complete: true,
            });
            projection.children.set(item.id, emptyList('loaded'));
            if (parentId !== null) {
              const parent = uiRequired(projection.nodes.get(parentId));
              projection.nodes.set(parentId, {
                ...parent,
                childIds: [...parent.childIds, item.id],
              });
            }
          }
          parentId = item.id;
        }
      }
      projection.version = response.page.version;
      this.projection = projection;
      this.searchPage = response.page;
      this.rebuild();
      this.state.focusedId = this.rows.find((row) => row.kind === 'node')?.id ?? null;
      this.paint();
    } catch (error) {
      if (queryGeneration === this.searchGeneration) {
        this.fail(error);
      }
    }
  }
  private async resolve(nodeId: string) {
    const response = await this.request({ kind: 'path', nodeId }, `path:${nodeId}`);
    if (response.patch) {
      this.apply(response.patch);
    }
    return response.path?.path ?? [];
  }
  async applyEffect(command: TreeCommand, response?: TreeResponse) {
    if (response?.patch) {
      this.apply(response.patch);
    }
    if (command.type === 'move') {
      if (response?.saved && this.definition.controllers.children) {
        await this.load(null, false, true);
      }
      return;
    }
    return this.command(command, true);
  }
  applyPatch(patch: NonNullable<TreeResponse['patch']>) {
    this.apply(patch);
  }
  async command(command: TreeCommand, authorized = false) {
    try {
      if (command.type === 'move') {
        await this.move(command.sourceIds, command.targetParentId, command.beforeId);
        return;
      }
      const response = authorized
        ? { accepted: true }
        : await this.request({ kind: 'command', operationId: crypto.randomUUID(), command });
      if (!response.accepted) {
        return;
      }
      if (command.type === 'expand' || command.type === 'collapse') {
        await this.expand(command.nodeId, command.type === 'expand', undefined, true);
      } else if (command.type === 'expandAll') {
        for (const [id, list] of this.store.children) {
          if (id !== null && list.status === 'loaded' && list.ids.length) {
            this.state.expandedIds.add(id);
          }
        }
        this.rebuild();
      } else if (command.type === 'collapseAll') {
        for (const id of [...this.state.expandedIds]) {
          await this.expand(id, false, undefined, true);
        }
      } else if (command.type === 'filter') {
        await this.filter(command.query);
      } else if (command.type === 'refresh') {
        await this.load(command.parentId, false, true);
        this.live.textContent = '列表已刷新';
      } else if (command.type === 'reveal') {
        if (!this.store.nodes.has(command.nodeId)) {
          await this.resolve(command.nodeId);
        }
        for (const id of this.store.ancestors(command.nodeId).reverse()) {
          this.state.expandedIds.add(id);
        }
        this.rebuild();
        this.revealVisible(command.nodeId);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  private dragStart(event: DragEvent) {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-id]'),
      id = row?.dataset.treeId;
    if (
      !id ||
      this.state.query ||
      this.options.disabled ||
      this.options.readonly ||
      !this.options.dragDrop
    ) {
      event.preventDefault();
      return;
    }
    try {
      const source =
        this.options.dragDrop.multiple !== false && this.state.selectedIds.has(id)
          ? [...this.state.selectedIds]
          : [id];
      const record = uiRequired(this.store.nodes.get(id));
      // Validate permissions and ancestor deduplication with a real sibling anchor.
      const siblings = uiRequired(this.store.children.get(record.parentId)).ids.filter(
        (key) => !source.includes(key),
      );
      const move = normalizeTreeMove(
        this.store,
        source,
        record.parentId,
        siblings[0] ?? null,
        this.options,
        true,
      );
      this.dragging = move.sourceIds;
      event.dataTransfer?.setData('application/x-scwc-tree', this.prefix);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    } catch (error) {
      event.preventDefault();
      this.fail(error);
    }
  }
  private dragOver(event: DragEvent) {
    if (!this.dragging || this.pendingMove || this.state.query) {
      return;
    }
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-id]'),
      id = row?.dataset.treeId;
    if (!row || !id) {
      return;
    }
    const rect = row.getBoundingClientRect(),
      ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const position = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    const record = uiRequired(this.store.nodes.get(id)),
      parent = position === 'inside' ? id : record.parentId;
    const siblings = (this.store.children.get(parent)?.ids ?? []).filter(
      (key) => !uiRequired(this.dragging).includes(key),
    );
    const beforeId =
      position === 'inside'
        ? null
        : position === 'before'
          ? id
          : (siblings[siblings.indexOf(id) + 1] ?? null);
    try {
      normalizeTreeMove(this.store, this.dragging, parent, beforeId, this.options);
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      if (this.drop?.row !== id || this.drop.position !== position) {
        this.clearDrop();
        this.drop = { row: id, position, targetParentId: parent, beforeId };
        if (position === 'inside' && !this.state.expandedIds.has(id)) {
          this.hover = setTimeout(() => void this.expand(id, true), 650);
        }
        this.paint();
      }
      this.autoScroll?.();
      this.autoScroll = undefined;
      const viewport = this.scroll.getBoundingClientRect(),
        delta =
          event.clientY < viewport.top + 24
            ? -this.rowHeight
            : event.clientY > viewport.bottom - 24
              ? this.rowHeight
              : 0;
      if (delta) {
        const tick = () => {
          if (!this.dragging) {
            return;
          }
          this.scroll.scrollTo({
            top: this.scroll.scrollState.scrollTop + delta,
            behavior: 'instant',
          });
          this.autoScroll = scheduleFrame(tick);
        };
        this.autoScroll = scheduleFrame(tick);
      }
    } catch {
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none';
      }
      this.clearDrop();
    }
  }
  private clearDrop() {
    clearTimeout(this.hover);
    this.hover = undefined;
    this.autoScroll?.();
    this.autoScroll = undefined;
    this.drop = undefined;
    this.queuePaint();
  }
  private endDrag() {
    this.dragging = undefined;
    this.clearDrop();
  }
  private async move(sourceIds: string[], targetParentId: string | null, beforeId: string | null) {
    if (this.pendingMove) {
      return;
    }
    try {
      uiAssert(!this.state.query, 'TREE_FILTERED_MOVE', '搜索中禁止排序');
      const move = normalizeTreeMove(this.store, sourceIds, targetParentId, beforeId, this.options);
      const selected = [...this.state.selectedIds];
      this.pendingMove = true;
      this.paint();
      const response = await this.request({
        kind: 'command',
        operationId: crypto.randomUUID(),
        command: { type: 'move', ...move, expectedVersion: this.store.version ?? '' },
      });
      if (!response.accepted) {
        this.fail(new Error(response.message ?? '移动被拒绝'));
        return;
      }
      if (response.patch) {
        this.apply(response.patch);
      }
      if (response.saved && this.definition.controllers.children) {
        await this.load(null, false, true);
        if (this.store.children.get(null)?.status === 'error') {
          this.message = this.live.textContent = '移动已保存，列表待刷新';
          this.status.textContent = this.live.textContent;
          return;
        }
        if (
          targetParentId !== null &&
          this.store.children.get(targetParentId)?.status !== 'loaded'
        ) {
          await this.load(targetParentId, false, true);
        }
        this.state.selectedIds = new Set(selected.filter((id) => this.store.nodes.has(id)));
        this.host.dispatchEvent(new CustomEvent('tree-reconcile'));
      }
      this.live.textContent = '移动已保存';
      this.notify('drop', null);
    } catch (error) {
      this.fail(error);
    } finally {
      this.pendingMove = false;
      this.paint();
    }
  }
  private fail(error: unknown) {
    if (this.disposed) {
      return;
    }
    this.message = this.live.textContent = error instanceof Error ? error.message : '树操作失败';
    this.status.textContent = this.live.textContent;
    this.status.setAttribute('data-error', 'true');
  }
  readValue() {
    return treeSelectionValue(this.state, this.options.selectionMode);
  }
  writeValue(value: FieldValue) {
    const ids = treeValueIds(value, this.options.selectionMode);
    uiAssert(
      (!this.options.disabled && !this.options.readonly) ||
        JSON.stringify(value) === JSON.stringify(this.readValue()),
      'TREE_READ_ONLY',
      '树选择不可写',
    );
    for (const id of ids) {
      uiAssert(this.data.nodes.has(id), 'TREE_UNKNOWN_NODE', '写入选择前必须解析节点');
      const permission = this.data.snapshot(id, this.options);
      uiAssert(
        this.state.selectedIds.has(id) ||
          (!permission.disabled &&
            !permission.readonly &&
            uiRequired(this.data.nodes.get(id)).item.selectable !== false),
        'TREE_READ_ONLY',
        '节点不允许选择',
      );
    }
    for (const id of this.state.selectedIds) {
      if (!ids.includes(id) && this.data.nodes.has(id)) {
        const permission = this.data.snapshot(id, this.options);
        uiAssert(
          !permission.disabled && !permission.readonly,
          'TREE_READ_ONLY',
          '只读节点的选择不能改变',
        );
      }
    }
    this.state.selectedIds = new Set(ids);
    this.paint();
  }
  focus() {
    this.list.focus();
    if (!this.state.focusedId) {
      this.state.focusedId = this.rows.find((row) => row.kind === 'node')?.id ?? null;
    }
    if (this.state.focusedId) {
      this.revealVisible(this.state.focusedId);
    }
  }
  captureState() {
    return structuredClone(this.state);
  }
  captureData() {
    return {
      store: this.store.clone(),
      projection: this.projection?.clone(),
      top: this.scroll.scrollState.scrollTop,
    };
  }
  restoreData(saved: ReturnType<JSONTree['captureData']>) {
    this.store = saved.store.clone();
    this.projection = saved.projection?.clone();
    this.initialized = true;
    void this.scroll.updateComplete.then(() => {
      if (!this.disposed) {
        this.scroll.refresh();
        this.scroll.scrollTo({ top: saved.top, behavior: 'instant' });
      }
    });
  }
  restoreState(state: TreeViewState) {
    this.state = structuredClone(state);
    reconcileTreeState(this.store, this.state);
    this.rebuild();
  }
  dispose() {
    this.disposed = true;
    for (const id of this.requests.keys()) {
      void this.bridge
        .request({ kind: 'cancel', targetRequestId: id }, crypto.randomUUID())
        .catch(() => undefined);
    }
    this.tasks = [];
    this.observer?.disconnect();
    this.mutation?.disconnect();
    this.frame?.();
    this.endDrag();
    clearTimeout(this.timer);
    this.listeners.forEach((remove) => remove());
    this.tooltipCleanups.forEach((remove) => remove());
    this.scroll.contentScroll = undefined;
  }
}
