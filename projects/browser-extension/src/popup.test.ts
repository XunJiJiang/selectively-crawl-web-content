import { afterEach, expect, it, vi } from 'vitest';
import { ExtensionPopup } from './popup.ts';
import { initialSettings, initialSnapshot } from './model.ts';
import type { Init, PluginBatch } from './background.ts';
import type { PluginConfig } from '../../shared/types/plugin.d.ts';

const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./browser.ts', () => ({ browser: {}, call: mock.call }));
afterEach(() => {
  document.body.replaceChildren();
  mock.call.mockReset();
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
