import style from './root.css?raw';
import { theme } from '../theme.ts';
import type { ContextMenuItem } from '../../../web/src/components/context-menu/menu-types.ts';
import './minimized.ts';
import './header.ts';
import './content.ts';
import './footer.ts';

import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { loadFromStorage, saveToStorage } from '../../../shared/utils/storage.ts';
import { INIT_POS, PERSISTENT_DATA_KEY } from '../../../shared/utils/common.ts';
import { styleMap } from 'lit/directives/style-map.js';
import type { Item } from '../types/claw.d.ts';

@customElement('scwc-layout-root')
class SCWCRootLayout extends LitElement {
  static styles = [
    theme,
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
    css`
      ${unsafeCSS(style)}
    `,
  ];

  /** 持久化配置 */
  @state()
  private accessor persistentData = loadFromStorage<{
    version: string;
    window: {
      pos: { x: number; y: number };
      minimized: boolean;
    };
    plugin: {
      expanded: boolean;
      activeTab: string;
    };
  }>(
    PERSISTENT_DATA_KEY,
    {
      version: '2.0.0-1', // 2.0.0-1 表示在 2.0.0 版本中第一次更新本地存储数据格式. 仅在数据格式发生变化时更新 version 字段, 如果版本号更新但是数据格式没有变化, 则不更新 version 字段.
      window: {
        pos: INIT_POS,
        minimized: true,
      },
      plugin: {
        expanded: false,
        activeTab: '',
      },
    },
    'a',
  );

  private updatePersistentData() {
    const persistentData = {
      version: this.persistentData.version,
      window: {
        pos: this.position,
        minimized: this.minimized,
      },
      plugin: {
        expanded: this.pluginExpanded,
        activeTab: this.currentPluginTab,
      },
    };
    this.persistentData = persistentData;
    saveToStorage(PERSISTENT_DATA_KEY, persistentData);
  }

  @state()
  private accessor minimized = this.persistentData.window.minimized;
  /** 设置是否最小化 */
  private setMinimized(value: boolean) {
    this.minimized = value;
    this.updatePersistentData();
  }

  @state()
  private accessor position = this.persistentData.window.pos;
  /** 设置窗口位置 */
  private setPosition(x: number | null, y: number | null) {
    this.position = {
      x: x ?? this.position.x,
      y: y ?? this.position.y,
    };
    this.updatePersistentData();
  }

  /** 是否展开选择框 */
  @property({ type: Boolean, reflect: true, attribute: 'selection-expanded' })
  private accessor selectionExpanded = false;

  /** 设置是否展开选择框 */
  private setSelectionExpanded(value: boolean) {
    this.selectionExpanded = value;
  }

  @state()
  private accessor pluginExpanded = this.persistentData.plugin.expanded;
  /** 设置是否展开插件 */
  private setPluginExpanded(value: boolean) {
    this.pluginExpanded = value;
    this.updatePersistentData();
  }

  @state()
  private accessor currentPluginTab = this.persistentData.plugin.activeTab;
  /** 设置当前聚焦的插件标签页 */
  private setCurrentPluginTab(tab: string) {
    this.currentPluginTab = tab;
    this.updatePersistentData();
  }

  /** 抓取的元素项列表 */
  @state()
  private accessor clawItems: Item[] = [];

  private boundsObserver?: ResizeObserver;
  protected firstUpdated() {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.boundsObserver = new ResizeObserver(() => {
      const panel = this.renderRoot.querySelector<HTMLElement>('.scwc-layout-root');
      if (!panel || this.minimized) {
        return;
      }
      const rect = panel.getBoundingClientRect();
      const x = Math.max(0, Math.min(this.position.x, window.innerWidth - rect.width));
      const y = Math.max(0, Math.min(this.position.y, window.innerHeight - rect.height));
      if (x !== this.position.x || y !== this.position.y) {
        this.setPosition(x, y);
      }
    });
    const panel = this.renderRoot.querySelector('.scwc-layout-root');
    if (panel) {
      this.boundsObserver.observe(panel);
    }
  }
  disconnectedCallback() {
    this.boundsObserver?.disconnect();
    super.disconnectedCallback();
  }

  @state() private accessor menu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  private openMenu = (event: MouseEvent) => {
    event.preventDefault();
    this.menu = {
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          kind: 'checkbox',
          id: 'selection',
          label: '展开抓取列表',
          checked: this.selectionExpanded,
          action: (value) => this.setSelectionExpanded(value),
        },
        {
          kind: 'checkbox',
          id: 'plugins',
          label: '展开插件窗口',
          checked: this.pluginExpanded,
          action: (value) => this.setPluginExpanded(value),
        },
        { kind: 'separator', id: 'separator' },
        { kind: 'action', id: 'minimize', label: '最小化', action: () => this.setMinimized(true) },
      ],
    };
  };

  render() {
    return [
      html`
        <scwc-layout-minimized
          style=${styleMap({
            display: this.persistentData.window.minimized ? 'initial' : 'none',
          })}
          @maximize=${() => this.setMinimized(false)}
          @move=${(e: CustomEvent<{ x: number; y: number }>) =>
            this.setPosition(e.detail.x, e.detail.y)}
          .position=${this.position}
        ></scwc-layout-minimized>
      `,
      html`
        <div
          class="scwc-layout-root"
          ?data-expanded=${this.selectionExpanded || this.pluginExpanded}
          style=${styleMap({
            left: `${this.position.x}px`,
            top: `${this.position.y}px`,
            display: this.persistentData.window.minimized ? 'none' : 'flex',
          })}
        >
          <scwc-layout-header
            @contextmenu=${this.openMenu}
            @move=${(e: CustomEvent<{ x: number; y: number }>) =>
              this.setPosition(e.detail.x, e.detail.y)}
            @toggleclaw=${() => this.setSelectionExpanded(!this.selectionExpanded)}
            @toggleplugin=${() => this.setPluginExpanded(!this.pluginExpanded)}
            @minimize=${() => this.setMinimized(true)}
            .selectionExpanded=${!this.persistentData.window.minimized && this.selectionExpanded}
            .pluginExpanded=${!this.persistentData.window.minimized && this.pluginExpanded}
            .position=${this.position}
          ></scwc-layout-header>
          <wb-scroll-container class="window-scroll"
            ><scwc-layout-content
              .selectionExpanded=${!this.persistentData.window.minimized && this.selectionExpanded}
              @trigger-selection-expanded=${(e: CustomEvent<boolean>) =>
                this.setSelectionExpanded(e.detail)}
              .pluginExpanded=${!this.persistentData.window.minimized && this.pluginExpanded}
              @claw-items-changed=${(e: CustomEvent<Item[]>) => {
                this.clawItems = e.detail;
              }}
              .currentPluginTab=${this.currentPluginTab}
              @current-plugin-tab-changed=${(e: CustomEvent<string>) =>
                this.setCurrentPluginTab(e.detail)}
            ></scwc-layout-content
          ></wb-scroll-container>
          <scwc-layout-footer></scwc-layout-footer>
        </div>
      `,
      this.menu
        ? html`<wb-context-menu
            .items=${this.menu.items}
            .x=${this.menu.x}
            .y=${this.menu.y}
            .open=${true}
            presentation="custom"
            @wb-menu-select=${(e: CustomEvent<{ id: string }>) => {
              const item = this.menu?.items.find((item) => item.id === e.detail.id);
              if (!item) {
                return;
              }
              if (item.kind === 'checkbox') {
                void item.action(!item.checked);
              } else if (item.kind === 'action') {
                void item.action();
              }
              this.menu = null;
            }}
            @wb-menu-close=${() => {
              this.menu = null;
            }}
          ></wb-context-menu>`
        : null,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-layout-root': SCWCRootLayout;
  }
}
