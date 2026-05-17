import style from './header.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { configContext, type TConfig } from '../store/config'

@customElement('scwc-layout-header')
export class SCWCHeaderLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @consume({ context: configContext, subscribe: true, })
  private accessor config: TConfig;

  render () {
    return html``;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-header": SCWCHeaderLayout;
  }
}