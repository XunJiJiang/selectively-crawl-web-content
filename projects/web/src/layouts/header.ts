import style from './header.css?raw';
import { html, LitElement, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('app-header')
class AppHeader extends LitElement {
  static styles = css`
    ${unsafeCSS(style)}
  `;

  @property({ type: Boolean })
  private accessor isLeftBarExpanded = false;

  render() {
    return html`
      <header id="root-header">
        <div class="expand-collapse-btn">
          <scwc-button
            type="secondary"
            title="展开/收起"
            aria-label="展开/收起"
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('toggle-left-bar', { bubbles: true, composed: true }),
              );
            }}
          >
            ${this.isLeftBarExpanded
              ? html`<svg
                  color="#777"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                >
                  <path
                    d="M12.5 1C13.881 1 15 2.119 15 3.5V12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5ZM12.5 14C13.328 14 14 13.328 14 12.5V3.5C14 2.672 13.328 2 12.5 2H7V14H12.5Z"
                  />
                </svg>`
              : html`<svg
                  color="#777"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                >
                  <path
                    d="M1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.122 13.878 1 12.5 1H3.5C2.122 1 1 2.122 1 3.5ZM12.5 14H7V2H12.5C13.327 2 14 2.673 14 3.5V12.5C14 13.327 13.327 14 12.5 14ZM2 3.5C2 2.673 2.673 2 3.5 2H6V14H3.5C2.673 14 2 13.327 2 12.5V3.5Z"
                  />
                </svg>`}
          </scwc-button>
        </div>
        <p>SCWC</p>
      </header>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-header': AppHeader;
  }
}
