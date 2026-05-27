import style from './footer.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('scwc-layout-footer')
class SCWCFooterLayout extends LitElement {
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