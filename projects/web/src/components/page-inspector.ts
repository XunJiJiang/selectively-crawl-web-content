import './declarative-view.ts';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { Tab } from '../workbench/types.ts';
/** Thin host: inspector content and data come from the core JSON template. */
@customElement('wb-page-inspector')
export class PageInspector extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor tab: Tab | undefined;
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
    }
    wb-declarative-view {
      flex: 1;
      height: auto;
      min-height: 0;
    }
    p {
      padding: 12px;
      color: var(--color-text-muted, #aaa);
    }
  `;
  render() {
    if (this.tab?.kind !== 'plugin') {
      return html`<p>选择一个插件页面查看后端属性与配置。</p>`;
    }
    const tabId = this.store.workspace?.snapshot.tabs.some((t) => t.id === this.tab?.id)
      ? this.tab.id
      : null;
    return html`<wb-declarative-view
      .store=${this.store}
      .pluginId=${this.tab.pluginId}
      surface="currentPage"
      viewId="currentPage"
      .tabId=${tabId}
    ></wb-declarative-view>`;
  }
}
