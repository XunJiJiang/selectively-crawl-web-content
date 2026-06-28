import style from './toggle.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { v4 as uuidv4 } from 'uuid';

@customElement('scwc-toggle')
class SCWCToggle extends LitElement {
  static styles = [
    css`
      ${unsafeCSS(style)}
    `,
  ];

  @property({ type: Boolean })
  accessor checked = false;

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor label = '';

  @property({ type: String })
  accessor id = `scwc-toggle-${uuidv4()}`;

  @property({ type: String })
  accessor title = '';

  @property({ type: String, attribute: 'aria-label' })
  accessor ariaLabel = '';

  render() {
    return html`
      <scwc-checkbox
        id=${this.id}
        title=${this.title}
        aria-label=${this.ariaLabel}
        .checked=${this.checked}
        ?disabled=${this.disabled}
        .label=${this.label}
        @change=${(e: CustomEvent<boolean>) => {
          e.stopPropagation();
          this.dispatchEvent(
            new CustomEvent('change', {
              detail: e.detail,
              bubbles: true,
            }),
          );
        }}
      ></scwc-checkbox>
    `;
  }
}

export interface SCWCToggleEventMap {
  change: CustomEvent<boolean>;
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-toggle': SCWCToggle;
  }
}
