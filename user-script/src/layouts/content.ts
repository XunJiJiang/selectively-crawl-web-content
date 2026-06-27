import style from './content.css?raw';
import './content-claw.ts';
import './content-plugin.ts';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('scwc-layout-content')
class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Boolean })
  public accessor selectionExpanded = false;
  @property({ type: Boolean })
  public accessor pluginExpanded = false;
  @property({ type: String })
  public accessor currentPluginTab = '';

  @state()
  private accessor clawItems = [];

  render () {
    return html`
      <div>
        <scwc-layout-content-claw
          .expanded=${this.selectionExpanded}
          @items-changed=${(e: CustomEvent) => {
        this.clawItems = e.detail;
        this.dispatchEvent(new CustomEvent('claw-items-changed', { detail: e.detail }));
      }}
      @trigger-selection-expanded=${(e: CustomEvent) => {
        this.dispatchEvent(new CustomEvent('trigger-selection-expanded', { detail: e.detail }));
      }}
        ></scwc-layout-content-claw>
        <scwc-layout-content-plugin
          .expanded=${this.pluginExpanded}
          .clawItems=${this.clawItems}
          .currentPluginTab=${this.currentPluginTab}
          @current-plugin-tab-changed=${(e: CustomEvent<string>) => {
        this.dispatchEvent(new CustomEvent('current-plugin-tab-changed', { detail: e.detail }));
      }}
        ></scwc-layout-content-plugin>
      </div>
    `;
  }
}



declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-content": SCWCContentLayout;
  }
}