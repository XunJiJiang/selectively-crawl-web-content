import style from './content.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-layout-content')
export class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  render () {
    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-content": SCWCContentLayout;
  }
}