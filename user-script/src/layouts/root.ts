import style from './root.css?raw';
import './minimized.ts';
import './header.ts';
import './content.ts';
import './footer.ts';

import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { loadFromStorage, saveToStorage } from '../utils/storage.ts';
import { POS_KEY, INIT_POS, MINIMIZED_KEY, PLUGIN_EXPANDED_KEY } from '../utils/common.ts';
import { styleMap } from 'lit/directives/style-map.js';
import type { Item } from '../types/claw';

@customElement('scwc-layout-root')
export class SCWCRootLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  /** 是否最小化 */
  @property({ type: Boolean, reflect: true })
  private accessor minimized: boolean = loadFromStorage(MINIMIZED_KEY, true);

  /** 设置是否最小化 */
  private setMinimized (value: boolean) {
    this.minimized = value;
    saveToStorage(MINIMIZED_KEY, value);
  }

  /** 窗口位置 */
  @property({ type: Object })
  private accessor position: { readonly x: number, readonly y: number } = loadFromStorage(POS_KEY, INIT_POS);

  /** 设置窗口位置 */
  private setPosition (x: number | null, y: number | null) {
    this.position = {
      x: x ?? this.position.x,
      y: y ?? this.position.y,
    };
    saveToStorage(POS_KEY, this.position);
  }

  /** 是否展开选择框 */
  @property({ type: Boolean, reflect: true })
  private accessor selectionExpanded = false;

  /** 设置是否展开选择框 */
  private setSelectionExpanded (value: boolean) {
    this.selectionExpanded = value;
  }

  /** 是否展开插件 */
  @property({ type: Boolean, reflect: true })
  private accessor pluginExpanded: boolean = loadFromStorage(PLUGIN_EXPANDED_KEY, false);

  /** 设置是否展开插件 */
  private setPluginExpanded (value: boolean) {
    this.pluginExpanded = value;
    saveToStorage(PLUGIN_EXPANDED_KEY, value);
  }

  /** 抓取的元素项列表 */
  @state()
  private accessor clawItems: Item[] = [];

  render () {
    return this.minimized ? html`
      <scwc-layout-minimized
        @maximize=${() => this.setMinimized(false)}
        @move=${(e: CustomEvent<{ x: number, y: number }>) => this.setPosition(e.detail.x, e.detail.y)}
        .position=${this.position}
      ></scwc-layout-minimized>
    ` : html`
      <div
        class="scwc-layout-root"
        style=${styleMap({
      left: `${this.position.x}px`,
      top: `${this.position.y}px`,
      'min-width': this.selectionExpanded ? '320px' : '100px',
      'min-height': this.selectionExpanded ? '180px' : '56px',
    })}
        .position=${this.position}
        .selectionExpanded=${this.selectionExpanded}
        .pluginExpanded=${this.pluginExpanded}
      >
        <scwc-layout-header
          @move=${(e: CustomEvent<{ x: number, y: number }>) => this.setPosition(e.detail.x, e.detail.y)}
          @toggleclaw=${() => this.setSelectionExpanded(!this.selectionExpanded)}
          @toggleplugin=${() => this.setPluginExpanded(!this.pluginExpanded)}
          @minimize=${() => this.setMinimized(true)}
        ></scwc-layout-header>
        <scwc-layout-content
          .selectionExpanded=${this.selectionExpanded}
          @trigger-selection-expanded=${(e: CustomEvent<boolean>) => this.setSelectionExpanded(e.detail)}
          .pluginExpanded=${this.pluginExpanded}
          @claw-items-changed=${(e: CustomEvent<Item[]>) => {
        this.clawItems = e.detail;
      }}
        ></scwc-layout-content>
        <scwc-layout-footer></scwc-layout-footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-root": SCWCRootLayout;
  }
}
