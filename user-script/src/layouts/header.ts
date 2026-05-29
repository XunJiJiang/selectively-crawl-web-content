import style from './header.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { debounce } from 'es-toolkit'
import { styleMap } from 'lit/directives/style-map.js';

@customElement('scwc-layout-header')
class SCWCHeaderLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Object })
  public accessor position = { x: 0, y: 0 };
  @property({ type: Boolean, reflect: true })
  public accessor selectionExpanded = false;
  @property({ type: Boolean, reflect: true })
  public accessor pluginExpanded = false;

  /** 是否处于拖动中 */
  private isDragging = false;
  /** 鼠标位置偏移量, 相对于窗口左上角的位置 */
  private offset = { x: 0, y: 0 };

  /** 鼠标按下事件 */
  private handleMouseDown (e: MouseEvent) {
    this.isDragging = true;
    this.offset = {
      x: e.clientX - this.position.x,
      y: e.clientY - this.position.y,
    };
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    e.stopPropagation();
    e.preventDefault();
  }

  /** 鼠标移动事件 */
  private handleMouseMove = (e: MouseEvent) => {
    if (!this.isDragging) return;
    // 计算悬浮窗宽高
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const width = this.selectionExpanded ? 320 : 120; // minWidth
    const height = this.selectionExpanded ? 180 : 56; // minHeight
    const maxWidth = 420;
    const maxHeight = this.selectionExpanded ? winH * 0.7 : 56;
    // 先计算目标位置
    let x = e.clientX - this.offset.x;
    let y = e.clientY - this.offset.y;
    // 限制范围：全部在窗口内
    // 取实际宽高（max/min）
    let w = this.selectionExpanded ? Math.min(maxWidth, Math.max(width, 320)) : 120;
    let h = this.selectionExpanded ? Math.min(maxHeight, Math.max(height, 180)) : 56;
    if (typeof w === 'string') w = parseInt(w);
    if (typeof h === 'string') h = parseInt(h);
    x = Math.max(0, Math.min(x, winW - w));
    y = Math.max(0, Math.min(y, winH - h));
    if (x !== this.position.x || y !== this.position.y) {
      this.dispatchEvent(new CustomEvent('move', { detail: { x, y }, bubbles: false }));
    }
  }

  /** 鼠标释放事件 */
  private handleMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  }

  render () {
    return html`
      <div
        class="scwc-layout-header"
        @mousedown=${this.handleMouseDown}
      >
        <div class="scwc-layout-header-title">SCWC</div>
        <div
          class="scwc-layout-header-switch-claw-visible"
          ?active=${this.selectionExpanded}
          title="展开/收起抓取列表"
          @click=${() => this.dispatchEvent(new CustomEvent('toggleclaw', { bubbles: false }))}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2 3.50049C2 3.22435 2.22386 3.00049 2.5 3.00049H13.5C13.7761 3.00049 14 3.22435 14 3.50049C14 3.77663 13.7761 4.00049 13.5 4.00049H2.5C2.22386 4.00049 2 3.77663 2 3.50049ZM2 7.50049C2 7.22435 2.22386 7.00049 2.5 7.00049H13.5C13.7761 7.00049 14 7.22435 14 7.50049C14 7.77663 13.7761 8.00049 13.5 8.00049H2.5C2.22386 8.00049 2 7.77663 2 7.50049ZM2 11.5005C2 11.2243 2.22386 11.0005 2.5 11.0005H13.5C13.7761 11.0005 14 11.2243 14 11.5005C14 11.7766 13.7761 12.0005 13.5 12.0005H2.5C2.22386 12.0005 2 11.7766 2 11.5005Z"/></svg>
        </div>
        <div
          class="scwc-layout-header-switch-plugin-visible"
          ?active=${this.pluginExpanded}
          title="展开/收起插件窗口"
          @click=${() => this.dispatchEvent(new CustomEvent('toggleplugin', { bubbles: false }))}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 4.95703C15 4.58711 14.8563 4.24054 14.5949 3.97992L12.0096 1.39234C11.4879 0.86922 10.5788 0.86922 10.0571 1.39234L8 3.45119V3.32321C8 2.55068 7.37187 1.922 6.6 1.922H2.4C1.62813 1.922 1 2.55068 1 3.32321V13.5988C1 14.3713 1.62813 15 2.4 15H12.6667C13.4385 15 14.0667 14.3713 14.0667 13.5988V9.39514C14.0667 8.62261 13.4385 7.99393 12.6667 7.99393H12.5379L14.5949 5.93508C14.8553 5.67445 15 5.32602 15 4.95703ZM2.4 2.85521H6.6C6.85667 2.85521 7.06667 3.06446 7.06667 3.32228V7.99299H1.93333V3.32228C1.93333 3.06446 2.14333 2.85521 2.4 2.85521ZM1.93333 13.5979V8.92714H7.06667V14.0649H2.4C2.14333 14.0649 1.93333 13.8547 1.93333 13.5979ZM13.1333 9.39421V13.5979C13.1333 13.8547 12.9233 14.0649 12.6667 14.0649H8V8.92714H12.6667C12.9233 8.92714 13.1333 9.13638 13.1333 9.39421ZM8 7.99299V6.46287L9.5288 7.99299H8ZM13.9351 5.2737L11.3488 7.86221C11.1789 8.03223 10.8859 8.03223 10.716 7.86221L8.12973 5.2737C8.0448 5.18963 7.99813 5.07753 7.99813 4.95796C7.99813 4.83839 8.0448 4.7263 8.12973 4.64129L10.716 2.05278C10.8009 1.96777 10.9129 1.92106 11.0324 1.92106C11.1519 1.92106 11.2639 1.96777 11.3488 2.05278L13.9351 4.64129C14.02 4.72536 14.0667 4.83746 14.0667 4.95703C14.0667 5.0766 14.02 5.1887 13.9351 5.2737Z"/></svg>
        </div>
        <div
          class="scwc-layout-header-minimize"
          title="最小化"
          @click=${() => this.dispatchEvent(new CustomEvent('minimize', { bubbles: false }))}
        >
          <svg style="width: 100%; height: 100%;">
            <rect x="4.5" y="7" width="9" height="1.2" rx="0.35" fill="currentColor" />
          </svg>
        </div>
      </div>
    `;
  }

  /** 窗口 resize 事件 */
  private handleWindowResize = debounce(() => {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const width = this.selectionExpanded ? 320 : 120;
    const height = this.selectionExpanded ? 180 : 56;
    const maxWidth = 420;
    const maxHeight = this.selectionExpanded ? winH * 0.7 : 56;
    let w = this.selectionExpanded ? Math.min(maxWidth, Math.max(width, 320)) : 120;
    let h = this.selectionExpanded ? Math.min(maxHeight, Math.max(height, 180)) : 56;
    if (typeof w === 'string') w = parseInt(w);
    if (typeof h === 'string') h = parseInt(h);
    let x = this.position.x;
    let y = this.position.y;
    x = Math.max(0, Math.min(x, winW - w));
    y = Math.max(0, Math.min(y, winH - h));
    if (x !== this.position.x || y !== this.position.y) {
      this.dispatchEvent(new CustomEvent('move', { detail: { x, y }, bubbles: false }));
    }
  }, 200)

  connectedCallback () {
    super.connectedCallback();
    window.addEventListener('resize', this.handleWindowResize);
  }

  disconnectedCallback () {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.handleWindowResize);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-header": SCWCHeaderLayout;
  }
}