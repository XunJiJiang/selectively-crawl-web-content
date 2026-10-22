import { afterEach, describe, expect, it, vi } from 'vitest';
import { FramePool } from './frames.ts';
import { WorkbenchStore } from './store.ts';
import { addTab, groups, moveTab, newPluginTab, splitGroup } from './model.ts';
import type { WorkspaceSnapshot } from './types.ts';
vi.mock('../../../shared/store/config.ts', () => ({
  ConfigController: {
    config: {
      api: { host: 'http://localhost', port: '3200', token: '' },
      plugin: { refreshRule: '//' },
      notify: { placement: 'tr' },
    },
  },
}));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
function fixture() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* Geometry is supplied by the fixture. */
      }
      disconnect() {
        /* No actual observer resources. */
      }
    },
  );
  const store = new WorkbenchStore();
  disposers.push(() => store.dispose());
  const snapshot: WorkspaceSnapshot = {
    layout: {
      schemaVersion: 1,
      mainSidebar: { side: 'left', visible: true, size: 280, view: 'pages', openPagesRatio: 0.6 },
      auxiliarySidebar: { visible: true, size: 280 },
      panel: {
        dock: 'bottom',
        align: 'center',
        visible: false,
        width: 360,
        height: 240,
        activeView: 'output',
        terminalListSize: 200,
      },
      center: { kind: 'group', id: 'one', tabIds: [], activeTabId: null, tabBarPosition: 'top' },
      focusedGroupId: 'one',
    },
    tabs: [],
  };
  const tab = newPluginTab('p', 'P', 'http://localhost/web/page/plugin/p/', {
    installationId: 'i',
    pluginId: 'p',
    path: '/',
    search: '',
    hash: '',
  });
  addTab(snapshot, tab);
  store.workspace = { workspaceId: 'workspace', revision: 1, snapshot };
  store.catalog = [
    {
      pluginId: 'p',
      title: 'P',
      description: null,
      version: null,
      enabled: true,
      runtime: { status: 'ready', pid: 1, reason: null },
      ui: {
        detection: 'runtime',
        state: 'ready',
        entryUrl: tab.url,
        buildCapability: 'absent',
        diagnostics: [],
      },
      diagnostics: [],
      revision: 1,
    },
  ];
  store.lease = { workspaceId: 'workspace', token: 'lease', expiresAt: Date.now() + 30000 };
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<div data-page-slot="one"></div><div class="pool"></div>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 500,
    bottom: 400,
    width: 500,
    height: 400,
    toJSON() {
      return {};
    },
  });
  const container = root.querySelector<HTMLElement>('.pool');
  if (!container) {
    throw new Error('missing pool');
  }
  const command = vi.fn(async (_id: string, _args?: unknown) => undefined);
  const pool = new FramePool(container, store, root, command);
  disposers.unshift(() => {
    pool.dispose();
    store.lease = undefined;
  });
  pool.sync();
  return { pool, store, snapshot, tab, root, container, command };
}
describe('stable iframe ownership and hibernation safety', () => {
  it('moves a tab to another group without reparenting or replacing its iframe', () => {
    const { pool, snapshot, tab, root, container } = fixture();
    const runtime = pool.runtimes.get(tab.id);
    expect(runtime).toBeDefined();
    const frame = runtime?.frame,
      documentWindow = frame?.contentWindow;
    splitGroup(snapshot, 'horizontal');
    const target = groups(snapshot.layout.center)[1];
    const slot = document.createElement('div');
    slot.dataset.pageSlot = target.id;
    root.append(slot);
    moveTab(snapshot, tab.id, target.id);
    pool.sync();
    expect(pool.runtimes.get(tab.id)?.frame).toBe(frame);
    expect(frame?.parentElement).toBe(container);
    expect(frame?.contentWindow).toBe(documentWindow);
  });
  it('keeps the document and resumes it when state persistence fails', async () => {
    const { pool, store, tab } = fixture();
    const runtime = pool.runtimes.get(tab.id);
    if (!runtime) {
      throw new Error('missing runtime');
    }
    const event = vi.fn();
    runtime.capabilities = { serialize: true, restore: true };
    runtime.port = {
      request: vi.fn().mockResolvedValue({ draft: 'saved state' }),
      event,
      close: vi.fn(),
    } as never;
    vi.spyOn(store.api, 'request').mockRejectedValue(new Error('quota_exceeded'));
    await pool.hibernate(tab.id);
    expect(pool.runtimes.get(tab.id)).toBe(runtime);
    expect(runtime.frame.isConnected).toBe(true);
    expect(event).toHaveBeenCalledWith('lifecycle.resume', {});
  });
});

it('reports a same-document route change when a router bypasses the SDK', async () => {
  vi.useFakeTimers();
  const { pool, tab, command } = fixture();
  const runtime = pool.runtimes.get(tab.id)!;
  runtime.state = 'ready';
  const url = tab.url + 'nested?view=detail#section';
  vi.spyOn(runtime.frame, 'contentWindow', 'get').mockReturnValue({
    location: { href: url },
  } as Window);
  command.mockImplementation(async (_id, args) => {
    const data = args as { url: string };
    tab.url = data.url;
  });
  const src = runtime.frame.src;
  await vi.advanceTimersByTimeAsync(250);
  expect(command).toHaveBeenCalledWith('reportNavigation', { tabId: tab.id, url });
  expect(runtime.frame.src).toBe(src);
  await vi.advanceTimersByTimeAsync(250);
  expect(command).toHaveBeenCalledTimes(1);
});
