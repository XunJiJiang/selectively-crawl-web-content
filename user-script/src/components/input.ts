import style from './input.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('scwc-input')
export class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: String, attribute: 'value' })
  accessor value = '';

  @property({ type: String })
  accessor type: 'text' | 'number' = 'text';

  render () {
    return html`
      <input
        class=${['scwc-input', classMap({
      'scwc-input-text': this.type === 'text',
      'scwc-input-number': this.type === 'number',
    })]}
        type=${this.type}
        .value=${this.value}
        @input=${(e: Event) => this.dispatchEvent(new CustomEvent('input', { detail: (e.target as HTMLInputElement).value }))}
        @change=${(e: Event) => this.dispatchEvent(new CustomEvent('change', { detail: (e.target as HTMLInputElement).value }))}
        @blur=${(e: Event) => this.dispatchEvent(new CustomEvent('blur', { detail: (e.target as HTMLInputElement).value }))}
      />
    `;
  }
}



declare global {
  interface HTMLElementTagNameMap {
    "scwc-input": SCWCContentLayout;
  }
}