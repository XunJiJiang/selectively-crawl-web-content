import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import { ApiError, EventConnection } from '../api/workbench.ts';
import { CONFIG_KEY } from '../../../shared/utils/common.ts';
import type { WorkspaceSnapshot } from './types.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
vi.mock('../../../shared/store/config.ts', () => ({
  ConfigController: {
    config: {
      api: { host: 'http://localhost', port: '3200', token: 'test-token' },
      plugin: { refreshRule: '//' },
      notify: { placement: 'tr' },
    },
  },
}));
function defaultSnapshot(): WorkspaceSnapshot {
  return {
    layout: {
      schemaVersion: 1,
      mainSidebar: { side: 'left', visible: true, size: 280, view: 'pages', openPagesRatio: 0.6 },
      auxiliarySidebar: { visible: true, size: 280 },
      panel: {
        dock: 'bottom',
        align: 'center',
        visible: true,
        width: 360,
        height: 240,
        activeView: 'output',
        terminalListSize: 200,
      },
      center: { kind: 'group', id: 'group', tabIds: [], activeTabId: null, tabBarPosition: 'top' },
      focusedGroupId: 'group',
    },
    tabs: [],
  };
}
import { addTab, newPluginTab } from './model.ts';
const stores: WorkbenchStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => {
    s.lease = undefined;
    s.dispose();
  });
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});
function fixture() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
    clear: () => data.clear(),
  });
  const store = new WorkbenchStore();
  stores.push(store);
  store.lease = { workspaceId: 'ws', token: 'lease', expiresAt: Date.now() + 30000 };
  store.workspace = { workspaceId: 'ws', revision: 1, snapshot: defaultSnapshot() };
  return store;
}
describe('workspace writes and recovery', () => {
  it('retries authentication with the entered token and only persists a successful connection', async () => {
    const store = fixture();
    const snapshot = defaultSnapshot();
    const fetcher = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      const token = (options.headers as Record<string, string>).Authorization;
      if (token !== 'Bearer current-token') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ success: false, message: '无效令牌' }),
        };
      }
      const pathname = new URL(url, location.origin).pathname;
      let data: unknown = { items: [], total: 0, nextCursor: null };
      if (pathname.endsWith('/bootstrap')) {
        data = {
          installationId: 'installation',
          coreBootId: 'boot',
          preferences: { values: {}, revision: 0 },
        };
      } else if (pathname.endsWith('/lease')) {
        data = { workspaceId: 'workspace', token: 'lease', expiresAt: Date.now() + 30000 };
      } else if (pathname.endsWith('/workspaces/workspace')) {
        data = { workspaceId: 'workspace', revision: 1, snapshot };
      } else if (pathname.endsWith('/terminals')) {
        data = [];
      }
      return { ok: true, json: async () => ({ success: true, data }) };
    });
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(EventConnection.prototype, 'connect').mockResolvedValue();
    await store.authenticate('wrong-token');
    expect(store.error).toBe('无效令牌');
    expect(localStorage.getItem(CONFIG_KEY)).toBeNull();
    await store.authenticate('  current-token  ');
    expect(store.error).toBe('');
    expect(store.workspace?.workspaceId).toBe('workspace');
    expect(JSON.parse(requireValue(localStorage.getItem(CONFIG_KEY))).api.token).toBe(
      'current-token',
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/web/api/workbench/bootstrap',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer current-token' }),
      }),
    );
  });

  it('keeps a committed receipt saved when browser cleanup fails, and exports from memory', async () => {
    const store = fixture();
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(store.api, 'request').mockImplementation(async (_path, body) => {
      const value = body as { snapshot: ReturnType<typeof defaultSnapshot> };
      return { workspaceId: 'ws', revision: 2, snapshot: value.snapshot } as never;
    });
    await store.update((s) => {
      s.layout.mainSidebar.size = 340;
    });
    expect(store.saveState).toBe('saved');
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(store.exportDraft()).toContain('340');
  });

  it('serializes concurrent saves against their committed predecessor revision', async () => {
    const store = fixture(),
      revisions: number[] = [];
    vi.spyOn(store.api, 'request').mockImplementation(async (_path, body) => {
      const data = body as { baseRevision: number; snapshot: ReturnType<typeof defaultSnapshot> };
      revisions.push(data.baseRevision);
      await Promise.resolve();
      return {
        workspaceId: 'ws',
        revision: data.baseRevision + 1,
        snapshot: data.snapshot,
      } as never;
    });
    await Promise.all([
      store.update((s) => {
        s.layout.mainSidebar.size = 320;
      }),
      store.update((s) => {
        s.layout.panel.dock = 'right';
      }),
    ]);
    expect(revisions).toEqual([1, 2]);
    expect(store.workspace?.snapshot.layout.mainSidebar.size).toBe(320);
    expect(store.workspace?.snapshot.layout.panel.dock).toBe('right');
  });
  it('retains edits while offline and saves the latest draft on retry', async () => {
    const store = fixture();
    const request = vi.spyOn(store.api, 'request').mockRejectedValue(new Error('offline'));
    await store.update((s) => {
      s.layout.mainSidebar.size = 360;
    });
    await store.update((s) => {
      s.layout.panel.dock = 'right';
    });
    expect(store.workspace?.snapshot.layout.mainSidebar.size).toBe(360);
    expect(store.workspace?.snapshot.layout.panel.dock).toBe('right');
    expect(store.exportDraft()).toContain('360');
    expect(store.toasts).toEqual([]);
    request.mockImplementation(async (_path, body) => {
      const data = body as { snapshot: WorkspaceSnapshot };
      return { workspaceId: 'ws', revision: 2, snapshot: data.snapshot } as never;
    });
    await store.retrySave();
    expect(store.saveState).toBe('saved');
    expect(store.workspace?.snapshot.layout.panel.dock).toBe('right');
  });
  it('automatically rebinds a conflicted save without losing the local draft', async () => {
    const store = fixture();
    const request = vi.spyOn(store.api, 'request');
    request.mockRejectedValueOnce(new ApiError('revision_conflict', '数据已更新', 409));
    request.mockResolvedValueOnce({ ...store.workspace, revision: 8 } as never);
    request.mockImplementation(async (_path, body) => {
      const data = body as { snapshot: WorkspaceSnapshot; baseRevision: number };
      return {
        workspaceId: 'ws',
        revision: data.baseRevision + 1,
        snapshot: data.snapshot,
      } as never;
    });
    await store.update((s) => {
      s.layout.mainSidebar.size = 400;
    });
    expect(store.workspace?.revision).toBe(9);
    expect(store.workspace?.snapshot.layout.mainSidebar.size).toBe(400);
    expect(request.mock.calls[2][1]).toMatchObject({ baseRevision: 8 });
    expect(store.toasts).toEqual([]);
  });
  it('never locally removes a plugin tab when the atomic close transaction fails', async () => {
    const store = fixture(),
      s = requireValue(store.workspace).snapshot;
    const tab = newPluginTab('p', 'P', 'http://localhost/web/page/plugin/p/', {
      installationId: 'i',
      pluginId: 'p',
      path: '/',
      search: '',
      hash: '',
    });
    addTab(s, tab);
    vi.spyOn(store.api, 'request').mockRejectedValue(new Error('offline'));
    await expect(store.closeTabs([tab.id])).rejects.toThrow('offline');
    expect(store.workspace?.snapshot.tabs.some((t) => t.id === tab.id)).toBe(true);
    expect(store.saveState).toBe('unsaved');
  });
});

it('creates a fresh workspace per document, shares only the seed, and isolates existing windows', async () => {
  const first = fixture();
  first.lease = undefined;
  first.workspace = undefined;
  const snapshots = new Map<
    string,
    { workspaceId: string; revision: number; snapshot: WorkspaceSnapshot }
  >();
  vi.spyOn(EventConnection.prototype, 'connect').mockResolvedValue();
  const setup = (store: WorkbenchStore) => {
    vi.spyOn(store, 'refreshLists').mockResolvedValue();
    vi.spyOn(store.api, 'request').mockImplementation(async (path, body) => {
      if (path === '/bootstrap') {
        return {
          installationId: 'i',
          coreBootId: 'boot',
          preferences: { values: {}, revision: 0 },
        } as never;
      }
      const id = path.split('/')[2];
      if (path.endsWith('/lease')) {
        if (!snapshots.has(id)) {
          snapshots.set(id, { workspaceId: id, revision: 0, snapshot: defaultSnapshot() });
        }
        return { workspaceId: id, token: 'lease', expiresAt: Date.now() + 30000 } as never;
      }
      if (path.endsWith('/save')) {
        const data = body as { snapshot: WorkspaceSnapshot; baseRevision: number };
        const saved = {
          workspaceId: id,
          snapshot: structuredClone(data.snapshot),
          revision: data.baseRevision + 1,
        };
        snapshots.set(id, saved);
        return structuredClone(saved) as never;
      }
      return structuredClone(requireValue(snapshots.get(id))) as never;
    });
  };
  setup(first);
  await first.start();
  await first.update((s) => {
    s.layout.mainSidebar.size = 333;
  });
  sessionStorage.setItem(
    'scwc.workspace',
    requireValue((first as WorkbenchStore).workspace).workspaceId,
  );
  const second = new WorkbenchStore();
  stores.push(second);
  setup(second);
  await second.start();
  expect(second.workspace?.workspaceId).not.toBe(
    requireValue((first as WorkbenchStore).workspace).workspaceId,
  );
  expect(second.workspace?.snapshot.layout.mainSidebar.size).toBe(333);
  await first.update((s) => {
    s.layout.mainSidebar.size = 444;
  });
  expect(second.workspace?.snapshot.layout.mainSidebar.size).toBe(333);
  const third = new WorkbenchStore();
  stores.push(third);
  setup(third);
  await third.start();
  expect(third.workspace?.snapshot.layout.mainSidebar.size).toBe(444);
  expect(third.workspace?.snapshot.binding).toEqual({ kind: 'browser-temporary', localPath: null });
  expect(new Set([first, second, third].map((s) => s.workspace?.workspaceId)).size).toBe(3);
  sessionStorage.clear();
});
