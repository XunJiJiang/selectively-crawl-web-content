import style from './toggle.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-toggle')
export class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  render () {
    return html``;
  }
}



declare global {
  interface HTMLElementTagNameMap {
    "scwc-toggle": SCWCContentLayout;
  }
}