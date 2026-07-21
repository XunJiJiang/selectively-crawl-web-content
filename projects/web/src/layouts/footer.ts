import style from './footer.css?raw';
import { html, LitElement, css, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('app-footer')
class AppFooter extends LitElement {
  static styles = css`
    ${unsafeCSS(style)}
  `;

  render() {
    return html` <footer id="root-footer"></footer> `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-footer': AppFooter;
  }
}
