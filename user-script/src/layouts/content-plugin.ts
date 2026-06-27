import style from './content-plugin.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Item } from '../types/claw';
import { styleMap } from 'lit/directives/style-map.js';
import { PluginsController } from './hooks/plugins';
import type { SCWCCheckboxEventMap } from '../components/checkbox';
import type { SCWCSelectEventMap } from '../components/select';
import type { SCWCInputEventMap } from '../components/input';

@customElement('scwc-layout-content-plugin')
export class SCWCContentPlugin extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Boolean })
  accessor expanded: boolean = false;

  @property({ type: Array, attribute: false })
  accessor clawItems: Item[] = [];

  @property({ type: String })
  accessor currentPluginTab: string = '';

  private pluginsController = new PluginsController(this);

  render () {
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
      display: this.expanded ? 'flex' : 'none'
    })}
      >
      <!-- Tabs -->
        <div class="plugin-window-tabs">
          ${plugins?.map(plugin => html`
            <div 
              class="plugin-window-tab"
              style=${styleMap({
      'border-button': activeTab === plugin.id ? '2px solid #1890ff' : 'none',
    })}
              data-active=${activeTab === plugin.id}
              @click=${() => {
        this.pluginsController.setActiveTab(plugin.id);
        this.pluginsController.setActivePlugin(plugin);
        this.dispatchEvent(new CustomEvent('current-plugin-tab-changed', { detail: plugin.id }));
      }}
            >
              ${plugin.title}
            </div>
          `)}
        </div>
        <!-- Plugin Content -->
        <div class="plugin-window-content">
          ${activeTab && activePlugin ? activePlugin.controls.map((control) => {
        switch (control.type) {
          case 'button':
            return html`
              <scwc-button
                title=${control.label}
                aria-label=${control.label}
                @click=${() => this.pluginsController.setControlValue(control, null)}
              >${control.label}</scwc-button>
            `
          case 'toggle':
            return html`
              <scwc-checkbox
                checked=${this.pluginsController.getControlValue(control) === true}
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                @change=${(e: SCWCCheckboxEventMap['change']) => this.pluginsController.setControlValue(control, e.detail)}
              ></scwc-checkbox>
            `
          case 'select':
            return html`
              <scwc-select
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                value=${this.pluginsController.getControlValue(control)?.toString()}
                .options=${control.options?.options ?? []}
                @change=${(e: SCWCSelectEventMap['change']) => this.pluginsController.setControlValue(control, e.detail)}
              ></scwc-select>
            `
          case 'input:text':
            return html`
              <scwc-input
                type="text"
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                value=${this.pluginsController.getControlValue(control)?.toString()}
                @change=${(e: SCWCInputEventMap['change']) => this.pluginsController.setControlValue(control, e.detail)}
              ></scwc-input>
            `
          case 'input:number':
            return html`
              <scwc-input
                type="number"
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                value=${this.pluginsController.getControlValue(control)?.toString()}
                @change=${(e: SCWCInputEventMap['change']) => this.pluginsController.setControlValue(control, e.detail)}
              ></scwc-input>
            `
          case 'checkbox':
            return html`
              <scwc-checkbox
                checked=${this.pluginsController.getControlValue(control) === true}
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                @change=${(e: SCWCCheckboxEventMap['change']) => this.pluginsController.setControlValue(control, e.detail)}
              ></scwc-checkbox>
            `
          default:
            return html`
              <div style="color: #888; margin-block-end: 8px">
                不支持的控件类型: ${control.type}
              </div>
            `
        }
      }) : html`
            <div style="color: #888">
              ${plugins === null ? '加载中...' : plugins.length === 0 ? '没有插件可用' : '选择一个插件'}
            </div>
          `}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-content-plugin": SCWCContentPlugin;
  }
}