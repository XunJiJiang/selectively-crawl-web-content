import style from './checkbox.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { v4 as uuidv4 } from 'uuid';

@customElement('scwc-checkbox')
export class SCWCContentLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Boolean })
  accessor checked = false;

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor label = '';

  @property({ type: String })
  accessor id = `scwc-checkbox-${uuidv4()}`;

  render () {
    return html`
      <label for=${this.id} class="scwc-checkbox-label">
        <input
          class=${classMap({
      'scwc-checkbox': true,
      'scwc-checkbox-disabled': this.disabled,
    })}
          id=${this.id}
          type="checkbox"
          .checked=${this.checked}
          ?disabled=${this.disabled}
          @change=${(e: Event) => {
        this.dispatchEvent(new CustomEvent('change', {
          detail: (e.target as HTMLInputElement).checked,
          bubbles: true,
        }));
      }}
        />
        <span class="scwc-checkbox-desc">${this.label}</span>
      </label>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-checkbox": SCWCContentLayout;
  }
}
