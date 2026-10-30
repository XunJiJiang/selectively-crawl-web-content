import style from './content-plugin.css?raw';
import { controls } from '../theme.ts';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Item } from '../types/claw.d.ts';
import { styleMap } from 'lit/directives/style-map.js';
import { PluginsController } from './hooks/plugins.ts';
import type { SCWCCheckboxEventMap } from '../../../shared/components/checkbox.ts';
import type { SCWCInputEventMap } from '../../../shared/components/input.ts';

@customElement('scwc-layout-content-plugin')
export class SCWCContentPlugin extends LitElement {
  static styles = [
    controls,
    css`
      ${unsafeCSS(style)}
    `,
  ];

  @property({ type: Boolean })
  accessor expanded = false;

  @property({ type: Array, attribute: false })
  accessor clawItems: Item[] = [];

  @property({ type: String })
  accessor currentPluginTab = '';

  private pluginsController = new PluginsController(this);

  render() {
    const plugins = this.pluginsController.plugins;
    const activeTab = this.pluginsController.activeTab;
    const activePlugin = this.pluginsController.activePlugin;

    if (this.expanded) {
      this.pluginsController.requestPlugins();
    }

    return html`
      <div
        class="plugin-window"
        style=${styleMap({
          display: this.expanded ? 'flex' : 'none',
        })}
      >
        <!-- Tabs -->
        <wb-scroll-container class="plugin-tabs-scroll" thin
          ><div class="plugin-window-tabs" role="tablist">
            ${plugins?.map(
              (plugin) => html`
                <button
                  type="button"
                  role="tab"
                  aria-selected=${activeTab === plugin.id}
                  class="plugin-window-tab"
                  data-active=${activeTab === plugin.id}
                  @click=${() => {
                    this.pluginsController.setActiveTab(plugin.id);
                    this.pluginsController.setActivePlugin(plugin);
                    this.dispatchEvent(
                      new CustomEvent('current-plugin-tab-changed', {
                        detail: plugin.id,
                      }),
                    );
                  }}
                >
                  ${plugin.title}
                </button>
              `,
            )}
          </div></wb-scroll-container
        >
        <!-- Plugin Content -->
        <wb-scroll-container class="plugin-content-scroll"
          ><div class="plugin-window-content" role="tabpanel">
            ${activeTab && activePlugin
              ? activePlugin.controls.map((control) => {
                  switch (control.type) {
                    case 'button':
                      return html`
                        <scwc-button
                          title=${control.label}
                          aria-label=${control.label}
                          @click=${() => this.pluginsController.setControlValue(control, null)}
                          >${control.label}</scwc-button
                        >
                      `;
                    case 'toggle':
                      return html`
                        <scwc-checkbox
                          .checked=${this.pluginsController.getControlValue(control) === true}
                          label=${control.label}
                          title=${control.label}
                          aria-label=${control.label}
                          @change=${(e: SCWCCheckboxEventMap['change']) =>
                            this.pluginsController.setControlValue(control, e.detail)}
                        ></scwc-checkbox>
                      `;
                    case 'select':
                      return html`
                        <label class="plugin-select"
                          ><span>${control.label}</span>
                          <wb-menu-select
                            .label=${control.label}
                            .value=${this.pluginsController.getControlValue(control)?.toString() ??
                            ''}
                            .options=${control.options?.options ?? []}
                            @wb-menu-change=${(e: CustomEvent<{ value: string }>) =>
                              this.pluginsController.setControlValue(control, e.detail.value)}
                          ></wb-menu-select
                        ></label>
                      `;
                    case 'input:text':
                      return html`
                        <scwc-input
                          type="text"
                          label=${control.label}
                          title=${control.label}
                          aria-label=${control.label}
                          value=${this.pluginsController.getControlValue(control)?.toString()}
                          @change=${(e: SCWCInputEventMap['change']) =>
                            this.pluginsController.setControlValue(control, e.detail)}
                        ></scwc-input>
                      `;
                    case 'input:number':
                      return html`
                        <scwc-input
                          type="number"
                          label=${control.label}
                          title=${control.label}
                          aria-label=${control.label}
                          value=${this.pluginsController.getControlValue(control)?.toString()}
                          @change=${(e: SCWCInputEventMap['change']) =>
                            this.pluginsController.setControlValue(control, e.detail)}
                        ></scwc-input>
                      `;
                    case 'checkbox':
                      return html`
                        <scwc-checkbox
                          .checked=${this.pluginsController.getControlValue(control) === true}
                          label=${control.label}
                          title=${control.label}
                          aria-label=${control.label}
                          @change=${(e: SCWCCheckboxEventMap['change']) =>
                            this.pluginsController.setControlValue(control, e.detail)}
                        ></scwc-checkbox>
                      `;
                    default:
                      return html`
                        <div class="plugin-placeholder">不支持的控件类型: ${control.type}</div>
                      `;
                  }
                })
              : html`
                  <div class="plugin-placeholder">
                    ${plugins === null
                      ? '加载中...'
                      : plugins.length === 0
                        ? '没有插件可用'
                        : '选择一个插件'}
                  </div>
                `}
          </div></wb-scroll-container
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-layout-content-plugin': SCWCContentPlugin;
  }
}
