import type { WorkbenchScrollContainer } from '../components/scroll-container.ts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import { addTab, internalTab, titleOf, splitGroup, groups } from './model.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import type { AppRoot } from '../layouts/root.ts';
import type { UIContribution } from '../../../shared/declarative-ui.ts';
import type { DeclarativeView } from '../components/declarative-view.ts';

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
  for (const [name, value] of Object.entries({
    '--activity-width': 40,
    '--topbar-height': 36,
    '--statusbar-height': 32,
    '--resize-handle-size': 4,
    '--activity-item-size': 28,
    '--activity-gap': 4,
    '--activity-padding': 4,
  })) {
    app.style.setProperty(name, `${value}px`);
  }
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

describe('auxiliary sidebar header', () => {
  async function auxiliaryFixture(hideCurrentPage = false, custom = true) {
    const root = await fixture();
    app.store.catalog = [{
      pluginId: 'plugin', title: '插件的正式标题', description: null, version: null,
      enabled: true, runtime: { status: 'ready', pid: null, reason: null },
      ui: { detection: 'runtime', state: 'ready', entryUrl: '/', buildCapability: 'absent', diagnostics: [] },
      diagnostics: [], revision: 1,
    }];
    const sidebar = requireValue(app.store.workspace).snapshot.layout.auxiliarySidebar;
    sidebar.visible = true;
    sidebar.context = { mode: 'explicit', pluginId: 'plugin' };
    (app as unknown as { uiContributions: UIContribution[] }).uiContributions = custom ? [{
      pluginId: 'plugin', ownerEpoch: 'epoch', surface: 'auxiliarySidebar', id: 'details',
      title: '模板详情', hideCurrentPage,
    }] : [];
    vi.spyOn(app.store, 'update').mockImplementation(async (mutate) => {
      mutate(requireValue(app.store.workspace).snapshot);
      app.store.changed();
    });
    app.store.changed();
    await app.updateComplete;
    return requireValue(root.querySelector<HTMLElement>('.auxiliary-sidebar'));
  }

  it('places both tabs in the header using the plugin title and shared center tab classes', async () => {
    const sidebar = await auxiliaryFixture();
    const header = requireValue(sidebar.querySelector('.sidebar-header'));
    expect(header.querySelector('strong')).toBeNull();
    expect([...header.querySelectorAll('[role=tab]')].map((node) => node.textContent?.trim())).toEqual(['页面信息', '插件的正式标题']);
    expect(header.querySelectorAll('.tab-item .tab-label')).toHaveLength(2);
    expect(sidebar.querySelector(':scope > .auxiliary-tabs')).toBeNull();
    expect(header.querySelector('[aria-label="隐藏辅助侧栏"]')).not.toBeNull();
    const tabs = header.querySelectorAll<HTMLButtonElement>('[role=tab]');
    tabs[1].click();
    await app.updateComplete;
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(sidebar.querySelector<DeclarativeView>('wb-declarative-view')?.viewId).toBe('details');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await app.updateComplete;
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('shows a strong plugin title when page information is hidden', async () => {
    const sidebar = await auxiliaryFixture(true);
    expect(sidebar.querySelector('.sidebar-header strong')?.textContent).toBe('插件的正式标题');
    expect(sidebar.querySelector('.auxiliary-tabs')).toBeNull();
    expect(sidebar.querySelector('wb-declarative-view')).not.toBeNull();
  });

  it('shows the page information title when no custom template is registered', async () => {
    const sidebar = await auxiliaryFixture(false, false);
    expect(sidebar.querySelector('.sidebar-header strong')?.textContent).toBe('页面信息');
    expect(sidebar.querySelector('.auxiliary-tabs')).toBeNull();
    expect(sidebar.querySelector('wb-page-inspector')).not.toBeNull();
  });
});

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

describe('constrained workbench layout', () => {
  async function sizedFixture(width = 1280, height = 800) {
    const fixture = await resizeFixture();
    Object.defineProperties(app, {
      clientWidth: { value: width },
      clientHeight: { value: height },
    });
    app.requestUpdate();
    await app.updateComplete;
    return fixture;
  }
  it('reverses coupled sidebar collapse during a drag and preserves it after release', async () => {
    const { root, main } = await sizedFixture();
    const snapshot = requireValue(app.store.workspace).snapshot;
    snapshot.layout.auxiliarySidebar.visible = true;
    app.requestUpdate();
    await app.updateComplete;
    resizePointer(main, 'pointerdown', 318, 100);
    resizePointer(window, 'pointermove', 670, 100);
    await app.updateComplete;
    const shell = requireValue(root.querySelector<HTMLElement>('.shell-body'));
    expect(shell.style.gridTemplateColumns).toBe('40px 632px 440px 168px');
    resizePointer(window, 'pointermove', 754, 100);
    await app.updateComplete;
    expect(shell.dataset.auxVisible).toBe('false');
    expect(shell.style.gridTemplateColumns).toBe('40px 716px 524px 0px');
    resizePointer(window, 'pointermove', 753, 100);
    await app.updateComplete;
    expect(shell.dataset.auxVisible).toBe('true');
    resizePointer(window, 'pointermove', 754, 100);
    resizePointer(window, 'pointerup', 754, 100);
    await app.updateComplete;
    expect(snapshot.layout.auxiliarySidebar.visible).toBe(false);
    resizePointer(main, 'pointerdown', 318, 100);
    resizePointer(window, 'pointermove', 218, 100);
    resizePointer(window, 'pointerup', 218, 100);
    await app.updateComplete;
    expect(snapshot.layout.mainSidebar.size).toBe(616);
    expect(snapshot.layout.auxiliarySidebar.visible).toBe(false);
  });
  it('drags a hidden bottom panel through reveal, plateau and maximization and cancels cleanly', async () => {
    const { root } = await sizedFixture();
    const snapshot = requireValue(app.store.workspace).snapshot;
    snapshot.layout.panel.visible = false;
    app.requestUpdate();
    await app.updateComplete;
    const handle = requireValue(root.querySelector<HTMLElement>('.hidden-panel-resize'));
    const shell = requireValue(root.querySelector<HTMLElement>('.shell-body'));
    resizePointer(handle, 'pointerdown', 600, 768);
    resizePointer(window, 'pointermove', 600, 730);
    await app.updateComplete;
    expect(shell.dataset.panelVisible).toBe('false');
    resizePointer(window, 'pointermove', 600, 729);
    await app.updateComplete;
    expect(shell.style.gridTemplateRows).toBe('654px 78px');
    expect(root.querySelector('.hidden-panel-resize')).toBeNull();
    resizePointer(window, 'pointermove', 600, 690);
    await app.updateComplete;
    expect(shell.style.gridTemplateRows).toBe('654px 78px');
    resizePointer(window, 'pointermove', 600, 689);
    await app.updateComplete;
    expect(shell.style.gridTemplateRows).toBe('653px 79px');
    resizePointer(window, 'pointermove', 600, 71);
    await app.updateComplete;
    expect(shell.dataset.panelMaximized).toBe('true');
    expect(root.querySelector<HTMLElement>('.center-area')?.hidden).toBe(true);
    resizePointer(window, 'pointermove', 600, 72);
    await app.updateComplete;
    expect(shell.dataset.panelMaximized).toBe('false');
    resizePointer(window, 'pointercancel', 600, 72);
    await app.updateComplete;
    expect(shell.dataset.panelVisible).toBe('false');
    expect(root.querySelector('.hidden-panel-resize')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.center-area')?.hidden).toBe(false);
  });
  it('keeps all groups at their minima and places overflow on the root scroll containers', async () => {
    const { root } = await sizedFixture(300, 100);
    const snapshot = requireValue(app.store.workspace).snapshot;
    snapshot.layout.auxiliarySidebar.visible = true;
    addTab(snapshot, internalTab('bookmarks'));
    splitGroup(snapshot, 'horizontal', snapshot.tabs[1].id);
    app.requestUpdate();
    await app.updateComplete;
    expect(root.querySelectorAll('.center-group')).toHaveLength(2);
    expect(root.querySelector<HTMLElement>('.center-canvas')?.style.width).toBe('444px');
    expect(root.querySelector<HTMLElement>('.workbench')?.style.height).toBe('216px');
    expect(root.querySelector('.window-size-warning')).toBeNull();
    expect(root.querySelectorAll('.activity-bar-item')).toHaveLength(2);
    const more = requireValue(root.querySelector<HTMLButtonElement>('[aria-label="更多视图"]'));
    more.click();
    await app.updateComplete;
    const menu = root.querySelector('wb-context-menu');
    expect(menu?.items.map((item) => ('label' in item ? item.label : ''))).toEqual([
      '页面',
      '收藏',
      '关闭历史',
      '插件管理',
    ]);
    for (const name of ['application-scroll', 'center-scroll', 'panel-scroll']) {
      const scroll = requireValue(root.querySelector<WorkbenchScrollContainer>(`.${name}`));
      expect(scroll.wheelDirection).toBe('none');
      expect(scroll.shiftWheelDirection).toBe('none');
      expect(scroll.dragOnly).toBe(true);
    }
  });
});

it('keeps the activity bar available when the bottom panel spans both sidebars', async () => {
  const { root } = await resizeFixture();
  Object.defineProperties(app, { clientWidth: { value: 1280 }, clientHeight: { value: 800 } });
  requireValue(app.store.workspace).snapshot.layout.panel.align = 'full';
  app.requestUpdate();
  await app.updateComplete;
  const shell = requireValue(root.querySelector<HTMLElement>('.shell-body'));
  expect(shell.style.gridTemplateAreas).toBe(
    '"activity main center aux" "activity panel panel panel"',
  );
  expect(root.querySelector<HTMLElement>('.panel-canvas')?.style.width).toBe('1240px');
});

it('reserves the measured statusbar height in both the outer grid and the shell calculation', async () => {
  const { root } = await resizeFixture();
  Object.defineProperties(app, { clientWidth: { value: 1280 }, clientHeight: { value: 800 } });
  const status = requireValue(root.querySelector<HTMLElement>('.status-bar'));
  Object.defineProperty(status, 'getBoundingClientRect', {
    value: () => new DOMRect(0, 752, 1280, 48),
  });
  app.requestUpdate();
  await app.updateComplete;
  expect(root.querySelector<HTMLElement>('.workbench')?.style.gridTemplateRows).toBe(
    '36px minmax(0, 1fr) 48px',
  );
  expect(root.querySelector<HTMLElement>('.shell-body')?.style.gridTemplateRows).toBe(
    '476px 240px',
  );
  expect(root.querySelector<HTMLElement>('.workbench')?.style.height).toBe('800px');
});

describe('lateral panels and full-width maximization', () => {
  it('renders controlled loading bars and operation buttons in both toast and notification history', async () => {
    const root = await fixture();
    const notice = {
      id: 'notice',
      source: 'plugin',
      pluginId: 'alpha',
      title: '下载',
      message: '文件 A',
      level: 'info',
      readAt: null,
      updatedAt: new Date().toISOString(),
      count: 1,
      actions: [{ type: 'callback', id: 'action', label: '重试' }],
      progress: 0 as number | null,
    };
    app.store.notifications = [notice];
    app.store.toast(notice.title, notice.level, notice);
    await app.updateComplete;
    expect(root.querySelector('.toast [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '0',
    );
    expect(root.querySelector('.toast .notification-buttons')?.textContent).toContain('重试');
    notice.progress = null;
    app.store.dismissToast(notice.id, false);
    requireValue(root.querySelector<HTMLButtonElement>('.notification-button')).click();
    await app.updateComplete;
    expect(root.querySelector('.notification .feedback-progress.indeterminate')).not.toBeNull();
    expect(
      root.querySelector('.notification [role="progressbar"]')?.hasAttribute('aria-valuenow'),
    ).toBe(false);
    expect(root.querySelector('.notification .notification-buttons')?.textContent).toContain(
      '重试',
    );
  });
  it('opens tasks only on request and distinguishes idle, running and unread completion', async () => {
    const root = await fixture();
    vi.spyOn(app.store, 'ackJobs').mockImplementation(async (ids) => {
      for (const id of ids) {
        const job = app.store.jobs.get(id);
        if (job) {
          job.readAt = 'read';
        }
      }
      app.store.changed();
    });
    const button = requireValue(root.querySelector<HTMLButtonElement>('.task-button'));
    expect(button.dataset.state).toBe('idle');
    expect(button.nextElementSibling?.classList.contains('notification-button')).toBe(true);
    const job = {
      id: 'custom',
      pluginId: 'alpha',
      type: 'custom',
      title: '下载',
      status: 'running' as const,
      phase: '传输',
      revision: 1,
      logs: [],
      progress: 25,
    };
    app.store.jobs.set(job.id, job);
    app.store.changed();
    await app.updateComplete;
    expect(root.querySelector('.jobs-dialog')).toBeNull();
    expect(button.dataset.state).toBe('running');
    app.store.jobs.set(job.id, { ...job, status: 'succeeded', progress: 100, revision: 2 });
    app.store.changed();
    await app.updateComplete;
    expect(button.dataset.state).toBe('unread');
    button.click();
    await app.updateComplete;
    await app.updateComplete;
    expect(root.querySelector('.jobs-dialog')?.getAttribute('aria-label')).toBe('任务');
    expect(
      root.querySelector('.job-card [role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('100');
    expect(app.store.ackJobs).toHaveBeenCalledWith(['custom']);
    expect(button.dataset.state).toBe('idle');
  });
  it.each(['left', 'right'] as const)(
    'retains a hidden %s panel sash and reveals it at 110px with a 220px minimum',
    async (dock) => {
      const { root } = await resizeFixture();
      Object.defineProperties(app, { clientWidth: { value: 1840 }, clientHeight: { value: 800 } });
      const snapshot = requireValue(app.store.workspace).snapshot;
      snapshot.layout.auxiliarySidebar.visible = true;
      snapshot.layout.panel.dock = dock;
      snapshot.layout.panel.visible = false;
      app.requestUpdate();
      await app.updateComplete;
      const handle = requireValue(root.querySelector<HTMLElement>('.hidden-panel-resize'));
      expect(handle.getAttribute('aria-orientation')).toBe('vertical');
      Object.defineProperty(handle, 'getBoundingClientRect', {
        value: () => new DOMRect(600, 100, 4, 100),
      });
      const sign = dock === 'left' ? 1 : -1;
      resizePointer(handle, 'pointerdown', 602, 150);
      resizePointer(window, 'pointermove', 602 + sign * 109, 150);
      await app.updateComplete;
      expect(root.querySelector('.hidden-panel-resize')).not.toBeNull();
      resizePointer(window, 'pointermove', 602 + sign * 110, 150);
      await app.updateComplete;
      expect(root.querySelector('.hidden-panel-resize')).toBeNull();
      expect(root.querySelector<HTMLElement>('.panel-canvas')?.style.width).toBe('440px');
      resizePointer(window, 'pointerup', 602 + sign * 110, 150);
      await app.updateComplete;
      expect(snapshot.layout.panel).toMatchObject({ visible: true, width: 220 });
    },
  );
  it.each(['left', 'right'] as const)(
    'couples a %s docked panel to sidebar expansion and restores the full draft on cancellation',
    async (dock) => {
      const { root, main } = await resizeFixture();
      Object.defineProperties(app, { clientWidth: { value: 1840 }, clientHeight: { value: 800 } });
      const snapshot = requireValue(app.store.workspace).snapshot;
      snapshot.layout.auxiliarySidebar.visible = true;
      snapshot.layout.panel.dock = dock;
      snapshot.layout.panel.width = 360;
      app.requestUpdate();
      await app.updateComplete;
      resizePointer(main, 'pointerdown', 318, 150);
      resizePointer(window, 'pointermove', 1010, 150);
      await app.updateComplete;
      const shell = requireValue(root.querySelector<HTMLElement>('.shell-body'));
      expect(shell.dataset.panelVisible).toBe('true');
      expect(shell.style.gridTemplateColumns).toBe(
        dock === 'left' ? '40px 972px 220px 440px 168px' : '40px 972px 440px 220px 168px',
      );
      resizePointer(window, 'pointermove', 1120, 150);
      await app.updateComplete;
      expect(shell.dataset.panelVisible).toBe('false');
      expect(shell.dataset.auxVisible).toBe('true');
      resizePointer(window, 'pointermove', 1314, 150);
      await app.updateComplete;
      expect(shell.dataset.auxVisible).toBe('false');
      resizePointer(window, 'pointermove', 1119, 150);
      await app.updateComplete;
      expect(shell.dataset.panelVisible).toBe('true');
      resizePointer(window, 'pointercancel', 1119, 150);
      await app.updateComplete;
      expect(snapshot.layout.mainSidebar.size).toBe(280);
      expect(snapshot.layout.auxiliarySidebar.visible).toBe(true);
      expect(snapshot.layout.panel).toMatchObject({ visible: true, width: 360 });
    },
  );
  it.each(['left', 'right'] as const)(
    'sizes a maximized full-width panel across both sidebars with the main sidebar on the %s',
    async (side) => {
      const { root } = await resizeFixture();
      Object.defineProperties(app, { clientWidth: { value: 1280 }, clientHeight: { value: 800 } });
      const snapshot = requireValue(app.store.workspace).snapshot;
      snapshot.layout.mainSidebar.side = side;
      snapshot.layout.auxiliarySidebar.visible = true;
      snapshot.layout.panel.align = 'full';
      app.requestUpdate();
      await app.updateComplete;
      requireValue(
        root.querySelector<HTMLButtonElement>('[aria-label="最大化 / 还原面板"]'),
      ).click();
      await app.updateComplete;
      expect(root.querySelector('.panel-maximized')).not.toBeNull();
      expect(root.querySelector<HTMLElement>('.panel-canvas')?.style.width).toBe('1240px');
      expect(root.querySelector<HTMLElement>('.shell-body')?.dataset.panelAlign).toBe('full');
      expect(root.querySelector<HTMLElement>('.center-area')?.hidden).toBe(true);
    },
  );
  it('does not resize two adjacent vertical sashes in the same gesture', async () => {
    const { root, main } = await resizeFixture();
    Object.defineProperties(app, { clientWidth: { value: 1840 }, clientHeight: { value: 800 } });
    const snapshot = requireValue(app.store.workspace).snapshot;
    snapshot.layout.panel.dock = 'left';
    snapshot.layout.panel.visible = false;
    app.requestUpdate();
    await app.updateComplete;
    const hidden = requireValue(root.querySelector<HTMLElement>('.hidden-panel-resize'));
    Object.defineProperty(hidden, 'getBoundingClientRect', {
      value: () => new DOMRect(320, 36, 4, 652),
    });
    resizePointer(main, 'pointerdown', 318, 150);
    resizePointer(window, 'pointermove', 438, 150);
    resizePointer(window, 'pointerup', 438, 150);
    await app.updateComplete;
    expect(snapshot.layout.mainSidebar.size).toBe(400);
    expect(snapshot.layout.panel.visible).toBe(false);
  });
});
