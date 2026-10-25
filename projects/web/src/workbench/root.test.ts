import type { WorkbenchScrollContainer } from '../components/scroll-container.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import { addTab, internalTab, titleOf, splitGroup, groups } from './model.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import type { AppRoot } from '../layouts/root.ts';

vi.mock('../../../shared/store/config.ts', () => ({
  ConfigController: {
    config: {
      api: { host: 'http://localhost', port: '3200', token: '' },
      plugin: { refreshRule: '//' },
      notify: { placement: 'tr' },
    },
  },
}));

let Root: typeof AppRoot;
let app: AppRoot;
beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {
      /* Static theme in this fixture. */
    },
    removeEventListener() {
      /* No media listeners. */
    },
  }));
  Root = (await import('../layouts/root.ts')).AppRoot;
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function fixture() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* Geometry is supplied by each test. */
      }
      unobserve() {
        /* Geometry is supplied by the fixture. */
      }
      disconnect() {
        /* No observer resources. */
      }
    },
  );
  vi.spyOn(WorkbenchStore.prototype, 'start').mockResolvedValue();
  vi.spyOn(WorkbenchStore.prototype, 'loadOutput').mockResolvedValue();
  app = new Root();
  app.store.loading = false;
  app.store.workspace = {
    workspaceId: 'w',
    revision: 1,
    snapshot: {
      tabs: [],
      layout: {
        schemaVersion: 1,
        mainSidebar: { side: 'left', visible: true, size: 280, view: 'pages', openPagesRatio: 0.6 },
        auxiliarySidebar: { visible: false, size: 280 },
        panel: {
          dock: 'bottom',
          align: 'center',
          visible: true,
          width: 360,
          height: 240,
          activeView: 'output',
          terminalListSize: 200,
        },
        center: { kind: 'group', id: 'g', tabIds: [], activeTabId: null, tabBarPosition: 'top' },
        focusedGroupId: 'g',
      },
    },
  };
  addTab(app.store.workspace.snapshot, internalTab('welcome'));
  document.body.append(app);
  await app.updateComplete;
  return requireValue(app.shadowRoot);
}

function resizePointer(target: EventTarget, type: string, x = 318, y = 100) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

async function resizeFixture() {
  const root = await fixture();
  vi.spyOn(app.store, 'update').mockImplementation(async (mutate) => {
    mutate(requireValue(app.store.workspace).snapshot);
    app.store.changed();
  });
  const main = requireValue(root.querySelector<HTMLElement>('.main-resize'));
  const split = requireValue(root.querySelector<HTMLElement>('.sidebar-splitter'));
  Object.defineProperty(requireValue(root.querySelector('.sidebar-content')), 'clientHeight', {
    value: 400,
  });
  vi.spyOn(main, 'getBoundingClientRect').mockReturnValue(new DOMRect(316, 36, 4, 652));
  vi.spyOn(split, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 280, 4));
  return { root, main, split, workbench: requireValue(root.querySelector('.workbench')) };
}

describe('layout resize feedback', () => {
  it('highlights both intersecting handles whenever the cursor changes to move and clears on leave', async () => {
    const { main, split, workbench } = await resizeFixture();
    resizePointer(main, 'pointermove', 318, 302);
    await app.updateComplete;
    for (const handle of [main, split]) {
      expect(handle.style.cursor).toBe('move');
      expect(handle.hasAttribute('data-resize-active')).toBe(true);
    }
    resizePointer(main, 'pointermove', 318, 100);
    await app.updateComplete;
    for (const handle of [main, split]) {
      expect(handle.style.cursor).toBe('');
      expect(handle.hasAttribute('data-resize-active')).toBe(false);
    }
    resizePointer(main, 'pointermove', 318, 302);
    resizePointer(workbench, 'pointerleave');
    await app.updateComplete;
    expect(main.style.cursor).toBe('');
    expect(split.style.cursor).toBe('');
    expect(main.hasAttribute('data-resize-active')).toBe(false);
    expect(split.hasAttribute('data-resize-active')).toBe(false);
  });

  it.each(['pointerup', 'pointercancel'])(
    'keeps both handles highlighted throughout a combined drag until %s',
    async (finish) => {
      const { root, main, split, workbench } = await resizeFixture();
      resizePointer(main, 'pointerdown', 318, 302);
      await app.updateComplete;
      expect(document.documentElement.style.cursor).toBe('move');
      expect(root.querySelector('.resize-shield')).not.toBeNull();
      resizePointer(workbench, 'pointerleave');
      resizePointer(window, 'pointermove', 338, 282);
      await app.updateComplete;
      for (const handle of [main, split]) {
        expect(handle.hasAttribute('data-resize-active')).toBe(true);
      }
      resizePointer(window, finish, 900, 700);
      await app.updateComplete;
      expect(root.querySelector('.resize-shield')).toBeNull();
      expect(document.documentElement.style.cursor).toBe('');
      for (const handle of [main, split]) {
        expect(handle.hasAttribute('data-resize-active')).toBe(false);
      }
      const sidebar = requireValue(app.store.workspace).snapshot.layout.mainSidebar;
      expect(sidebar.size).toBe(finish === 'pointerup' ? 300 : 280);
      expect(sidebar.openPagesRatio).toBeCloseTo(finish === 'pointerup' ? 0.55 : 0.6);
    },
  );

  it('keeps a single handle active while the pointer leaves it and releases on disconnect', async () => {
    const { main, split, workbench } = await resizeFixture();
    resizePointer(main, 'pointerdown');
    resizePointer(workbench, 'pointerleave');
    await app.updateComplete;
    expect(main.hasAttribute('data-resize-active')).toBe(true);
    expect(split.hasAttribute('data-resize-active')).toBe(false);
    expect(document.documentElement.style.cursor).toBe('col-resize');
    app.remove();
    await app.updateComplete;
    expect(document.documentElement.style.cursor).toBe('');
    resizePointer(window, 'pointermove', 500, 100);
    expect(requireValue(app.store.workspace).snapshot.layout.mainSidebar.size).toBe(280);
  });

  it.each(['aux', 'panel', 'sidebar-split', 'split'])(
    'forces the %s handle to stay highlighted until pointer cancellation',
    async (key) => {
      const { root, workbench } = await resizeFixture();
      const snapshot = requireValue(app.store.workspace).snapshot;
      snapshot.layout.auxiliarySidebar.visible = true;
      if (key === 'split') {
        addTab(snapshot, internalTab('bookmarks'));
        splitGroup(snapshot, 'horizontal', snapshot.tabs[1].id);
      }
      app.requestUpdate();
      await app.updateComplete;
      const handle = requireValue(root.querySelector<HTMLElement>(`[data-resize-key="${key}"]`));
      vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 100, 4, 100));
      resizePointer(handle, 'pointerdown', 602, 150);
      resizePointer(workbench, 'pointerleave');
      await app.updateComplete;
      expect(handle.hasAttribute('data-resize-active')).toBe(true);
      resizePointer(window, 'pointercancel', 900, 700);
      await app.updateComplete;
      expect(handle.hasAttribute('data-resize-active')).toBe(false);
    },
  );

  it('keeps the main handle highlighted when dragging switches between hidden and visible sidebars', async () => {
    const { root } = await resizeFixture();
    requireValue(app.store.workspace).snapshot.layout.mainSidebar.visible = false;
    app.requestUpdate();
    await app.updateComplete;
    const hidden = requireValue(root.querySelector<HTMLElement>('.hidden-main-resize'));
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue(new DOMRect(38, 36, 4, 652));
    resizePointer(hidden, 'pointerdown', 40, 100);
    await app.updateComplete;
    expect(hidden.hasAttribute('data-resize-active')).toBe(true);
    resizePointer(window, 'pointermove', 260, 100);
    await app.updateComplete;
    expect(root.querySelector('.hidden-main-resize')).toBeNull();
    expect(root.querySelector('.main-resize')?.hasAttribute('data-resize-active')).toBe(true);
    resizePointer(window, 'pointercancel', 260, 100);
    await app.updateComplete;
    expect(root.querySelector('.hidden-main-resize')?.hasAttribute('data-resize-active')).toBe(
      false,
    );
  });
});

describe('workbench interactions', () => {
  it('creates a root bookmark folder after clicking the sidebar body outside the tree', async () => {
    const root = await fixture();
    requireValue(app.store.workspace).snapshot.layout.mainSidebar.view = 'bookmarks';
    app.store.preferences.values.bookmarkFolders = [{ id: 'parent', name: 'Parent' }];
    const prompt = vi.spyOn(app.store, 'prompt').mockResolvedValue('New folder');
    const save = vi.spyOn(app.store, 'setPreferences').mockResolvedValue();
    app.requestUpdate();
    await app.updateComplete;
    const folder = requireValue(root.querySelector<HTMLElement>('.bookmark-folder > summary'));
    const button = requireValue(
      root.querySelector<HTMLButtonElement>('.sidebar-search [aria-label="新建文件夹"]'),
    );
    folder.focus();
    expect(app.store.focusedBookmarkFolder).toBe('parent');
    expect(button.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }))).toBe(false);
    expect(root.activeElement).toBe(folder);
    button.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].bookmarkFolders?.[1].parentId).toBe('parent');

    requireValue(root.querySelector<HTMLElement>('.sidebar-section-body')).click();
    expect(root.activeElement).toBe(root.querySelector('.bookmark-tree'));
    expect(app.store.focusedBookmarkFolder).toBeNull();
    button.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].bookmarkFolders?.[1].parentId).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(2);
  });
  it('collapses page sections and drags a sidebar tab into another group with a placement marker', async () => {
    const root = await fixture();
    vi.spyOn(app.store, 'update').mockImplementation(async (mutate) => {
      mutate(requireValue(app.store.workspace).snapshot);
      app.store.changed();
    });
    const snapshot = requireValue(app.store.workspace).snapshot;
    const first = snapshot.tabs[0];
    addTab(snapshot, internalTab('bookmarks'));
    splitGroup(snapshot, 'horizontal', snapshot.tabs[1].id);
    const target = snapshot.layout.focusedGroupId;
    app.requestUpdate();
    await app.updateComplete;
    const fire = (node: Element, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { clientY: 0, dataTransfer: { setData: vi.fn() } });
      node.dispatchEvent(event);
    };
    const row = requireValue(root.querySelector('.sidebar-list-item'));
    fire(row, 'dragstart');
    const label = requireValue(root.querySelectorAll('.group-label')[1]);
    fire(label, 'dragover');
    expect(label.getAttribute('data-tab-drop')).toBe('before');
    fire(label, 'drop');
    await Promise.resolve();
    await app.updateComplete;
    expect(groups(snapshot.layout.center).find((g) => g.id === target)?.tabIds).toContain(first.id);
    requireValue(
      root.querySelector<HTMLButtonElement>('[aria-label="折叠或展开打开的页面"]'),
    ).click();
    await app.updateComplete;
    expect(root.querySelector('.sidebar-section-body')?.hasAttribute('hidden')).toBe(true);
  });
  it('follows public output only while the reader remains at the bottom, including hidden updates', async () => {
    const root = await fixture();
    const container = requireValue(root.querySelector<WorkbenchScrollContainer>('.output-content'));
    await container.updateComplete;
    const output = requireValue(container.scrollElement);
    let height = 1000,
      viewport = 200;
    Object.defineProperties(output, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => viewport },
    });
    Object.defineProperties(requireValue(container.shadowRoot?.querySelector('.frame')), {
      clientHeight: { get: () => viewport },
      clientWidth: { value: 400 },
    });
    Object.defineProperty(
      requireValue(container.shadowRoot?.querySelector('.content')),
      'scrollHeight',
      { get: () => height },
    );
    container.refresh();
    output.scrollTop = 300;
    container.dispatchEvent(new Event('scroll'));
    height = 1200;
    app.requestUpdate();
    await app.updateComplete;
    expect(output.scrollTop).toBe(300);
    viewport = 0;
    container.dispatchEvent(new Event('scroll'));
    app.requestUpdate();
    await app.updateComplete;
    expect(output.scrollTop).toBe(300);
    viewport = 200;
    output.scrollTop = 1000;
    container.dispatchEvent(new Event('scroll'));
    height = 1400;
    app.requestUpdate();
    await app.updateComplete;
    expect(output.scrollTop).toBe(1200);
  });
  it('prefills the displayed tab title and selects it for renaming', async () => {
    const root = await fixture();
    const task = app.command('rename');
    await vi.waitFor(() => expect(root.querySelector('.workbench-dialog input')).not.toBeNull());
    const input = requireValue(root.querySelector<HTMLInputElement>('.workbench-dialog input'));
    expect(input.value).toBe(titleOf(requireValue(app.store.workspace).snapshot.tabs[0]));
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    app.store.dialogState?.resolve(null);
    await task;
  });
  it('selects an existing terminal name when its prompt opens', async () => {
    const root = await fixture();
    const task = app.store.prompt('终端名称', '后台终端');
    await vi.waitFor(() => expect(root.querySelector('.workbench-dialog input')).not.toBeNull());
    const input = requireValue(root.querySelector<HTMLInputElement>('.workbench-dialog input'));
    expect(input.value).toBe('后台终端');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    app.store.dialogState?.resolve(null);
    await task;
  });
  it.each(['>', '@', '*', '#'])(
    'keeps quick access open and fills the selected %s prefix',
    async (prefix) => {
      const root = await fixture();
      await app.command('quickOpen');
      const results = [...root.querySelectorAll<HTMLButtonElement>('.quick-results [role=option]')];
      expect(results.slice(0, 4).map((el) => el.textContent?.trim()[0])).toEqual([
        '>',
        '@',
        '*',
        '#',
      ]);
      requireValue(results.find((el) => el.textContent?.trim().startsWith(prefix))).click();
      await app.updateComplete;
      const input = requireValue(root.querySelector<HTMLInputElement>('#quick-input'));
      expect(input.value).toBe(prefix);
      expect(root.activeElement).toBe(input);
    },
  );
});

it.each(['top', 'bottom', 'left', 'right'] as const)(
  'scrolls %s page tabs with both wheel modes and leaves zoom available',
  async (position) => {
    const root = await fixture();
    groups(requireValue(app.store.workspace).snapshot.layout.center)[0].tabBarPosition = position;
    app.requestUpdate();
    await app.updateComplete;
    const bar = requireValue(root.querySelector<WorkbenchScrollContainer>('.tab-bar'));
    await bar.updateComplete;
    const viewport = requireValue(bar.scrollElement);
    const vertical = position === 'left' || position === 'right';
    Object.defineProperties(requireValue(bar.shadowRoot?.querySelector('.frame')), {
      clientWidth: { value: 200 },
      clientHeight: { value: 200 },
    });
    Object.defineProperties(requireValue(bar.shadowRoot?.querySelector('.content')), {
      scrollWidth: { value: vertical ? 200 : 1000 },
      scrollHeight: { value: vertical ? 1000 : 200 },
    });
    viewport.scrollTo = (options: ScrollToOptions | number = {}, y?: number) => {
      viewport.scrollLeft =
        typeof options === 'number' ? options : (options.left ?? viewport.scrollLeft);
      viewport.scrollTop =
        typeof options === 'number' ? (y ?? 0) : (options.top ?? viewport.scrollTop);
    };
    bar.refresh();
    expect(bar.horizontal).toMatchObject({ size: 2, radius: 4, placement: 'overlay' });
    expect(bar.vertical).toMatchObject({ size: 2, radius: 4, placement: 'overlay' });
    const wheel = (extra: WheelEventInit = {}) =>
      bar.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true, ...extra }),
      );
    expect(wheel()).toBe(false);
    await new Promise(requestAnimationFrame);
    expect(vertical ? viewport.scrollTop : viewport.scrollLeft).toBe(60);
    expect(wheel({ shiftKey: true })).toBe(false);
    await new Promise(requestAnimationFrame);
    expect(vertical ? viewport.scrollTop : viewport.scrollLeft).toBe(120);
    expect(wheel({ ctrlKey: true })).toBe(true);
    expect(vertical ? viewport.scrollTop : viewport.scrollLeft).toBe(120);
  },
);
