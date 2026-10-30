import { afterEach, expect, it, vi } from 'vitest';
import { SCWCContentPlugin } from '../content-plugin.ts';
import '../../../../shared/components/index.ts';
import { fetchPlugins, triggerPlugin, type PluginConfigBatch } from '../../api/plugins.ts';
import { siteStore } from '../../site-store.ts';
import { ConfigController } from '../../../../shared/store/config.ts';
import type { PluginConfig } from '../../../../shared/types/plugin.d.ts';
import { requireValue } from '../../../../shared/workbench-protocol.ts';

vi.mock('../../api/plugins.ts', () => ({ fetchPlugins: vi.fn(), triggerPlugin: vi.fn() }));
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
});
const plugin = (id: string, title = id): PluginConfig => ({
  id,
  title,
  description: '',
  controls: [{ type: 'input:text', label: id, channel: id, options: { defaultValue: 'default' } }],
});
const batch = (
  plugins: PluginConfig[],
  activeIds = plugins.map((p) => p.id),
  updatedIds = plugins.map((p) => p.id),
): PluginConfigBatch => ({ plugins, activeIds, updatedIds });

it('retains unaffected plugin controls and saved values while replacing only refreshed plugins', async () => {
  const query = plugin('query'),
    path = plugin('path');
  vi.mocked(fetchPlugins).mockResolvedValueOnce(batch([query, path]));
  const host = new SCWCContentPlugin();
  host.expanded = true;
  host.currentPluginTab = 'query';
  document.body.append(host);
  await vi.waitFor(() =>
    expect(host.shadowRoot?.querySelector('scwc-input[label="query"]')).not.toBeNull(),
  );
  const input = requireValue(host.shadowRoot?.querySelector('scwc-input[label="query"]'));
  input.dispatchEvent(new CustomEvent('input', { detail: 'edited' }));
  await host.updateComplete;
  vi.mocked(fetchPlugins).mockResolvedValueOnce(
    batch([plugin('path')], ['query', 'path'], ['path']),
  );
  history.pushState({}, '', `${location.pathname}?plugin-refresh=${Date.now()}`);
  await vi.waitFor(() => expect(fetchPlugins).toHaveBeenCalledTimes(2));
  await host.updateComplete;
  expect(host.shadowRoot?.querySelector('scwc-input[label="query"]')).toBe(input);
  expect(siteStore.snapshot.data.controls).toContainEqual({
    pluginId: 'query',
    channel: 'query',
    value: 'edited',
  });
  const settings = new ConfigController(host);
  expect(
    settings.configControls.controls.some((control) => control.label === '插件配置刷新规则'),
  ).toBe(false);
});

it('discards a late URL response and exposes no user-editable refresh policy', async () => {
  vi.mocked(fetchPlugins).mockResolvedValueOnce(batch([plugin('q', 'Initial')]));
  const host = new SCWCContentPlugin();
  host.expanded = true;
  document.body.append(host);
  await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain('Initial'));
  let resolve: (value: PluginConfigBatch) => void = () => undefined;
  vi.mocked(fetchPlugins).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  history.pushState({}, '', '/slow-url');
  await vi.waitFor(() => expect(fetchPlugins).toHaveBeenCalledTimes(2));
  vi.mocked(fetchPlugins).mockResolvedValueOnce(batch([plugin('q', 'Newest')]));
  history.replaceState({}, '', '/newest-url');
  await vi.waitFor(() => expect(host.shadowRoot?.textContent).toContain('Newest'));
  resolve(batch([plugin('q', 'Old response')]));
  await Promise.resolve();
  await host.updateComplete;
  expect(host.shadowRoot?.textContent).not.toContain('Old response');
  expect(host.shadowRoot?.textContent).not.toContain('插件配置刷新规则');
});

it('lets an unaffected plugin finish its pending input action after the refresh decision', async () => {
  const query = plugin('query'),
    path = plugin('path');
  vi.mocked(fetchPlugins).mockResolvedValueOnce(batch([query, path]));
  const host = new SCWCContentPlugin();
  host.expanded = true;
  host.currentPluginTab = 'query';
  document.body.append(host);
  await vi.waitFor(() =>
    expect(host.shadowRoot?.querySelector('scwc-input[label="query"]')).not.toBeNull(),
  );
  vi.useFakeTimers();
  const input = requireValue(host.shadowRoot?.querySelector('scwc-input[label="query"]'));
  input.dispatchEvent(new CustomEvent('input', { detail: 'pending edit' }));
  let resolve: (value: PluginConfigBatch) => void = () => undefined;
  vi.mocked(fetchPlugins).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  history.pushState({}, '', `${location.pathname}?unaffected-plugin-action=1`);
  await vi.advanceTimersByTimeAsync(600);
  expect(triggerPlugin).not.toHaveBeenCalled();
  resolve(batch([plugin('path')], ['query', 'path'], ['path']));
  await vi.advanceTimersByTimeAsync(0);
  expect(triggerPlugin).toHaveBeenCalledWith(
    'change',
    'query',
    'query',
    query.controls[0],
    'pending edit',
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything(),
  );
});

it('commits rapid edits to different connection fields together without saving old intermediate values', async () => {
  vi.useFakeTimers();
  const previous = ConfigController.config;
  const settings = new ConfigController({
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  });
  const edit = (label: string, value: string) =>
    requireValue(settings.configControls.controls.find((item) => item.label === label)).trigger(
      value,
    );
  try {
    edit('Host', 'http://o');
    await vi.advanceTimersByTimeAsync(100);
    edit('Host', 'http://other.example');
    edit('Port', '4321');
    edit('API Token', 'new-token');
    await vi.advanceTimersByTimeAsync(499);
    expect(settings.config.api).toEqual(previous.api);
    await vi.advanceTimersByTimeAsync(1);
    expect(settings.config.api).toEqual({
      host: 'http://other.example',
      port: '4321',
      token: 'new-token',
    });
  } finally {
    settings.hostDisconnected();
    ConfigController.applyConfig(previous);
  }
});

it('retains debounced origin settings through a same-origin SPA path change', async () => {
  vi.useFakeTimers();
  const before = siteStore.snapshot;
  const settings = new ConfigController({
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  });
  try {
    requireValue(
      settings.configControls.controls.find((item) => item.label === 'API Token'),
    ).trigger('previous-page-token');
    history.pushState({}, '', '/separate-page-settings');
    await vi.advanceTimersByTimeAsync(600);
    expect(siteStore.snapshot.website).toBe(location.origin);
    expect(siteStore.snapshot.data.config.api.token).toBe('previous-page-token');
    expect(ConfigController.config.api.token).toBe('previous-page-token');
  } finally {
    settings.hostDisconnected();
    history.replaceState({}, '', before.website);
    ConfigController.applyConfig(before.data.config);
  }
});
