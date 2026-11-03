import { LitElement, html, css } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../utils/customElement.ts';
import { versionNoticeKey, type VersionNotice } from '../client-version.ts';

@customElement('scwc-version-notice')
class VersionNoticeElement extends LitElement {
  @property({ attribute: false }) accessor notice!: VersionNotice;
  dismiss: () => void | Promise<void> = () => undefined;
  static styles = css`
    :host {
      position: fixed;
      z-index: 2147483647;
      inset: 12px 12px auto;
      display: block;
      color: var(--text-primary, #eee);
      font: 14px/1.5 sans-serif;
    }
    aside {
      padding: 12px;
      background: var(--surface-2, #252526);
      border: 1px solid var(--border-default, #555);
      border-radius: 4px;
      box-shadow: 0 4px 18px #0005;
    }
    p {
      margin: 0 0 10px;
    }
    button {
      cursor: pointer;
      padding: 4px 8px;
      margin-right: 8px;
      color: inherit;
      background: transparent;
      border: 1px solid #888;
      border-radius: 3px;
      font: inherit;
    }
  `;
  render() {
    return html`<aside role="alert">
      <p>${this.notice.message}</p>
      <button @click=${() => this.remove()}>关闭</button>${this.notice.status === 'warning'
        ? html`<button
            @click=${async () => {
              await this.dismiss();
              this.remove();
            }}
          >
            当前版本不再提示
          </button>`
        : ''}
    </aside>`;
  }
}
const shown = new Set<string>();
export function showVersionNotice(notice: VersionNotice, dismiss?: () => void | Promise<void>) {
  const key =
    notice.status === 'error'
      ? `${versionNoticeKey(notice)}:error:${notice.route}`
      : versionNoticeKey(notice);
  if (shown.has(key)) {
    return;
  }
  try {
    if (notice.status === 'warning' && !dismiss && localStorage.getItem(key)) {
      return;
    }
  } catch {
    /* private browsing */
  }
  shown.add(key);
  const element = new VersionNoticeElement();
  element.notice = notice;
  element.dismiss =
    dismiss ??
    (() => {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* session dedup still works */
      }
    });
  document.body.append(element);
}
