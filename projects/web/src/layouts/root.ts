import './header.ts';
import './content.ts';
import './footer.ts';

import { customElement, state } from 'lit/decorators.js';
import style from './root.css?raw';
import { html, LitElement, css, unsafeCSS } from 'lit';

@customElement('app-root')
class AppRoot extends LitElement {
  static styles = css`
    ${unsafeCSS(style)}
  `;

  @state()
  private accessor isLeftBarExpanded = true;

  render() {
    return html`
      <app-header
        .isLeftBarExpanded=${this.isLeftBarExpanded}
        @toggle-left-bar=${() => {
          this.isLeftBarExpanded = !this.isLeftBarExpanded;
        }}
      ></app-header>
      <app-content .isLeftBarExpanded=${this.isLeftBarExpanded}></app-content>
      <app-footer></app-footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-root': AppRoot;
  }
}
