import style from './content.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { config, configContext, type TConfig } from '../store/config';
import { consume } from '@lit/context';

@customElement('scwc-layout-content')
export class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @consume({ context: configContext, subscribe: true })
  private accessor config: TConfig = config;

  render () {
    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-content": SCWCContentLayout;
  }
}