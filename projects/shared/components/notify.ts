import { css, html, LitElement, render, unsafeCSS } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { customElement } from '../utils/customElement.ts';
import { NotifyController, type NotifyCloseSource } from '../notify-controller.ts';
import type { INotifyOptions, NotifyHandle, NotifyPlacement } from '../types/notify.d.ts';
import { renderNotificationContent } from './notification.ts';
import cardStyle from './notification.css?raw';
import style from './notify.css?raw';

export { NotifyController } from '../notify-controller.ts';
interface Item extends INotifyOptions {
  id: string;
  placement: NotifyPlacement;
  leaving?: boolean;
}
const placements: NotifyPlacement[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];

/** Shared state and view also work in Chrome's isolated world without CustomElementRegistry. */
class NotificationView {
  private items = new Map<string, Item>();
  private removals = new Map<string, ReturnType<typeof setTimeout>>();
  readonly controller = new NotifyController((id, source) => this.leave(id, source));
  private requestUpdate: () => void;
  constructor(requestUpdate: () => void) {
    this.requestUpdate = requestUpdate;
  }
  notify(options: INotifyOptions): NotifyHandle {
    const id = crypto.randomUUID();
    const item: Item = { ...options, id, placement: options.placement ?? 'tr' };
    this.items.set(id, item);
    this.schedule(item);
    this.requestUpdate();
    return {
      id,
      close: () => this.controller.close(id),
      update: (value) => {
        if (item.leaving || !this.items.has(id)) {
          return false;
        }
        Object.assign(item, value);
        this.schedule(item);
        this.requestUpdate();
        return true;
      },
    };
  }
  private schedule(item: Item) {
    const busy = item.progress !== undefined && item.progress !== false && item.progress !== 100;
    this.controller.set(item.id, busy ? 0 : (item.duration ?? 3000));
  }
  private leave(id: string, source: NotifyCloseSource) {
    const item = this.items.get(id);
    if (!item || item.leaving) {
      return;
    }
    item.leaving = true;
    this.requestUpdate();
    this.removals.set(
      id,
      setTimeout(() => {
        this.removals.delete(id);
        this.items.delete(id);
        this.requestUpdate();
      }, 250),
    );
    if (source !== 'manual') {
      item.onclose?.(source);
    }
  }
  render() {
    return html`<div class="notify-container" aria-live="polite">
      ${placements.map(
        (placement) => html` <div class=${`notify-list ${placement}-list`}>
          ${repeat(
            [...this.items.values()].filter((item) => item.placement === placement),
            (item) => item.id,
            (item) => html` <div
              class=${`notify-item scwc-notification ${placement}-item ${item.type ?? 'info'} ${item.type ?? 'info'}-item ${item.leaving ? 'leave' : 'enter'}`}
              tabindex="0"
              role=${item.type === 'error' ? 'alert' : 'status'}
              @click=${(event: MouseEvent) => {
                event.stopPropagation();
                item.onclick?.();
              }}
              @mouseenter=${() => this.controller.pause(item.id)}
              @mouseleave=${() => this.controller.resume(item.id)}
              @focusin=${() => this.controller.pause(item.id, 'focus')}
              @focusout=${(event: FocusEvent) => {
                if (
                  !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)
                ) {
                  this.controller.resume(item.id, 'focus');
                }
              }}
            >
              ${renderNotificationContent({
                title: item.title,
                message: item.description,
                level: item.type,
                progress: item.progress,
                onClose: () => this.controller.close(item.id, 'user'),
                actions: item.actions?.length
                  ? html`<div class="notification-buttons">
                      ${item.actions.map(
                        (action) => html` <button
                          @click=${(event: MouseEvent) => {
                            event.stopPropagation();
                            void action.onClick();
                          }}
                        >
                          ${action.label}
                        </button>`,
                      )}
                    </div>`
                  : undefined,
              })}
            </div>`,
          )}
        </div>`,
      )}
    </div>`;
  }
}

export class SCWCNotify extends LitElement {
  static styles = css`
    ${unsafeCSS(cardStyle)} ${unsafeCSS(style)}
  `;
  private view = new NotificationView(() => this.requestUpdate());
  get controller() {
    return this.view.controller;
  }
  connectedCallback() {
    super.connectedCallback();
    this.controller.connect();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.controller.suspend();
  }
  notify(options: INotifyOptions) {
    return this.view.notify(options);
  }
  render() {
    return this.view.render();
  }
}
if (globalThis.customElements) {
  customElement('scwc-notify')(SCWCNotify);
}

class StandaloneNotify {
  readonly element = document.createElement('div');
  readonly shadowRoot = this.element.attachShadow({ mode: 'open' });
  private view = new NotificationView(() => render(this.view.render(), this.shadowRoot));
  constructor() {
    this.element.className = 'scwc-notify-root';
    this.element.id = 'scwc-notify-root';
    this.element.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cardStyle + style);
    this.shadowRoot.adoptedStyleSheets = [sheet];
    (document.body ?? document.documentElement).append(this.element);
    render(this.view.render(), this.shadowRoot);
  }
  notify(options: INotifyOptions) {
    return this.view.notify(options);
  }
}

/** Workbench-style notifications with a lazily mounted, per-document host. */
export class Notify {
  private static standalone?: StandaloneNotify;
  static getInstance(): SCWCNotify | StandaloneNotify {
    if (!globalThis.customElements) {
      if (!Notify.standalone?.element.isConnected) {
        Notify.standalone = new StandaloneNotify();
      }
      return Notify.standalone;
    }
    let element = document.querySelector<SCWCNotify>('scwc-notify');
    if (!element) {
      element = document.createElement('scwc-notify');
      const root = document.createElement('div');
      root.className = 'scwc-notify-root';
      root.id = 'scwc-notify-root';
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
      root.append(element);
      (document.body ?? document.documentElement).append(root);
    }
    return element;
  }
  static notify(options: INotifyOptions) {
    return Notify.getInstance().notify(options);
  }
  notify(options: INotifyOptions) {
    return Notify.notify(options);
  }
  create(options: INotifyOptions) {
    return this.notify(options);
  }
  info(title: string, options: Omit<INotifyOptions, 'title' | 'type'> = {}) {
    return this.notify({ ...options, title, type: 'info' });
  }
  success(title: string, options: Omit<INotifyOptions, 'title' | 'type'> = {}) {
    return this.notify({ ...options, title, type: 'success' });
  }
  warn(title: string, options: Omit<INotifyOptions, 'title' | 'type'> = {}) {
    return this.notify({ ...options, title, type: 'warn' });
  }
  error(title: string, options: Omit<INotifyOptions, 'title' | 'type'> = {}) {
    return this.notify({ ...options, title, type: 'error' });
  }
}
export const notify = (options: INotifyOptions) => Notify.notify(options);
declare global {
  interface Window {
    scwc?: { notify?: typeof notify };
  }
  interface HTMLElementTagNameMap {
    'scwc-notify': SCWCNotify;
  }
}
if (typeof window !== 'undefined') {
  window.scwc ??= {};
  window.scwc.notify ??= notify;
}
