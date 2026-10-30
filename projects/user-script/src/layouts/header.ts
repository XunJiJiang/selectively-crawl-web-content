import style from './header.css?raw';

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { debounce } from 'es-toolkit';

@customElement('scwc-layout-header')
class SCWCHeaderLayout extends LitElement {
  static styles = [
    css`
      ${unsafeCSS(style)}
    `,
  ];

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
  private handleMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.composedPath().some((node) => node instanceof HTMLButtonElement)) {
      return;
    }
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
    if (!this.isDragging) {
      return;
    }
    const rect =
      this.getRootNode() instanceof ShadowRoot
        ? (this.getRootNode() as ShadowRoot)
            .querySelector('.scwc-layout-root')
            ?.getBoundingClientRect()
        : undefined;
    const x = Math.max(
      0,
      Math.min(e.clientX - this.offset.x, window.innerWidth - (rect?.width ?? 176)),
    );
    const y = Math.max(
      0,
      Math.min(e.clientY - this.offset.y, window.innerHeight - (rect?.height ?? 68)),
    );
    if (x !== this.position.x || y !== this.position.y) {
      this.dispatchEvent(new CustomEvent('move', { detail: { x, y }, bubbles: false }));
    }
  };

  /** 鼠标释放事件 */
  private handleMouseUp = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  };

  render() {
    return html`
      <div class="scwc-layout-header" @mousedown=${this.handleMouseDown}>
        <div class="scwc-layout-header-title">SCWC</div>
        <button
          title="展开/收起抓取列表"
          aria-label="展开/收起抓取列表"
          aria-pressed=${this.selectionExpanded}
          @click=${() => this.dispatchEvent(new CustomEvent('toggleclaw'))}
        >
          <wb-icon name="list-selection"></wb-icon>
        </button>
        <button
          title="展开/收起插件窗口"
          aria-label="展开/收起插件窗口"
          aria-pressed=${this.pluginExpanded}
          @click=${() => this.dispatchEvent(new CustomEvent('toggleplugin'))}
        >
          <wb-icon name="plugins"></wb-icon>
        </button>
        <button
          title="最小化"
          aria-label="最小化"
          @click=${() => this.dispatchEvent(new CustomEvent('minimize'))}
        >
          <wb-icon name="chrome-minimize"></wb-icon>
        </button>
      </div>
    `;
  }

  /** 窗口 resize 事件 */
  private handleWindowResize = debounce(() => {
    const rect = (this.getRootNode() as ShadowRoot)
      .querySelector('.scwc-layout-root')
      ?.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.position.x, window.innerWidth - (rect?.width ?? 176)));
    const y = Math.max(0, Math.min(this.position.y, window.innerHeight - (rect?.height ?? 68)));
    if (x !== this.position.x || y !== this.position.y) {
      this.dispatchEvent(new CustomEvent('move', { detail: { x, y }, bubbles: false }));
    }
  }, 200);

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('resize', this.handleWindowResize);
  }

  disconnectedCallback() {
    this.handleMouseUp();
    super.disconnectedCallback();
    window.removeEventListener('resize', this.handleWindowResize);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-layout-header': SCWCHeaderLayout;
  }
}
