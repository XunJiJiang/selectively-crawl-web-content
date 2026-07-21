import style from './button.css?raw';

import { LitElement, html, css, unsafeCSS, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('scwc-button')
class SCWCButton extends LitElement {
  static styles = [
    css`
      ${unsafeCSS(style)}
    `,
  ];

  @property({ type: Boolean })
  accessor active = false;

  @property({ type: String })
  accessor label = '';

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor type: 'primary' | 'secondary' | 'inline' = 'primary';

  @property({ type: String, attribute: 'btn-style' })
  accessor btnStyle = '';

  @property({ type: String })
  accessor title = '';

  @property({ type: String, attribute: 'aria-label' })
  accessor ariaLabel = '';

  // @property({ type: String })
  // accessor name = '';

  // @property({ type: String })
  // accessor id = '';

  render() {
    return html`
      <button
        part="button"
        class=${classMap({
          'scwc-btn-primary': this.type === 'primary',
          'scwc-btn-secondary': this.type === 'secondary',
          'scwc-btn-inline': this.type === 'inline',
          'scwc-btn-disabled': this.disabled,
          active: this.active,
          'scwc-btn': true,
        })}
        title=${this.title}
        aria-label=${this.ariaLabel}
        style=${this.btnStyle}
        ?disabled=${this.disabled}
        @click=${(e: MouseEvent) => {
          e.stopPropagation();
          this.dispatchEvent(new CustomEvent('click', { bubbles: true }));
        }}
      >
        <slot name="before"></slot>
        <slot>${this.label || nothing}</slot>
        <slot name="after"></slot>
      </button>
    `;
  }
}

export interface SCWCButtonEventMap {
  click: CustomEvent<void>;
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-button': SCWCButton;
  }
}
