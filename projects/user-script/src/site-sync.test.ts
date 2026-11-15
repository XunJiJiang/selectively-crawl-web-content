import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteStore } from './site-store.ts';
import type { SiteConfigConnection } from './site-sync.ts';
import { requestCore } from './api/request.ts';
import {
  USER_SCRIPT_CONFIG_KEY,
  defaultSiteData,
  epoch,
  type UserScriptSnapshot,
} from '../../shared/userscript-config.ts';

vi.mock('./api/request.ts', () => ({ requestCore: vi.fn() }));
vi.mock('../../shared/components/notify.ts', () => ({ notify: vi.fn() }));
import { notify } from '../../shared/components/notify.ts';
let store: SiteStore, connection: SiteConfigConnection;
let ConfigController: typeof import('../../shared/store/config.ts').ConfigController;
let circuit: typeof import('./api/sync-circuit.ts');
const nativeFetch = globalThis.fetch,
  nativeSocket = globalThis.WebSocket;
const fetcher = vi.mocked(requestCore);
function response(snapshot: UserScriptSnapshot) {
  return Response.json({ success: true, data: { snapshot } });
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  ({ ConfigController } = await import('../../shared/store/config.ts'));
  circuit = await import('./api/sync-circuit.ts');
  const { SiteConfigConnection } = await import('./site-sync.ts');
  const { SiteStore } = await import('./site-store.ts');
  vi.mocked(notify).mockClear();
  fetcher.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('页面 fetch 被 CSP 禁止');
    }),
  );
  vi.stubGlobal(
    'WebSocket',
    vi.fn(() => {
      throw new Error('页面 WebSocket 被 CSP 禁止');
    }),
  );
  const snapshot: UserScriptSnapshot = {
    version: 1,
    website: location.origin,
    updatedAt: epoch,
    data: defaultSiteData(),
  };
  localStorage.setItem(USER_SCRIPT_CONFIG_KEY, JSON.stringify(snapshot));
  store = new SiteStore(localStorage, location.origin);
  connection = new SiteConfigConnection(store);
});
afterEach(() => {
  connection.stop();
  vi.useRealTimers();
  vi.stubGlobal('fetch', nativeFetch);
  vi.stubGlobal('WebSocket', nativeSocket);
});
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
describe('website configuration connection and live updates', () => {
  it('receives proactive notifications through manager polling, passes the cursor and ignores extension scope', async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({
        success: true,
        data: { snapshot: store.snapshot, cursor: 'boot:0', notifications: [] },
      }),
    );
    connection.start();
    await flush();
    fetcher.mockResolvedValueOnce(
      Response.json({
        success: true,
        data: {
          snapshot: store.snapshot,
          cursor: 'boot:1',
          notifications: [
            { id: 'one', title: '主动通知', type: 'success', scope: 'internal', placement: 'tc' },
          ],
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body ?? '{}').notificationCursor).toBe('boot:0');
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '主动通知', placement: 'tc' }),
    );
  });
  it('keeps the origin connection and values through a same-origin path change', async () => {
    fetcher.mockImplementation(async () => response(store.snapshot));
    connection.start();
    await flush();
    const oldUrl = location.href;
    store.update((data) => {
      data.window.pos.x = 800;
    });
    history.pushState({}, '', '/frame?same-origin=1');
    await flush();
    expect(store.snapshot.website).toBe(location.origin);
    expect(store.snapshot.data.window.pos.x).toBe(800);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      new URL(fetcher.mock.calls[fetcher.mock.calls.length - 1][0]).searchParams.get('site'),
    ).toBe(location.origin);
    history.replaceState({}, '', oldUrl);
  });
  it('polls remote changes without page fetch or WebSocket and only announces connectivity once', async () => {
    const remote = {
      ...store.snapshot,
      updatedAt: '2026-10-30T10:00:00.000Z',
      data: defaultSiteData(),
    };
    remote.data.window.pos.x = 500;
    const connected = vi.fn();
    store.addEventListener('connected', connected);
    fetcher.mockResolvedValue(response(remote));
    connection.start();
    await flush();
    expect(store.snapshot.data.window.pos.x).toBe(500);
    const next = {
      ...remote,
      updatedAt: '2026-10-30T10:00:01.000Z',
      data: { ...remote.data, items: [{ selector: '#new', label: '正文', prefix: '' }] },
    };
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(response(next));
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.snapshot.data.items[0].selector).toBe('#new');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body ?? '{}').watch).toBe(false);
    expect(connected).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
    connection.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps offline edits and uploads the latest local state immediately when connectivity returns', async () => {
    fetcher.mockRejectedValue(new TypeError('offline'));
    connection.start();
    await flush();
    store.update((data) => {
      data.window.minimized = false;
      data.config.notify.placement = 'bl';
    });
    await flush();
    const edited = store.snapshot;
    fetcher.mockImplementation(async () => response(store.snapshot));
    window.dispatchEvent(new Event('online'));
    await flush();
    const body = JSON.parse(fetcher.mock.calls[fetcher.mock.calls.length - 1][1]?.body ?? '{}');
    expect(body.snapshot).toEqual(edited);
    expect(body.watch).toBe(false);
    expect(store.snapshot.data.window.minimized).toBe(false);
  });
  it('never lets a late response overwrite an edit made during upload', async () => {
    let resolve: (value: ReturnType<typeof response>) => void = () => undefined;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    connection.start();
    const before = store.snapshot;
    store.update((data) => {
      data.items = [{ selector: '#late', label: '未上传修改', prefix: '' }];
    });
    const edited = store.snapshot;
    fetcher.mockResolvedValue(response(edited));
    resolve(response(before));
    await flush();
    expect(store.snapshot).toEqual(edited);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retries only the first connection and stops immediately if a later poll fails', async () => {
    fetcher.mockRejectedValue(new TypeError('offline'));
    connection.start();
    await flush();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockImplementation(async () => response(store.snapshot));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockRejectedValue(new TypeError('offline again'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(circuit.isCoreSyncBlocked()).toBe(true);
  });
  it('stops after three failed syncs and retries only after the token changes', async () => {
    fetcher.mockRejectedValue(new TypeError('unauthorized'));
    connection.start();
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(ConfigController.syncAuthRequired).toBe(true);

    await vi.advanceTimersByTimeAsync(60000);
    store.update((data) => {
      data.window.pos.x = 12;
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);

    fetcher.mockImplementation(async () => response(store.snapshot));
    store.update((data) => {
      data.config.api.token = 'correct-token';
    });
    await flush();
    expect(circuit.isCoreSyncBlocked()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(ConfigController.syncAuthRequired).toBe(false);
  });
  it('does not notify from background changes after retries are exhausted', async () => {
    fetcher.mockRejectedValue(new TypeError('offline'));
    connection.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledOnce();
    vi.mocked(notify).mockClear();
    store.update((data) => {
      data.window.pos.x = 42;
    });
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(notify).not.toHaveBeenCalled();
    expect(localStorage.getItem('scwc.userscript.sync-circuit.v1')).toBe('false');
  });
  it('tries a changed connection address once without recording a false success or restarting retries', async () => {
    fetcher.mockRejectedValue(new TypeError('offline'));
    connection.start();
    await vi.advanceTimersByTimeAsync(1500);
    store.update((data) => {
      data.config.api.port = '3400';
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3][1]?.interactive).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem('scwc.userscript.sync-circuit.v1')).toBe('false');
  });
  it('resumes polling after a user request recovers the connection and never restores startup retries', async () => {
    fetcher.mockRejectedValue(new TypeError('offline'));
    connection.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetcher).toHaveBeenCalledTimes(3);
    circuit.recordCoreSyncSuccess();
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(circuit.isCoreSyncBlocked()).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('aborts on stop and ignores a response from an obsolete core address', async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    connection.start();
    const before = store.snapshot;
    const signal = fetcher.mock.calls[0][1]?.signal;
    store.update((data) => {
      data.config.api.port = '3300';
    });
    fetcher.mockImplementation(async () => response(store.snapshot));
    resolve(response(before));
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(store.snapshot.data.config.api.port).toBe('3300');
    expect(new URL(fetcher.mock.calls[1][0]).port).toBe('3300');
    const active = fetcher.mock.calls[1][1]?.signal;
    connection.stop();
    expect(active?.aborted).toBe(true);
  });
});
