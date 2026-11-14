import { LitElement, html, css } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../utils/customElement.ts';

/** Plain-text tooltip shared by Web, userscript and extension Shadow DOM surfaces. */
@customElement('scwc-tooltip')
export class SCWCTooltip extends LitElement {
  @property() accessor text = '';
  private anchor?: HTMLElement;
  private generation = 0;
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
      padding: 7px 10px;
      overflow: auto;
      border: 1px solid var(--border-strong, #555);
      border-radius: var(--radius-md, 6px);
      background: var(--surface-2, #25272b);
      color: var(--text-primary, #eee);
      box-shadow: 0 4px 16px #0005;
      font: var(--text-xs, 13px) / 1.5 var(--font-sans, sans-serif);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      text-align: left;
    }
    :host([hidden]) {
      display: none;
    }
    :host::backdrop {
      display: none;
    }
  `;

  async openFor(anchor: HTMLElement, text: string) {
    if (!text || !anchor.isConnected) {
      this.close();
      return;
    }
    const generation = ++this.generation;
    this.anchor = anchor;
    this.text = text;
    await this.updateComplete;
    if (generation !== this.generation || !this.isConnected || !anchor.isConnected) {
      return;
    }
    this.hidden = false;
    // The top layer escapes scroll containers and preserves the anchor surface's theme.
    if (this.showPopover && !this.matches(':popover-open')) {
      this.showPopover();
    }
    this.reposition();
  }

  private reposition() {
    const anchor = this.anchor?.getBoundingClientRect();
    const view = this.ownerDocument.defaultView;
    if (!anchor || !view) {
      return;
    }
    const { width, height } = this.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - width - 8));
    const below = anchor.bottom + 6;
    const top = below + height <= view.innerHeight - 8 ? below : anchor.top - height - 6;
    this.style.left = `${left}px`;
    this.style.top = `${Math.max(8, Math.min(top, view.innerHeight - height - 8))}px`;
  }

  close() {
    ++this.generation;
    if (this.hidePopover && this.matches(':popover-open')) {
      this.hidePopover();
    }
    this.hidden = true;
    this.anchor = undefined;
  }

  disconnectedCallback() {
    this.close();
    super.disconnectedCallback();
  }

  render() {
    return html`${this.text}`;
  }
}

/** Bind to an existing element without changing its layout or using native title bubbles. */
export function attachTooltip(
  target: HTMLElement,
  text: (anchor: HTMLElement) => string,
  options: { delegate?: string } = {},
): () => void {
  const tooltip = target.ownerDocument.createElement('scwc-tooltip') as SCWCTooltip;
  tooltip.setAttribute('popover', 'manual');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  target.after(tooltip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let anchor: HTMLElement | null = null;
  const cancel = () => clearTimeout(timer);
  const close = () => {
    cancel();
    tooltip.close();
    anchor = null;
  };
  const resolveAnchor = (element: EventTarget | null) => {
    if (!options.delegate) {
      return target;
    }
    const match =
      element instanceof Element ? element.closest<HTMLElement>(options.delegate) : null;
    return match && target.contains(match) ? match : null;
  };
  const open = (event: Event) => {
    const next = resolveAnchor(event.target);
    if (!next) {
      close();
      return;
    }
    cancel();
    if (options.delegate && next === anchor && !tooltip.hidden) {
      return;
    }
    anchor = next;
    observer.takeRecords();
    void tooltip.openFor(next, text(next));
  };
  const leave = (event?: Event) => {
    if (
      options.delegate &&
      event &&
      anchor &&
      resolveAnchor((event as MouseEvent).relatedTarget) === anchor
    ) {
      return;
    }
    cancel();
    timer = setTimeout(close, 120);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
    }
  };
  const view = target.ownerDocument.defaultView;
  const scroll = (event: Event) => {
    if (!event.composedPath().includes(tooltip)) {
      close();
    }
  };
  const enterEvent = options.delegate ? 'mouseover' : 'mouseenter';
  const leaveEvent = options.delegate ? 'mouseout' : 'mouseleave';
  const focusEvent = options.delegate ? 'focusin' : 'focus';
  const blurEvent = options.delegate ? 'focusout' : 'blur';
  target.addEventListener(enterEvent, open);
  target.addEventListener(leaveEvent, leave);
  target.addEventListener(focusEvent, open);
  target.addEventListener(blurEvent, leave);
  tooltip.addEventListener('mouseenter', cancel);
  tooltip.addEventListener('mouseleave', leave);
  view?.addEventListener('keydown', escape);
  view?.addEventListener('resize', close);
  view?.addEventListener('scroll', scroll, true);
  // Close on scrolling instead of leaving a stale floating label over another control.
  const root = target.getRootNode();
  root.addEventListener('scroll', scroll, true);
  const observer = new MutationObserver(close);
  observer.observe(target, { attributes: true, childList: true, subtree: true });
  return () => {
    close();
    observer.disconnect();
    target.removeEventListener(enterEvent, open);
    target.removeEventListener(leaveEvent, leave);
    target.removeEventListener(focusEvent, open);
    target.removeEventListener(blurEvent, leave);
    view?.removeEventListener('keydown', escape);
    view?.removeEventListener('resize', close);
    view?.removeEventListener('scroll', scroll, true);
    root.removeEventListener('scroll', scroll, true);
    tooltip.remove();
  };
}
