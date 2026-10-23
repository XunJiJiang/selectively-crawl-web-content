import { LitElement, html, nothing, unsafeCSS, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { customElement } from '../../utils/customElement.ts';
import { clamp, nonNegative, scrollbarOptions, thumbGeometry } from './geometry.ts';
import type {
  ScrollAxis,
  ScrollbarOptions,
  ScrollContent,
  ScrollMetrics,
  ScrollMode,
  ScrollState,
  UpdateScrollMetrics,
  WheelDirection,
} from './types.ts';
import style from './scroll-container.css?raw';

const axes: ScrollAxis[] = ['horizontal', 'vertical'];
const wheelIdleDelay = 150;
let nextId = 0;

function wheelMovement(distance: number, step: number) {
  if (step === 0) {
    return distance;
  }
  // 触控板的小数增量可能在求和后略小于完整步长。
  return Math.sign(distance) * Math.floor(Math.abs(distance) / step + 1e-9) * step;
}

@customElement('scwc-scroll-container')
export class SCWCScrollContainer extends LitElement {
  static styles = unsafeCSS(style);

  @property({ attribute: false }) accessor horizontal: ScrollbarOptions = {};
  @property({ attribute: false }) accessor vertical: ScrollbarOptions = {};
  @property({ attribute: 'scroll-behavior' }) accessor scrollBehavior: ScrollMode = 'smooth';
  /** 跳跃滚动的最小距离（px）；滚轮按累计距离整步移动，0 表示不量化。 */
  @property({ type: Number, attribute: 'step-distance' }) accessor stepDistance = 40;
  @property({ attribute: 'wheel-direction' }) accessor wheelDirection: WheelDirection = 'auto';
  @property({ attribute: 'shift-wheel-direction' })
  accessor shiftWheelDirection: WheelDirection = 'horizontal';

  /** 一旦提供此对象，内部更新函数停止提供且旧函数失效。位置在对象更新时应用。 */
  @property({ attribute: false }) accessor metrics: ScrollMetrics | undefined;
  @property({ attribute: false }) accessor content: ScrollContent | undefined;
  @property({ attribute: false }) accessor contentScroll:
    | ((state: Readonly<ScrollState>) => void)
    | undefined;

  @state() private accessor position: ScrollState = {
    clientWidth: 0,
    clientHeight: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    scrollLeft: 0,
    scrollTop: 0,
    maxScrollLeft: 0,
    maxScrollTop: 0,
  };
  @state() private accessor revealed = { horizontal: false, vertical: false };
  private readonly viewportId = `scwc-scroll-viewport-${++nextId}`;
  private internalMetrics: ScrollMetrics = {};
  private hovered = false;
  private focused = new Set<ScrollAxis>();
  private hideTimers = new Map<ScrollAxis, ReturnType<typeof setTimeout>>();
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private observed = new Set<Element>();
  private refreshFrame?: number;
  private wheelFrame?: number;
  private wheelIdleTimer?: ReturnType<typeof setTimeout>;
  private wheelDistance = { x: 0, y: 0 };
  private wheelConfiguration?: string;
  private drag?: { axis: ScrollAxis; pointerId: number; anchor: number; thumb: HTMLElement };

  /** 原生滚动视口，可用于 focus、scrollIntoView 等 DOM 协作。 */
  get scrollElement(): HTMLElement | null {
    return this.renderRoot.querySelector('.viewport');
  }

  get scrollState(): Readonly<ScrollState> {
    return Object.freeze({ ...this.position });
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerenter', this.enter);
    this.addEventListener('pointerleave', this.leave);
    this.addEventListener('wheel', this.wheel, { passive: false });
    window.addEventListener('resize', this.queueRefresh);
    // updateComplete 也覆盖断开后重新连接的场景。
    void this.updateComplete.then(() => {
      if (this.isConnected) {
        this.observeContent();
        this.refresh();
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this.enter);
    this.removeEventListener('pointerleave', this.leave);
    this.removeEventListener('wheel', this.wheel);
    window.removeEventListener('resize', this.queueRefresh);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.resizeObserver = undefined;
    this.mutationObserver = undefined;
    this.observed.clear();
    if (this.refreshFrame !== undefined) {
      cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = undefined;
    }
    this.endDrag();
    for (const timer of this.hideTimers.values()) {
      clearTimeout(timer);
    }
    this.hideTimers.clear();
    this.hovered = false;
    this.focused.clear();
    this.revealed = { horizontal: false, vertical: false };
    this.clearWheel();
  }

  protected updated(changed: PropertyValues<this>) {
    if (this.wheelConfiguration !== undefined && this.wheelConfiguration !== this.wheelKey()) {
      this.clearWheel();
    }
    if (changed.has('metrics') || changed.has('horizontal') || changed.has('vertical')) {
      if (changed.has('metrics')) {
        this.internalMetrics = {};
      }
      this.measure(changed.has('metrics') ? this.metrics : undefined);
    }
    if (changed.has('content')) {
      this.observeContent();
      this.queueRefresh();
    }
  }

  private readonly updateContentMetrics: UpdateScrollMetrics = (metrics) => {
    if (!this.isConnected || this.metrics !== undefined) {
      return;
    }
    this.internalMetrics = { ...this.internalMetrics, ...metrics };
    this.measure(metrics);
  };

  /** 重新测量 DOM；通常由 ResizeObserver、MutationObserver 和 slotchange 自动触发。 */
  refresh() {
    this.measure();
  }

  private readonly queueRefresh = () => {
    if (!this.isConnected || this.refreshFrame !== undefined) {
      return;
    }
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = undefined;
      this.refresh();
    });
  };

  private observeContent() {
    if (!this.isConnected) {
      return;
    }
    const content = this.renderRoot.querySelector('.content');
    const viewport = this.scrollElement;
    if (!content || !viewport) {
      return;
    }
    if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.queueRefresh);
    }
    // 包含溢出、绝对定位及插槽后代，避免只观察包装层而漏掉内部尺寸变化。
    const elements = new Set<Element>([
      this,
      viewport,
      content,
      ...this.querySelectorAll('*'),
      ...content.querySelectorAll('*'),
    ]);
    for (const old of this.observed) {
      if (!elements.has(old)) {
        this.resizeObserver?.unobserve(old);
      }
    }
    for (const element of elements) {
      if (!this.observed.has(element)) {
        this.resizeObserver?.observe(element);
      }
    }
    this.observed = elements;
    if (!this.mutationObserver) {
      this.mutationObserver = new MutationObserver(() => {
        this.observeContent();
        this.queueRefresh();
      });
      const options = { subtree: true, childList: true, characterData: true, attributes: true };
      this.mutationObserver.observe(this, options);
      this.mutationObserver.observe(content, options);
    }
  }

  private measure(request?: ScrollMetrics) {
    const viewport = this.scrollElement;
    const content = this.renderRoot.querySelector<HTMLElement>('.content');
    const frame = this.renderRoot.querySelector<HTMLElement>('.frame');
    const extent = this.renderRoot.querySelector<HTMLElement>('.extent');
    if (!this.isConnected || !viewport || !content || !frame || !extent) {
      return;
    }
    if (request?.scrollLeft !== undefined || request?.scrollTop !== undefined) {
      this.clearWheel();
    }
    const old = this.position;
    const left = request?.scrollLeft ?? viewport.scrollLeft;
    const top = request?.scrollTop ?? viewport.scrollTop;
    const metrics = this.metrics ?? this.internalMetrics;
    const horizontal = scrollbarOptions(this.horizontal);
    const vertical = scrollbarOptions(this.vertical);
    let width = 0,
      height = 0,
      scrollWidth = 0,
      scrollHeight = 0;
    let gutterX = 0,
      gutterY = 0;
    // 从无占位开始收敛，解除旧滚动条互相制造的溢出；每轮重新考虑内容换行。
    for (let pass = 0; pass < 4; pass++) {
      frame.style.paddingBottom = `${gutterX}px`;
      frame.style.paddingRight = `${gutterY}px`;
      width = viewport.clientWidth;
      height = viewport.clientHeight;
      scrollWidth = Math.max(width, nonNegative(metrics.scrollWidth, content.scrollWidth));
      scrollHeight = Math.max(height, nonNegative(metrics.scrollHeight, content.scrollHeight));
      const nextX = scrollWidth > width && horizontal.placement === 'gutter' ? horizontal.size : 0;
      const nextY = scrollHeight > height && vertical.placement === 'gutter' ? vertical.size : 0;
      if (nextX === gutterX && nextY === gutterY) {
        break;
      }
      gutterX = nextX;
      gutterY = nextY;
    }
    // 单轴虚拟尺寸也需要非零的另一边；零面积元素不一定建立原生滚动范围。
    const virtualExtent = metrics.scrollWidth !== undefined || metrics.scrollHeight !== undefined;
    extent.style.width = `${virtualExtent ? scrollWidth : 0}px`;
    extent.style.height = `${virtualExtent ? scrollHeight : 0}px`;
    const maxScrollLeft = Math.max(0, scrollWidth - width);
    const maxScrollTop = Math.max(0, scrollHeight - height);
    const nextLeft = clamp(left, maxScrollLeft);
    const nextTop = clamp(top, maxScrollTop);
    if (viewport.scrollLeft !== nextLeft) {
      viewport.scrollLeft = nextLeft;
    }
    if (viewport.scrollTop !== nextTop) {
      viewport.scrollTop = nextTop;
    }
    const next = {
      clientWidth: width,
      clientHeight: height,
      scrollWidth,
      scrollHeight,
      maxScrollLeft,
      maxScrollTop,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    this.position = next;
    for (const axis of axes) {
      const horizontal = axis === 'horizontal';
      const changed = horizontal
        ? old.clientWidth !== width || old.scrollWidth !== scrollWidth
        : old.clientHeight !== height || old.scrollHeight !== scrollHeight;
      if (!this.hasOverflow(axis)) {
        this.hide(axis);
        if (this.drag?.axis === axis) {
          this.endDrag();
        }
      } else if (changed || this.hovered) {
        this.show(axis);
      }
    }
    if (old.scrollLeft !== next.scrollLeft || old.scrollTop !== next.scrollTop) {
      this.emitScroll();
    }
  }

  private hasOverflow(axis: ScrollAxis) {
    return axis === 'horizontal' ? this.position.maxScrollLeft > 0 : this.position.maxScrollTop > 0;
  }

  private readonly enter = () => {
    this.hovered = true;
    axes.forEach((axis) => this.show(axis));
  };

  private readonly leave = () => {
    this.hovered = false;
    axes.forEach((axis) => this.scheduleHide(axis));
  };

  private show(axis: ScrollAxis) {
    if (!this.hasOverflow(axis)) {
      return;
    }
    this.revealed = { ...this.revealed, [axis]: true };
    this.scheduleHide(axis);
  }

  private scheduleHide(axis: ScrollAxis) {
    clearTimeout(this.hideTimers.get(axis));
    this.hideTimers.delete(axis);
    if (!this.hovered && this.drag?.axis !== axis && !this.focused.has(axis)) {
      this.hideTimers.set(
        axis,
        setTimeout(() => this.hide(axis), scrollbarOptions(this[axis]).hideDelay),
      );
    }
  }

  private hide(axis: ScrollAxis) {
    clearTimeout(this.hideTimers.get(axis));
    this.hideTimers.delete(axis);
    this.revealed = { ...this.revealed, [axis]: false };
  }

  private readonly nativeScroll = (event: Event) => {
    if (event.target !== this.scrollElement) {
      return;
    }
    event.stopPropagation();
    this.syncPosition();
  };

  private syncPosition() {
    const viewport = this.scrollElement;
    if (!viewport) {
      return;
    }
    const old = this.position;
    const left = clamp(viewport.scrollLeft, old.maxScrollLeft);
    const top = clamp(viewport.scrollTop, old.maxScrollTop);
    if (viewport.scrollLeft !== left) {
      viewport.scrollLeft = left;
    }
    if (viewport.scrollTop !== top) {
      viewport.scrollTop = top;
    }
    if (old.scrollLeft === left && old.scrollTop === top) {
      return;
    }
    this.position = { ...old, scrollLeft: left, scrollTop: top };
    if (old.scrollLeft !== left) {
      this.show('horizontal');
    }
    if (old.scrollTop !== top) {
      this.show('vertical');
    }
    this.emitScroll();
  }

  private emitScroll() {
    const detail = this.scrollState;
    this.dispatchEvent(new CustomEvent('scroll', { detail, bubbles: true, composed: true }));
    this.contentScroll?.(detail);
  }

  scrollTo(options: ScrollToOptions): void;
  scrollTo(x: number, y: number): void;
  scrollTo(options: ScrollToOptions | number, y?: number) {
    this.clearWheel();
    const viewport = this.scrollElement;
    if (!viewport) {
      return;
    }
    const request = typeof options === 'number' ? { left: options, top: y } : options;
    const left = clamp(request.left ?? this.position.scrollLeft, this.position.maxScrollLeft);
    const top = clamp(request.top ?? this.position.scrollTop, this.position.maxScrollTop);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const smooth = (request.behavior ?? this.scrollBehavior) === 'smooth' && !reduced;
    if (smooth) {
      viewport.scrollTo({ left, top, behavior: 'smooth' });
    } else {
      // 显式 instant 同时中止尚未完成的原生平滑滚动。
      viewport.scrollTo({ left, top, behavior: 'instant' });
    }
    this.syncPosition();
  }

  private readonly wheel = (event: WheelEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      this.clearWheel();
      return;
    }
    const direction = event.shiftKey ? this.shiftWheelDirection : this.wheelDirection;
    if (direction === 'none') {
      this.clearWheel();
      event.preventDefault();
      return;
    }
    const viewport = this.scrollElement;
    if (!viewport) {
      return;
    }
    const configuration = this.wheelKey();
    if (this.wheelConfiguration !== configuration) {
      this.clearWheel();
      this.wheelConfiguration = configuration;
    }
    const scaleX =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.position.clientWidth : 1;
    const scaleY =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.position.clientHeight : 1;
    let x = event.deltaX * scaleX,
      y = event.deltaY * scaleY;
    const primary = Math.abs(x) > Math.abs(y) ? x : y;
    if (direction === 'horizontal') {
      x = primary;
      y = 0;
    } else if (direction === 'vertical') {
      y = primary;
      x = 0;
    }
    if (!Number.isFinite(x)) {
      x = 0;
    }
    if (!Number.isFinite(y)) {
      y = 0;
    }
    // 允许反向输入抵消本帧尚未应用的距离；真实边界上的向外输入交给祖先。
    const canMove = (position: number, max: number, pending: number, delta: number) =>
      delta > 0 ? position < max || pending < 0 : delta < 0 && (position > 0 || pending > 0);
    if (!canMove(viewport.scrollLeft, this.position.maxScrollLeft, this.wheelDistance.x, x)) {
      x = 0;
    }
    if (!canMove(viewport.scrollTop, this.position.maxScrollTop, this.wheelDistance.y, y)) {
      y = 0;
    }
    if (x === 0 && y === 0) {
      return;
    }
    // 即使尚未累计到一次跳跃，也必须拦截原生滚轮，防止逐事件滚动。
    event.preventDefault();
    this.wheelDistance.x += x;
    this.wheelDistance.y += y;
    if (this.wheelFrame === undefined) {
      this.wheelFrame = requestAnimationFrame(this.flushWheel);
    }
    clearTimeout(this.wheelIdleTimer);
    this.wheelIdleTimer = setTimeout(() => {
      this.wheelIdleTimer = undefined;
      if (this.wheelFrame === undefined) {
        this.wheelDistance = { x: 0, y: 0 };
      } else if (this.scrollBehavior === 'instant') {
        // 后台标签页可能延迟帧回调：保留已达到的完整步数，只丢弃余数。
        const step = nonNegative(this.stepDistance, 40);
        this.wheelDistance.x = wheelMovement(this.wheelDistance.x, step);
        this.wheelDistance.y = wheelMovement(this.wheelDistance.y, step);
      }
    }, wheelIdleDelay);
  };

  private wheelKey() {
    return `${this.scrollBehavior}:${nonNegative(this.stepDistance, 40)}:${this.wheelDirection}:${this.shiftWheelDirection}`;
  }

  private readonly flushWheel = () => {
    this.wheelFrame = undefined;
    const viewport = this.scrollElement;
    if (!this.isConnected || !viewport || this.wheelConfiguration !== this.wheelKey()) {
      this.clearWheel();
      return;
    }
    const step = this.scrollBehavior === 'instant' ? nonNegative(this.stepDistance, 40) : 0;
    const x = wheelMovement(this.wheelDistance.x, step);
    const y = wheelMovement(this.wheelDistance.y, step);
    const remainder = (distance: number, movement: number) => {
      const rest = distance - movement;
      return Math.abs(rest) <= step * 1e-9 ? 0 : rest;
    };
    this.wheelDistance.x = remainder(this.wheelDistance.x, x);
    this.wheelDistance.y = remainder(this.wheelDistance.y, y);
    const left = clamp(viewport.scrollLeft + x, this.position.maxScrollLeft);
    const top = clamp(viewport.scrollTop + y, this.position.maxScrollTop);
    if (
      (left === 0 && this.wheelDistance.x < 0) ||
      (left === this.position.maxScrollLeft && this.wheelDistance.x > 0)
    ) {
      this.wheelDistance.x = 0;
    }
    if (
      (top === 0 && this.wheelDistance.y < 0) ||
      (top === this.position.maxScrollTop && this.wheelDistance.y > 0)
    ) {
      this.wheelDistance.y = 0;
    }
    if (left !== viewport.scrollLeft || top !== viewport.scrollTop) {
      // 每帧直接写入一次位置，滚轮输入不启动原生平滑过渡。
      viewport.scrollTo({ left, top, behavior: 'instant' });
      this.syncPosition();
    }
  };

  private clearWheel() {
    if (this.wheelFrame !== undefined) {
      cancelAnimationFrame(this.wheelFrame);
      this.wheelFrame = undefined;
    }
    clearTimeout(this.wheelIdleTimer);
    this.wheelIdleTimer = undefined;
    this.wheelDistance = { x: 0, y: 0 };
    this.wheelConfiguration = undefined;
  }

  private geometry(axis: ScrollAxis) {
    const p = this.position;
    const horizontal = axis === 'horizontal';
    const cross = horizontal ? 'vertical' : 'horizontal';
    const total = horizontal ? p.clientWidth : p.clientHeight;
    const crossOptions = scrollbarOptions(this[cross]);
    // overlay 轨道交叉处留角；gutter 已经从视口扣除了对向厚度。
    const corner =
      this.hasOverflow(cross) && crossOptions.placement === 'overlay' ? crossOptions.size : 0;
    return thumbGeometry(
      total,
      horizontal ? p.scrollWidth : p.scrollHeight,
      horizontal ? p.scrollLeft : p.scrollTop,
      Math.max(0, total - corner),
      scrollbarOptions(this[axis]).minThumbSize,
    );
  }

  private pointerDown(event: PointerEvent, axis: ScrollAxis) {
    if (event.button !== 0 || this.drag) {
      return;
    }
    const track = event.currentTarget as HTMLElement;
    const thumb = track.querySelector<HTMLElement>('.thumb');
    if (!thumb) {
      return;
    }
    this.clearWheel();
    event.preventDefault();
    event.stopPropagation();
    const geometry = this.geometry(axis);
    const rect = track.getBoundingClientRect();
    const coordinate = axis === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
    const onThumb = event.composedPath().includes(thumb);
    this.drag = {
      axis,
      pointerId: event.pointerId,
      anchor:
        onThumb && geometry.size > 0
          ? clamp(coordinate - geometry.offset, geometry.size) / geometry.size
          : 0.5,
      thumb,
    };
    thumb.setPointerCapture?.(event.pointerId);
    this.ownerDocument.addEventListener('pointermove', this.moveDrag);
    this.ownerDocument.addEventListener('pointerup', this.finishDrag);
    this.ownerDocument.addEventListener('pointercancel', this.finishDrag);
    thumb.addEventListener('lostpointercapture', this.finishDrag);
    this.show(axis);
    if (!onThumb) {
      this.moveDrag(event);
    }
  }

  private readonly moveDrag = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    event.preventDefault();
    const geometry = this.geometry(drag.axis);
    const rect = drag.thumb.parentElement?.getBoundingClientRect();
    if (!rect || geometry.travel <= 0) {
      return;
    }
    const coordinate =
      drag.axis === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
    const offset = clamp(coordinate - drag.anchor * geometry.size, geometry.travel);
    const position = (offset / geometry.travel) * geometry.maxScroll;
    this.scrollTo({ [drag.axis === 'horizontal' ? 'left' : 'top']: position, behavior: 'instant' });
  };

  private readonly finishDrag = (event: PointerEvent) => {
    if (event.pointerId === this.drag?.pointerId) {
      this.endDrag();
    }
  };

  private endDrag() {
    const drag = this.drag;
    this.drag = undefined;
    this.ownerDocument.removeEventListener('pointermove', this.moveDrag);
    this.ownerDocument.removeEventListener('pointerup', this.finishDrag);
    this.ownerDocument.removeEventListener('pointercancel', this.finishDrag);
    if (drag) {
      drag.thumb.removeEventListener('lostpointercapture', this.finishDrag);
      if (drag.thumb.hasPointerCapture?.(drag.pointerId)) {
        drag.thumb.releasePointerCapture(drag.pointerId);
      }
      this.scheduleHide(drag.axis);
    }
  }

  private keyDown(event: KeyboardEvent, axis: ScrollAxis) {
    const horizontal = axis === 'horizontal';
    const p = this.position;
    const current = horizontal ? p.scrollLeft : p.scrollTop;
    const page = horizontal ? p.clientWidth : p.clientHeight;
    const max = horizontal ? p.maxScrollLeft : p.maxScrollTop;
    const step = nonNegative(this.stepDistance, 40);
    const keys: Record<string, number> = {
      Home: 0,
      End: max,
      PageUp: current - page,
      PageDown: current + page,
      [horizontal ? 'ArrowLeft' : 'ArrowUp']: current - step,
      [horizontal ? 'ArrowRight' : 'ArrowDown']: current + step,
    };
    if (keys[event.key] !== undefined) {
      event.preventDefault();
      this.scrollTo({ [horizontal ? 'left' : 'top']: keys[event.key] });
    }
  }

  private renderScrollbar(axis: ScrollAxis) {
    const options = scrollbarOptions(this[axis]);
    const geometry = this.geometry(axis);
    if (!geometry.visible) {
      return nothing;
    }
    const horizontal = axis === 'horizontal';
    const p = this.position;
    const opacity = this.revealed[axis] ? options.opacity : 0;
    return html`<div
      part=${`${axis}-track`}
      class=${`track ${axis}`}
      role="scrollbar"
      tabindex="0"
      aria-label=${horizontal ? '横向滚动' : '纵向滚动'}
      aria-orientation=${axis}
      aria-controls=${this.viewportId}
      aria-valuemin="0"
      aria-valuemax=${geometry.maxScroll}
      aria-valuenow=${horizontal ? p.scrollLeft : p.scrollTop}
      style=${styleMap({
        width: `${horizontal ? geometry.travel + geometry.size : options.size}px`,
        height: `${horizontal ? options.size : geometry.travel + geometry.size}px`,
        opacity: String(opacity),
        pointerEvents: opacity > 0 ? 'auto' : 'none',
        transitionDuration: `${this.revealed[axis] ? options.fadeInDuration : options.fadeOutDuration}ms`,
      })}
      @pointerdown=${(event: PointerEvent) => this.pointerDown(event, axis)}
      @keydown=${(event: KeyboardEvent) => this.keyDown(event, axis)}
      @focus=${() => {
        this.focused.add(axis);
        this.show(axis);
      }}
      @blur=${() => {
        this.focused.delete(axis);
        this.scheduleHide(axis);
      }}
    >
      <div
        part=${`${axis}-thumb`}
        class="thumb"
        style=${styleMap({
          backgroundColor: options.color,
          borderRadius: `${options.radius}px`,
          width: horizontal ? `${geometry.size}px` : undefined,
          height: horizontal ? undefined : `${geometry.size}px`,
          transform: horizontal
            ? `translateX(${geometry.offset}px)`
            : `translateY(${geometry.offset}px)`,
        })}
      ></div>
    </div>`;
  }

  render() {
    return html`<div class="frame" part="frame">
      <div
        class="viewport"
        part="viewport"
        id=${this.viewportId}
        tabindex="0"
        @scroll=${this.nativeScroll}
      >
        <div class="extent" aria-hidden="true"></div>
        <div class="content" part="content">
          ${this.content
            ? this.content(this.metrics === undefined ? this.updateContentMetrics : undefined)
            : html`<slot
                @slotchange=${() => {
                  this.observeContent();
                  this.queueRefresh();
                }}
              ></slot>`}
        </div>
      </div>
      ${axes.map((axis) => this.renderScrollbar(axis))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-scroll-container': SCWCScrollContainer;
  }
}
