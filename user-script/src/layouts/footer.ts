import style from './footer.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-layout-footer')
export class SCWCFooterLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  render () {
    return html``;
  }

  connectedCallback () {}
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-footer": SCWCFooterLayout;
  }
}