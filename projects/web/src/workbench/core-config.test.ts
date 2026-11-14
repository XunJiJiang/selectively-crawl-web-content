import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createCoreConfigSubscriptions } from '../../../webutils/lib/core-config.ts';
import {
  CORE_WEB_THEME_TOKENS,
  type CoreWebConfigMessage,
  type CoreWebTheme,
} from '../../../shared/core-web-config.ts';
import type { InstancePort } from '../../../shared/workbench-protocol.ts';

const snapshot = (revision: number, mode = 'dark-2026'): CoreWebConfigMessage => ({
  channel: 'theme',
  revision,
  value: {
    preference: 'system',
    mode,
    tokens: Object.fromEntries(
      CORE_WEB_THEME_TOKENS.map((key) => [key, '#123456']),
    ) as CoreWebTheme['tokens'],
  },
});
function connection() {
  let resolve!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise<unknown>((done) => {
        resolve = done;
      }),
  );
  const event = vi.fn();
  return {
    port: { request, event } as unknown as InstancePort,
    request,
    event,
    reply: (value: unknown) => resolve(value),
  };
}

describe('typed opt-in core Web configuration', () => {
  it('registers before connection and rejects an older initial response after a live change', async () => {
    const client = createCoreConfigSubscriptions(true),
      wire = connection(),
      listener = vi.fn();
    const stop = client.api.subscribe('theme', (theme) => {
      expectTypeOf(theme).toEqualTypeOf<CoreWebTheme>();
      listener(theme);
    });
    expect(wire.request).not.toHaveBeenCalled();
    client.connect(wire.port);
    expect(wire.request).toHaveBeenCalledWith('core-config.subscribe', { channel: 'theme' });
    client.receive(snapshot(2, 'light-2026'));
    wire.reply(snapshot(0));
    await Promise.resolve();
    expect(listener.mock.calls.map(([theme]) => theme.mode)).toEqual(['light-2026']);
    client.receive(snapshot(2));
    const second = vi.fn(),
      stopSecond = client.api.subscribe('theme', second);
    expect(second).toHaveBeenCalledWith(snapshot(2, 'light-2026').value);
    expect(wire.request).toHaveBeenCalledTimes(1);
    stop();
    expect(wire.event).not.toHaveBeenCalled();
    stopSecond();
    expect(wire.event).toHaveBeenCalledWith('core-config.unsubscribe', { channel: 'theme' });
    client.receive(snapshot(3));
    expect(second).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('re-registers on connection replacement and discards replies from the retired connection', async () => {
    const client = createCoreConfigSubscriptions(true),
      old = connection(),
      next = connection(),
      listener = vi.fn();
    client.api.subscribe('theme', listener);
    client.connect(old.port);
    client.receive(snapshot(50));
    client.connect(next.port);
    old.reply(snapshot(100));
    next.reply(snapshot(0, 'future-style'));
    await Promise.resolve();
    expect(listener.mock.calls.map(([theme]) => theme.mode)).toEqual(['dark-2026', 'future-style']);
    expect(next.request).toHaveBeenCalledTimes(1);
    client.dispose();
    client.receive(snapshot(1));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => client.api.subscribe('theme', listener)).toThrow('已释放');
  });

  it('does not register cancelled listeners or alter DOM, and isolates listener failures and values', async () => {
    const client = createCoreConfigSubscriptions(true),
      wire = connection();
    client.api.subscribe('theme', vi.fn())();
    client.connect(wire.port);
    expect(wire.request).not.toHaveBeenCalled();
    const before = document.documentElement.outerHTML;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.api.subscribe('theme', (theme) => {
      // @ts-expect-error Public snapshots are immutable.
      theme.mode = 'tampered';
    });
    const received = vi.fn();
    client.api.subscribe('theme', received);
    const value = snapshot(0);
    client.receive(value);
    expect(received).toHaveBeenCalledWith(snapshot(0).value);
    expect(error).toHaveBeenCalledTimes(1);
    expect(document.documentElement.outerHTML).toBe(before);
    client.receive({ ...snapshot(1), channel: 'token' });
    client.receive({ ...snapshot(1), value: { mode: 'dark-2026', tokens: {} } });
    expect(received).toHaveBeenCalledTimes(1);
    client.dispose();
    wire.reply(snapshot(2));
    await Promise.resolve();
    expect(received).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('advertises only supported channels and requires a hosting workbench', () => {
    const client = createCoreConfigSubscriptions(true);
    // @ts-expect-error Private preferences are not exposed configuration channels.
    expect(() => client.api.subscribe('keybindings', () => undefined)).toThrow('未公开');
    const standalone = createCoreConfigSubscriptions(false);
    expect(() => standalone.api.subscribe('theme', () => undefined)).toThrow('工作台内');
    client.dispose();
    standalone.dispose();
  });
});
