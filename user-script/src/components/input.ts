import style from './input.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { v4 as uuidv4 } from 'uuid';

@customElement('scwc-input')
class SCWCInput extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor value = '';

  @property({ type: String, reflect: true })
  accessor type: 'text' | 'number' = 'text';

  /** 描述与输入框是否在一行 */
  @property({ type: Boolean, reflect: true })
  accessor inline = false;

  @property({ type: String })
  accessor label = '';

  @property({ type: String })
  accessor placeholder = '';

  @property({ type: String })
  accessor id = `scwc-input-${uuidv4()}`;

  @property({ type: String })
  accessor title = '';

  @property({ type: String, attribute: 'aria-label' })
  accessor ariaLabel = ''

  render () {
    return html`
      <label part="label" for=${this.id} class="scwc-input-label" data-inline=${this.inline}>
        <span part="description" class="scwc-input-desc">${this.label}</span>
        <input
          part="input"
          class=${classMap({
      'scwc-input-text': this.type === 'text',
      'scwc-input-number': this.type === 'number',
      'scwc-input-disabled': this.disabled,
      'scwc-input': true,
    })}
          placeholder=${this.placeholder}
          id=${this.id}
          type=${this.type}
          title=${this.title}
          aria-label=${this.ariaLabel}
          .value=${this.value}
          ?disabled=${this.disabled}
          @input=${(e: Event) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('input', { detail: (e.target as HTMLInputElement).value })); }}
          @change=${(e: Event) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('change', { detail: (e.target as HTMLInputElement).value })); }}
          @blur=${(e: Event) => { e.stopPropagation(); this.dispatchEvent(new CustomEvent('blur', { detail: (e.target as HTMLInputElement).value })); }}
        />
      </label>
    `;
  }
}

export interface SCWCInputEventMap {
  'input': CustomEvent<string>;
  'change': CustomEvent<string>;
  'blur': CustomEvent<string>;
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-input": SCWCInput;
  }
}