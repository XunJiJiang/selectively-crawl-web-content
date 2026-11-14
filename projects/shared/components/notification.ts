import { html, nothing, svg, type TemplateResult } from 'lit';
import type { FeedbackProgress } from '../workbench-feedback.ts';

export interface NotificationPresentation {
  title: string;
  message?: string;
  level?: string;
  progress?: FeedbackProgress;
  actions?: TemplateResult;
  icon?: TemplateResult;
  focused?: boolean;
  onClose: () => void;
  onFocus?: (focused: boolean) => void;
  onClick?: () => void;
  onHover?: (hovered: boolean) => void;
}
export function renderNotificationProgress(progress: FeedbackProgress | undefined) {
  if (progress === undefined || progress === false) {
    return nothing;
  }
  return html`<div
    class=${`feedback-progress ${progress === null ? 'indeterminate' : ''}`}
    role="progressbar"
    aria-label="进度"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${typeof progress === 'number' ? progress : nothing}
    aria-valuetext=${progress === null ? '加载中' : `${progress}%`}
  >
    <span style=${`width:${progress === null ? 35 : Math.max(0, Math.min(100, progress))}%`}></span>
  </div>`;
}
export function notificationIcon(level = 'info') {
  return svg`<svg viewBox="0 0 16 16" aria-hidden="true">${
    level === 'warn'
      ? svg`<path d="M8 1.5 15 14H1Z"/><path d="M8 5.5v4M8 11.5v.1"/>`
      : svg`<circle cx="8" cy="8" r="6.5"/>${
          level === 'success'
            ? svg`<path d="m4.5 8 2.5 2.5 4.5-5"/>`
            : level === 'error'
              ? svg`<path d="m5.5 5.5 5 5m0-5-5 5"/>`
              : svg`<path d="M8 7v4M8 4.5v.1"/>`
        }`
  }</svg>`;
}
export function renderNotificationContent(value: NotificationPresentation) {
  return html`<span class="notify-icon">${value.icon ?? notificationIcon(value.level)}</span>
    <div class="toast-body notify-body">
      <strong class="notify-title-text">${value.title}</strong> ${value.message
        ? html`<p class="notify-content">${value.message}</p>`
        : nothing}
      ${value.actions ?? nothing}
    </div>
    <button
      class="notify-close icon-button"
      type="button"
      aria-label="关闭提示"
      @click=${(event: MouseEvent) => {
        event.stopPropagation();
        value.onClose();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button
    >${renderNotificationProgress(value.progress)}`;
}
/** The same card is used in the workbench and the standalone six-position host. */
export function renderNotification(value: NotificationPresentation) {
  return html`<div
    class=${`toast scwc-notification ${value.level ?? 'info'} ${value.focused ? 'focused' : ''}`}
    tabindex="0"
    role=${value.level === 'error' ? 'alert' : 'status'}
    @click=${(event: MouseEvent) => {
      (event.currentTarget as HTMLElement).focus();
      value.onClick?.();
    }}
    @mouseenter=${() => value.onHover?.(true)}
    @mouseleave=${() => value.onHover?.(false)}
    @focusin=${() => value.onFocus?.(true)}
    @focusout=${(event: FocusEvent) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
        value.onFocus?.(false);
      }
    }}
  >
    ${renderNotificationContent(value)}
  </div>`;
}
