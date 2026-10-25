import { css, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SCWCScrollContainer } from '../../../shared/components/scroll-container/index.ts';

/** 工作台独有的默认值，不改变插件及其他共享组件使用者。 */
@customElement('wb-scroll-container')
export class WorkbenchScrollContainer extends SCWCScrollContainer {
  @property({ type: Boolean, attribute: 'line-scroll' }) accessor lineScroll = false;
  @property({ type: Boolean, attribute: 'whole-lines' }) accessor wholeLines = false;
  @property({ type: Boolean }) accessor thin = false;

  constructor() {
    super();
    this.smoothWheel = { accelerationRatio: 0, minAcceleration: 0 };
    this.wheelAxisLockRatio = 0.5;
    this.horizontal = { placement: 'overlay', radius: 4, color: 'var(--border-strong)' };
    this.vertical = { ...this.horizontal };
  }

  static styles = css`
    ${SCWCScrollContainer.styles}
    :host {
      --scrollbar-hover-color: var(--text-tertiary);
      --scrollbar-active-color: var(--text-secondary);
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
    .frame {
      height: auto;
      min-height: 0;
    }
    /* 内容自然增高的弹层也须把最大高度传到实际原生视口。 */
    .frame,
    .viewport {
      max-height: inherit;
    }
    .content {
      box-sizing: border-box;
    }
  `;

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has('thin')) {
      this.horizontal = { ...this.horizontal, size: this.thin ? 2 : 4 };
      this.vertical = { ...this.vertical, size: this.thin ? 2 : 4 };
    }
    this.updateLineStep();
    super.willUpdate(changed);
  }

  private updateLineStep() {
    if (this.lineScroll) {
      const row = this.querySelector<HTMLElement>('.output-line, .terminal-output-line');
      const style = getComputedStyle(row ?? this);
      const number = (value: string) => Number.parseFloat(value) || 0;
      const padding = (value: CSSStyleDeclaration) =>
        number(value.paddingTop) + number(value.paddingBottom);
      // 使用单行的实际排版高度，长日志换行不改变最小步长。
      const line = number(style.lineHeight) || number(style.fontSize) * 1.5 || 21;
      const childLine = row
        ? Math.max(
            line,
            ...[...row.children].map((child) => {
              const childStyle = getComputedStyle(child);
              return (number(childStyle.lineHeight) || line) + padding(childStyle);
            }),
          )
        : line;
      this.stepDistance = Math.max(
        childLine + padding(style) + number(style.borderTopWidth) + number(style.borderBottomWidth),
        number(style.minHeight),
      );
    }
  }

  refresh() {
    this.updateLineStep();
    if (this.wholeLines && this.stepDistance > 0) {
      const height = this.getBoundingClientRect().height;
      if (height > 0) {
        // flex 分配后的高度加回上次余量，避免 ResizeObserver 反复减去余量。
        const available = height + (Number.parseFloat(this.style.marginTop) || 0);
        const rows = Math.floor((available + 0.01) / this.stepDistance);
        const gap = Math.max(0, available - rows * this.stepDistance);
        const margin = `${gap}px`;
        if (this.style.marginTop !== margin) {
          this.style.marginTop = margin;
        }
      }
    } else if (this.style.marginTop) {
      this.style.marginTop = '';
    }
    super.refresh();
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('wheel', this.nativeInputWheel, true);
  }

  disconnectedCallback() {
    this.removeEventListener('wheel', this.nativeInputWheel, true);
    super.disconnectedCallback();
  }

  private nativeInputWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    const input = event.composedPath().find((node) => node instanceof HTMLTextAreaElement);
    if (
      input instanceof HTMLTextAreaElement &&
      ((event.deltaY < 0 && input.scrollTop > 0) ||
        (event.deltaY > 0 && input.scrollTop + input.clientHeight < input.scrollHeight))
    ) {
      // 配置 textarea 保留浏览器原生滚动，到边界后再交给外层。
      event.stopPropagation();
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'wb-scroll-container': WorkbenchScrollContainer;
  }
}
