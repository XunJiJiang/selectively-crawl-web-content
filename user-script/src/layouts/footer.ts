import style from './footer.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { config, configContext, type TConfig } from '../store/config';
import { consume } from '@lit/context';

@customElement('scwc-layout-footer')
export class SCWCFooterLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @consume({ context: configContext, subscribe: true })
  private accessor config: TConfig = config;

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