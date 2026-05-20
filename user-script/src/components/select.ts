import style from './select.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-select')
export class SCWCSelect extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  render () {
    return html``;
  }
}



declare global {
  interface HTMLElementTagNameMap {
    "scwc-select": SCWCSelect;
  }
}