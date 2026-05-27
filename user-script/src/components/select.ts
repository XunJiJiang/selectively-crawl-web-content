import style from './select.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('scwc-select')
export class SCWCSelect extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: String })
  accessor label = '';

  @property({ type: String })
  accessor value = '';

  @property({ type: String })
  accessor placeholder = '请选择';

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: Array, attribute: false })
  accessor options: { label: string; value: string }[] = [];

  @property({ type: String })
  accessor title = '';

  @property({ type: String, attribute: 'aria-label' })
  accessor ariaLabel = ''

  render () {
    return html`
      <div part="root" class="scwc-select">
        <span part="description" class="scwc-select-label">${this.label}</span>
        <select
          part="select"
          class=${classMap({
      'scwc-select-control': true,
      'scwc-select-control-disabled': this.disabled,
    })}
          title=${this.title}
          aria-label=${this.ariaLabel}
          .value=${this.value}
          ?disabled=${this.disabled}
          @change=${(e: Event) => this.dispatchEvent(new CustomEvent('change', { detail: (e.target as HTMLSelectElement).value }))}>
          <option part="option placeholder" value="" disabled>${this.placeholder}</option>
          ${this.options.map(option => html`
            <option part="option" value=${option.value}>${option.label}</option>
          `)}
        </select>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-select": SCWCSelect;
  }
}
