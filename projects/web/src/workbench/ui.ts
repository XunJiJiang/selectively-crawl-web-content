import { requireValue } from '../../../shared/workbench-protocol.ts';
import { html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { CatalogItem } from './types.ts';
import { runtimeNames, uiNames } from './types.ts';
import type { WorkbenchStore } from './store.ts';
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
export function pluginOpenButtons(
  p: CatalogItem,
  action: (id: string, args?: unknown) => void,
  compact = false,
) {
  if (p.runtime.status !== 'ready' || p.ui.state !== 'ready') {
    return nothing;
  }
  return html`<span class=${`plugin-open-buttons ${compact ? 'small' : ''}`}>
    <button class="btn primary" @click=${() => action('openPlugin', p)}>
      ${icon('external')}打开页面
    </button>
    <button
      class="btn primary dropdown-button"
      aria-label=${`${p.title} 的打开方式`}
      aria-haspopup="menu"
      @click=${() => action('pluginOpenMenu', p)}
    >
      ${icon('chevron-down')}
    </button>
  </span>`;
}
type BookmarkDrag = {
  source: string;
  target?: HTMLElement;
  position?: 'before' | 'after' | 'inside';
  timer?: ReturnType<typeof setTimeout>;
};
const bookmarkDrags = new WeakMap<WorkbenchStore, BookmarkDrag>();
export function bookmarkFolderButton(
  store: WorkbenchStore,
  action: (id: string, args?: unknown) => void,
) {
  return html`<button
    class="icon-button"
    title="新建文件夹"
    aria-label="新建文件夹"
    @mousedown=${(e: MouseEvent) => e.preventDefault()}
    @click=${() => action('newBookmarkFolder', { parentId: store.focusedBookmarkFolder ?? null })}
  >
    ${icon('new-folder')}
  </button>`;
}
function clearBookmarkDrop(drag: BookmarkDrag) {
  clearTimeout(drag.timer);
  drag.timer = undefined;
  drag.target?.removeAttribute('data-drop');
  drag.target = undefined;
}
export function bookmarkList(
  store: WorkbenchStore,
  action: (id: string, args?: unknown) => void,
  query = '',
  compact = false,
) {
  const folders = store.preferences.values.bookmarkFolders ?? [];
  const folderIds = new Set(folders.map((f) => f.id));
  const order = store.preferences.values.bookmarkOrder ?? [];
  const drag = bookmarkDrags.get(store) ?? { source: '' };
  bookmarkDrags.set(store, drag);
  const end = () => {
    clearBookmarkDrop(drag);
    drag.source = '';
  };
  const begin = (e: DragEvent, key: string) => {
    e.stopPropagation();
    end();
    drag.source = key;
    e.dataTransfer?.setData('application/x-scwc-bookmark', key);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };
  const over = (e: DragEvent, key: string, folder: boolean) => {
    if (!drag.source) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const row = folder ? (target.querySelector('summary') ?? target) : target;
    const rect = row.getBoundingClientRect();
    const fraction = (e.clientY - rect.top) / Math.max(1, rect.height);
    const position =
      folder && fraction >= 0.25 && fraction <= 0.75
        ? 'inside'
        : fraction < 0.5
          ? 'before'
          : 'after';
    const invalid = key === drag.source;
    // DOM ancestry rejects every descendant, even before/after a nested child.
    let ancestor = target.parentElement?.closest<HTMLElement>('[data-bookmark-key]');
    let cycle = false;
    while (ancestor) {
      if (ancestor.dataset.bookmarkKey === drag.source) {
        cycle = true;
      }
      ancestor = ancestor.parentElement?.closest<HTMLElement>('[data-bookmark-key]');
    }
    if (invalid || cycle) {
      clearBookmarkDrop(drag);
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'none';
      }
      return;
    }
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    if (drag.target === target && drag.position === position) {
      return;
    }
    clearBookmarkDrop(drag);
    drag.target = target;
    drag.position = position;
    target.dataset.drop = position;
    if (position === 'inside' && folder) {
      drag.timer = setTimeout(() => {
        if (drag.target === target && target instanceof HTMLDetailsElement) {
          target.open = true;
        }
      }, 650);
    }
  };
  const drop = (e: DragEvent, key: string | null) => {
    if (!drag.source) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (key && drag.target !== e.currentTarget) {
      return;
    }
    const source = drag.source,
      position = key ? drag.position : 'inside';
    end();
    if (position) {
      action('moveBookmark', { source, target: key, position });
    }
  };
  const matching = store.bookmarks.filter((b) =>
    `${b.customTitle ?? b.originalTitle} ${b.url}`.toLowerCase().includes(query.toLowerCase()),
  );
  const included = new Set<string>();
  if (query) {
    const include = (id: string | null | undefined) => {
      const seen = new Set<string>();
      while (id && !seen.has(id)) {
        seen.add(id);
        included.add(id);
        id = folders.find((f) => f.id === id)?.parentId;
      }
    };
    for (const b of matching) {
      include(b.folderId);
    }
    for (const f of folders) {
      if (f.name.toLowerCase().includes(query.toLowerCase())) {
        include(f.id);
      }
    }
  }
  const renderChildren = (parentId: string | null, ancestors: string[] = []): TemplateResult => {
    const nodes = [
      ...folders
        .filter(
          (f) =>
            (folderIds.has(f.parentId ?? '') ? f.parentId : null) === parentId &&
            !ancestors.includes(f.id) &&
            (!query || included.has(f.id)),
        )
        .map((folder) => ({ key: `folder:${folder.id}`, folder, bookmark: undefined })),
      ...matching
        .filter((b) => (folderIds.has(b.folderId ?? '') ? b.folderId : null) === parentId)
        .map((bookmark) => ({ key: `bookmark:${bookmark.id}`, folder: undefined, bookmark })),
    ];
    nodes.sort((a, b) => {
      const ai = order.indexOf(a.key),
        bi = order.indexOf(b.key);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
    return html`${repeat(
      nodes,
      (n) => n.key,
      (n) =>
        n.folder
          ? html`<details
              class=${`bookmark-folder bookmark-node ${compact ? 'compact' : ''}`}
              data-bookmark-key=${n.key}
              draggable="true"
              open
              @contextmenu=${(e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                action('bookmarkMenu', { x: e.clientX, y: e.clientY, folder: n.folder });
              }}
              @dragstart=${(e: DragEvent) => begin(e, n.key)}
              @dragend=${end}
              @dragover=${(e: DragEvent) => over(e, n.key, true)}
              @drop=${(e: DragEvent) => drop(e, n.key)}
              @dragleave=${(e: DragEvent) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                  clearBookmarkDrop(drag);
                }
              }}
            >
              <summary
                tabindex="0"
                data-focused=${store.focusedBookmarkFolder === n.folder.id}
                @focus=${() => {
                  store.focusedBookmarkFolder = n.folder.id;
                  store.changed();
                }}
              >
                <span class="folder-closed">${icon('folder-compact')}</span
                ><span class="folder-open">${icon('folder-opened-compact')}</span>${n.folder
                  .name}<span class="spacer"></span
                ><span class="bookmark-actions" @click=${(e: Event) => e.stopPropagation()}
                  >${iconButton('edit', '重命名文件夹', () =>
                    action('renameBookmarkFolder', n.folder),
                  )}${iconButton('trash', '删除文件夹，保留收藏', () =>
                    action('deleteBookmarkFolder', n.folder),
                  )}</span
                >
              </summary>
              <div class="bookmark-children">
                ${renderChildren(n.folder.id, [...ancestors, n.folder.id])}
              </div>
            </details>`
          : html`<article
              class=${`bookmark-node bookmark-item ${compact ? 'compact' : ''}`}
              data-bookmark-key=${n.key}
              draggable="true"
              @contextmenu=${(e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                action('bookmarkMenu', { x: e.clientX, y: e.clientY, bookmark: n.bookmark });
              }}
              @dragstart=${(e: DragEvent) => begin(e, n.key)}
              @dragend=${end}
              @dragover=${(e: DragEvent) => over(e, n.key, false)}
              @drop=${(e: DragEvent) => drop(e, n.key)}
              @dragleave=${(e: DragEvent) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                  clearBookmarkDrop(drag);
                }
              }}
            >
              <button
                class="list-main"
                title=${requireValue(n.bookmark).url}
                @click=${() => action('openBookmark', n.bookmark)}
              >
                ${icon('star-full')}<span class="bookmark-title"
                  >${requireValue(n.bookmark).customTitle ??
                  requireValue(n.bookmark).originalTitle}${compact
                    ? nothing
                    : html`<small class="mono">${requireValue(n.bookmark).url}</small>`}</span
                ></button
              ><span class="bookmark-actions"
                >${iconButton('edit', '编辑收藏名称、URL 和文件夹', () =>
                  action('editBookmark', n.bookmark),
                )}${iconButton('trash', '删除收藏', () =>
                  action('deleteBookmark', n.bookmark),
                )}</span
              >
            </article>`,
    )}`;
  };
  return html`<div
    class="bookmark-tree"
    tabindex="0"
    @focus=${(e: FocusEvent) => {
      if (e.target === e.currentTarget) {
        store.focusedBookmarkFolder = null;
        store.changed();
      }
    }}
    @click=${(e: MouseEvent) => {
      if (e.target === e.currentTarget) {
        (e.currentTarget as HTMLElement).focus();
      }
    }}
    aria-label="收藏树"
    @dragover=${(e: DragEvent) => {
      if (drag.source) {
        e.preventDefault();
        clearBookmarkDrop(drag);
      }
    }}
    @drop=${(e: DragEvent) => drop(e, null)}
  >
    ${renderChildren(null)}${!matching.length && !folders.length
      ? html`<p class="sidebar-empty">暂无收藏。</p>`
      : nothing}
  </div>`;
}
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
    ${p.diagnostics.length || p.ui.diagnostics.length
      ? html`<details class="diagnostics">
          <summary>${p.diagnostics.length + p.ui.diagnostics.length} 项诊断</summary>
          ${[...p.diagnostics, ...p.ui.diagnostics].map((d) => html`<p>${d.message}</p>`)}
        </details>`
      : nothing}
    <div class="plugin-card-footer">
      <div class="plugin-card-status">
        <span class=${`badge ${runtimeClass(p.runtime.status)}`}
          ><i class="dot"></i>${runtimeNames[p.runtime.status] ?? p.runtime.status}</span
        ><span
          class=${`badge ${p.ui.state === 'error' ? 'error' : p.ui.state === 'building' ? 'building' : 'neutral'}`}
          >${uiNames[p.ui.state] ?? p.ui.state}</span
        >
      </div>
      <div class="plugin-card-actions">
        ${open
          ? pluginOpenButtons(p, action, compact)
          : html`<button
              class=${`btn ${open ? 'primary' : 'secondary'}`}
              ?disabled=${!open &&
              p.runtime.status === 'ready' &&
              p.ui.buildCapability !== 'supported'}
              @click=${() =>
                action(
                  open
                    ? 'openPlugin'
                    : p.runtime.status !== 'ready'
                      ? 'enablePlugin'
                      : 'buildPlugin',
                  p,
                )}
            >
              ${icon(open ? 'external' : p.runtime.status !== 'ready' ? 'play' : 'code')}${open
                ? '打开页面'
                : p.runtime.status !== 'ready'
                  ? '启用插件'
                  : p.ui.buildCapability === 'supported'
                    ? '构建页面'
                    : '后端插件'}
            </button>`}
        ${iconButton('settings', `${p.title} 的配置`, () => action('pluginConfig', p))}
      </div>
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
