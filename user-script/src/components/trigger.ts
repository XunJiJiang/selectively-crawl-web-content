import style from './trigger.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('scwc-trigger')
class SCWCTrigger extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: String })
  accessor label = '';

  @property({ type: Boolean })
  accessor disabled = false;

  @property({ type: String })
  accessor type: 'primary' | 'secondary' | 'inline' = 'primary';

  @property({ type: String })
  accessor title = '';

  @property({ type: String, attribute: 'aria-label' })
  accessor ariaLabel = ''

  render () {
    return html`
      <scwc-button
        type=${this.type}
        ?disabled=${this.disabled}
        label=${this.label}
        title=${this.title}
        aria-label=${this.ariaLabel}
        @click=${(e: MouseEvent) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('trigger', { bubbles: true }));
      }}
      ></scwc-button>
    `;
  }
}

export interface SCWCTriggerEventMap {
  'trigger': CustomEvent<void>;
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-trigger": SCWCTrigger;
  }
}