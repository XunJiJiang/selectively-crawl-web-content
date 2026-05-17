import style from './header.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-layout-header')
export class SCWCHeaderLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  render () {
    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-header": SCWCHeaderLayout;
  }
}