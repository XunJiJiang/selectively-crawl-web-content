import { describe, expect, it } from 'vitest';
import { ExtensionStore } from './storage.ts';
import {
  fromWire,
  initialSettings,
  initialSnapshot,
  navigationKey,
  siteKey,
  toWire,
} from './model.ts';
import { defaultSiteData } from '../../shared/userscript-config.ts';

function fixture() {
  const values: Record<string, unknown> = {};
  const store = new ExtensionStore({
    get: async (key) => ({ [key]: structuredClone(values[key]) }),
    set: async (entries) => {
      Object.assign(values, structuredClone(entries));
    },
    remove: async (key) => {
      Reflect.deleteProperty(values, key);
    },
  });
  return { store, values };
}
describe('extension storage and userscript interoperability', () => {
  it('restores local navigation across paths and store restarts independently of core sync', async () => {
    const { store, values } = fixture();
    const site = 'https://one.example/article';
    const initial = await store.patch(site, { plugin: { expanded: true, activeTab: 'legacy' } });
    expect(await store.navigation(site)).toEqual({ panel: 'capture', activePlugin: 'legacy' });
    const navigation = { panel: 'settings', activePlugin: 'second' } as const;
    const save = store.saveNavigation(site, navigation);
    // 弹窗重开时的读取等待已经交给后台的保存。
    expect(await store.navigation('https://one.example/other')).toEqual(navigation);
    await save;
    expect(await store.load(site)).toEqual(initial);
    const remote = toWire(initial);
    remote.data.plugin.activeTab = 'remote';
    await store.accept(site, remote, initial.updatedAt);
    await store.patch(site, { items: [{ selector: '#local', label: '', prefix: '' }] });
    expect(await store.navigation(site)).toEqual(navigation);
    expect(await store.navigation('https://two.example')).toEqual({
      panel: 'capture',
      activePlugin: '',
    });
    const reopened = new ExtensionStore({
      get: async (key) => ({ [key]: structuredClone(values[key]) }),
      set: async () => undefined,
      remove: async () => undefined,
    });
    expect(await reopened.navigation(site)).toEqual(navigation);
    expect(values[navigationKey(site)]).toEqual(navigation);
    values[navigationKey(site)] = { panel: 'removed-panel', activePlugin: null };
    expect(await store.navigation(site)).toEqual({ panel: 'capture', activePlugin: 'remote' });
  });
  it('shares an extension origin record across paths, isolates websites and keeps edits after reopening', async () => {
    const { store, values } = fixture();
    await Promise.all([
      store.patch('https://one.example/a', {
        items: [{ selector: '#article', label: '正文', prefix: '> ' }],
      }),
      store.patch('https://one.example/b', {
        controls: [{ pluginId: 'p', channel: 'c', value: false }],
      }),
    ]);
    expect((await store.load('https://one.example/frame')).data.items).toHaveLength(1);
    expect((await store.load('https://one.example/frame')).data.controls[0].value).toBe(false);
    expect((await store.load('https://two.example')).data.items).toEqual([]);
    expect(Object.keys(values)).toEqual([siteKey('https://one.example')]);
    expect(JSON.stringify(values)).not.toMatch(/minimized|"pos"/);
  });
  it('accepts core tie decisions but never overwrites an edit made during upload', async () => {
    const { store } = fixture();
    const uploaded = await store.patch('https://one.example', { items: [] });
    const remote = toWire(uploaded);
    remote.data.items = [{ selector: '#core', label: '核心', prefix: '' }];
    expect(
      (await store.accept(uploaded.website, remote, uploaded.updatedAt)).data.items[0].selector,
    ).toBe('#core');
    const edited = await store.patch(uploaded.website, {
      items: [{ selector: '#local', label: '离线编辑', prefix: '' }],
    });
    expect(await store.accept(uploaded.website, remote, uploaded.updatedAt)).toEqual(edited);
    await expect(
      store.accept(
        uploaded.website,
        { ...remote, website: 'https://other.example' },
        uploaded.updatedAt,
      ),
    ).rejects.toThrow('归属');
  });
  it('drops floating position and minimization while keeping every shared business field', () => {
    const initial = initialSnapshot('https://one.example/a', initialSettings().config);
    const wire = toWire(initial);
    wire.data.window = { pos: { x: 900, y: 700 }, minimized: false, selectionExpanded: true };
    wire.data.plugin = { expanded: true, activeTab: 'plugin' };
    const local = fromWire(wire);
    expect(local.data).not.toHaveProperty('window');
    expect(local.data.selectionExpanded).toBe(true);
    expect(toWire(local).data.plugin).toEqual(wire.data.plugin);
    expect(toWire(local).data.window.pos).toEqual(defaultSiteData().window.pos);
  });
});
