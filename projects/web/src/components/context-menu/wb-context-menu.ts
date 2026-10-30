import { customElement } from '../../../../shared/utils/customElement.ts';
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import '../icon.ts';
import { emit, resolveMenuPresentation } from './helpers.ts';
import { menuStyles } from './styles.ts';

import type { ContextMenuItem, MenuPresentationMode } from './menu-types.ts';

interface NativeMenuEntry {
  id: string;
  label: string;
  disabled: boolean;
  separator?: boolean;
}

@customElement('wb-context-menu')
export class WbContextMenu extends LitElement {
  @property({ attribute: false }) accessor rootClickHandler:
    | ((event: MouseEvent, close: () => void) => void)
    | undefined;
  @property({ type: Boolean }) accessor open = true;
  @property({ type: Boolean, reflect: true, attribute: 'no-backdrop' }) accessor noBackdrop = false;
  @property({ type: Number }) accessor x = -1;
  @property({ type: Number }) accessor y = -1;
  @property({ type: String }) accessor alignment: 'left' | 'right' = 'left';
  @property({ attribute: false }) accessor items: ContextMenuItem[] = [];
  @property({ type: Boolean }) accessor loading = false;
  @property({ type: String }) accessor presentation: MenuPresentationMode = 'custom';
  @property({ type: Boolean, reflect: true }) accessor compact = false;

  @state() private accessor focusIndex = 0;
  @state() private accessor hoverSubItemId: string | null = null;
  @state() private accessor position = { left: 8, top: 8 };
  @state() private accessor scrollEdges: Record<string, { up: boolean; down: boolean }> = {};
  private scrollTimer?: number;
  @state() private accessor showLoading = false;
  @state() private accessor loadingTimeout: number | null = null;
  @state() private accessor nativePickerFailed = false;
  private nativePickerRequested = false;
  private closed = false;

  requestClose(reason = 'programmatic'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.isConnected && this.popover === 'manual') {
      this.hidePopover();
    }
    this.style.setProperty('--wb-context-menu-pointer-events', 'none');
    this.stopScroll();
    if (this.loadingTimeout) {
      window.clearTimeout(this.loadingTimeout);
    }
    this.loadingTimeout = null;
    this.hoverSubItemId = null;
    this.requestUpdate();
    emit(this, 'wb-menu-close', { reason });
  }
  private rootClick = (event: MouseEvent): void => {
    if (this.closed || !this.open || event.composedPath()[0] !== this) {
      return;
    }
    event.stopPropagation();
    const close = () => this.requestClose('backdrop');
    if (this.rootClickHandler) {
      this.rootClickHandler(event, close);
    } else {
      close();
    }
  };

  @query('[data-context-menu]') private accessor menuElement: HTMLElement | null = null;

  static styles = [
    menuStyles,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 1100;
        display: block;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: visible;
        pointer-events: var(--wb-context-menu-pointer-events, auto);
      }

      :host([popover]:not(:popover-open)) {
        display: none;
      }

      :host([no-backdrop]) {
        width: 0;
        height: 0;
        pointer-events: none;
      }

      :host([no-backdrop])::backdrop {
        display: none;
      }

      .wb-menu,
      .wb-menu__submenu-panel {
        box-sizing: border-box;
        max-height: calc(100dvh - 16px);
        max-width: calc(100vw - 16px);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: visible;
      }
      .wb-menu__submenu-panel {
        position: fixed;
        z-index: 101;
      }
      .menu-viewport {
        overflow-y: auto;
        min-height: 0;
        overscroll-behavior: contain;
        scrollbar-width: none;
      }
      .menu-viewport::-webkit-scrollbar {
        display: none;
      }
      .menu-scroll {
        flex: 0 0 18px;
        height: 18px;
        border: 0;
        padding: 0;
        width: 100%;
        background: var(--wb-color-bg-surface);
        color: var(--wb-color-text-secondary);
        cursor: default;
      }
      .menu-scroll:hover {
        background: var(--wb-color-bg-surface-2);
      }
      .wb-menu-native {
        all: revert;
        box-sizing: border-box;
        width: 1px;
        height: 1px;
        position: fixed;
        z-index: 100;
        border: 0;
        padding: 0;
        opacity: 0;
        pointer-events: none;
        color-scheme: light dark;
      }
      :host([compact]) .wb-menu,
      :host([compact]) .wb-menu__submenu-panel,
      :host([compact]) button,
      :host([compact]) input {
        border-radius: 0;
        box-shadow: none;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    // Keep the host in place for inherited styles and Lit event handlers, while
    // the top layer lets its full-viewport backdrop escape ancestor clipping.
    if (typeof this.showPopover === 'function') {
      this.popover = 'manual';
    }
    this.requestUpdate();
    window.addEventListener('resize', this.resize);
    this.addEventListener('click', this.rootClick);
  }
  disconnectedCallback(): void {
    window.removeEventListener('resize', this.resize);
    this.removeEventListener('click', this.rootClick);
    this.stopScroll();
    if (this.loadingTimeout) {
      window.clearTimeout(this.loadingTimeout);
    }
    super.disconnectedCallback();
  }
  private resize = (): void => {
    this.requestUpdate();
  };

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('x') || changed.has('y') || (changed.has('open') && this.open)) {
      this.closed = false;
      this.nativePickerRequested = false;
      this.nativePickerFailed = false;
      this.focusIndex = 0;
      this.hoverSubItemId = null;
      this.scrollEdges = {};
      this.stopScroll();
    }
    if (changed.has('items')) {
      this.nativePickerFailed = false;
      this.nativePickerRequested = false;
      this.scrollEdges = {};
      this.focusIndex = Math.max(
        0,
        Math.min(this.focusIndex, this.countSelectableItems(this.items) - 1),
      );
      if (this.hoverSubItemId && !this.containsItem(this.items, this.hoverSubItemId)) {
        this.hoverSubItemId = null;
      }
    }
    if (changed.has('presentation')) {
      this.nativePickerFailed = false;
      this.nativePickerRequested = false;
    }
  }

  protected override firstUpdated(): void {
    this.focusFirst();
  }

  protected override updated(): void {
    if (this.isConnected && this.popover === 'manual') {
      if (this.closed || !this.open || this.x < 0 || this.y < 0) {
        this.hidePopover();
      } else {
        this.showPopover();
      }
    }
    if (this.closed || !this.open) {
      return;
    }
    if (this.loading && !this.loadingTimeout) {
      this.showLoading = false;
      this.loadingTimeout = window.setTimeout(() => {
        this.showLoading = true;
      }, 500);
    }
    if (this.loading || !this.menuElement) {
      return;
    }
    if (this.menuElement instanceof HTMLSelectElement) {
      this.menuElement.selectedIndex = -1;
      if (!this.nativePickerRequested) {
        this.nativePickerRequested = true;
        try {
          if (typeof this.menuElement.showPicker !== 'function') {
            throw new DOMException('showPicker is not supported', 'NotSupportedError');
          }
          this.menuElement.focus({ preventScroll: true });
          this.menuElement.showPicker();
        } catch {
          queueMicrotask(() => {
            this.nativePickerFailed = true;
          });
        }
      }
      return;
    }
    const width = this.menuElement.offsetWidth || 278;
    const height = this.menuElement.offsetHeight || 300;
    const left = this.alignment === 'right' ? this.x - width : this.x;
    const next = {
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(this.y, window.innerHeight - height - 8)),
    };
    if (next.left !== this.position.left || next.top !== this.position.top) {
      this.position = next;
      return;
    }
    this.positionSubmenus();
    this.updateScrollEdges();
    const activeElement =
      this.renderRoot instanceof ShadowRoot
        ? this.renderRoot.activeElement
        : document.activeElement;
    if (!activeElement || !this.renderRoot.contains(activeElement)) {
      this.focusFirst();
    }
  }

  render() {
    if (this.closed || !this.open || this.x < 0 || this.y < 0) {
      this.style.setProperty('--wb-context-menu-pointer-events', 'none');
      return nothing;
    }
    if (
      !this.loading &&
      !this.nativePickerFailed &&
      resolveMenuPresentation(this.presentation) === 'native'
    ) {
      return this.renderNativeMenu();
    }
    this.style.setProperty('--wb-context-menu-pointer-events', this.noBackdrop ? 'none' : 'auto');
    return html`${this.panel('root', this.items)}${this.activeSubmenus().map((item) =>
      this.panel(item.id, item.children),
    )}`;
  }

  // Each panel owns a clipped scroll viewport. Submenus are sibling fixed panels,
  // anchored to the actual parent panel, so no overflow ancestor can clip them.
  private panel(id: string, items: ContextMenuItem[]): TemplateResult {
    const edge = this.scrollEdges[id];
    return html`<div
      class=${id === 'root' ? 'wb-menu' : 'wb-menu__submenu-panel'}
      data-context-menu=${id === 'root' ? '' : nothing}
      data-submenu-panel=${id === 'root' ? nothing : id}
      data-panel-id=${id}
      data-has-checked=${items.some((item) => item.kind === 'checkbox' && item.checked)}
      role="menu"
      tabindex="-1"
      style=${styleMap({ left: `${this.position.left}px`, top: `${this.position.top}px` })}
      @keydown=${this.handleKeydown}
    >
      ${edge?.up ? this.scrollMarker(id, -1) : nothing}
      <div
        class="menu-viewport"
        data-viewport=${id}
        @scroll=${this.onScroll}
        @wheel=${(e: Event) => e.stopPropagation()}
      >
        ${this.loading && id === 'root'
          ? this.showLoading
            ? html`<div class="wb-loading">正在检查可用操作…</div>`
            : nothing
          : repeat(
              items,
              (item) => item.id,
              (item, index) => this.item(item, `${id}.${index}`),
            )}
      </div>
      ${edge?.down ? this.scrollMarker(id, 1) : nothing}
    </div>`;
  }
  private scrollMarker(id: string, direction: number): TemplateResult {
    return html`<button
      class="menu-scroll"
      tabindex="-1"
      aria-label=${direction < 0 ? '向上滚动菜单' : '向下滚动菜单'}
      @mouseenter=${() => {
        this.stopScroll();
        this.scrollTimer = window.setInterval(() => this.scrollPanel(id, direction * 10), 35);
      }}
      @mouseleave=${this.stopScroll}
      @pointerdown=${(e: Event) => e.preventDefault()}
      @click=${(e: Event) => {
        e.stopPropagation();
        this.scrollPanel(id, direction * 56);
      }}
    >
      ${direction < 0 ? '▴' : '▾'}
    </button>`;
  }
  private stopScroll = (): void => {
    if (this.scrollTimer) {
      window.clearInterval(this.scrollTimer);
    }
    this.scrollTimer = undefined;
  };
  private scrollPanel(id: string, amount: number): void {
    const viewport = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-viewport]')].find(
      (el) => el.dataset.viewport === id,
    );
    if (!viewport) {
      this.stopScroll();
      return;
    }
    viewport.scrollTop = Math.max(
      0,
      Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + amount),
    );
    if (
      (amount < 0 && viewport.scrollTop === 0) ||
      (amount > 0 && viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1)
    ) {
      this.stopScroll();
    }
    this.hoverSubItemId = id === 'root' ? null : id;
    this.updateScrollEdges();
  }
  private onScroll = (e: Event): void => {
    const viewport = e.currentTarget as HTMLElement;
    this.hoverSubItemId =
      viewport.dataset.viewport === 'root' ? null : (viewport.dataset.viewport ?? null);
    this.updateScrollEdges();
  };
  private updateScrollEdges(): void {
    const edges: typeof this.scrollEdges = {};
    for (const viewport of this.renderRoot.querySelectorAll<HTMLElement>('[data-viewport]')) {
      edges[viewport.dataset.viewport ?? 'root'] = {
        up: viewport.scrollTop > 1,
        down: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1,
      };
    }
    if (JSON.stringify(edges) !== JSON.stringify(this.scrollEdges)) {
      this.scrollEdges = edges;
    }
  }
  private activeSubmenus(): Extract<ContextMenuItem, { kind: 'submenu' }>[] {
    const find = (
      items: ContextMenuItem[],
    ): Extract<ContextMenuItem, { kind: 'submenu' }>[] | undefined => {
      for (const item of items) {
        if (item.id === this.hoverSubItemId) {
          return item.kind === 'submenu' && !item.disabled ? [item] : [];
        }
        if (item.kind === 'submenu' && !item.disabled) {
          const chain = find(item.children);
          if (chain) {
            return [item, ...chain];
          }
        }
      }
    };
    return find(this.items) ?? [];
  }
  private positionSubmenus(): void {
    for (const panel of this.renderRoot.querySelectorAll<HTMLElement>('[data-submenu-panel]')) {
      const anchor = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-menu-submenu]')].find(
        (el) => el.dataset.menuSubmenu === panel.dataset.submenuPanel,
      );
      const parent = anchor?.closest<HTMLElement>('[data-panel-id]');
      if (!anchor || !parent) {
        continue;
      }
      const parentRect = parent.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const width = panel.offsetWidth || 278;
      const right = parentRect.right - 1;
      const left = right + width <= window.innerWidth - 8 ? right : parentRect.left - width + 1;
      const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      panel.style.left = `${clampedLeft}px`;
      panel.style.maxHeight = 'calc(100dvh - 16px)';
      if (clampedLeft < parentRect.right - 1 && clampedLeft + width > parentRect.left + 1) {
        // Narrow windows cannot fit two panels side by side. Keep the anchor
        // row uncovered so pointer entry never selects a child by accident.
        const below = window.innerHeight - anchorRect.bottom - 8;
        const above = anchorRect.top - 8;
        const opensBelow = below >= above;
        panel.style.maxHeight = `${Math.max(28, opensBelow ? below : above)}px`;
        panel.style.top = `${opensBelow ? anchorRect.bottom : Math.max(8, anchorRect.top - panel.offsetHeight)}px`;
      } else {
        panel.style.top = `${Math.max(8, Math.min(anchorRect.top - 3, window.innerHeight - panel.offsetHeight - 8))}px`;
      }
    }
  }

  private renderNativeMenu(): TemplateResult {
    const entries = this.nativeEntries(this.items);
    const position = {
      left: Math.max(8, Math.min(this.x, window.innerWidth - 9)),
      top: Math.max(8, Math.min(this.y, window.innerHeight - 9)),
    };
    this.style.setProperty('--wb-context-menu-pointer-events', 'none');
    return html`<select
      class="wb-menu-native"
      data-context-menu
      data-native-menu
      aria-label="上下文菜单"
      style=${styleMap({ left: `${position.left}px`, top: `${position.top}px` })}
      @change=${this.selectNativeItem}
      @keydown=${this.handleNativeKeydown}
      @click=${(event: Event) => event.stopPropagation()}
    >
      ${entries.map(
        (entry) => html`<option
          value=${entry.id}
          ?disabled=${entry.disabled || entry.separator}
          data-separator=${entry.separator ? 'true' : 'false'}
        >
          ${entry.label}
        </option>`,
      )}
    </select>`;
  }

  private nativeEntries(
    items: ContextMenuItem[],
    parents: string[] = [],
    path = 'root',
  ): NativeMenuEntry[] {
    const entries: NativeMenuEntry[] = [];
    for (const [index, item] of items.entries()) {
      const itemPath = `${path}.${index}`;
      if (item.kind === 'separator') {
        entries.push({
          id: `separator:${itemPath}`,
          label: parents.length ? `${parents.join(' › ')} › ────────` : '────────────',
          disabled: true,
          separator: true,
        });
        continue;
      }
      if (item.kind === 'submenu') {
        if (item.disabled || !item.children.length) {
          entries.push({
            id: item.id,
            label: `${[...parents, item.label].join(' › ')}（不可用）`,
            disabled: true,
          });
        } else {
          entries.push(...this.nativeEntries(item.children, [...parents, item.label], itemPath));
        }
        continue;
      }
      const prefix = parents.length ? `${parents.join(' › ')} › ` : '';
      const state = item.kind === 'checkbox' ? `${item.checked ? '✓' : '　'} ` : '';
      const suffix =
        item.kind === 'input'
          ? '…'
          : item.kind === 'action' && item.shortcut
            ? `    ${item.shortcut}`
            : '';
      const itemDisabled = item.kind === 'input' ? false : Boolean(item.disabled);
      const disabledLabel = itemDisabled ? '（不可用）' : '';
      entries.push({
        id: item.id,
        label: `${prefix}${state}${item.label}${disabledLabel}${suffix}`,
        disabled:
          itemDisabled && !(item.kind === 'action' && typeof item.onDisabledSelect === 'function'),
      });
    }
    return entries;
  }

  private item(item: ContextMenuItem, path: string): TemplateResult {
    if (item.kind === 'separator') {
      return html`<div class="wb-menu__separator" data-menu-path=${path}></div>`;
    }
    if (item.kind === 'submenu') {
      return html`<div
        class="wb-menu__submenu"
        data-open=${this.needShowItem(item) ? 'true' : 'false'}
        @mouseenter=${() => {
          if (!item.disabled) {
            this.hoverSubItemId = item.id;
          }
        }}
      >
        <button
          class=${classMap({ 'wb-menu__item': true, disabled: Boolean(item.disabled) })}
          tabindex="-1"
          data-menu-submenu=${item.id}
          data-menu-path=${path}
          aria-disabled=${item.disabled ? 'true' : 'false'}
          aria-expanded=${this.needShowItem(item) ? 'true' : 'false'}
          @click=${this.openSubmenu}
          @keydown=${this.handleSubmenuKeydown}
          role="menuitem"
        >
          <span class="wb-menu__check"></span
          ><span class="wb-menu__icon" style=${styleMap({ display: item.icon ? '' : 'none' })}
            >${item.icon ? html`<wb-icon name=${item.icon} size="sm"></wb-icon>` : ''}</span
          ><span class="wb-menu__label">${item.label}</span
          ><span class="wb-menu__arrow"><wb-icon name="right" size="sm"></wb-icon></span>
        </button>
      </div>`;
    }
    if (item.kind === 'checkbox') {
      return html`<button
        class=${classMap({ 'wb-menu__item': true, disabled: Boolean(item.disabled) })}
        tabindex="-1"
        data-menu-id=${item.id}
        data-menu-path=${path}
        aria-disabled=${item.disabled ? 'true' : 'false'}
        @click=${this.selectItem}
        role="menuitemcheckbox"
        aria-checked=${item.checked ? 'true' : 'false'}
        @mouseenter=${(e: MouseEvent) => {
          e.stopPropagation();
          this.hoverSubItemId = item.id;
        }}
      >
        ${this.left(item.icon, item.checked)}<span class="wb-menu__label">${item.label}</span>
      </button>`;
    }
    if (item.kind === 'input') {
      return html`<div
        class="wb-menu__item"
        role="none"
        @mouseenter=${(e: MouseEvent) => {
          e.stopPropagation();
          this.hoverSubItemId = item.id;
        }}
      >
        ${this.left(item.icon)}<span class="wb-menu__label">${item.label}</span
        ><input
          class="wb-menu__input"
          data-menu-input=${item.id}
          type=${item.inputType}
          .value=${live(item.value)}
          placeholder=${item.placeholder ?? ''}
          @keydown=${this.submitInput}
          @click=${(event: Event) => event.stopPropagation()}
          aria-label=${item.label}
        />
      </div>`;
    }
    return html`<button
      class=${classMap({ 'wb-menu__item': true, disabled: Boolean(item.disabled) })}
      tabindex="-1"
      data-menu-id=${item.id}
      data-menu-path=${path}
      aria-disabled=${item.disabled ? 'true' : 'false'}
      @click=${this.selectItem}
      role="menuitem"
      @mouseenter=${(e: MouseEvent) => {
        e.stopPropagation();
        this.hoverSubItemId = item.id;
      }}
    >
      ${this.left(item.icon)}<span class="wb-menu__label">${item.label}</span>${item.shortcut
        ? html`<span class="wb-menu__shortcut">${item.shortcut}</span>`
        : ''}
    </button>`;
  }

  private left(iconName?: string, checked = false): TemplateResult {
    return html`<span class="wb-menu__check"
        >${checked ? html`<wb-icon name="check" size="sm"></wb-icon>` : ''}</span
      ><span class="wb-menu__icon" style=${styleMap({ display: iconName ? '' : 'none' })}
        >${iconName ? html`<wb-icon name=${iconName} size="sm"></wb-icon>` : ''}</span
      >`;
  }

  /**
   * 判断当前菜单项是否需要显示，主要用于子菜单的展开逻辑
   */
  private needShowItem(item: ContextMenuItem): boolean {
    const openSubmenuId = this.hoverSubItemId;
    if (item.id === openSubmenuId) {
      return true;
    }
    if (item.kind === 'submenu') {
      return item.children.some((child) => this.needShowItem(child));
    }
    return false;
  }

  private openSubmenu = (event: Event): void => {
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const id = element.dataset.menuSubmenu;
    if (id) {
      const item = this.findItem(this.items, id);
      if (item?.kind === 'submenu' && !item.disabled) {
        this.hoverSubItemId = id;
      }
    }
  };

  private handleSubmenuKeydown = async (event: KeyboardEvent): Promise<void> => {
    if (event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const id = element.dataset.menuSubmenu;
    const item = this.findItem(this.items, id ?? '');
    if (item?.kind !== 'submenu' || item.disabled) {
      return;
    }
    this.hoverSubItemId = id ?? null;
    await this.updateComplete;
    const panel = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-submenu-panel]')].find(
      (el) => el.dataset.submenuPanel === id,
    );
    panel
      ?.querySelector<HTMLElement>('[data-menu-id], [data-menu-submenu], [data-menu-input]')
      ?.focus({ preventScroll: true });
  };

  private selectItem = (event: Event): void => {
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const item = this.findItem(this.items, element.dataset.menuId ?? '');
    if (!item || ('disabled' in item && item.disabled)) {
      return;
    }
    emit(this, 'wb-menu-select', { id: element.dataset.menuId });
  };

  private submitInput = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const input = event.currentTarget as HTMLInputElement;
    emit(this, 'wb-menu-input-submit', { id: input.dataset.menuInput, value: input.value });
  };

  private selectNativeItem = (event: Event): void => {
    event.stopPropagation();
    const select = event.currentTarget as HTMLSelectElement;
    const id = select.value;
    select.selectedIndex = -1;
    const item = this.findItem(this.items, id);
    if (!item || item.kind === 'separator' || item.kind === 'submenu') {
      return;
    }
    if ('disabled' in item && item.disabled) {
      return;
    }
    if (item.kind === 'input') {
      this.nativePickerFailed = true;
      this.requestUpdate();
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLInputElement>(`[data-menu-input="${item.id}"]`)?.focus(),
      );
      return;
    }
    emit(this, 'wb-menu-select', { id: item.id });
  };

  private handleNativeKeydown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Tab') {
      this.requestClose('programmatic');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestClose('escape');
    }
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      this.requestClose('programmatic');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestClose('escape');
      return;
    }
    if (event.target instanceof HTMLInputElement) {
      return;
    }
    const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-panel-id]');
    if (event.key === 'ArrowLeft' && panel?.dataset.panelId !== 'root') {
      event.preventDefault();
      event.stopPropagation();
      const id = panel?.dataset.panelId;
      const anchor = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-menu-submenu]')].find(
        (el) => el.dataset.menuSubmenu === id,
      );
      this.hoverSubItemId =
        anchor?.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? null;
      anchor?.focus({ preventScroll: true });
      return;
    }
    const items = Array.from(
      panel?.querySelectorAll<HTMLElement>(
        '[data-menu-id], [data-menu-submenu], [data-menu-input]',
      ) ?? [],
    ).filter((el) => el.getAttribute('aria-disabled') !== 'true');
    if (!items.length) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.focusIndex = items.indexOf(event.target as HTMLElement);
      this.focusIndex =
        (this.focusIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      const target = items[this.focusIndex];
      target?.focus({ preventScroll: true });
      const viewport = target?.closest<HTMLElement>('.menu-viewport');
      if (viewport && target) {
        const rect = target.getBoundingClientRect(),
          view = viewport.getBoundingClientRect();
        if (rect.top < view.top) {
          viewport.scrollTop -= view.top - rect.top;
        } else if (rect.bottom > view.bottom) {
          viewport.scrollTop += rect.bottom - view.bottom;
        }
        this.updateScrollEdges();
      }
    } else if (
      event.key === 'Enter' &&
      event.target instanceof HTMLElement &&
      event.target.matches('[data-menu-id]')
    ) {
      event.preventDefault();
      event.target.click();
    }
  };

  private focusFirst(): void {
    const item = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        '[data-native-menu], [data-menu-id], [data-menu-submenu]',
      ),
    ].find((el) => el.getAttribute('aria-disabled') !== 'true');
    item?.focus({ preventScroll: true });
  }

  private findItem(items: ContextMenuItem[], id: string): ContextMenuItem | undefined {
    for (const item of items) {
      if (item.id === id) {
        return item;
      }
      if (item.kind === 'submenu') {
        const child = this.findItem(item.children, id);
        if (child) {
          return child;
        }
      }
    }
    return undefined;
  }

  private containsItem(items: ContextMenuItem[], id: string): boolean {
    return items.some(
      (item) => item.id === id || (item.kind === 'submenu' && this.containsItem(item.children, id)),
    );
  }

  private countSelectableItems(items: ContextMenuItem[]): number {
    return items.reduce(
      (count, item) =>
        count +
        (item.kind === 'separator' ? 0 : 1) +
        (item.kind === 'submenu' ? this.countSelectableItems(item.children) : 0),
      0,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wb-context-menu': WbContextMenu;
  }
}
