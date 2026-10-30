import { beforeEach, describe, expect, it } from 'vitest';
import { USER_SCRIPT_CONFIG_KEY, defaultSiteData, epoch } from '../../shared/userscript-config.ts';
import { CONFIG_KEY, SELECTIVE_CRAWL_KEY, PERSISTENT_DATA_KEY } from '../../shared/utils/common.ts';
import updateLocalStorage, {
  updateLocalStorageFormat_2026_10_30,
  updateLocalStorageFormat_2026_10_31_origin,
} from '../../shared/utils/updateLocalStorage.ts';
import { SiteStore } from './site-store.ts';
import { ConfigController } from '../../shared/store/config.ts';

beforeEach(() => localStorage.clear());
function fixture() {
  updateLocalStorageFormat_2026_10_30();
  return new SiteStore(localStorage, location.origin);
}
describe('website configuration migration and dates', () => {
  it('shares origin configuration between different paths, iframes and direct visits', () => {
    const parent = new SiteStore(localStorage, location.origin + '/host');
    const frame = new SiteStore(localStorage, location.origin + '/child?embedded=1');
    parent.update((data) => {
      data.window.pos.x = 777;
      data.items = [{ selector: '#host', label: 'host', prefix: '' }];
      data.config.notify.placement = 'bl';
    });
    frame.storageChanged(USER_SCRIPT_CONFIG_KEY, JSON.stringify(parent.snapshot));
    expect(frame.snapshot).toEqual(parent.snapshot);
    frame.update((data) => {
      data.window.minimized = false;
      data.items = [{ selector: '#child', label: 'child', prefix: '' }];
    });
    parent.storageChanged(USER_SCRIPT_CONFIG_KEY, JSON.stringify(frame.snapshot));
    expect(parent.snapshot).toEqual(frame.snapshot);
    const direct = new SiteStore(localStorage, location.origin + '/child#direct');
    expect(direct.snapshot).toEqual(frame.snapshot);
    direct.update((data) => {
      data.plugin.expanded = true;
    });
    frame.storageChanged(USER_SCRIPT_CONFIG_KEY, JSON.stringify(direct.snapshot));
    parent.storageChanged(USER_SCRIPT_CONFIG_KEY, JSON.stringify(direct.snapshot));
    expect(frame.snapshot).toEqual(direct.snapshot);
    expect(parent.snapshot).toEqual(direct.snapshot);
  });
  it('migrates the newest path copy back to origin without losing its edit date', () => {
    updateLocalStorageFormat_2026_10_30();
    const legacy = JSON.parse(localStorage.getItem(USER_SCRIPT_CONFIG_KEY) ?? '{}');
    legacy.updatedAt = '2026-10-30T10:00:00.000Z';
    legacy.data.window.minimized = false;
    const raw = JSON.stringify(legacy);
    localStorage.setItem(USER_SCRIPT_CONFIG_KEY, raw);
    const path = {
      ...legacy,
      version: 2,
      website: location.origin + '/one',
      updatedAt: '2026-10-31T10:00:00.000Z',
      data: defaultSiteData(),
    };
    path.data.window.pos.x = 555;
    const key = USER_SCRIPT_CONFIG_KEY + ':' + encodeURIComponent(path.website);
    localStorage.setItem(key, JSON.stringify(path));
    const migrated = updateLocalStorageFormat_2026_10_31_origin(
      undefined,
      location.origin + '/two',
    );
    expect(migrated).toEqual({ ...path, version: 1, website: location.origin });
    expect(localStorage.getItem(key)).toBe(JSON.stringify(path));
    expect(updateLocalStorageFormat_2026_10_31_origin()).toEqual(migrated);
  });
  it('retains the origin snapshot across different paths and rejects other origins', () => {
    const store = new SiteStore(localStorage, location.origin + '/one');
    store.update((data) => {
      data.window.pos.x = 456;
    });
    const first = store.snapshot;
    const otherPath = new SiteStore(localStorage, location.origin + '/two?q=1#part');
    expect(otherPath.snapshot).toEqual(first);
    expect(() => store.accept({ ...first, website: 'https://other.example' })).toThrow(
      '归属不匹配',
    );
  });
  it('consumes origin-wide settings events from other paths', () => {
    const before = ConfigController.config;
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: CONFIG_KEY,
        newValue: JSON.stringify({ ...before, api: { ...before.api, token: 'other-page' } }),
      }),
    );
    expect(ConfigController.config.api.token).toBe('other-page');
    ConfigController.applyConfig(before);
  });
  it('migrates all old settings/items/window state once without discarding old keys', () => {
    const data = defaultSiteData();
    data.config.api.token = 'legacy';
    localStorage.setItem(CONFIG_KEY, JSON.stringify(data.config));
    localStorage.setItem(
      SELECTIVE_CRAWL_KEY,
      JSON.stringify([{ selector: '#old', label: '正文' }]),
    );
    localStorage.setItem(
      PERSISTENT_DATA_KEY,
      JSON.stringify({
        version: '2.0.0-1',
        window: { pos: { x: 18, y: 25 }, minimized: false },
        plugin: { expanded: true, activeTab: 'plugin-a' },
      }),
    );
    const store = fixture(),
      raw = localStorage.getItem(USER_SCRIPT_CONFIG_KEY);
    expect(store.snapshot.data).toMatchObject({
      config: { api: { token: 'legacy' } },
      items: [{ selector: '#old', label: '正文', prefix: '' }],
      window: { pos: { x: 18, y: 25 }, minimized: false },
      plugin: { expanded: true, activeTab: 'plugin-a' },
    });
    expect(Date.parse(store.snapshot.updatedAt)).toBeGreaterThan(0);
    expect(localStorage.getItem(SELECTIVE_CRAWL_KEY)).toContain('#old');
    updateLocalStorageFormat_2026_10_30();
    expect(localStorage.getItem(USER_SCRIPT_CONFIG_KEY)).toBe(raw);
  });
  it('does not mark fresh defaults as a user edit; accepts newer core data and rejects old responses', () => {
    const store = fixture();
    expect(store.snapshot.updatedAt).toBe(epoch);
    const remote = {
      ...store.snapshot,
      updatedAt: '2026-10-30T10:00:00.000Z',
      data: defaultSiteData(),
    };
    remote.data.window.pos.x = 260;
    remote.data.controls = [{ pluginId: 'p', channel: 'q', value: false }];
    store.accept(remote);
    expect(store.snapshot.data.window.pos.x).toBe(260);
    store.update((data) => {
      data.window.minimized = false;
    });
    const current = store.snapshot;
    store.accept(remote, true);
    expect(store.snapshot).toEqual(current);
    expect(JSON.parse(localStorage.getItem(PERSISTENT_DATA_KEY) ?? '{}').window.minimized).toBe(
      false,
    );
  });
  it('keeps edit dates monotonic even if the local clock is behind the received date', () => {
    const store = fixture();
    store.accept({ ...store.snapshot, updatedAt: '2090-01-01T00:00:00.000Z' });
    store.update((data) => {
      data.items = [{ selector: '#new', label: '新', prefix: '' }];
    });
    expect(store.snapshot.updatedAt).toBe('2090-01-01T00:00:00.001Z');
    const previous = store.snapshot.updatedAt;
    store.update(() => undefined);
    expect(store.snapshot.updatedAt).toBe(previous);
  });
  it('preserves malformed legacy JSON for recovery', () => {
    localStorage.setItem(CONFIG_KEY, '{broken');
    fixture();
    expect(localStorage.getItem(CONFIG_KEY + '.before-2026-10-30')).toBe('{broken');
  });
  it('still migrates valid settings when the old window JSON is damaged', () => {
    localStorage.setItem(PERSISTENT_DATA_KEY, '{broken-window');
    const config = defaultSiteData().config;
    config.api.token = 'preserved';
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    updateLocalStorage();
    const store = new SiteStore(localStorage, location.origin);
    expect(store.snapshot.data.config.api.token).toBe('preserved');
    expect(localStorage.getItem(PERSISTENT_DATA_KEY + '.before-2026-10-30')).toBe('{broken-window');
  });
});
