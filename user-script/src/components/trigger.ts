import style from './trigger.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-trigger')
export class SCWCTrigger extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: String })
  accessor label = '';

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor type: 'primary' | 'secondary' | 'inline' = 'primary';

  render () {
    return html`
      <scwc-button
        type=${this.type}
        ?disabled=${this.disabled}
        label=${this.label}
        @trigger=${() => this.dispatchEvent(new CustomEvent('click', { bubbles: true }))}
      ></scwc-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-trigger": SCWCTrigger;
  }
}