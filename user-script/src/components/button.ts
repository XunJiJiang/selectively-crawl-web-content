import style from './button.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('scwc-button')
export class SCWCButton extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: String })
  accessor label = '';

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor type: 'primary' | 'secondary' | 'inline' = 'primary';

  // @property({ type: String })
  // accessor name = '';

  // @property({ type: String })
  // accessor id = '';

  render () {
    return html`
      <button
        class=${[classMap({
      'scwc-btn-primary': this.type === 'primary',
      'scwc-btn-secondary': this.type === 'secondary',
      'scwc-btn-inline': this.type === 'inline',
      'scwc-btn-disabled': this.disabled,
    }), 'scwc-btn']}
        ?disabled=${this.disabled}
        @click=${() => this.dispatchEvent(new CustomEvent('click', { bubbles: true }))}
      >
        ${this.label}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-button": SCWCButton;
  }
}