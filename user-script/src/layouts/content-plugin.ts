import style from './content-plugin.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { config, configContext, type TConfig } from '../store/config';
import { consume } from '@lit/context';
import type { Item } from '../types/claw';
import type { PluginConfig } from '../types/plugin';
import type { ScriptConfig } from '../types/config';
import { styleMap } from 'lit/directives/style-map.js';

@customElement('scwc-layout-content-plugin')
export class SCWCContentPlugin extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @consume({ context: configContext, subscribe: true })
  private accessor config: TConfig = config;

  @property({ type: Boolean })
  accessor expanded: boolean = false;

  @property({ type: Array, attribute: false })
  accessor clawItems: Item[] = [];

  @state()
  private accessor plugins: (PluginConfig | ScriptConfig)[] | null = null
  @state()
  private accessor activeTab = ''
  @state()
  private accessor activePlugin: PluginConfig | ScriptConfig | null = null

  render () {
    return html`
      <div 
        class="plugin-window"
        style=${styleMap({
      display: this.expanded ? 'flex' : 'none'
    })}
      >
      <!-- Tabs -->
        <div class="plugin-window-tabs">
          ${this.plugins?.map(plugin => html`
            <div 
              class="plugin-window-tab"
              style=${styleMap({
      'border-button': this.activeTab === plugin.id ? '2px solid #1890ff' : 'none',
    })}
              data-active=${this.activeTab === plugin.id}
              @click=${() => {
        this.activeTab = plugin.id
        this.activePlugin = plugin
      }}
            >
              ${plugin.title}
            </div>
          `)}
        </div>
        <!-- Plugin Content -->
        <div class="plugin-window-content">
          ${this.activeTab && this.activePlugin ? this.activePlugin.controls.map((control, idx) => {
        switch (control.type) {
          case 'button':
            return html`
              <scwc-button
                title=${control.label}
                aria-label=${control.label}
                @click=${() => {}}
              >${control.label}</scwc-button>
            `
          case 'toggle':
            return html`
              <scwc-checkbox
                checked=${true}
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                @change=${() => {}}
              ></scwc-checkbox>
            `
          case 'select':
            return html`
              <scwc-select
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                value=${''}
                options=${[]}
                @change=${() => {}}
              ></scwc-select>
            `
          case 'input:text':
            return html`
              <scwc-input
                type="text"
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                value=${''}
                @change=${() => {}}
              ></scwc-input>
            `
          case 'input:number':
            return html`
              <scwc-input
                type="number"
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                value=${''}
                @change=${() => {}}
              ></scwc-input>
            `
          case 'checkbox':
            return html`
              <scwc-checkbox
                checked=${true}
                label=${control.label}
                title=${control.label}
                aria-label=${control.label}
                @change=${() => {}}
              ></scwc-checkbox>
            `
          default:
            return html`
              <div style="color: #888; margin-bottom: 8px">
                不支持的控件类型: ${control.type}
              </div>
            `
        }
      }) : html`
            <div style="color: #888">
              ${this.plugins === null ? '加载中...' : this.plugins.length === 0 ? '没有插件可用' : '选择一个插件'}
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