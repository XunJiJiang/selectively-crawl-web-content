import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import { addTab, internalTab, titleOf } from './model.ts';
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
describe('workbench interactions', () => {
  it('follows public output only while the reader remains at the bottom, including hidden updates', async () => {
    const root = await fixture();
    const output = requireValue(root.querySelector<HTMLElement>('.output-content'));
    let height = 1000,
      viewport = 200;
    Object.defineProperties(output, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => viewport },
    });
    output.scrollTop = 300;
    output.dispatchEvent(new Event('scroll'));
    height = 1200;
    app.requestUpdate();
    await app.updateComplete;
    expect(output.scrollTop).toBe(300);
    viewport = 0;
    output.dispatchEvent(new Event('scroll'));
    app.requestUpdate();
    await app.updateComplete;
    expect(output.scrollTop).toBe(300);
    viewport = 200;
    output.scrollTop = 1000;
    output.dispatchEvent(new Event('scroll'));
    height = 1400;
    app.requestUpdate();
    await app.updateComplete;
    expect(output.scrollTop).toBe(1400);
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

it('scrolls horizontal page tabs with both wheel modes and leaves zoom available', async () => {
  const root = await fixture();
  const bar = requireValue(root.querySelector<HTMLElement>('.tab-bar'));
  Object.defineProperties(bar, { scrollWidth: { value: 1000 }, clientWidth: { value: 200 } });
  const wheel = (extra: WheelEventInit = {}) =>
    bar.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true, ...extra }),
    );
  expect(wheel()).toBe(false);
  expect(bar.scrollLeft).toBe(60);
  expect(wheel({ shiftKey: true })).toBe(false);
  expect(bar.scrollLeft).toBe(120);
  expect(wheel({ ctrlKey: true })).toBe(true);
  expect(bar.scrollLeft).toBe(120);
  expect(root.textContent).not.toContain('工作区已保存');
});
