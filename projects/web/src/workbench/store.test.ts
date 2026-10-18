import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import { ApiError } from '../api/workbench.ts';
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
  it('keeps a failed CAS draft and retries the identical idempotent operation without fabricating success', async () => {
    const store = fixture(),
      calls: unknown[] = [];
    const request = vi.spyOn(store.api, 'request').mockImplementation(async (_path, body) => {
      calls.push(body);
      throw new ApiError('revision_conflict', '数据已更新', 409);
    });
    await expect(
      store.update((s) => {
        s.layout.mainSidebar.size = 360;
      }),
    ).rejects.toThrow('数据已更新');
    expect(store.saveState).toBe('unsaved');
    expect(store.exportDraft()).toContain('360');
    await expect(
      store.update((s) => {
        s.layout.panel.visible = true;
      }),
    ).rejects.toThrow('未同步');
    expect(request).toHaveBeenCalledTimes(1);
    request.mockImplementation(async (_path, body) => {
      calls.push(body);
      const data = body as { snapshot: ReturnType<typeof defaultSnapshot> };
      return { workspaceId: 'ws', revision: 2, snapshot: data.snapshot } as never;
    });
    await store.retrySave();
    expect(calls[1]).toEqual(calls[0]);
    expect(store.saveState).toBe('saved');
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
