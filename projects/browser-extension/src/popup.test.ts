import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExtensionPopup } from './popup.ts';
import { initialSettings, initialSnapshot, type PopupNavigation } from './model.ts';
import type { Init, PluginBatch, Request } from './background.ts';
import { ExtensionStore } from './storage.ts';
import type { PluginConfig } from '../../shared/types/plugin.d.ts';

const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./browser.ts', () => ({ browser: {}, call: mock.call }));
const nativeScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.scrollLeft = options.left ?? this.scrollLeft;
    },
  });
});
afterEach(() => {
  document.body.replaceChildren();
  mock.call.mockReset();
  if (nativeScrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', nativeScrollTo);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
});
function navigationFixture() {
  const settings = initialSettings();
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
  let site = 'https://one.example/article';
  const plugins: PluginConfig[] = ['first', 'second'].map((id) => ({
    id,
    title: id,
    description: '',
    controls: [],
  }));
  mock.call.mockImplementation(async (message: Request) => {
    switch (message.type) {
      case 'init':
        return {
          settings,
          syncBlocked: false,
          tab: { id: 1, url: site },
          ...(/^https?:/.test(site)
            ? { snapshot: await store.load(site), navigation: await store.navigation(site) }
            : {}),
        } satisfies Init;
      case 'navigation.save':
        return store.saveNavigation(message.site, message.navigation);
      case 'site.patch':
        return store.patch(message.site, message.patch);
      case 'core.sync': {
        const snapshot = await store.load(message.site);
        return {
          ...snapshot,
          data: { ...snapshot.data, plugin: { expanded: true, activeTab: 'first' } },
        };
      }
      case 'plugins':
        return { data: plugins, activeIds: ['first', 'second'], updatedIds: ['first', 'second'] };
    }
  });
  return {
    store,
    setSite(value: string) {
      site = value;
    },
    async open() {
      const popup = new ExtensionPopup();
      const state = popup as unknown as {
        panel: string;
        activePlugin: string;
        plugins: PluginConfig[];
        refresh(): Promise<void>;
      };
      document.body.append(popup);
      await vi.waitFor(() => expect(state.plugins).toHaveLength(2));
      await popup.updateComplete;
      return { popup, state };
    },
  };
}
it.each(['capture', 'plugins', 'notifications', 'settings'] as const)(
  'restores the %s panel and selected plugin after closing, reopening and syncing',
  async (panel) => {
    const fixture = navigationFixture();
    const { popup } = await fixture.open();
    const tabs = [...(popup.shadowRoot?.querySelectorAll<HTMLButtonElement>('nav button') ?? [])];
    expect(tabs).toHaveLength(4);
    tabs[1].click();
    await popup.updateComplete;
    const pluginTabs = popup.shadowRoot?.querySelectorAll<HTMLButtonElement>(
      '.plugin-tab [role="tab"]',
    );
    expect(pluginTabs).toHaveLength(2);
    pluginTabs?.[1].click();
    tabs[['capture', 'plugins', 'notifications', 'settings'].indexOf(panel)].click();
    popup.remove();
    expect(await fixture.store.navigation('https://one.example')).toEqual({
      panel,
      activePlugin: 'second',
    });
    const reopened = await fixture.open();
    expect(reopened.state.panel).toBe(panel);
    expect(reopened.state.activePlugin).toBe('second');
    await reopened.state.refresh();
    expect(reopened.state.panel).toBe(panel);
    expect(reopened.state.activePlugin).toBe('second');
    expect(
      reopened.popup.shadowRoot?.querySelector('.plugin-tab [aria-selected="true"]')?.textContent,
    ).toContain('second');
  },
);
it('restores each website navigation on source changes and falls back for unavailable plugins', async () => {
  const fixture = navigationFixture();
  const first: PopupNavigation = { panel: 'plugins', activePlugin: 'second' };
  const second: PopupNavigation = { panel: 'notifications', activePlugin: 'removed-plugin' };
  await fixture.store.saveNavigation('https://one.example', first);
  await fixture.store.saveNavigation('https://two.example', second);
  const { state } = await fixture.open();
  expect(state.activePlugin).toBe('second');
  fixture.setSite('https://one.example/other');
  await state.refresh();
  expect(state.panel).toBe('plugins');
  expect(state.activePlugin).toBe('second');
  fixture.setSite('https://two.example/article');
  await state.refresh();
  expect(state.panel).toBe('notifications');
  expect(state.activePlugin).toBe('first');
  fixture.setSite('chrome://extensions');
  await state.refresh();
  expect(state.panel).toBe('settings');
  fixture.setSite('https://one.example/article');
  await state.refresh();
  expect(state.panel).toBe('plugins');
  expect(state.activePlugin).toBe('second');
});
it('refreshes only the clicked plugin tab, retains the focused tab and shows loading until completion', async () => {
  const settings = initialSettings(),
    site = 'https://example.com/article';
  mock.call.mockResolvedValue({ settings });
  const popup = new ExtensionPopup();
  document.body.append(popup);
  await popup.updateComplete;
  await Promise.resolve();
  const state = popup as unknown as {
    context: Init;
    panel: string;
    plugins: PluginConfig[];
    activePlugin: string;
    refreshPlugin(id: string): Promise<void>;
  };
  state.context = {
    settings,
    syncBlocked: false,
    tab: { id: 1, url: site },
    snapshot: initialSnapshot(site, settings.config),
  };
  state.panel = 'plugins';
  const first: PluginConfig = { id: 'first', title: 'First', description: '', controls: [] };
  state.plugins = [first, { ...first, id: 'second', title: 'Second' }];
  state.activePlugin = 'first';
  let finish!: (batch: PluginBatch) => void;
  mock.call.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await popup.updateComplete;
  const work = state.refreshPlugin('second');
  await popup.updateComplete;
  expect(mock.call).toHaveBeenLastCalledWith({ type: 'plugins', tab: 1, site, pluginId: 'second' });
  expect(popup.shadowRoot?.querySelector('.spinning')).not.toBeNull();
  expect(popup.shadowRoot?.querySelectorAll('.plugin-tab')).toHaveLength(2);
  expect(popup.shadowRoot?.textContent).not.toContain('网站插件');
  finish({
    data: [{ ...first, id: 'second', title: 'Refreshed' }],
    activeIds: ['first', 'second'],
    updatedIds: ['second'],
  });
  await work;
  await popup.updateComplete;
  expect(state.plugins[0]).toBe(first);
  expect(state.plugins[1].title).toBe('Refreshed');
  expect(state.activePlugin).toBe('first');
  expect(popup.shadowRoot?.querySelector('.spinning')).toBeNull();
});
it('routes results to the shared floating center and places notification history between plugins and settings', async () => {
  mock.call.mockResolvedValue({ settings: initialSettings(), syncBlocked: false });
  const popup = new ExtensionPopup();
  document.body.append(popup);
  await popup.updateComplete;
  await Promise.resolve();
  const state = popup as unknown as { showResult(input: unknown): void };
  state.showResult({
    data: { type: 'notification', data: { type: 'warn', message: '请检查采集内容' } },
  });
  state.showResult({
    data: ['采集结果一', { pluginInfo: { name: '示例插件' }, info: '采集结果二' }],
  });
  await popup.updateComplete;
  const center = popup.shadowRoot?.querySelector('scwc-extension-notifications') as HTMLElement & {
    updateComplete: Promise<boolean>;
  };
  await center.updateComplete;
  expect(center.shadowRoot?.querySelectorAll('.toast')).toHaveLength(3);
  expect(center.shadowRoot?.querySelector('[data-type="warn"]')?.textContent).toContain(
    '请检查采集内容',
  );
  expect(popup.shadowRoot?.querySelector('main .notice, main .results')).toBeNull();
  const tabs = [...(popup.shadowRoot?.querySelectorAll<HTMLButtonElement>('nav button') ?? [])];
  expect(tabs.map((button) => button.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
    '采集 0',
    '插件',
    '通知',
    '设置',
  ]);
  tabs[2].click();
  await popup.updateComplete;
  await center.updateComplete;
  expect(center.shadowRoot?.querySelectorAll('.notification')).toHaveLength(3);
  expect(center.shadowRoot?.textContent).toContain('示例插件：采集结果二');
  tabs[3].click();
  await popup.updateComplete;
  expect(popup.shadowRoot?.textContent).not.toContain('通知位置');
});
