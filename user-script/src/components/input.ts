import style from './input.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { v4 as uuidv4 } from 'uuid';

@customElement('scwc-input')
export class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor value = '';

  @property({ type: String })
  accessor type: 'text' | 'number' = 'text';

  @property({ type: String })
  accessor label = '';

  @property({ type: String })
  accessor id = `scwc-input-${uuidv4()}`;

  render () {
    return html`
      <label for=${this.id} class="scwc-input-label">
        <span class="scwc-input-desc">${this.label}</span>
        <input
          class=${['scwc-input', classMap({
      'scwc-input-text': this.type === 'text',
      'scwc-input-number': this.type === 'number',
      'scwc-input-disabled': this.disabled,
    })]}
          id=${this.id}
          type=${this.type}
          .value=${this.value}
          ?disabled=${this.disabled}
          @input=${(e: Event) => this.dispatchEvent(new CustomEvent('input', { detail: (e.target as HTMLInputElement).value }))}
          @change=${(e: Event) => this.dispatchEvent(new CustomEvent('change', { detail: (e.target as HTMLInputElement).value }))}
          @blur=${(e: Event) => this.dispatchEvent(new CustomEvent('blur', { detail: (e.target as HTMLInputElement).value }))}
        />
      </label>
    `;
  }
}



declare global {
  interface HTMLElementTagNameMap {
    "scwc-input": SCWCContentLayout;
  }
}