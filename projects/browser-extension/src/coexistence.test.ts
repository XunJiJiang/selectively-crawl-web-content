import { beforeEach, expect, it, vi } from 'vitest';
import type { ExtensionInfo, MessageSender } from './browser.ts';
import { chromiumExtensionManager } from '../../shared/client-coexistence.ts';
const fixture = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  values: new Map<string, unknown>(),
}));
vi.mock('./browser.ts', () => ({
  browser: {
    runtime: { id: 'scwc' },
    management: { getAll: fixture.getAll },
    tabs: { get: fixture.get, create: fixture.create },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: fixture.values.get(key) }),
        set: fixture.set,
      },
    },
  },
}));
import { coexistenceRequest, coexistenceDismissedKey } from './coexistence.ts';
const script = { version: '3.4.8', handler: 'Tampermonkey', handlerVersion: '5.5.1' };
const sender: MessageSender = {
  id: 'scwc',
  frameId: 0,
  tab: { id: 1 },
  url: 'https://example.org/page',
};
const extension = (
  optionsUrl = 'chrome-extension://actual-installed-manager/options.html',
): ExtensionInfo => ({
  id: 'test-manager',
  name: 'Tampermonkey',
  enabled: true,
  version: '5.5.1',
  optionsUrl,
});
beforeEach(() => {
  vi.restoreAllMocks();
  fixture.getAll.mockReset().mockResolvedValue([extension()]);
  fixture.create.mockReset().mockResolvedValue({});
  fixture.get.mockReset().mockResolvedValue({ url: sender.url });
  fixture.values.clear();
  fixture.set.mockReset().mockImplementation(async (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      fixture.values.set(key, value);
    }
  });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/144 Edg/144');
});
it('opens the installed manager and current Edge page without accepting page-supplied URLs', async () => {
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    extensionManager: true,
    scriptManager: true,
  });
  await coexistenceRequest(
    { type: 'coexistence.open', script, target: 'script', url: 'https://evil.example' },
    sender,
  );
  expect(fixture.create).toHaveBeenLastCalledWith({
    url: 'chrome-extension://actual-installed-manager/options.html#nav=dashboard',
  });
  await coexistenceRequest({ type: 'coexistence.open', script, target: 'extension' }, sender);
  expect(fixture.create).toHaveBeenLastCalledWith({ url: 'edge://extensions/' });
});
it('resolves a relative Firefox manager URL and omits privileged about:addons navigation', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Firefox/144');
  fixture.getAll.mockResolvedValue([
    {
      ...extension('options.html'),
      icons: [{ url: 'moz-extension://actual-uuid/images/icon.png' }],
    },
  ]);
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    extensionManager: false,
    scriptManager: true,
    instructions: expect.stringContaining('about:addons'),
  });
  await coexistenceRequest({ type: 'coexistence.open', script, target: 'script' }, sender);
  expect(fixture.create).toHaveBeenCalledWith({
    url: 'moz-extension://actual-uuid/options.html#nav=dashboard',
  });
});
it.each([
  { id: 'another-extension' },
  { frameId: 1 },
  { frameId: undefined },
  { tab: undefined },
  { url: 'https://other.example' },
])('rejects a foreign, nested or stale sender: %j', async (change) => {
  await expect(
    coexistenceRequest({ type: 'coexistence.info', script }, { ...sender, ...change }),
  ).rejects.toThrow('来源');
  expect(fixture.getAll).not.toHaveBeenCalled();
  expect(fixture.create).not.toHaveBeenCalled();
});
it('uses manual directions if the manager is unavailable or stable/beta identification is ambiguous', async () => {
  fixture.getAll.mockResolvedValue([extension(), { ...extension(), name: 'Tampermonkey BETA' }]);
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    scriptManager: false,
  });
  fixture.getAll.mockRejectedValue(new Error('unsupported'));
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    scriptManager: false,
  });
  await expect(
    coexistenceRequest({ type: 'coexistence.open', script, target: 'script' }, sender),
  ).rejects.toThrow('手动');
  expect(fixture.create).not.toHaveBeenCalled();
});
it('does not open a web URL supplied by an installed manager', async () => {
  fixture.getAll.mockResolvedValue([extension('https://manager.example/options')]);
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    scriptManager: false,
  });
});
it('works before an activeTab or core host grant, when tabs.get does not expose a URL', async () => {
  fixture.get.mockResolvedValue({ id: 1 });
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    scriptManager: true,
    extensionManager: true,
  });
});
it('only maps positively identified Chrome and Edge', () => {
  expect(chromiumExtensionManager({ userAgent: '', brands: [{ brand: 'Google Chrome' }] })).toBe(
    'chrome://extensions/',
  );
  expect(chromiumExtensionManager({ userAgent: '', brands: [{ brand: 'Microsoft Edge' }] })).toBe(
    'edge://extensions/',
  );
  for (const userAgent of ['Chromium/144', 'Chrome/144', 'Firefox/144', 'Version/26 Safari/605']) {
    expect(
      chromiumExtensionManager({ userAgent, brands: [{ brand: 'Chromium' }] }),
    ).toBeUndefined();
  }
});
it.each([
  { name: '篡改猴' },
  { name: '本地化显示名称', id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo' },
  { version: '5.5.1.0', versionName: '5.5.1' },
])(
  'keeps the script button for a uniquely installed localized manager or differently formatted version: %j',
  async (metadata) => {
    fixture.getAll.mockResolvedValue([{ ...extension(), ...metadata }]);
    expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
      scriptManager: true,
    });
    await coexistenceRequest({ type: 'coexistence.open', script, target: 'script' }, sender);
    expect(fixture.create).toHaveBeenCalledWith({
      url: 'chrome-extension://actual-installed-manager/options.html#nav=dashboard',
    });
  },
);
it('uses versionName to distinguish stable and beta when both are installed', async () => {
  const stable = { ...extension(), version: '5.5.1.0', versionName: '5.5.1' };
  const beta = {
    ...extension('chrome-extension://beta/options.html'),
    name: 'Tampermonkey BETA',
    version: '5.6.1',
  };
  fixture.getAll.mockResolvedValue([stable, beta]);
  await coexistenceRequest({ type: 'coexistence.open', script, target: 'script' }, sender);
  expect(fixture.create).toHaveBeenCalledWith({
    url: 'chrome-extension://actual-installed-manager/options.html#nav=dashboard',
  });
});
it('prefers an official store ID over an unrelated extension with the same display name', async () => {
  const official = {
    ...extension('chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html'),
    id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo',
    name: '篡改猴',
  };
  fixture.getAll.mockResolvedValue([
    official,
    extension('chrome-extension://development/options.html'),
  ]);
  await coexistenceRequest({ type: 'coexistence.open', script, target: 'script' }, sender);
  expect(fixture.create).toHaveBeenCalledWith({
    url: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard',
  });
});
it('replaces an existing options hash with the dashboard destination', async () => {
  fixture.getAll.mockResolvedValue([
    extension('chrome-extension://actual-installed-manager/options.html#nav=settings'),
  ]);
  await coexistenceRequest({ type: 'coexistence.open', script, target: 'script' }, sender);
  expect(fixture.create).toHaveBeenCalledWith({
    url: 'chrome-extension://actual-installed-manager/options.html#nav=dashboard',
  });
});
it('persists dismissal across websites and versions without inspecting installed managers again', async () => {
  await coexistenceRequest({ type: 'coexistence.dismiss', script }, sender);
  fixture.get.mockResolvedValue({ url: 'https://other.example/page' });
  expect(
    await coexistenceRequest(
      { type: 'coexistence.info', script: { ...script, version: '4.0.0' } },
      {
        ...sender,
        url: 'https://other.example/page',
      },
    ),
  ).toEqual({ suppressed: true });
  expect(fixture.getAll).not.toHaveBeenCalled();
});
it('does not suppress future reminders if saving fails', async () => {
  fixture.set.mockRejectedValue(new Error('storage failed'));
  await expect(coexistenceRequest({ type: 'coexistence.dismiss', script }, sender)).rejects.toThrow(
    'storage failed',
  );
  expect(await coexistenceRequest({ type: 'coexistence.info', script }, sender)).toMatchObject({
    suppressed: false,
  });
});
it('does not accept dismissal from an unrelated sender', async () => {
  await expect(
    coexistenceRequest({ type: 'coexistence.dismiss', script }, { ...sender, id: 'other' }),
  ).rejects.toThrow('来源');
  expect(fixture.values.has(coexistenceDismissedKey)).toBe(false);
});
