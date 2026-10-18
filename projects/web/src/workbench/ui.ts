import { html, nothing } from 'lit';
import type { CatalogItem } from './types.ts';
import { runtimeNames, uiNames } from './types.ts';
export const icon = (name: string) => html`<wb-icon name=${name}></wb-icon>`;
export function iconButton(
  name: string,
  label: string,
  action: () => void,
  disabled = false,
  active?: boolean,
) {
  return html`<button
    class="icon-button"
    title=${label}
    aria-label=${label}
    ?disabled=${disabled}
    aria-pressed=${active === undefined ? nothing : active}
    @click=${action}
  >
    ${icon(name)}
  </button>`;
}
export const runtimeClass = (status: string) =>
  status === 'ready'
    ? 'success'
    : ['failed', 'unresponsive'].includes(status)
      ? 'error'
      : ['starting', 'stopping'].includes(status)
        ? 'warn'
        : 'neutral';
export function pluginCard(
  p: CatalogItem,
  action: (id: string, args?: unknown) => void,
  compact = false,
  favorite = false,
) {
  const open = p.runtime.status === 'ready' && p.ui.state === 'ready';
  return html`<article class=${`plugin-card ${compact ? 'compact-card' : ''}`}>
    <div class="plugin-card-header">
      <div class="plugin-card-icon">${icon('plugins')}</div>
      <div class="plugin-card-info">
        <div class="plugin-card-title-row">
          <strong title=${p.title}>${p.title}</strong>${favorite
            ? html`<span class="warn">${icon('bookmarks')}</span>`
            : nothing}
        </div>
        <div class="plugin-card-meta">
          <span>${p.version ? `v${p.version}` : p.pluginId}</span>${p.runtime.pid !== null
            ? html`<span class="mono">PID ${p.runtime.pid}</span>`
            : nothing}
        </div>
      </div>
      ${iconButton('more', `${p.title} 的操作`, () => action('pluginMenu', p))}
    </div>
    ${p.description ? html`<p class="plugin-card-description">${p.description}</p>` : nothing}
    <div class="plugin-card-status">
      <span class=${`badge ${runtimeClass(p.runtime.status)}`}
        ><i class="dot"></i>${runtimeNames[p.runtime.status] ?? p.runtime.status}</span
      ><span
        class=${`badge ${p.ui.state === 'error' ? 'error' : p.ui.state === 'building' ? 'building' : 'neutral'}`}
        >${uiNames[p.ui.state] ?? p.ui.state}</span
      >
    </div>
    ${p.diagnostics.length || p.ui.diagnostics.length
      ? html`<details class="diagnostics">
          <summary>${p.diagnostics.length + p.ui.diagnostics.length} 项诊断</summary>
          ${[...p.diagnostics, ...p.ui.diagnostics].map((d) => html`<p>${d.message}</p>`)}
        </details>`
      : nothing}
    <div class="plugin-card-actions">
      <button
        class=${`btn ${open ? 'primary' : 'secondary'}`}
        ?disabled=${!open && p.runtime.status === 'ready' && p.ui.buildCapability !== 'supported'}
        @click=${() =>
          action(
            open ? 'openPlugin' : p.runtime.status !== 'ready' ? 'enablePlugin' : 'buildPlugin',
            p,
          )}
      >
        ${icon(open ? 'external' : p.runtime.status !== 'ready' ? 'play' : 'code')}${open
          ? '打开页面'
          : p.runtime.status !== 'ready'
            ? '启用插件'
            : p.ui.buildCapability === 'supported'
              ? '构建页面'
              : '后端插件'}</button
      >${iconButton('settings', `${p.title} 的配置`, () => action('pluginConfig', p))}
    </div>
  </article>`;
}

export function tabNavigation(event: KeyboardEvent) {
  if (
    event.isComposing ||
    !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
  ) {
    return;
  }
  const list = event.currentTarget as HTMLElement,
    items = [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (el) => el.getAttribute('aria-disabled') !== 'true',
    );
  const current = items.indexOf(event.target as HTMLElement);
  if (current < 0 || !items.length) {
    return;
  }
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (current + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + items.length) %
          items.length;
  event.preventDefault();
  event.stopPropagation();
  items[index].focus();
  items[index].click();
}
export function deepActiveElement(root: Document | ShadowRoot): HTMLElement | undefined {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active instanceof HTMLElement ? active : undefined;
}
