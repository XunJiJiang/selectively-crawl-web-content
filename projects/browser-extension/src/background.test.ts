import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageSender } from './browser.ts';
import {
  initialSettings,
  initialSnapshot,
  navigationKey,
  settingsKey,
  siteKey,
  toWire,
} from './model.ts';
import type { Init } from './background.ts';

const fixture = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  listener: undefined as
    | ((input: unknown, sender: MessageSender, respond: (reply: unknown) => void) => void)
    | undefined,
  core: vi.fn(),
  runtime: vi.fn(async () => undefined),
  removed: undefined as ((tab: number) => void) | undefined,
}));
vi.mock('./core.ts', () => ({
  requestCore: fixture.core,
  pendingVersionNotice: undefined,
  dismissVersionNotice: vi.fn(),
}));
vi.mock('./browser.ts', () => ({
  browser: {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      sendMessage: fixture.runtime,
      onMessage: {
        addListener: (listener: typeof fixture.listener) => {
          fixture.listener = listener;
        },
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: fixture.values.get(key) }),
        set: async (input: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(input)) {
            fixture.values.set(key, value);
          }
        },
        remove: async (key: string) => {
          fixture.values.delete(key);
        },
      },
    },
    tabs: {
      get: async () => ({ id: 1, url: 'https://one.example/article' }),
      query: async () => [{ id: 1, url: 'https://one.example/article' }],
      onRemoved: {
        addListener: (listener: (tab: number) => void) => {
          fixture.removed = listener;
        },
      },
      onUpdated: { addListener: vi.fn() },
    },
  },
}));
beforeAll(async () => {
  await import('./background.ts');
});
beforeEach(() => {
  fixture.values.clear();
  fixture.core.mockReset();
});
function message(input: unknown, sender: MessageSender) {
  return new Promise<{ ok: boolean; error?: string; errorCode?: string; data?: unknown }>(
    (resolve) => {
      fixture.listener?.(input, sender, (reply) =>
        resolve(reply as { ok: boolean; error?: string; errorCode?: string }),
      );
    },
  );
}
describe('background message trust boundary', () => {
  it.each(['settings.save', 'settings.patch'])(
    '%s repairs a stored theme-only record',
    async (type) => {
      const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
      const site = 'https://one.example/article';
      const { config } = initialSettings();
      config.api = { host: 'https://core.example', port: '443', token: 'site-token' };
      const snapshot = initialSnapshot(site, config);
      fixture.values.set(siteKey(site), snapshot);
      fixture.values.set(settingsKey, { theme: 'light-2026' });

      expect((await message({ type: 'init' }, popup)).data).toMatchObject({
        settings: { ...initialSettings(), theme: 'light-2026' },
        snapshot,
      });
      const saved = await message({ type, settings: { theme: 'dark-2026' } }, popup);
      expect(saved).toMatchObject({ ok: true, data: { settings: initialSettings() } });
      expect(fixture.values.get(settingsKey)).toEqual(initialSettings());
      expect(fixture.values.get(siteKey(site))).toEqual(snapshot);
    },
  );
  it('saves both navigation levels through the popup boundary and returns them on init', async () => {
    const site = 'https://one.example/other';
    const navigation = { panel: 'plugins', activePlugin: 'second' };
    const request = { type: 'navigation.save', site, navigation };
    expect(
      (
        await message(request, {
          id: 'test-extension',
          url: site,
          tab: { id: 1 },
        })
      ).ok,
    ).toBe(false);
    expect(fixture.values.has(navigationKey(site))).toBe(false);
    const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
    expect((await message(request, popup)).ok).toBe(true);
    const reply = await message({ type: 'init' }, popup);
    expect((reply.data as Init).navigation).toEqual(navigation);
    expect(fixture.core).not.toHaveBeenCalled();
  });
  it('receives unsolicited messages after popup requests finish and reconnects the background socket', async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      readyState = 0;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      onopen?: () => void;
      url: string;
      constructor(url: string | URL) {
        this.url = String(url);
        sockets.push(this);
      }
      send() {
        /* Mock browser transport. */
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    try {
      const site = 'https://one.example/article';
      fixture.core.mockResolvedValue({
        data: {
          snapshot: toWire(initialSnapshot(site, initialSettings().config)),
          ticket: 'ticket',
          cursor: 'boot:0',
          notifications: [],
        },
      });
      const reply = await message(
        { type: 'core.sync', site },
        { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' },
      );
      expect(reply.ok).toBe(true);
      expect(sockets[0].url).toContain('/api/userscript/config/events?ticket=ticket');
      sockets[0].readyState = 1;
      sockets[0].onopen?.();
      sockets[0].onmessage?.({
        data: JSON.stringify({
          type: 'notification',
          notification: { id: 'push', title: '主动通知', pluginId: 'p', createdAt: Date.now() },
        }),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.runtime).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'notification.received',
          record: expect.objectContaining({ message: '主动通知' }),
        }),
      );
      sockets[0].close();
      await vi.advanceTimersByTimeAsync(2000);
      expect(sockets).toHaveLength(2);
    } finally {
      fixture.removed?.(1);
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it('rejects core and settings requests from content scripts or a forged extension page', async () => {
    const fromContent = {
      id: 'test-extension',
      url: 'https://one.example/article',
      tab: { id: 1 },
    };
    expect(
      (await message({ type: 'core.sync', site: 'https://one.example' }, fromContent)).ok,
    ).toBe(false);
    expect(
      (
        await message(
          { type: 'settings.save', settings: {} },
          { id: 'test-extension', url: 'https://malicious.example/index.html' },
        )
      ).ok,
    ).toBe(false);
    expect(fixture.core).not.toHaveBeenCalled();
  });
  it('only accepts a selection from the current document of its own content script', async () => {
    const draft = { site: 'https://one.example/article', selector: '#article', depth: 1 };
    const sender = { id: 'test-extension', url: draft.site, tab: { id: 1 } };
    expect((await message({ type: 'picker.selection', draft }, sender)).ok).toBe(true);
    expect(fixture.values.get('scwc.extension.selection.v1:1')).toEqual(draft);
    expect(
      (
        await message(
          { type: 'picker.selection', draft: { ...draft, site: 'https://other.example' } },
          sender,
        )
      ).ok,
    ).toBe(false);
    expect(
      (await message({ type: 'picker.selection', draft }, { ...sender, id: 'other-extension' })).ok,
    ).toBe(false);
  });
  it('stops automatic sync after three failures and lets a changed core address retry', async () => {
    const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
    const site = 'https://one.example/article';
    fixture.core.mockRejectedValue(new Error('unauthorized'));

    const first = await message({ type: 'core.sync', site }, popup);
    const second = await message({ type: 'core.sync', site }, popup);
    const third = await message({ type: 'core.sync', site }, popup);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(third.errorCode).toBe('CORE_SYNC_BLOCKED');
    expect(fixture.core).toHaveBeenCalledTimes(3);

    const blocked = await message({ type: 'core.sync', site }, popup);
    expect(blocked.errorCode).toBe('CORE_SYNC_BLOCKED');
    expect(fixture.core).toHaveBeenCalledTimes(3);

    const otherRequest = await message(
      {
        type: 'plugin.event',
        tab: 1,
        site,
        plugin: 'test',
        requireFullContent: false,
        request: { readOnly: true, fields: {} },
      },
      popup,
    );
    expect(otherRequest.error).toBe('unauthorized');
    expect(fixture.core).toHaveBeenCalledTimes(4);

    const settings = initialSettings();
    settings.config.api.host = 'http://other.example';
    await message({ type: 'settings.save', settings }, popup);
    expect((await message({ type: 'init' }, popup)).ok).toBe(true);

    fixture.core.mockResolvedValue({
      data: { snapshot: toWire(initialSnapshot(site, settings.config)) },
    });
    expect((await message({ type: 'core.sync', site }, popup)).ok).toBe(true);
    expect(fixture.core).toHaveBeenCalledTimes(5);
  });
  it('retries a new popup startup three times after a prior circuit pause', async () => {
    const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
    const site = 'https://one.example/article';
    fixture.core.mockRejectedValue(new TypeError('Failed to fetch'));
    await message({ type: 'core.sync', site }, popup);
    await message({ type: 'core.sync', site }, popup);
    await message({ type: 'core.sync', site }, popup);
    expect(fixture.core).toHaveBeenCalledTimes(3);

    vi.useFakeTimers();
    try {
      const startup = message({ type: 'core.sync', site, mode: 'startup' }, popup);
      await vi.runAllTimersAsync();
      const reply = await startup;
      expect(reply.errorCode).toBe('CORE_SYNC_BLOCKED');
      expect(fixture.core).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });
  it('allows one user request through the paused circuit and resets it on success', async () => {
    const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
    const site = 'https://one.example/article';
    fixture.core.mockRejectedValue(new TypeError('Failed to fetch'));
    await message({ type: 'core.sync', site }, popup);
    await message({ type: 'core.sync', site }, popup);
    await message({ type: 'core.sync', site }, popup);

    fixture.core
      .mockResolvedValueOnce({ data: { result: [] } })
      .mockResolvedValueOnce({
        data: { snapshot: toWire(initialSnapshot(site, initialSettings().config)) },
      });
    const reply = await message(
      {
        type: 'plugin.event',
        tab: 1,
        site,
        plugin: 'test',
        requireFullContent: false,
        request: { readOnly: true, fields: {} },
      },
      popup,
    );
    expect(reply.ok).toBe(true);
    expect(fixture.core).toHaveBeenCalledTimes(4);
    expect((await message({ type: 'core.sync', site }, popup)).ok).toBe(true);
    expect(fixture.core).toHaveBeenCalledTimes(5);
  });
});
