import style from './root.css?raw';
import './minimized.ts';
import './header.ts';
import './content.ts';
import './footer.ts';

import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { loadFromStorage, saveToStorage } from '../utils/storage.ts';
import { INIT_POS, PERSISTENT_DATA_KEY } from '../utils/common.ts';
import { styleMap } from 'lit/directives/style-map.js';
import type { Item } from '../types/claw';

@customElement('scwc-layout-root')
class SCWCRootLayout extends LitElement {
  static styles = [
    css`
      :host {
        position: fixed;
        width: 0;
        height: 0;
        top: 0;
        left: 0;
        z-index: 2147483647;
      }
    `,
    css`${unsafeCSS(style)}`
  ];

  /** 持久化配置 */
  @state()
  private accessor persistentData = loadFromStorage<{
    version: string;
    window: {
      pos: { x: number, y: number };
      minimized: boolean;
    };
    plugin: {
      expanded: boolean;
      activeTab: string;
    };
  }>(PERSISTENT_DATA_KEY, {
    version: '2.0.0-1', // 2.0.0-1 表示在 2.0.0 版本中第一次更新本地存储数据格式. 仅在数据格式发生变化时更新 version 字段, 如果版本号更新但是数据格式没有变化, 则不更新 version 字段.
    window: {
      pos: INIT_POS,
      minimized: false,
    },
    plugin: {
      expanded: false,
      activeTab: '',
    }
  }, 'a');

  /** 设置是否最小化 */
  private setMinimized (value: boolean) {
    this.persistentData = {
      ...this.persistentData,
      window: {
        ...this.persistentData.window,
        minimized: value,
      }
    };
    saveToStorage(PERSISTENT_DATA_KEY, this.persistentData);
  }

  /** 设置窗口位置 */
  private setPosition (x: number | null, y: number | null) {
    this.persistentData = {
      ...this.persistentData,
      window: {
        ...this.persistentData.window,
        pos: {
          x: x ?? this.persistentData.window.pos.x,
          y: y ?? this.persistentData.window.pos.y,
        },
      }
    };
    saveToStorage(PERSISTENT_DATA_KEY, this.persistentData);
  }

  /** 是否展开选择框 */
  @property({ type: Boolean, reflect: true })
  private accessor selectionExpanded = false;

  /** 设置是否展开选择框 */
  private setSelectionExpanded (value: boolean) {
    this.selectionExpanded = value;
  }

  /** 设置是否展开插件 */
  private setPluginExpanded (value: boolean) {
    this.persistentData = {
      ...this.persistentData,
      plugin: {
        ...this.persistentData.plugin,
        expanded: value,
      }
    };
    saveToStorage(PERSISTENT_DATA_KEY, this.persistentData);
  }

  /** 设置当前聚焦的插件标签页 */
  private setCurrentPluginTab (tab: string) {
    this.persistentData = {
      ...this.persistentData,
      plugin: {
        ...this.persistentData.plugin,
        activeTab: tab,
      }
    };
    saveToStorage(PERSISTENT_DATA_KEY, this.persistentData);
  }

  /** 抓取的元素项列表 */
  @state()
  private accessor clawItems: Item[] = [];

  render () {
    return [html`
      <scwc-layout-minimized
        style=${styleMap({
      display: this.persistentData.window.minimized ? '' : 'none',
    })}
        @maximize=${() => this.setMinimized(false)}
        @move=${(e: CustomEvent<{ x: number, y: number }>) => this.setPosition(e.detail.x, e.detail.y)}
        .position=${this.persistentData.window.pos}
      ></scwc-layout-minimized>
    ` , html`
      <div
        class="scwc-layout-root"
        style=${styleMap({
      left: `${this.persistentData.window.pos.x}px`,
      top: `${this.persistentData.window.pos.y}px`,
      'min-width': this.selectionExpanded ? '320px' : '120px',
      'min-height': this.selectionExpanded ? '180px' : '56px',
      display: this.persistentData.window.minimized ? 'none' : '',
    })}
        .position=${this.persistentData.window.pos}
        .selectionExpanded=${this.selectionExpanded}
        .pluginExpanded=${this.persistentData.plugin.expanded}
      >
        <scwc-layout-header
          @move=${(e: CustomEvent<{ x: number, y: number }>) => this.setPosition(e.detail.x, e.detail.y)}
          @toggleclaw=${() => this.setSelectionExpanded(!this.selectionExpanded)}
          @toggleplugin=${() => this.setPluginExpanded(!this.persistentData.plugin.expanded)}
          @minimize=${() => this.setMinimized(true)}
          .selectionExpanded=${this.selectionExpanded}
          .pluginExpanded=${this.persistentData.plugin.expanded}
          .position=${this.persistentData.window.pos}
        ></scwc-layout-header>
        <scwc-layout-content
          .selectionExpanded=${this.selectionExpanded}
          @trigger-selection-expanded=${(e: CustomEvent<boolean>) => this.setSelectionExpanded(e.detail)}
          .pluginExpanded=${this.persistentData.plugin.expanded}
          @claw-items-changed=${(e: CustomEvent<Item[]>) => { this.clawItems = e.detail; }}
          .current-plugin-tab=${this.persistentData.plugin.activeTab}
          @current-plugin-tab-changed=${(e: CustomEvent<string>) => this.setCurrentPluginTab(e.detail)}
        ></scwc-layout-content>
        <scwc-layout-footer></scwc-layout-footer>
      </div>
    `];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-root": SCWCRootLayout;
  }
}
