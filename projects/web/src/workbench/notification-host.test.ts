import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserNotificationHost } from './notification-host.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser notification host', () => {
  it.each([
    ['visible', true, true],
    ['visible', false, false],
    ['hidden', true, false],
    ['hidden', false, false],
  ] as const)(
    'checks page visibility %s and document focus %s',
    (visibility, focused, expected) => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility);
      vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
      expect(browserNotificationHost().focus.isFocused()).toBe(expected);
    },
  );
  it('requires support and a secure context, and requests permission only explicitly', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', undefined);
    const host = browserNotificationHost();
    expect(host.notifications.getPermission()).toBe('unsupported');
    const request = vi.fn(async () => 'granted' as const);
    class BrowserNotification {
      close() {
        /* Native constructor placeholder; this test only exercises permission. */
      }
      static permission = 'default';
      static requestPermission = request;
    }
    vi.stubGlobal('Notification', BrowserNotification);
    expect(host.notifications.getPermission()).toBe('default');
    expect(request).not.toHaveBeenCalled();
    expect(await host.notifications.requestPermission()).toBe('granted');
    expect(request).toHaveBeenCalledOnce();
    BrowserNotification.permission = 'denied';
    expect(await host.notifications.requestPermission()).toBe('denied');
    expect(request).toHaveBeenCalledOnce();
    vi.stubGlobal('isSecureContext', false);
    expect(await host.notifications.requestPermission()).toBe('unsupported');
  });
  it('maps title, body and stable tag to the browser, closes on click and delegates focus', async () => {
    const close = vi.fn();
    const create = vi.fn();
    let clicked: (() => void) | null = null;
    class BrowserNotification {
      constructor(title: string, options: NotificationOptions) {
        create(title, options);
      }
      set onclick(value: (() => void) | null) {
        clicked = value;
      }
      close = close;
    }
    vi.stubGlobal('Notification', BrowserNotification);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    const onClick = vi.fn();
    const host = browserNotificationHost();
    const handle = await host.notifications.show({
      id: 'one',
      title: '完成',
      message: '已保存',
      onClick,
    });
    expect(create).toHaveBeenCalledExactlyOnceWith('完成', { body: '已保存', tag: 'scwc:one' });
    expect(clicked).not.toBeNull();
    (clicked as unknown as () => void)();
    expect(close).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    expect(clicked).toBeNull();
    await host.focus.focus();
    expect(focus).toHaveBeenCalledOnce();
    handle.close();
  });
});
