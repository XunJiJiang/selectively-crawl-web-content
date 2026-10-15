import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ loaded: false }));
vi.mock('../../shared/components/index.ts', () => ({}));
vi.mock('../../shared/store/config.ts', () => ({
  ConfigController: {
    config: {
      api: { host: 'http://localhost', port: '3200', token: 'stale' },
      plugin: { refreshRule: '//' },
      notify: { placement: 'tr' },
    },
  },
}));
vi.mock('./layouts/index.ts', async () => {
  const { ConfigController } = await import('../../shared/store/config.ts');
  const { getPluginPages } = await import('./api/plugins.ts');
  await getPluginPages(ConfigController.config);
  state.loaded = true;
  return {};
});

afterEach(() => vi.unstubAllGlobals());

it('loads and saves the current token before the first plugin API request', async () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { setItem });
  vi.stubGlobal('window', { location: { href: 'http://localhost:3212/web' } });
  const fetcher = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/local-config')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { host: 'http://localhost', port: '3212', token: 'current-token' },
        }),
      };
    }
    return { json: async () => ({ success: true, data: [] }) };
  });
  vi.stubGlobal('fetch', fetcher);
  await import('./main.ts');
  await vi.waitFor(() => expect(state.loaded).toBe(true));
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('http://localhost:3212/web/api/pages?'),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer current-token' }),
    }),
  );
  const { CONFIG_KEY } = await import('../../shared/utils/common.ts');
  expect(setItem).toHaveBeenCalledWith(CONFIG_KEY, expect.any(String));
  expect(JSON.parse(setItem.mock.calls[0][1]).api.token).toBe('current-token');
});
