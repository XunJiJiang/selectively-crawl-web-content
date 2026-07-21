import style from './content.css?raw';
import { html, LitElement, css, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ConfigController } from '../../../shared/store/config.ts';
import type { TPluginPagesResult } from '../types/api.d.ts';
import { getPluginPages } from '../api/plugins.ts';

@customElement('app-content')
class AppContent extends LitElement {
  static styles = css`
    ${unsafeCSS(style)}
  `;

  private configController = new ConfigController(this);

  @property({ type: Boolean })
  private accessor isLeftBarExpanded = true;

  @state()
  private accessor pluginPages: TPluginPagesResult = [];

  @state()
  private accessor focusPluginPage: TPluginPagesResult[number] | null = null;

  render() {
    return html`
      <main id="root-content">
        <div class="root-aside" ?hidden=${!this.isLeftBarExpanded}>
          ${this.pluginPages.map(
            (pluginPage) => html`<div>
              <scwc-button @click=${() => (this.focusPluginPage = pluginPage)}>
                ${pluginPage.dir}
              </scwc-button>
            </div>`,
          )}
        </div>
        <div class="root-main">
          <iframe
            class="plugin-iframe"
            src=${`${this.configController.config.api.host}:${this.configController.config.api.port.replace(/[^\d]/g, '')}/web/page/plugin/${this.focusPluginPage?.dir}?site=${encodeURIComponent(window.location.href)}`}
            ?hidden=${!this.focusPluginPage}
          ></iframe>
        </div>
      </main>
    `;
  }

  connectedCallback() {
    super.connectedCallback();
    getPluginPages(this.configController.config).then((res) => {
      if (res.success) {
        this.pluginPages = res.data ?? [];
      }
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-content': AppContent;
  }
}
