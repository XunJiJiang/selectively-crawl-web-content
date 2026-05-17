import style from './root.css?raw';
import './header.ts';
import './content.ts';
import './footer.ts';

import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-layout-root')
export class SCWCRootLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  render () {
    return html`
      <scwc-layout-header></scwc-layout-header>
      <scwc-layout-content></scwc-layout-content>
      <scwc-layout-footer></scwc-layout-footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-root": SCWCRootLayout;
  }
}
