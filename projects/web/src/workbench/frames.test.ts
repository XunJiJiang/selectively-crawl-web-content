import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue, InstancePort, PROTOCOL } from '../../../shared/workbench-protocol.ts';
import { FramePool } from './frames.ts';
import { WorkbenchStore } from './store.ts';
import { addTab, groups, moveTab, newPluginTab, splitGroup } from './model.ts';
import type { WorkspaceSnapshot } from './types.ts';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { Notify } from '../../../shared/components/notify.ts';
import { createWorkbenchSDK } from '../../../webutils/lib/workbench.ts';
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
it('projects shared Notify state through the page SDK while preserving document ownership and local opt-out', async () => {
  const { pool, store, tab } = fixture();
  const runtime = requireValue(pool.runtimes.get(tab.id));
  const channel = new NodeMessageChannel();
  const core = new InstancePort(channel.port1 as unknown as MessagePort, tab.id, runtime.epoch);
  runtime.port = core;
  core.onEvent = (method, payload) =>
    (
      pool as unknown as { onEvent(r: typeof runtime, method: string, payload: unknown): void }
    ).onEvent(runtime, method, payload);
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('parent', parent);
  const sdk = createWorkbenchSDK(vi.fn());
  // Creation before the welcome must use the eventual core presentation without a local flash.
  const onclick = vi.fn(),
    onclose = vi.fn(),
    oldAction = vi.fn();
  const notice = new Notify().info('插件下载', {
    placement: 'tl',
    progress: null,
    autoRead: false,
    onclick,
    onclose,
    actions: [{ label: '旧操作', onClick: oldAction }],
  });
  expect(document.querySelector('scwc-notify')).toBeNull();
  window.dispatchEvent(
    new MessageEvent('message', {
      source: parent as unknown as Window,
      origin: location.origin,
      ports: [channel.port2 as unknown as MessagePort],
      data: {
        protocol: PROTOCOL,
        version: 1,
        type: 'welcome',
        documentNonce: (
          await (async () => {
            await Promise.resolve();
            return parent.postMessage.mock.calls[0][0] as { documentNonce: string };
          })()
        ).documentNonce,
        session: {
          grant: 'grant',
          safeId: 'safe',
          tabId: tab.id,
          frameEpoch: runtime.epoch,
          expiresAt: Date.now() + 300000,
        },
        focused: true,
        visible: true,
      },
    }),
  );
  await sdk.ready;
  await vi.waitFor(() => expect(store.toasts).toHaveLength(1));
  const id = store.toasts[0].id;
  expect(store.toasts[0].notification).toMatchObject({
    source: 'page',
    pluginId: 'p',
    progress: null,
    readAt: null,
  });
  expect(store.toasts[0].notification).not.toHaveProperty('placement');
  await notice.markRead();
  await notice.setContent('正在下载', '已完成一半');
  await notice.setProgress(50);
  await vi.waitFor(() =>
    expect(store.toasts[0].notification).toMatchObject({
      title: '正在下载',
      message: '已完成一半',
      progress: 50,
      readAt: expect.any(String),
    }),
  );
  await notice.markRead(false);
  await vi.waitFor(() => expect(store.toasts[0].notification.readAt).toBeNull());
  await store.ackNotifications([id]);
  expect((await notice.getState()).readAt).not.toBeNull();
  store.clickToast(id);
  await vi.waitFor(() => expect(onclick).toHaveBeenCalledOnce());
  const staleAction = requireValue(store.toasts[0].notification.actions[0].id);
  const action = vi.fn(async () => {
    await notice.setProgress(100);
  });
  await notice.setActions([{ label: '完成', onClick: action }]);
  await vi.waitFor(() => expect(store.toasts[0].notification.actions[0].label).toBe('完成'));
  await expect(store.invokeNotificationAction(id, staleAction)).rejects.toThrow('已失效');
  await store.invokeNotificationAction(
    id,
    requireValue(store.toasts[0].notification.actions[0].id),
  );
  expect(action).toHaveBeenCalledOnce();
  expect(oldAction).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(store.toasts[0].notification.progress).toBe(100));
  // Host placement never enters this projection; explicit opt-out still uses all six local placements.
  const local = new Notify({ useCore: false }).success('插件内显示', {
    placement: 'bc',
    duration: 0,
  });
  const element = requireValue(document.querySelector('scwc-notify'));
  await element.updateComplete;
  expect(element.shadowRoot?.querySelector('.bc-list .notify-item')).not.toBeNull();
  expect(store.toasts).toHaveLength(1);
  await local.markRead();
  expect((await local.getState()).readAt).not.toBeNull();
  local.close();
  await store.deleteNotifications([id]);
  expect(onclose).toHaveBeenCalledWith('user');
  await vi.waitFor(() => expect(store.toasts).toHaveLength(0));
  expect(notice.update({ progress: 1 })).toBe(false);
  const remaining = Notify.notify({ title: '随文档释放', progress: null });
  await vi.waitFor(() => expect(store.toasts).toHaveLength(1));
  expect(remaining.id).not.toBe(notice.id);
  (pool as unknown as { invalidate(r: typeof runtime): void }).invalidate(runtime);
  expect(store.toasts).toHaveLength(0);
  expect(store.notificationItems).toHaveLength(0);
  window.dispatchEvent(new Event('pagehide'));
});
describe('stable iframe ownership and hibernation safety', () => {
  it('sends one blur when focus enters the auxiliary sidebar and restores page focus', () => {
    const { pool, store, tab } = fixture();
    const runtime = requireValue(pool.runtimes.get(tab.id));
    const event = vi.fn();
    runtime.port = { event, close: vi.fn() } as unknown as NonNullable<typeof runtime.port>;
    store.focusedLocation = { kind: 'auxiliary' };
    pool.sync();
    pool.sync();
    expect(event.mock.calls.filter(([name]) => name === 'focus.changed')).toEqual([
      ['focus.changed', false],
    ]);
    store.focusedLocation = { kind: 'tab', id: tab.id };
    pool.sync();
    expect(event).toHaveBeenLastCalledWith('focus.changed', true);
    runtime.port = undefined;
  });
  it('clips a horizontally scrolled page to its own viewport', () => {
    vi.useFakeTimers();
    const { pool, tab, root } = fixture();
    const slot = requireValue(root.querySelector<HTMLElement>('[data-page-slot]'));
    const viewport = document.createElement('div');
    viewport.className = 'page-viewport';
    slot.replaceWith(viewport);
    viewport.append(slot);
    const rect = (left: number, right: number) => ({
      x: left,
      y: 0,
      left,
      right,
      top: 0,
      bottom: 400,
      width: right - left,
      height: 400,
      toJSON() {
        return {};
      },
    });
    Object.defineProperty(slot, 'getBoundingClientRect', { value: () => rect(-100, 400) });
    Object.defineProperty(viewport, 'getBoundingClientRect', { value: () => rect(0, 200) });
    pool.position();
    vi.advanceTimersByTime(20);
    const frame = pool.runtimes.get(tab.id)?.frame;
    expect(frame?.style.left).toBe('-100px');
    expect(frame?.style.width).toBe('500px');
    expect(frame?.style.clipPath).toBe('inset(0px 200px 0px 100px)');
  });
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
  const runtime = requireValue(pool.runtimes.get(tab.id));
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

it('clips plugin frames to the group, center and application viewports and hides zero-width centers', () => {
  vi.useFakeTimers();
  const { pool, tab, root } = fixture();
  const slot = requireValue(root.querySelector<HTMLElement>('[data-page-slot]'));
  const center = document.createElement('main');
  center.className = 'center-area';
  slot.replaceWith(center);
  center.append(slot);
  let width = 100;
  Object.defineProperty(center, 'getBoundingClientRect', {
    value: () => new DOMRect(0, 0, width, 400),
  });
  pool.position();
  vi.advanceTimersByTime(20);
  const frame = requireValue(pool.runtimes.get(tab.id)?.frame);
  expect(frame.style.width).toBe('500px');
  expect(frame.style.clipPath).toBe('inset(0px 400px 0px 0px)');
  width = 0;
  pool.position();
  vi.advanceTimersByTime(20);
  expect(frame.hidden).toBe(true);
  width = 100;
  center.hidden = true;
  pool.position();
  vi.advanceTimersByTime(20);
  expect(frame.hidden).toBe(true);
});
