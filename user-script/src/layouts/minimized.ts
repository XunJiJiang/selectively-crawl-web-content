import style from './minimized.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

@customElement('scwc-layout-minimized')
class SCWCMinimizedLayout extends LitElement {
  static styles = [
    css`
      :host {
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        z-index: 2147483647;
      }
    `,
    css`
      ${unsafeCSS(style)}
    `,
  ];

  @property({ type: Object })
  public accessor position: { readonly x: number; readonly y: number } = {
    x: 0,
    y: 0,
  };

  /** 是否处于拖动中 */
  private isDragging = false;
  /** 本次点击是否为拖动 */
  private isDrag = false;
  /** 鼠标位置偏移量 */
  private offsetY = 0;

  /** 鼠标按下事件 */
  private handleMouseDown(e: MouseEvent) {
    this.isDragging = true;
    this.isDrag = false;
    this.offsetY = e.clientY - this.position.y;
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
    e.stopPropagation();
    e.preventDefault();
  }

  /** 鼠标移动事件 */
  private handleMouseMove = (e: MouseEvent) => {
    if (!this.isDragging) {
      return;
    }
    this.isDrag = true;
    // 触发了拖动
    this.isDragging = true;
    let newY = e.clientY - this.offsetY;
    // 限制在窗口内
    const minY = 0;
    const maxY = window.innerHeight - 38; // 38为组件高度
    if (newY < minY) {
      newY = minY;
    }
    if (newY > maxY) {
      newY = maxY;
    }
    this.dispatchEvent(
      new CustomEvent('move', {
        detail: { x: this.position.x, y: newY },
        bubbles: false,
      }),
    );
  };

  /** 鼠标释放事件 */
  private handleMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  };

  render() {
    return html`
      <div
        class="scwc-layout-minimized"
        style=${styleMap({ top: `${this.position.y}px`, position: 'fixed' })}
        @click=${() => {
          if (this.isDrag) {
            return;
          }
          this.dispatchEvent(new CustomEvent('maximize', { bubbles: false }));
        }}
        @mousedown=${this.handleMouseDown}
      >
        <span class="scwc-layout-minimized-drag-area">SCWC</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-layout-minimized': SCWCMinimizedLayout;
  }
}
