import style from './content-claw.css?raw';

import { LitElement, html, css, unsafeCSS, nothing, type ReactiveController, type ReactiveControllerHost } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ConfigController } from '../store/config';
import type { Item } from '../types/claw';
import { loadFromStorage, saveToStorage } from '../utils/storage';
import { SELECTIVE_CRAWL_KEY } from '../utils/common';
import type { ArrayProcessor, JSONValueWithFunction } from '../types/utils';
import { styleMap } from 'lit/directives/style-map.js';
import { getElementBySelector, getSelector } from '../utils/selector';
import { getCrawlData } from '../utils/claw';
import { sendCrawlRequest } from '../api/crawl';

/** 判断是否为悬浮窗或其子元素 */
function isExcludedElement (el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.id === 'selective-crawl-floating-root' || cur.classList.contains('scw-floating-window')) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

class RectController implements ReactiveController {
  host: ReactiveControllerHost;
  private target: Element;

  value = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  }

  private active = false;

  constructor(host: ReactiveControllerHost, target: Element) {
    (this.host = host).addController(this);
    this.target = target;
  }

  private updateValue = () => {
    if (!this.active) return;
    requestAnimationFrame(this.updateValue);
    if (!this.target) return;
    const rect = this.target.getBoundingClientRect();
    this.value = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    this.host.requestUpdate();
  }

  hostConnected () {
    this.active = true;
    requestAnimationFrame(this.updateValue);
  }
  hostDisconnected () {
    this.active = false;
  }
}

@customElement('scwc-element-highlight')
class SCWCElementHighlight extends LitElement {
  static styles = css`
    .scwc-highlight-root {
      position: fixed;
      pointer-events: none;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483646;
    }

    .scwc-highlight-box {
      position: absolute;
      background: rgba(125, 203, 255, 0.47);
      border: none;
    }
  `;

  @state()
  private accessor rectController: RectController | null = null;

  @property({ type: Object, attribute: false })
  accessor _target: Element | null = null;

  setTarget (target: Element) {
    this._target = target;
    this.rectController = new RectController(this, this._target);
  }

  render () {
    const rect = this.rectController?.value;
    if (!rect) return nothing;
    return html`
      <div
        class="scwc-highlight-root"
      >
        <div
          class="scwc-highlight-box"
          style=${styleMap({
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    })}
        ></div>
      </div>
    `
  }
}

@customElement('scwc-layout-content-claw')
class SCWCContentClaw extends LitElement {
  static styles = [css`${unsafeCSS(style)}`];

  private configController = new ConfigController(this);

  /** 是否展开 */
  @property({ type: Boolean })
  accessor expanded: boolean = false;

  /** 是否正在选择元素 */
  @state()
  private accessor selecting: boolean = false;

  /** 当前选中的元素 */
  @state()
  private accessor selectedEl: Element | null = null;

  /** 选中元素的 selector 列表 */
  @state()
  private accessor items: Item[] = loadFromStorage<ArrayProcessor<Item>>(SELECTIVE_CRAWL_KEY, (item) => {
    if (typeof item === 'undefined' || item === null || typeof item !== 'object') return [] as Item[];
    if ('selector' in item && 'label' in item && 'prefix' in item)
      return item as JSONValueWithFunction;
    if ('selector' in item && 'label' in item)
      return { ...item, prefix: '' };
    return [] as Item[];
  });

  /** 更新 items */
  private setItems (value: Item[]) {
    this.items = value;
    // 持久化
    saveToStorage(SELECTIVE_CRAWL_KEY, value);
    this.dispatchEvent(new CustomEvent('items-changed', { detail: value }));
  }

  /** undo栈，存储 selector */
  @state()
  private accessor undoStack: string[] = [];

  /** 选中元素的描述输入 */
  @state()
  private accessor descInput: string = '';

  /** 选中元素的前缀输入 */
  @state()
  private accessor prefixInput: string = '';

  /** 当前hover的元素 */
  @state()
  private accessor hoverEl: Element | null = null;

  /** 触发元素选择模式的切换 */
  private toggleSelecting = () => {
    this.selecting = !this.selecting;
    if (this.selecting) {
      document.addEventListener('click', this.onElementClick, true);
      document.addEventListener('mousemove', this.onElementHover);
    } else {
      document.removeEventListener('click', this.onElementClick, true);
      document.removeEventListener('mousemove', this.onElementHover);
      this.highlightEl?.remove();
      this.highlightEl = null;
    }
  }

  /** 选择父元素 */
  private selectParent = () => {
    if (!this.selectedEl) {
      return;
    }
    if (!this.selectedEl.parentElement) {
      console.warn('No parent element to select');
      return;
    }
    const parent = this.selectedEl.parentElement;
    const parentSelector = getSelector(parent);
    this.selectedEl = parent;
    this.undoStack = [...this.undoStack, parentSelector];
    this.highlightEl?.setTarget(parent);
  }

  /** 撤销选择父元素 */
  private undoSelection = () => {
    if (this.undoStack.length <= 1) {
      console.warn('No more parent to undo');
      return;
    }
    this.undoStack = this.undoStack.slice(0, -1);
    const lastSelector = this.undoStack[this.undoStack.length - 1];
    this.selectedEl = document.querySelector(lastSelector);
    if (this.selectedEl)
      this.highlightEl?.setTarget(this.selectedEl);
  }

  /** 确认当前选择 */
  private confirmSelection = () => {
    this.setItems([...this.items, {
      selector: this.undoStack[this.undoStack.length - 1],
      label: this.descInput,
      prefix: this.prefixInput,
    }]);
    this.abortSelection();
  }

  /** 放弃当前选择 */
  private abortSelection = () => {
    this.descInput = '';
    this.prefixInput = '';
    this.undoStack = [];
    this.dispatchEvent(new CustomEvent('trigger-selection-expanded', { detail: false }));
    this.selectedEl = null;
    this.selecting = false;
    document.removeEventListener('click', this.onElementClick, true);
    document.removeEventListener('mousemove', this.onElementHover);
    this.highlightEl?.remove();
    this.highlightEl = null;
  }

  /** 处理元素 hover */
  private onElementHover = (e: MouseEvent) => {
    if (!this.selecting) return;
    this.hoverEl = document.elementFromPoint(e.clientX, e.clientY);
    if (this.hoverEl && isExcludedElement(this.hoverEl)) {
      this.hoverEl = null;
    } else if (this.hoverEl) {
      if (!this.highlightEl) {
        this.highlightEl = document.createElement('scwc-element-highlight');
      }
      this.highlightEl.setTarget(this.hoverEl);
    }
  }

  /** 选择元素处理函数 */
  private onElementClick = (e: MouseEvent) => {
    if (!this.selecting) return;
    e.preventDefault();
    // 只允许选中未被排除的元素
    if (this.hoverEl && !isExcludedElement(this.hoverEl)) {
      e.stopPropagation();
      this.selecting = false;
      this.selectedEl = this.hoverEl;
      this.descInput = '';
      this.prefixInput = '';
      this.undoStack = [getSelector(this.selectedEl)];
      this.dispatchEvent(new CustomEvent('trigger-selection-expanded', { detail: true }));
    }
    document.removeEventListener('click', this.onElementClick, true);
    document.removeEventListener('mousemove', this.onElementHover);
  }

  /** 触发抓取数据 */
  private triggerCrawlData = async () => {
    if (this.items.length === 0) {
      // TODO: 修改, 此处不要禁止触发, 而是返回一个空结果
      console.warn('No items to crawl');
      return;
    }
    const { result, failed } = getCrawlData(this.items);
    if (failed.length > 0) {
      console.warn('Failed to crawl the following selectors:', failed);
      return;
    }
    const data = await sendCrawlRequest(result, this.configController.config)
    if (data && data.success === true) {
      console.warn(data.message);
    } else {
      console.log(data.message);
      // console.log(data.data);
      // for (const item of data.data ?? []) {
      // TODO: 弹窗通知
      // notify[item.type as 'info' | 'success' | 'warn' | 'error']({
      //   title: `插件 ${item.pluginInfo.name} 的抓取结果`,
      //   description: item.info,
      //   placement: 'topRight',
      // });
      // }
    }
  }


  /** 高亮覆盖层元素 */
  private highlightEl: SCWCElementHighlight | null = null;

  render () {
    if (!this.expanded) {
      this.selectedEl = null;
      this.descInput = '';
      this.prefixInput = '';
      this.undoStack = [];
    }

    return html`
      <div class="claw-container">
        <div
          class="claw-header"
          style=${styleMap({
      'border-bottom': this.expanded ? '1px solid #eee6' : 'none',
      padding: this.expanded ? 0 : '0 4px',
      width: this.expanded ? void 0 : 142,
      height: this.expanded ? void 0 : 32,
    })}
        >
          <scwc-button
            type="secondary"
            ?active=${this.selecting}
            title="点击网页中的元素即可开始选择捕获内容"
            aria-label="Toggle element selection mode"
            btn-style=${this.selecting ? 'color: #0045d9;' : ''}
            @click=${this.toggleSelecting}
          >
            <!-- 是否开启选中 -->
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M15 3.5V6.5C15 6.776 14.776 7 14.5 7C14.224 7 14 6.776 14 6.5V3.5C14 2.673 13.327 2 12.5 2H3.5C2.673 2 2 2.673 2 3.5V12.5C2 13.327 2.673 14 3.5 14H6.5C6.776 14 7 14.224 7 14.5C7 14.776 6.776 15 6.5 15H3.5C2.121 15 1 13.879 1 12.5V3.5C1 2.121 2.121 1 3.5 1H12.5C13.879 1 15 2.121 15 3.5ZM15 9.5C15 9.224 14.776 9 14.5 9H9.5C9.224 9 9 9.224 9 9.5V14.5C9 14.776 9.224 15 9.5 15C9.776 15 10 14.776 10 14.5V10.707L14.146 14.853C14.244 14.951 14.372 14.999 14.5 14.999C14.628 14.999 14.756 14.95 14.854 14.853C15.049 14.658 15.049 14.341 14.854 14.146L10.708 10H14.501C14.777 10 15.001 9.776 15.001 9.5H15Z"/></svg>
          </scwc-button>
          ${this.selecting ? html`
            <scwc-button
            type="secondary"
            ?active=${this.selecting}
            title="选择当前选中元素的父元素"
            aria-label="Choose the parent element of the currently selected element"
            @click=${this.selectParent}
          >
            <!-- 选择当前选中元素的父元素 -->
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M13 6H11.76L8.96 10H9C9.552 10 10 10.448 10 11V14C10 14.552 9.552 15 9 15H6C5.448 15 5 14.552 5 14V11C5 10.448 5.448 10 6 10H6.04L3.24 6H2C1.448 6 1 5.552 1 5V2C1 1.448 1.448 1 2 1H5C5.552 1 6 1.448 6 2V5C6 5.552 5.552 6 5 6H4.46L7.26 10H7.74L10.54 6H10C9.448 6 9 5.552 9 5V2C9 1.448 9.448 1 10 1H13C13.552 1 14 1.448 14 2V5C14 5.552 13.552 6 13 6ZM5.001 2H2.001V5H5.001V2ZM6 14H9V11H6V14ZM13 2H10V5H13V2Z"/></svg>
          </scwc-button>
          <scwc-button
            type="secondary"
            ?active=${this.selecting}
            title="撤回上一步对父元素的选择"
            aria-label="Undo the previous selection of the parent element"
            @click=${this.undoSelection}
          >
            <!-- 撤回父元素的选择 -->
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M3.00098 2.5C3.00098 2.22386 3.22483 2 3.50098 2C3.77712 2 4.00098 2.22386 4.00098 2.5V6.34262L7.17202 3.17157C8.73412 1.60948 11.2668 1.60948 12.8289 3.17157C14.391 4.73367 14.391 7.26633 12.8289 8.82843L7.80375 13.8536C7.60849 14.0488 7.2919 14.0488 7.09664 13.8536C6.90138 13.6583 6.90138 13.3417 7.09664 13.1464L12.1218 8.12132C13.2933 6.94975 13.2933 5.05025 12.1218 3.87868C10.9502 2.70711 9.0507 2.70711 7.87913 3.87868L4.75781 7H8.50098C8.77712 7 9.00098 7.22386 9.00098 7.5C9.00098 7.77614 8.77712 8 8.50098 8H3.60098C3.26961 8 3.00098 7.73137 3.00098 7.4V2.5Z"/></svg>
          </scwc-button>
          <scwc-button
            type="secondary"
            ?active=${this.selecting}
            title="确认当前选择的元素"
            aria-label="Confirm the currently selected element"
            @click=${this.confirmSelection}
          >
            <!-- 确认当前选择 -->
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M10.6484 5.64648C10.8434 5.45148 11.1605 5.45148 11.3555 5.64648C11.5498 5.84137 11.5499 6.15766 11.3555 6.35254L7.35547 10.3525C7.25747 10.4495 7.12898 10.499 7.00098 10.499C6.87299 10.499 6.74545 10.4505 6.64746 10.3525L4.64746 8.35254C4.45247 8.15754 4.45248 7.84148 4.64746 7.64648C4.84246 7.45148 5.15949 7.45148 5.35449 7.64648L7 9.29199L10.6465 5.64648H10.6484Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8 1C11.86 1 15 4.14 15 8C15 11.86 11.86 15 8 15C4.14 15 1 11.86 1 8C1 4.14 4.14 1 8 1ZM8 2C4.691 2 2 4.691 2 8C2 11.309 4.691 14 8 14C11.309 14 14 11.309 14 8C14 4.691 11.309 2 8 2Z"/></svg>
          </scwc-button>
          <scwc-button
            type="secondary"
            ?active=${this.selecting}
            title="放弃当前选择"
            aria-label="Abort the current selection"
            @click=${this.abortSelection}
          >
            <!-- 放弃当前选择 -->
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1C4.14 1 1 4.14 1 8C1 11.86 4.14 15 8 15C11.86 15 15 11.86 15 8C15 4.14 11.86 1 8 1ZM8 14C4.691 14 2 11.309 2 8C2 4.691 4.691 2 8 2C11.309 2 14 4.691 14 8C14 11.309 11.309 14 8 14ZM10.854 5.854L8.708 8L10.854 10.146C11.049 10.341 11.049 10.658 10.854 10.853C10.756 10.951 10.628 10.999 10.5 10.999C10.372 10.999 10.244 10.95 10.146 10.853L8 8.707L5.854 10.853C5.756 10.951 5.628 10.999 5.5 10.999C5.372 10.999 5.244 10.95 5.146 10.853C4.951 10.658 4.951 10.341 5.146 10.146L7.292 8L5.146 5.854C4.951 5.659 4.951 5.342 5.146 5.147C5.341 4.952 5.658 4.952 5.853 5.147L7.999 7.293L10.145 5.147C10.34 4.952 10.657 4.952 10.852 5.147C11.047 5.342 11.047 5.659 10.852 5.854H10.854Z"/></svg>
          </scwc-button>
          ` : nothing}
          ${!this.selecting ? html`<scwc-button
            type="secondary"
            ?active=${this.selecting}
            title="点击触发抓取数据"
            aria-label="Trigger data crawling"
            @click=${this.triggerCrawlData}
          >
            <!-- 抓取元素 -->
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M1.17683 1.11898C1.32953 0.989634 1.54464 0.963786 1.72363 1.05328L14.7236 7.55328C14.893 7.63797 15 7.8111 15 8.00049C15 8.18987 14.893 8.36301 14.7236 8.4477L1.72363 14.9477C1.54464 15.0372 1.32953 15.0113 1.17683 14.882C1.02414 14.7526 0.96328 14.5447 1.02213 14.3534L2.97688 8.00049L1.02213 1.64754C0.96328 1.45627 1.02414 1.24833 1.17683 1.11898ZM3.8693 8.50049L2.32155 13.5307L13.382 8.00049L2.32155 2.47027L3.8693 7.50049H9.50001C9.77615 7.50049 10 7.72435 10 8.00049C10 8.27663 9.77615 8.50049 9.50001 8.50049H3.8693Z"/></svg>
          </scwc-button>
          ` : nothing}
        </div>
        <div
          class="claw-body"
          style=${styleMap({
      display: this.expanded ? '' : 'none',
    })}
        >
          ${this.selecting && this.selectedEl ? html`
              <div class="claw-form-container">
                <scwc-input
                  label="描述*"
                  placeholder="请输入对选中元素的描述. 需要留空则输入${`<null>`}"
                  title="对选中元素的描述，方便区分和理解. 必填, 需要留空则输入${`<null>`}."
                  aria-label="Description of the selected element, required. If no description is needed, please input ${`<null>`}."
                  .value=${this.descInput}
                  @input=${(e: CustomEvent) => this.descInput = e.detail.value}
                ></scwc-input>
                <scwc-input
                  label="前缀"
                  placeholder="请输入选中元素的前缀"
                  title="选中元素的前缀，抓取时会将前缀与选中元素的文本内容拼接后输出. 选填, 留空时默认为一个空格."
                  aria-label="Prefix of the selected element, optional. If no prefix is needed, please leave it blank."
                  .value=${this.prefixInput}
                  @input=${(e: CustomEvent) => this.prefixInput = e.detail.value}
                ></scwc-input>
            ` : nothing}
          ${this.selecting && !this.selectedEl ? html`
              <div class="claw-choose-placeholder">
                <span>请在页面中选择一个元素</span>
              </div>
            ` : nothing}
          ${!this.selecting ? html`
              <div class="claw-item-list">
                ${this.items.length > 0 ? this.items.map((item, idx) => html`
                  <div
                    class="claw-item"
                    draggable
                    @dragstart=${(e: DragEvent) => {
        e.dataTransfer?.setData('idx', idx.toString());
      }}
                    @dragover=${(e: DragEvent) => {
        e.preventDefault();
      }}
                    @drop=${(e: DragEvent) => {
        const fromIdx = Number(e.dataTransfer?.getData('idx'));
        if (isNaN(fromIdx)) return;
        const toIdx = idx;
        if (fromIdx === toIdx) return;
        const newItems = [...this.items];
        const [movedItem] = newItems.splice(fromIdx, 1);
        newItems.splice(toIdx, 0, movedItem);
        this.setItems(newItems);
      }}
                  >
                    <scwc-input
                      label="描述"
                      placeholder="请输入对选中元素的描述. 需要留空则输入${`<null>`}"
                      title="对选中元素的描述，方便区分和理解. 必填, 需要留空则输入${`<null>`}."
                      aria-label="Description of the selected element, required. If no description is needed, please input ${`<null>`}."
                      .value=${item.label}
                      @input=${(e: CustomEvent<string>) => {
        const newItems = [...this.items];
        newItems[idx] = { ...newItems[idx], label: e.detail };
        this.setItems(newItems);
      }}
                    ></scwc-input>
                    <scwc-input
                      label="前缀"
                      placeholder="请输入选中元素的前缀"
                      title="选中元素的前缀，抓取时会将前缀与选中元素的文本内容拼接后输出. 选填, 留空时默认为一个空格."
                      aria-label="Prefix of the selected element, optional. If no prefix is needed, please leave it blank."
                      .value=${item.prefix}
                      @input=${(e: CustomEvent<string>) => {
        const newItems = [...this.items];
        newItems[idx] = { ...newItems[idx], prefix: e.detail };
        this.setItems(newItems);
      }}
                    ></scwc-input>
                    <scwc-button
                      type="danger"
                      title="删除该选择项"
                      aria-label="Delete this selection item"
                      btn-style="color: #d90000;"
                      @click=${() => {
        const newItems = this.items.filter(i => i.selector !== item.selector);
        this.setItems(newItems);
      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M14 2H10C10 0.897 9.103 0 8 0C6.897 0 6 0.897 6 2H2C1.724 2 1.5 2.224 1.5 2.5C1.5 2.776 1.724 3 2 3H2.54L3.349 12.708C3.456 13.994 4.55 15 5.84 15H10.159C11.449 15 12.543 13.993 12.65 12.708L13.459 3H13.999C14.275 3 14.499 2.776 14.499 2.5C14.499 2.224 14.275 2 13.999 2H14ZM8 1C8.551 1 9 1.449 9 2H7C7 1.449 7.449 1 8 1ZM11.655 12.625C11.591 13.396 10.934 14 10.16 14H5.841C5.067 14 4.41 13.396 4.346 12.625L3.544 3H12.458L11.656 12.625H11.655ZM7 5.5V11.5C7 11.776 6.776 12 6.5 12C6.224 12 6 11.776 6 11.5V5.5C6 5.224 6.224 5 6.5 5C6.776 5 7 5.224 7 5.5ZM10 5.5V11.5C10 11.776 9.776 12 9.5 12C9.224 12 9 11.776 9 11.5V5.5C9 5.224 9.224 5 9.5 5C9.776 5 10 5.224 10 5.5Z"/></svg>
                    </scwc-button>
                    <span
                      class="claw-item-drag-handle"
                      title=${item.selector}
                      @mouseenter=${() => {
        // 有选中项时禁止高亮其它项
        if (this.selectedEl) return;
        const el = getElementBySelector(item.selector);
        if (!el) {
          console.warn('Element not found for selector:', item.selector);
          return;
        };
        if (this.highlightEl) {
          this.highlightEl.setTarget(el);
        } else {
          const highlightEl = document.createElement('scwc-element-highlight') as SCWCElementHighlight;
          highlightEl.setTarget(el);
          document.body.appendChild(highlightEl);
          this.highlightEl = highlightEl;
        }
      }}
                      @mouseleave=${() => {
        // 有选中项时禁止清除高亮
        if (this.selectedEl) return;
        if (this.highlightEl) {
          this.highlightEl.remove();
          this.highlightEl = null;
        }
      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M7 4C7 4.552 6.552 5 6 5C5.448 5 5 4.552 5 4C5 3.448 5.448 3 6 3C6.552 3 7 3.448 7 4ZM10 3C9.448 3 9 3.448 9 4C9 4.552 9.448 5 10 5C10.552 5 11 4.552 11 4C11 3.448 10.552 3 10 3ZM6 7C5.448 7 5 7.448 5 8C5 8.552 5.448 9 6 9C6.552 9 7 8.552 7 8C7 7.448 6.552 7 6 7ZM10 7C9.448 7 9 7.448 9 8C9 8.552 9.448 9 10 9C10.552 9 11 8.552 11 8C11 7.448 10.552 7 10 7ZM6 11C5.448 11 5 11.448 5 12C5 12.552 5.448 13 6 13C6.552 13 7 12.552 7 12C7 11.448 6.552 11 6 11ZM10 11C9.448 11 9 11.448 9 12C9 12.552 9.448 13 10 13C10.552 13 11 12.552 11 12C11 11.448 10.552 11 10 11Z"/></svg>
                    </span>
                  </div>
                `) : html`
                  <div class="claw-item-placeholder">
                    <span>暂无抓取项，添加后可在此处编辑</span>
                  </div>
                `}
              </div>
            ` : nothing}
        </div>
      </div>
    `;
  }

  connectedCallback () {
    super.connectedCallback();
    this.dispatchEvent(new CustomEvent('items-changed', { detail: this.items }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "scwc-element-highlight": SCWCElementHighlight;
    "scwc-layout-content-claw": SCWCContentClaw;
  }
}
