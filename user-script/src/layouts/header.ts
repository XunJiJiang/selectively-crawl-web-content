import style from './header.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { config, configContext, type TConfig } from '../store/config'

@customElement('scwc-layout-header')
export class SCWCHeaderLayout extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  @consume({ context: configContext, subscribe: true })
  private accessor config: TConfig = config;

  @property({ type: Object })
  public accessor position = { x: 0, y: 0 };
  @property({ type: Boolean, reflect: true })
  public accessor selectionExpanded = false;
  @property({ type: Boolean, reflect: true })
  public accessor pluginExpanded = false;

  /** 是否处于拖动中 */
  private isDragging = false;
  /** 鼠标位置偏移量 */
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
    const width = this.selectionExpanded ? 320 : 100; // minWidth
    const height = this.selectionExpanded ? 180 : 56; // minHeight
    const maxWidth = 420;
    const maxHeight = this.selectionExpanded ? winH * 0.7 : 56;
    let w = this.selectionExpanded ? Math.min(maxWidth, Math.max(width, 320)) : 100;
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
    onmousedown=${this.handleMouseDown}
      >

      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-layout-header": SCWCHeaderLayout;
  }
}