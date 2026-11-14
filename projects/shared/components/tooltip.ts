import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { scheduleFrame } from '../utils/frame.ts';
import { customElement } from '../utils/customElement.ts';

export type TooltipPlacement = 'right' | 'left' | 'bottom' | 'top' | 'current';
export type TooltipTrigger = 'hover' | 'click' | 'contextmenu';
type TooltipText = string | (() => string);
const HOVER_DELAY = 1000;
const CLOSE_DELAY = 100;
const coordinators = new WeakMap<Document, TooltipCoordinator>();

/** One visible popup and one pending hover per document, including ShadowRoots. */
class TooltipCoordinator {
  active?: SCWCTooltip;
  pending?: SCWCTooltip;
  private roots = new Map<Node, number>();
  private count = 0;
  private blurTimer?: ReturnType<typeof setTimeout>;
  constructor(privateDocument: Document) {
    this.document = privateDocument;
  }
  private document: Document;
  register(root: Node) {
    const view = this.document.defaultView;
    if (this.count++ === 0) {
      view?.addEventListener('pointerdown', this.outside, true);
      view?.addEventListener('focusin', this.outside, true);
      view?.addEventListener('focusout', this.windowBlur, true);
      view?.addEventListener('blur', this.windowBlur);
      view?.addEventListener('keydown', this.escape);
      view?.addEventListener('resize', this.resize);
      view?.addEventListener('scroll', this.scroll, true);
    }
    if (root !== this.document && !this.roots.has(root)) {
      root.addEventListener('scroll', this.scroll, true);
    }
    this.roots.set(root, (this.roots.get(root) ?? 0) + 1);
    return () => {
      const count = (this.roots.get(root) ?? 1) - 1;
      if (count) {
        this.roots.set(root, count);
      } else {
        this.roots.delete(root);
        root.removeEventListener('scroll', this.scroll, true);
      }
      if (--this.count === 0) {
        clearTimeout(this.blurTimer);
        this.blurTimer = undefined;
        view?.removeEventListener('pointerdown', this.outside, true);
        view?.removeEventListener('focusin', this.outside, true);
        view?.removeEventListener('focusout', this.windowBlur, true);
        view?.removeEventListener('blur', this.windowBlur);
        view?.removeEventListener('keydown', this.escape);
        view?.removeEventListener('resize', this.resize);
        view?.removeEventListener('scroll', this.scroll, true);
      }
    };
  }
  private outside = (event: Event) => {
    if (this.active && !this.active.containsEvent(event)) {
      this.active.close();
    }
    if (this.pending && !this.pending.containsEvent(event)) {
      this.pending.cancelPending();
    }
  };
  private escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.active?.close();
      this.pending?.cancelPending();
    }
  };
  private windowBlur = () => {
    // An iframe receives pointer events in its own window. Wait until the parent
    // document's activeElement has changed before deciding whether focus left us.
    // A microtask can run midway through the browser's iframe focus transition.
    clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(this.checkFocus, 0);
  };
  private checkFocus = () => {
    this.blurTimer = undefined;
    if (this.active && !this.active.containsFocus()) {
      this.active.close();
    }
    // Browsers emit no parent focus event when switching between two iframes.
    // Only watch while a pinned popup contains the focused frame, once per document.
    if (this.active?.pinned && this.active.containsFrameFocus()) {
      this.blurTimer = setTimeout(this.checkFocus, CLOSE_DELAY);
    }
  };
  private resize = () => this.active?.queueReposition();
  private scroll = (event: Event) => {
    this.pending?.cancelPending();
    if (this.active && !event.composedPath().includes(this.active)) {
      if (this.active.pinned) {
        this.active.queueReposition();
      } else {
        this.active.close();
      }
    }
  };
}
function coordinator(document: Document) {
  let state = coordinators.get(document);
  if (!state) {
    state = new TooltipCoordinator(document);
    coordinators.set(document, state);
  }
  return state;
}

function focusWithin(element?: HTMLElement) {
  const root = element?.getRootNode();
  const active = root instanceof Document || root instanceof ShadowRoot ? root.activeElement : null;
  // The owning root keeps its iframe/ShadowRoot host as activeElement.
  return !!active && (active === element || !!element?.contains(active));
}

/** Text and interactive content share one top-layer popup and lifecycle. */
@customElement('scwc-tooltip')
export class SCWCTooltip extends LitElement {
  @property() accessor text = '';
  /** A render callback keeps custom views unmounted until the tooltip opens. */
  @property({ attribute: false }) accessor content: (() => unknown) | undefined;
  @property({ attribute: false }) accessor placements: readonly TooltipPlacement[] = [
    'bottom',
    'top',
    'right',
    'left',
    'current',
  ];
  @property({
    converter: {
      fromAttribute: (value: string | null) =>
        (value?.split(/\s+/).filter(Boolean) ?? ['hover']) as TooltipTrigger[],
      toAttribute: (value: readonly TooltipTrigger[]) => value.join(' '),
    },
  })
  accessor triggers: readonly TooltipTrigger[] = ['hover'];
  @property({ type: Boolean, reflect: true }) accessor interactive = false;
  @property({ type: Boolean, reflect: true }) accessor arrow = true;
  @property({ type: Boolean, reflect: true, attribute: 'match-anchor-height' })
  accessor matchAnchorHeight = false;
  @property() accessor group = '';
  @state() accessor pinned = false;
  @state() accessor opened = false;
  private anchor?: HTMLElement;
  private pendingAnchor?: HTMLElement;
  private generation = 0;
  private openTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private observer?: ResizeObserver;
  private unregister?: () => void;
  private unbind?: () => void;
  private binding?: {
    target: HTMLElement;
    text: (anchor: HTMLElement) => string;
    delegate?: string;
  };
  private frame?: () => void;
  private coordinator!: TooltipCoordinator;

  static styles = css`
    :host {
      position: fixed;
      inset: auto;
      z-index: 10000;
      box-sizing: border-box;
      width: max-content;
      max-width: min(360px, calc(100vw - 16px));
      max-height: calc(100vh - 16px);
      margin: 0;
      padding: 2px 6px;
      overflow: visible;
      --tooltip-border-color: var(--border-strong, #555);
      --tooltip-surface: var(--menu-background, rgb(0 0 0 / 45%));
      border: 1px solid transparent;
      border-radius: var(--radius-sm, 3px);
      /* The continuous outline below also supplies the pinned focus indicator. */
      outline: none !important;
      background: var(--tooltip-surface);
      backdrop-filter: blur(16px);
      color: var(--text-primary, #eee);
      box-shadow: 0 4px 16px #0005;
      font: var(--text-xs, 13px) / 18px var(--font-sans, sans-serif);
      /* Preserve text whitespace in the slot, not between the body and arrow. */
      white-space: normal;
      overflow-wrap: anywhere;
      text-align: left;
    }
    .outline {
      position: absolute;
      inset: -1px;
      z-index: 1;
      width: calc(100% + 2px);
      height: calc(100% + 2px);
      overflow: visible;
      fill: none;
      stroke: var(--tooltip-border-color);
      stroke-width: 1;
      stroke-linejoin: miter;
      pointer-events: none;
    }
    :host([interactive]) {
      width: 320px;
      padding: 0;
      border-radius: var(--radius-md, 6px);
    }
    :host([match-anchor-height]) {
      height: var(--tooltip-anchor-height);
      max-width: calc(100vw - 16px);
      padding-block: 0;
      line-height: calc(var(--tooltip-anchor-height) - 2px);
    }
    :host([data-pinned]) {
      --tooltip-border-color: var(--accent-primary, #89b4fa);
    }
    .body {
      max-height: calc(100vh - 22px);
      overflow: auto;
      white-space: normal;
    }
    :host([interactive]) .body,
    :host([match-anchor-height]) .body {
      height: 100%;
    }
    slot {
      display: block;
      white-space: pre-wrap;
    }
    :host([match-anchor-height]) slot {
      white-space: pre;
    }
    .arrow {
      position: absolute;
      z-index: -1;
      box-sizing: content-box;
      width: 6px;
      height: 6px;
      background: var(--tooltip-surface);
      backdrop-filter: blur(16px);
      border: 1px solid transparent;
      border-left: 0;
      border-top: 0;
      /* Show only the half outside the surface, avoiding stacked alpha fills. */
      clip-path: polygon(100% 0.707px, 100% 100%, 0.707px 100%);
      pointer-events: none;
    }
    :host([data-placement='top']) .arrow {
      left: var(--tooltip-pointer-x);
      bottom: -4px;
      transform: translateX(-50%) rotate(45deg);
    }
    :host([data-placement='bottom']) .arrow {
      left: var(--tooltip-pointer-x);
      top: -4px;
      transform: translateX(-50%) rotate(225deg);
    }
    :host([data-placement='left']) .arrow {
      top: var(--tooltip-pointer-y);
      right: -4px;
      transform: translateY(-50%) rotate(-45deg);
    }
    :host([data-placement='right']) .arrow {
      top: var(--tooltip-pointer-y);
      left: -4px;
      transform: translateY(-50%) rotate(135deg);
    }
    :host([data-placement='current']) .arrow {
      display: none;
    }
    :host([hidden]) {
      display: none;
    }
    :host::backdrop {
      display: none;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.hidden = !this.opened;
    this.setAttribute('popover', 'manual');
    this.setAttribute('role', 'tooltip');
    this.tabIndex = -1;
    this.coordinator = coordinator(this.ownerDocument);
    this.unregister = this.coordinator.register(this.getRootNode());
    this.addEventListener('mouseenter', this.keepOpen);
    this.addEventListener('mouseleave', this.scheduleClose);
    this.addEventListener('focusin', this.pin);
    this.addEventListener('click', this.pin, true);
    this.bindSource();
  }

  containsEvent(event: Event) {
    const path = event.composedPath();
    return (
      path.includes(this) ||
      !!(this.anchor && path.includes(this.anchor)) ||
      !!(this.pendingAnchor && path.includes(this.pendingAnchor))
    );
  }

  containsFocus() {
    return focusWithin(this) || focusWithin(this.anchor) || focusWithin(this.pendingAnchor);
  }

  containsFrameFocus() {
    const root = this.getRootNode();
    let active = root instanceof Document || root instanceof ShadowRoot ? root.activeElement : null;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active?.localName === 'iframe';
  }

  /** Native sources and forwarded iframe surface events use the same trigger state machine. */
  trigger(
    type: TooltipTrigger | 'leave' | 'escape',
    anchor?: HTMLElement,
    text?: TooltipText,
  ): boolean {
    if (type === 'leave') {
      this.scheduleClose();
      return true;
    }
    if (type === 'escape') {
      this.close();
      return true;
    }
    const active = this.coordinator.active;
    const warmGroup = type === 'hover' && active?.group === this.group;
    if (!anchor || (!this.triggers.includes(type) && !warmGroup)) {
      return false;
    }
    const value = typeof text === 'function' ? text() : text;
    if (value !== undefined && !value) {
      this.cancelPending();
      return false;
    }
    if (type !== 'hover') {
      void this.openFor(anchor, value, true);
      return true;
    }
    if (active?.pinned && active.group !== this.group) {
      this.cancelPending();
      return false;
    }
    if (active === this && this.anchor === anchor && !this.closeTimer) {
      this.keepOpen();
      return true;
    }
    // Any still-visible member keeps its group warm, including re-entry during the 100ms grace.
    if (active?.group === this.group) {
      const pinned = active.pinned;
      active.close();
      void this.openFor(anchor, value, pinned);
      return true;
    }
    if (this.pendingAnchor === anchor) {
      return true;
    }
    this.cancelPending();
    this.coordinator.pending?.cancelPending();
    this.coordinator.pending = this;
    this.pendingAnchor = anchor;
    this.openTimer = setTimeout(() => {
      this.cancelPending();
      const current = typeof text === 'function' ? text() : text;
      void this.openFor(anchor, current);
    }, HOVER_DELAY);
    return true;
  }

  cancelPending() {
    clearTimeout(this.openTimer);
    this.openTimer = undefined;
    this.pendingAnchor = undefined;
    if (this.coordinator?.pending === this) {
      this.coordinator.pending = undefined;
    }
  }

  async openFor(anchor: HTMLElement, text?: string, pin = false) {
    this.cancelPending();
    this.keepOpen();
    if (
      (text !== undefined ? !text : !this.text && !this.content && !this.childNodes.length) ||
      !anchor.isConnected ||
      !this.isConnected
    ) {
      this.close();
      return;
    }
    const active = this.coordinator.active;
    if (active && active !== this && active.pinned && active.group !== this.group && !pin) {
      return;
    }
    const fixed = pin || (active?.group === this.group && active.pinned) || this.pinned;
    if (active && active !== this) {
      active.close();
    }
    this.coordinator.pending?.cancelPending();
    this.coordinator.active = this;
    const generation = ++this.generation;
    if (this.anchor !== anchor) {
      this.observer?.disconnect();
    }
    this.anchor = anchor;
    if (typeof ResizeObserver === 'function') {
      this.observer ??= new ResizeObserver(this.queueReposition);
      this.observer.observe(this);
      this.observer.observe(anchor);
    }
    if (text !== undefined) {
      this.text = text;
    }
    this.opened = true;
    this.pinned = fixed;
    await this.updateComplete;
    if (generation !== this.generation || !this.isConnected || !anchor.isConnected) {
      return;
    }
    this.hidden = false;
    if (this.showPopover && !this.matches(':popover-open')) {
      this.showPopover();
    }
    this.reposition();
    if (fixed) {
      this.focus({ preventScroll: true });
    }
  }

  keepOpen = () => {
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  };

  scheduleClose = () => {
    this.cancelPending();
    if (this.pinned) {
      return;
    }
    if (!this.opened || this.hidden) {
      this.close();
      return;
    }
    this.keepOpen();
    this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY);
  };

  pin = () => {
    if (!this.opened) {
      return;
    }
    this.keepOpen();
    this.pinned = true;
    // Focusing a control inside custom content must keep that control's focus.
    if (!focusWithin(this)) {
      this.focus({ preventScroll: true });
    }
  };

  queueReposition = () => {
    if (this.frame || !this.opened) {
      return;
    }
    this.frame = scheduleFrame(() => {
      this.frame = undefined;
      this.reposition();
    });
  };

  private setStyle(name: string, value: string) {
    if (this.style.getPropertyValue(name) !== value) {
      this.style.setProperty(name, value);
    }
  }

  private updateOutline(
    width: number,
    height: number,
    placement: TooltipPlacement,
    style: CSSStyleDeclaration,
  ) {
    const outline = this.renderRoot.querySelector('svg.outline');
    const path = outline?.querySelector('path');
    if (!outline || !path || width <= 0 || height <= 0) {
      return;
    }
    const left = 0.5,
      top = 0.5,
      right = width - 0.5,
      bottom = height - 0.5;
    const radius = Math.max(
      0,
      Math.min(parseFloat(style.borderTopLeftRadius) - 0.5 || 0, (width - 1) / 2, (height - 1) / 2),
    );
    const x =
      parseFloat(this.style.getPropertyValue('--tooltip-pointer-x')) +
      (parseFloat(style.borderLeftWidth) || 0);
    const y =
      parseFloat(this.style.getPropertyValue('--tooltip-pointer-y')) +
      (parseFloat(style.borderTopWidth) || 0);
    // The stroke follows the centre of a 6px square rotated by 45 degrees.
    const half = 6 / Math.SQRT2;
    const side = this.arrow ? placement : 'current';
    const segments = [`M ${left + radius} ${top}`];
    if (side === 'bottom') {
      segments.push(`L ${x - half} ${top} L ${x} ${top - half} L ${x + half} ${top}`);
    }
    segments.push(`L ${right - radius} ${top} Q ${right} ${top} ${right} ${top + radius}`);
    if (side === 'left') {
      segments.push(`L ${right} ${y - half} L ${right + half} ${y} L ${right} ${y + half}`);
    }
    segments.push(`L ${right} ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom}`);
    if (side === 'top') {
      segments.push(`L ${x + half} ${bottom} L ${x} ${bottom + half} L ${x - half} ${bottom}`);
    }
    segments.push(`L ${left + radius} ${bottom} Q ${left} ${bottom} ${left} ${bottom - radius}`);
    if (side === 'right') {
      segments.push(`L ${left} ${y + half} L ${left - half} ${y} L ${left} ${y - half}`);
    }
    segments.push(`L ${left} ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`);
    const d = segments.join(' ');
    if (path.getAttribute('d') !== d) {
      outline.setAttribute('viewBox', `0 0 ${width} ${height}`);
      path.setAttribute('d', d);
    }
  }

  bindTo(
    target: HTMLElement,
    text: (anchor: HTMLElement) => string = () => this.text,
    delegate?: string,
  ) {
    this.unbind?.();
    this.close();
    const binding = { target, text, delegate };
    this.binding = binding;
    this.bindSource();
    return () => {
      if (this.binding === binding) {
        this.unbind?.();
        this.binding = undefined;
        this.close();
      }
    };
  }

  private bindSource() {
    if (!this.isConnected || !this.binding || this.unbind) {
      return;
    }
    const { target, text, delegate } = this.binding;
    let current: HTMLElement | null = null;
    const resolve = (element: EventTarget | null) => {
      if (!delegate) {
        return target;
      }
      const match = element instanceof Element ? element.closest<HTMLElement>(delegate) : null;
      return match && target.contains(match) ? match : null;
    };
    const enter = (event: Event) => {
      const anchor = resolve(event.target);
      if (!anchor) {
        return;
      }
      current = anchor;
      this.trigger('hover', anchor, () => text(anchor));
    };
    const leave = (event: Event) => {
      const related = (event as MouseEvent).relatedTarget;
      if (
        (delegate && current && resolve(related) === current) ||
        (related instanceof Node && this.contains(related))
      ) {
        return;
      }
      this.trigger('leave');
    };
    const activate = (event: Event) => {
      const anchor = resolve(event.target);
      if (!anchor) {
        return;
      }
      current = anchor;
      if (
        this.trigger(event.type as TooltipTrigger, anchor, () => text(anchor)) &&
        event.type === 'contextmenu'
      ) {
        event.preventDefault();
      }
    };
    const enterEvent = delegate ? 'mouseover' : 'mouseenter';
    const leaveEvent = delegate ? 'mouseout' : 'mouseleave';
    target.addEventListener(enterEvent, enter);
    target.addEventListener(leaveEvent, leave);
    target.addEventListener('focusin', enter);
    target.addEventListener('focusout', leave);
    target.addEventListener('click', activate);
    target.addEventListener('contextmenu', activate);
    const observer = new MutationObserver(() => {
      // Ignore incidental class/style changes; invalidate only removed or changed sources.
      const anchor = this.anchor ?? this.pendingAnchor;
      if (anchor && (!anchor.isConnected || (this.opened && text(anchor) !== this.text))) {
        this.close();
      }
    });
    observer.observe(target, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    const cleanup = () => {
      observer.disconnect();
      target.removeEventListener(enterEvent, enter);
      target.removeEventListener(leaveEvent, leave);
      target.removeEventListener('focusin', enter);
      target.removeEventListener('focusout', leave);
      target.removeEventListener('click', activate);
      target.removeEventListener('contextmenu', activate);
      if (this.unbind === cleanup) {
        this.unbind = undefined;
      }
    };
    this.unbind = cleanup;
  }

  /** Re-run the ordered fit checks after custom content changes size. */
  reposition = () => {
    if (!this.opened) {
      return;
    }
    const anchor = this.anchor?.getBoundingClientRect();
    const view = this.ownerDocument.defaultView;
    if (!anchor || !view || !this.anchor?.isConnected) {
      this.close();
      return;
    }
    this.setStyle('--tooltip-anchor-height', `${anchor.height}px`);
    const { width, height } = this.getBoundingClientRect();
    const middleX = anchor.left + (anchor.width - width) / 2;
    const middleY = anchor.top + (anchor.height - height) / 2;
    const positions: Record<TooltipPlacement, { left: number; top: number }> = {
      right: { left: anchor.right + 6, top: middleY },
      left: { left: anchor.left - width - 6, top: middleY },
      bottom: { left: middleX, top: anchor.bottom + 6 },
      top: { left: middleX, top: anchor.top - height - 6 },
      current: { left: anchor.left, top: anchor.top },
    };
    const order = this.placements.length ? this.placements : (['current'] as const);
    const fits = ({ left, top }: { left: number; top: number }) =>
      left >= 8 &&
      top >= 8 &&
      left + width <= view.innerWidth - 8 &&
      top + height <= view.innerHeight - 8;
    const placement = order.find((side) => fits(positions[side])) ?? order[order.length - 1];
    const position = positions[placement];
    this.dataset.placement = placement;
    this.setStyle('left', `${Math.max(8, Math.min(position.left, view.innerWidth - width - 8))}px`);
    this.setStyle('top', `${Math.max(8, Math.min(position.top, view.innerHeight - height - 8))}px`);
    const surfaceStyle = view.getComputedStyle(this);
    const borderLeft = Number.parseFloat(surfaceStyle.borderLeftWidth) || 0;
    this.setStyle(
      '--tooltip-pointer-x',
      `${Math.max(12, Math.min(width - 12, anchor.left + anchor.width / 2 - Number.parseFloat(this.style.left) - borderLeft))}px`,
    );
    // Absolute arrow coordinates start inside the border. Keep the source centre
    // even when a short row or viewport clamping leaves less than 12px of room.
    const borderTop = Number.parseFloat(surfaceStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(surfaceStyle.borderBottomWidth) || 0;
    const pointerY = anchor.top + anchor.height / 2 - Number.parseFloat(this.style.top) - borderTop;
    this.setStyle(
      '--tooltip-pointer-y',
      `${Math.max(0, Math.min(height - borderTop - borderBottom, pointerY))}px`,
    );
    this.updateOutline(width, height, placement, surfaceStyle);
  };

  protected updated(changed: PropertyValues) {
    this.toggleAttribute('data-pinned', this.pinned);
    this.setAttribute('role', this.pinned ? 'dialog' : 'tooltip');
    if (
      this.opened &&
      changed.has('text') &&
      !this.text &&
      !this.content &&
      !this.childNodes.length
    ) {
      this.close();
    }
    if (this.opened && !this.hidden) {
      this.queueReposition();
    }
  }

  close() {
    this.cancelPending();
    this.keepOpen();
    this.frame?.();
    this.frame = undefined;
    ++this.generation;
    if (this.hidePopover && this.matches(':popover-open')) {
      this.hidePopover();
    }
    this.hidden = true;
    this.opened = false;
    this.pinned = false;
    this.observer?.disconnect();
    this.anchor = undefined;
    if (this.coordinator?.active === this) {
      this.coordinator.active = undefined;
    }
  }

  disconnectedCallback() {
    this.unbind?.();
    this.close();
    this.unregister?.();
    this.unregister = undefined;
    this.removeEventListener('mouseenter', this.keepOpen);
    this.removeEventListener('mouseleave', this.scheduleClose);
    this.removeEventListener('focusin', this.pin);
    this.removeEventListener('click', this.pin, true);
    super.disconnectedCallback();
  }

  render() {
    return this.opened
      ? html`<div class="body" part="content">
            ${this.content?.() ?? html`<slot>${this.text}</slot>`}
          </div>
          ${this.arrow
            ? html`<span class="arrow" part="arrow" aria-hidden="true"></span>`
            : nothing}
          <svg class="outline" aria-hidden="true"><path></path></svg>`
      : nothing;
  }
}

export interface TooltipOptions {
  delegate?: string;
  group?: string;
  triggers?: readonly TooltipTrigger[];
  placements?: readonly TooltipPlacement[];
  matchAnchorHeight?: boolean;
}

/** Bind an existing element without changing its layout or using native title bubbles. */
export function attachTooltip(
  target: HTMLElement,
  text: (anchor: HTMLElement) => string,
  options: TooltipOptions = {},
): () => void {
  const tooltip = target.ownerDocument.createElement('scwc-tooltip') as SCWCTooltip;
  tooltip.hidden = true;
  tooltip.group = options.group ?? '';
  tooltip.matchAnchorHeight = options.matchAnchorHeight ?? false;
  if (options.placements) {
    tooltip.placements = options.placements;
  }
  if (options.triggers) {
    tooltip.triggers = options.triggers;
  }
  target.after(tooltip);
  const unbind = tooltip.bindTo(target, text, options.delegate);
  return () => {
    unbind();
    tooltip.remove();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-tooltip': SCWCTooltip;
  }
}
