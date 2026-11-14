import './declarative-view.ts';
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { SCWCTooltip } from '../../../shared/components/tooltip.ts';
import type { UIContribution } from '../../../shared/declarative-ui.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { FramePool } from '../workbench/frames.ts';

@customElement('wb-plugin-status')
export class PluginStatus extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor pool: FramePool | undefined;
  @property({ attribute: false }) accessor contribution!: UIContribution;
  @property({ attribute: false }) accessor sourceTabId: string | null = null;
  @state() private accessor menuOpened = false;
  @state() private accessor popupHeight = 100;
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
  private tooltipAction = (event: CustomEvent<{ kind: string; height?: number }>) => {
    event.stopPropagation();
    if (
      event.detail.kind === 'resize' &&
      typeof event.detail.height === 'number' &&
      Number.isFinite(event.detail.height)
    ) {
      this.popupHeight = Math.ceil(event.detail.height) + 2;
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
        .placements=${['top', 'bottom', 'right', 'left', 'current']}
        style=${`height:min(${Math.max(40, this.popupHeight)}px, calc(100vh - 16px))`}
        .content=${() => html`<wb-declarative-view
          .store=${this.store}
          .pool=${this.pool}
          .pluginId=${view.pluginId}
          .viewId=${view.id}
          surface="tooltip"
          .sourceTabId=${this.sourceTabId}
          @ui-surface-action=${this.tooltipAction}
        ></wb-declarative-view>`}
      ></scwc-tooltip>
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
