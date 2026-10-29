import './declarative-view.ts';
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { UIContribution } from '../../../shared/declarative-ui.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { FramePool } from '../workbench/frames.ts';
let pinnedStatus: string | null = null;
@customElement('wb-plugin-status')
export class PluginStatus extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor pool: FramePool | undefined;
  @property({ attribute: false }) accessor contribution!: UIContribution;
  @property({ attribute: false }) accessor sourceTabId: string | null = null;
  @state() private accessor opened = false;
  @state() private accessor pinned = false;
  @state() private accessor menuOpened = false;
  @state() private accessor popupHeight = 100;
  private menuPosition = { x: 0, y: 0 };
  private closeTimer?: ReturnType<typeof setTimeout>;
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private itemId = crypto.randomUUID();
  static styles = css`
    :host {
      display: flex;
      align-items: stretch;
      flex: 0 1 auto;
      width: auto;
      max-width: 180px;
      min-width: 30px;
      height: 24px;
      overflow: visible;
    }
    :host > wb-declarative-view[surface='statusBar'] {
      width: auto;
      min-width: 0;
    }
    .popup {
      position: fixed;
      box-sizing: border-box;
      width: 320px;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 60px);
      z-index: 600;
      background: var(--surface-2, #25272b);
      border: 1px solid var(--border-strong, #555);
      box-shadow: 0 8px 24px #0006;
      border-radius: var(--radius-md, 6px);
    }
    .popup::after {
      content: '';
      position: absolute;
      left: var(--pointer-left);
      bottom: -5px;
      width: 8px;
      height: 8px;
      transform: translateX(-50%) rotate(45deg);
      background: var(--surface-2, #25272b);
      border-right: 1px solid var(--border-strong, #555);
      border-bottom: 1px solid var(--border-strong, #555);
      pointer-events: none;
    }
    .popup.pinned {
      border-color: var(--accent-primary, #89b4fa);
    }
    .popup.pinned::after {
      border-color: var(--accent-primary, #89b4fa);
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('pointerdown', this.outside, true);
    window.addEventListener('scwc-ui-tooltip-open', this.other);
    window.addEventListener('keydown', this.escape);
    window.addEventListener('resize', this.reposition);
    this.addEventListener('ui-effect', this.effect);
  }
  disconnectedCallback() {
    this.close();
    clearTimeout(this.closeTimer);
    clearTimeout(this.hoverTimer);
    window.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('scwc-ui-tooltip-open', this.other);
    window.removeEventListener('keydown', this.escape);
    window.removeEventListener('resize', this.reposition);
    this.removeEventListener('ui-effect', this.effect);
    super.disconnectedCallback();
  }
  private reposition = () => this.requestUpdate();
  protected updated(changed: PropertyValues) {
    const old = changed.get('contribution') as UIContribution | undefined;
    if (
      old &&
      (old.pluginId !== this.contribution.pluginId ||
        old.ownerEpoch !== this.contribution.ownerEpoch ||
        old.id !== this.contribution.id)
    ) {
      this.close();
    }
  }
  private outside = (event: Event) => {
    if (!event.composedPath().includes(this)) {
      this.close();
    }
  };
  private other = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail.id !== this.itemId && (detail.pin || !this.pinned)) {
      this.close();
    }
  };
  private escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.close();
    }
  };
  private effect = (event: Event) => {
    const effect = (event as CustomEvent).detail;
    if (effect.type === 'tooltip.close') {
      event.stopPropagation();
      this.close();
    }
    if (effect.type === 'tooltip.pin' || effect.type === 'tooltip.open') {
      event.stopPropagation();
      this.open(effect.type === 'tooltip.pin');
    }
    if (effect.type === 'menu.open') {
      event.stopPropagation();
      this.openMenu();
    }
  };
  private close() {
    clearTimeout(this.closeTimer);
    clearTimeout(this.hoverTimer);
    if (pinnedStatus === this.itemId) {
      pinnedStatus = null;
    }
    this.opened = false;
    this.pinned = false;
    this.menuOpened = false;
  }
  private openMenu(x?: number, y?: number) {
    if (!this.contribution.hasContextMenu) {
      return;
    }
    const rect = this.getBoundingClientRect();
    this.close();
    this.menuPosition = { x: x ?? rect.left, y: y ?? rect.top };
    this.menuOpened = true;
  }
  private open(pin = false) {
    clearTimeout(this.closeTimer);
    clearTimeout(this.hoverTimer);
    if (!this.contribution.hasTooltip || (!pin && pinnedStatus && pinnedStatus !== this.itemId)) {
      return;
    }
    if (pin) {
      pinnedStatus = this.itemId;
    }
    window.dispatchEvent(
      new CustomEvent('scwc-ui-tooltip-open', { detail: { id: this.itemId, pin } }),
    );
    this.opened = true;
    this.pinned ||= pin;
  }
  private action = (event: CustomEvent<{ kind: string; x?: number; y?: number }>) => {
    event.stopPropagation();
    if (event.detail.kind === 'click') {
      this.open(true);
    }
    if (event.detail.kind === 'hover' && !this.opened) {
      this.hoverTimer = setTimeout(() => this.open(), 300);
    }
    if (event.detail.kind === 'leave' && !this.pinned) {
      clearTimeout(this.hoverTimer);
      this.closeTimer = setTimeout(() => {
        if (!this.pinned) {
          this.opened = false;
        }
      }, 200);
    }
    if (event.detail.kind === 'escape') {
      this.close();
    }
    if (event.detail.kind === 'contextmenu' && this.contribution.hasContextMenu) {
      this.openMenu(event.detail.x, event.detail.y);
    }
  };
  render() {
    const view = this.contribution;
    if (!view) {
      return nothing;
    }
    const anchor =
      this.renderRoot
        .querySelector('wb-declarative-view')
        ?.shadowRoot?.querySelector('button')
        ?.getBoundingClientRect() ?? this.getBoundingClientRect();
    const width = Math.min(320, innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(innerWidth - width - 8, anchor.left + anchor.width / 2 - width / 2),
    );
    const bottom = innerHeight - anchor.top + 8;
    const height = Math.max(40, Math.min(this.popupHeight, anchor.top - 16));
    const pointer = Math.max(12, Math.min(width - 12, anchor.left + anchor.width / 2 - left));
    const shared = { store: this.store, pool: this.pool, pluginId: view.pluginId, viewId: view.id };
    return html`<wb-declarative-view
        .store=${shared.store}
        .pool=${shared.pool}
        .pluginId=${shared.pluginId}
        .viewId=${shared.viewId}
        surface="statusBar"
        .sourceTabId=${this.sourceTabId}
        @ui-surface-action=${this.action}
      ></wb-declarative-view>
      ${this.opened
        ? html`<div
            class=${`popup ${this.pinned ? 'pinned' : ''}`}
            style=${`left:${left}px;bottom:${bottom}px;height:${height}px;--pointer-left:${pointer}px`}
            role=${this.pinned ? 'dialog' : 'tooltip'}
            aria-label=${view.title}
            @mouseenter=${() => clearTimeout(this.closeTimer)}
            @mouseleave=${() => {
              if (!this.pinned) {
                this.closeTimer = setTimeout(() => (this.opened = false), 200);
              }
            }}
          >
            <wb-declarative-view
              .store=${this.store}
              .pool=${this.pool}
              .pluginId=${view.pluginId}
              .viewId=${view.id}
              surface="tooltip"
              .sourceTabId=${this.sourceTabId}
              @ui-surface-action=${(e: CustomEvent<{ kind: string; height?: number }>) => {
                e.stopPropagation();
                if (
                  e.detail.kind === 'resize' &&
                  typeof e.detail.height === 'number' &&
                  Number.isFinite(e.detail.height)
                ) {
                  this.popupHeight = Math.ceil(e.detail.height) + 2;
                }
                if (e.detail.kind === 'click') {
                  this.pinned = true;
                }
                if (e.detail.kind === 'escape') {
                  this.close();
                }
              }}
            ></wb-declarative-view>
          </div>`
        : nothing}
      ${this.menuOpened
        ? html`<wb-declarative-view
            .store=${this.store}
            .pool=${this.pool}
            .pluginId=${view.pluginId}
            .viewId=${view.id}
            surface="contextMenu"
            .menuX=${this.menuPosition.x}
            .menuY=${this.menuPosition.y}
            .sourceTabId=${this.sourceTabId}
            @ui-menu-close=${() => {
              this.menuOpened = false;
              this.renderRoot
                .querySelector('wb-declarative-view')
                ?.shadowRoot?.querySelector('button')
                ?.focus();
            }}
          ></wb-declarative-view>`
        : nothing}`;
  }
}
