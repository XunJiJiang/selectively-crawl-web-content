import { describe, expect, it } from 'vitest';
import { ExtensionStore } from './storage.ts';
import { fromWire, initialSettings, initialSnapshot, siteKey, toWire } from './model.ts';
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
