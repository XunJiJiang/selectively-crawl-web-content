import style from './minimized.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

@customElement('scwc-layout-minimized')
class SCWCMinimizedLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @property({ type: Object })
  public accessor position: { readonly x: number, readonly y: number } = { x: 0, y: 0 };

  /** 是否处于拖动中 */
  private isDragging = false;
  /** 鼠标位置偏移量 */
  private offsetY = 0;

  /** 鼠标按下事件 */
  private onMouseDown (e: MouseEvent) {
    this.isDragging = true;
    // 由于 click 的触发时间晚于 onMouseUp 所以不能在 onMouseDown 里设置 isDragging
    // 虽然已经触发了 onMouseDown，但还不能算是拖动
    this.isDragging = false;
    this.offsetY = e.clientY - this.position.y;
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    e.stopPropagation();
    e.preventDefault();
  }

  /** 鼠标移动事件 */
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging) return;
    // 触发了拖动
    this.isDragging = true;
    let newY = e.clientY - this.offsetY;
    // 限制在窗口内
    const minY = 0;
    const maxY = window.innerHeight - 38; // 38为组件高度
    if (newY < minY) newY = minY;
    if (newY > maxY) newY = maxY;
    this.dispatchEvent(new CustomEvent('move', { detail: { x: this.position.x, y: newY }, bubbles: false }));
  }

  /** 鼠标释放事件 */
  private onMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  render () {
    return html`
      <div
        class="scwc-layout-minimized"
        style=${styleMap({ top: `${this.position.y}px`, })}
        onclick=${() => this.dispatchEvent(new CustomEvent('maximize', { bubbles: false }))}
        onmousedown=${this.onMouseDown}
      >
        <span class="scwc-layout-minimized-drag-area">SCWC</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-minimized": SCWCMinimizedLayout;
  }
}