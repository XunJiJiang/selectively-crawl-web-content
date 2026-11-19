import './declarative-view.ts';
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { keyed } from 'lit/directives/keyed.js';
import './icon.ts';
import { SCWCTooltip, type TooltipPlacement } from '../../../shared/components/tooltip.ts';
import type { UIContribution } from '../../../shared/declarative-ui.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { FramePool } from '../workbench/frames.ts';

const tooltipPlacements: readonly TooltipPlacement[] = ['top'];
const loadingDelay = 500;

@customElement('wb-plugin-status')
export class PluginStatus extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor pool: FramePool | undefined;
  @property({ attribute: false }) accessor contribution!: UIContribution;
  @property({ attribute: false }) accessor sourceTabId: string | null = null;
  @state() private accessor menuOpened = false;
  @state() private accessor popupMode: 'pending' | 'loading' | 'html' | 'json' = 'pending';
  @state() private accessor popupHeight = 0;
  @state() private accessor popupWidth = 0;
  private popupGeneration = 0;
  private loadingTimer?: ReturnType<typeof setTimeout>;
  private menuPosition = { x: 0, y: 0 };
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
    scwc-tooltip[data-mode='json'] {
      width: max-content;
      max-width: min(450px, calc(100vw - 16px));
      max-height: var(--tooltip-space-above, calc(100vh - 16px));
    }
    scwc-tooltip[data-mode='json']::part(content) {
      height: auto;
      max-height: max(0px, calc(var(--tooltip-space-above, 100vh - 16px) - 2px));
    }
    scwc-tooltip[data-mode='html'],
    scwc-tooltip[data-mode='html']::part(content) {
      max-width: none;
      max-height: none;
    }
    scwc-tooltip[data-mode='pending'],
    scwc-tooltip[data-mode='loading'] {
      width: max-content;
    }
    .loading {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
    }
    .loading wb-icon {
      animation: tooltip-spin 1s linear infinite;
    }
    @keyframes tooltip-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .loading wb-icon { animation: none; }
    }
  `;
  private get tooltip() {
    return this.renderRoot.querySelector<SCWCTooltip>('scwc-tooltip');
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('ui-effect', this.effect);
  }
  disconnectedCallback() {
    this.close();
    this.removeEventListener('ui-effect', this.effect);
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    const old = changed.get('contribution') as UIContribution | undefined;
    if (
      old &&
      (!this.contribution.hasTooltip ||
        old.pluginId !== this.contribution.pluginId ||
        old.ownerEpoch !== this.contribution.ownerEpoch ||
        old.id !== this.contribution.id)
    ) {
      this.close();
    }
  }
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
    this.tooltip?.close();
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
  private get anchor(): HTMLElement {
    return (
      this.renderRoot.querySelector('wb-declarative-view')?.shadowRoot?.querySelector('button') ??
      this
    );
  }
  private open(pin = false) {
    if (this.contribution.hasTooltip) {
      void this.tooltip?.openFor(this.anchor, undefined, pin);
    }
  }
  private action = (event: CustomEvent<{ kind: string; x?: number; y?: number }>) => {
    event.stopPropagation();
    if (this.contribution.hasTooltip && ['click', 'hover', 'leave'].includes(event.detail.kind)) {
      this.tooltip?.trigger(event.detail.kind as 'click' | 'hover' | 'leave', this.anchor);
    }
    if (event.detail.kind === 'escape') {
      this.close();
    }
    if (event.detail.kind === 'contextmenu') {
      this.openMenu(event.detail.x, event.detail.y);
    }
  };
  private resetPopup = () => {
    clearTimeout(this.loadingTimer);
    this.popupMode = 'pending';
    this.popupHeight = 0;
    this.popupWidth = 0;
  };
  private popupClosed = () => {
    this.popupGeneration++;
    this.resetPopup();
    this.requestUpdate();
  };
  private tooltipAction = (event: CustomEvent<{ kind: string; height?: number; width?: number }>) => {
    event.stopPropagation();
    if (!this.tooltip?.opened) {
      return;
    }
    if (event.detail.kind === 'prepare') {
      this.resetPopup();
      this.loadingTimer = setTimeout(() => {
        this.popupMode = 'loading';
      }, loadingDelay);
    }
    if (
      event.detail.kind === 'error' ||
      (event.detail.kind === 'ready' && event.detail.width === undefined)
    ) {
      clearTimeout(this.loadingTimer);
      this.popupMode = 'json';
    }
    if (
      (event.detail.kind === 'resize' || event.detail.kind === 'ready') &&
      typeof event.detail.height === 'number' &&
      Number.isFinite(event.detail.height) &&
      typeof event.detail.width === 'number' &&
      Number.isFinite(event.detail.width)
    ) {
      clearTimeout(this.loadingTimer);
      const fixed = event.detail.kind === 'ready';
      this.popupHeight = fixed ? event.detail.height : Math.ceil(event.detail.height) + 2;
      this.popupWidth = fixed ? event.detail.width : Math.ceil(event.detail.width) + 2;
      this.popupMode = 'html';
    }
    if (event.detail.kind === 'click') {
      this.tooltip?.pin();
    }
    if (event.detail.kind === 'escape') {
      this.close();
    }
  };
  render() {
    const view = this.contribution;
    if (!view) {
      return nothing;
    }
    const measuring = this.popupMode === 'pending' || this.popupMode === 'loading';
    const loading = this.popupMode === 'loading';
    const content = () => html`
      ${keyed(this.popupGeneration, html`<wb-declarative-view
        .store=${this.store}
        .pool=${this.pool}
        .pluginId=${view.pluginId}
        .viewId=${view.id}
        surface="tooltip"
        ?inert=${measuring}
        .sourceTabId=${this.sourceTabId}
        @ui-surface-action=${this.tooltipAction}
      ></wb-declarative-view>`)}
      ${loading ? html`<slot name="loading"></slot>` : nothing}
    `;
    return html`<wb-declarative-view
        .store=${this.store}
        .pool=${this.pool}
        .pluginId=${view.pluginId}
        .viewId=${view.id}
        surface="statusBar"
        .sourceTabId=${this.sourceTabId}
        @ui-surface-action=${this.action}
      ></wb-declarative-view>
      <scwc-tooltip
        interactive
        arrow
        group="plugin-status"
        triggers="hover click"
        aria-label=${view.title}
        data-mode=${this.popupMode}
        .concealed=${this.popupMode === 'pending'}
        .placements=${tooltipPlacements}
        style=${styleMap({
          height: this.popupMode === 'html' ? `${this.popupHeight}px` : undefined,
          width: this.popupMode === 'html' ? `${this.popupWidth}px` : undefined,
        })}
        @tooltip-close=${this.popupClosed}
        .content=${content}
      >
        ${loading
          ? html`<span slot="loading" class="loading" role="status" aria-label="正在加载"
              ><wb-icon name="loading" aria-hidden="true"></wb-icon></span>`
          : nothing}
      </scwc-tooltip>
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
              this.anchor.focus();
            }}
          ></wb-declarative-view>`
        : nothing}`;
  }
}
