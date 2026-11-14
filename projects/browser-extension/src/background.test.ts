import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageSender } from './browser.ts';
import { initialSettings, initialSnapshot, toWire } from './model.ts';

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
  return new Promise<{ ok: boolean; error?: string; errorCode?: string }>((resolve) => {
    fixture.listener?.(input, sender, (reply) =>
      resolve(reply as { ok: boolean; error?: string; errorCode?: string }),
    );
  });
}
describe('background message trust boundary', () => {
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
  it('stops core requests after three sync failures and resets when the token changes', async () => {
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
    expect(otherRequest.errorCode).toBe('CORE_SYNC_BLOCKED');
    expect(fixture.core).toHaveBeenCalledTimes(3);

    const settings = initialSettings();
    settings.config.api.token = 'correct-token';
    await message({ type: 'settings.save', settings }, popup);
    expect((await message({ type: 'init' }, popup)).ok).toBe(true);

    fixture.core.mockResolvedValue({
      data: { snapshot: toWire(initialSnapshot(site, settings.config)) },
    });
    expect((await message({ type: 'core.sync', site }, popup)).ok).toBe(true);
    expect(fixture.core).toHaveBeenCalledTimes(4);
  });
});
