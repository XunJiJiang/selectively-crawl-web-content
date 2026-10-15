import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TConfig } from '../../../shared/types/config.d.ts';
import { loadLocalConfig } from './local-config.ts';

const config: TConfig = {
  api: { host: 'http://localhost', port: '3200', token: 'previous-token' },
  plugin: { refreshRule: '//' },
  notify: { placement: 'bl' },
};

afterEach(() => vi.unstubAllGlobals());

function openPage(href: string) {
  vi.stubGlobal('window', { location: { href } });
}

describe('load local startup configuration', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'loads the current token from the page origin on %s and preserves other settings',
    async (hostname) => {
      openPage(`http://${hostname}:3212/web`);
      const api = { host: `http://${hostname}`, port: '3212', token: 'current-token' };
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: api }),
      });
      vi.stubGlobal('fetch', fetcher);
      expect(await loadLocalConfig(config)).toEqual({ ...config, api });
      expect(config.api.token).toBe('previous-token');
      expect(fetcher).toHaveBeenCalledWith(
        `http://${hostname}:3212/web/local-config`,
        expect.objectContaining({ mode: 'same-origin', cache: 'no-store', redirect: 'error' }),
      );
    },
  );

  it.each(['https://example.com/web', 'http://192.168.1.2:3200/web', 'file:///web/index.html'])(
    'keeps manual configuration without a request on %s',
    async (url) => {
      openPage(url);
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      expect(await loadLocalConfig(config)).toBe(config);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ok: false },
    { ok: true, json: async () => ({ success: false }) },
    { ok: true, json: async () => ({ success: true, data: { token: 'invalid' } }) },
    {
      ok: true,
      json: async () => ({
        success: true,
        data: { host: 'http://localhost', port: '3201', token: 'wrong-port' },
      }),
    },
  ])('keeps manual configuration if the response is denied or invalid', async (response) => {
    openPage('http://localhost:3200/web');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await loadLocalConfig(config)).toBe(config);
  });

  it('keeps manual configuration on network failure or timeout', async () => {
    openPage('http://localhost:3200/web');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    expect(await loadLocalConfig(config)).toBe(config);
  });

  it('accepts an explicitly disabled token', async () => {
    openPage('http://localhost:3200/web');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { ...config.api, token: '' } }),
      }),
    );
    expect((await loadLocalConfig(config)).api.token).toBe('');
  });
});
