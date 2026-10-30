import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteConfigConnection } from './site-sync.ts';
import { SiteStore } from './site-store.ts';
import {
  USER_SCRIPT_CONFIG_KEY,
  defaultSiteData,
  epoch,
  type UserScriptSnapshot,
} from '../../shared/userscript-config.ts';

class Socket {
  static instances: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    Socket.instances.push(this);
  }
  close() {
    this.onclose?.();
  }
  receive(snapshot: UserScriptSnapshot) {
    this.onmessage?.({ data: JSON.stringify({ type: 'config.changed', snapshot }) });
  }
}
let store: SiteStore, connection: SiteConfigConnection;
const nativeFetch = globalThis.fetch,
  nativeSocket = globalThis.WebSocket;
const fetcher = vi.fn();
function response(snapshot: UserScriptSnapshot) {
  return {
    ok: true,
    json: async () => ({ success: true, data: { snapshot, ticket: 'single-use' } }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Socket.instances = [];
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('WebSocket', Socket);
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
    expect(Socket.instances).toHaveLength(1);
    expect(
      new URL(fetcher.mock.calls[fetcher.mock.calls.length - 1][0]).searchParams.get('site'),
    ).toBe(location.origin);
    history.replaceState({}, '', oldUrl);
  });
  it('compares on connect and reconnect, then receives immediate core updates without echo uploads', async () => {
    const remote = {
      ...store.snapshot,
      updatedAt: '2026-10-30T10:00:00.000Z',
      data: defaultSiteData(),
    };
    remote.data.window.pos.x = 500;
    fetcher.mockResolvedValue(response(remote));
    connection.start();
    await flush();
    expect(store.snapshot.data.window.pos.x).toBe(500);
    expect(Socket.instances).toHaveLength(1);
    const next = {
      ...remote,
      updatedAt: '2026-10-30T10:00:01.000Z',
      data: { ...remote.data, items: [{ selector: '#new', label: '正文', prefix: '' }] },
    };
    Socket.instances[0].receive(next);
    expect(store.snapshot.data.items[0].selector).toBe('#new');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(response(next));
    Socket.instances[0].close();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(Socket.instances).toHaveLength(2);
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
    const body = JSON.parse(fetcher.mock.calls[fetcher.mock.calls.length - 1][1].body);
    expect(body.snapshot).toEqual(edited);
    expect(body.watch).toBe(true);
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
});
