import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import type { Notification, WorkbenchEvent } from './types.ts';
import type { NotificationHost, SystemNotificationPermission } from './notification-host.ts';
vi.mock('../../../shared/store/config.ts', () => ({
  ConfigController: { config: { api: { token: '' } } },
}));
let store: WorkbenchStore;
afterEach(() => {
  store?.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  globalThis.localStorage?.clear();
});

function notice(patch: Partial<Notification> = {}): Notification {
  return {
    id: 'import-complete',
    source: 'plugin',
    pluginId: 'alpha',
    title: '导入完成',
    message: '文件已保存',
    level: 'success',
    updatedAt: new Date().toISOString(),
    readAt: null,
    count: 1,
    actions: [],
    systemNotification: true,
    ...patch,
  };
}
function systemFixture() {
  vi.useFakeTimers();
  const close = vi.fn();
  const host = {
    focus: {
      isFocused: vi.fn<NotificationHost['focus']['isFocused']>(() => false),
      focus: vi.fn(),
    },
    notifications: {
      getPermission: vi.fn((): SystemNotificationPermission => 'granted'),
      requestPermission: vi.fn(async (): Promise<SystemNotificationPermission> => 'granted'),
      show: vi.fn<NotificationHost['notifications']['show']>(() => ({ close })),
    },
  } satisfies NotificationHost;
  store = new WorkbenchStore(host);
  store.preferences.values.systemNotifications = { mode: 'browser', enabled: true, answered: true };
  vi.spyOn(store, 'setPreferences').mockImplementation(async (values) => {
    store.preferences = {
      values: { ...store.preferences.values, ...values },
      revision: store.preferences.revision + 1,
    };
    store.changed();
  });
  const event = (type: string, payload: unknown) =>
    (store as unknown as { onEvent(event: WorkbenchEvent): void }).onEvent({
      type,
      payload,
    } as WorkbenchEvent);
  return { host, close, event };
}

describe('system notification escalation', () => {
  it('requests permission immediately and reports a dismissed or blocked request', async () => {
    const { host } = systemFixture();
    host.notifications.getPermission.mockReturnValue('default');
    host.notifications.requestPermission.mockResolvedValue('default');
    const request = store.requestSystemNotificationPermission();
    expect(host.notifications.requestPermission).toHaveBeenCalledOnce();
    await request;
    expect(store.toasts[store.toasts.length - 1]?.text).toContain('权限提示中选择允许');
    host.notifications.getPermission.mockReturnValue('denied');
    host.notifications.requestPermission.mockResolvedValue('denied');
    await store.requestSystemNotificationPermission();
    expect(store.toasts[store.toasts.length - 1]?.text).toContain('浏览器的网站设置');
  });
  it('refreshes permission status when returning from external settings and stops after disposal', () => {
    systemFixture();
    const changed = vi.fn();
    store.addEventListener('change', changed);
    window.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledOnce();
    store.dispose();
    changed.mockClear();
    window.dispatchEvent(new Event('focus'));
    expect(changed).not.toHaveBeenCalled();
  });
  it('only escalates opted-in live publications while the host is unfocused', async () => {
    const { host, event } = systemFixture();
    event('notification.created', notice({ id: 'ordinary', systemNotification: false }));
    host.focus.isFocused.mockReturnValue(true);
    event('notification.created', notice({ id: 'foreground' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).not.toHaveBeenCalled();
    host.focus.isFocused.mockResolvedValue(false);
    event('notification.created', notice());
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'import-complete', title: '导入完成', message: '文件已保存' }),
    );
    expect(store.toasts).toHaveLength(3);
    expect(store.notifications.every((n) => !n.readAt)).toBe(true);
    expect(host.notifications.requestPermission).not.toHaveBeenCalled();
  });
  it.each(['default', 'denied', 'unsupported'] as const)(
    'retains in-app notifications without prompting when permission is %s',
    async (permission) => {
      const { host, event } = systemFixture();
      host.notifications.getPermission.mockReturnValue(permission);
      event('notification.created', notice());
      await vi.advanceTimersByTimeAsync(0);
      expect(host.notifications.show).not.toHaveBeenCalled();
      expect(host.notifications.requestPermission).not.toHaveBeenCalled();
      expect(store.toasts[0].notification.id).toBe('import-complete');
      const request = store.requestSystemNotificationPermission();
      expect(host.notifications.requestPermission).toHaveBeenCalledOnce();
      await request;
      host.notifications.getPermission.mockReturnValue('granted');
      expect(host.notifications.show).not.toHaveBeenCalled();
    },
  );
  it('deduplicates events and ignores progress, visibility, read changes and history loading', async () => {
    const { host, close, event } = systemFixture();
    const value = notice();
    event('notification.created', value);
    event('notification.created', value);
    event('notification.updated', { ...value, progress: 50 });
    event('notification.updated', { ...value, seenAt: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).toHaveBeenCalledOnce();
    event('notification.updated', { ...value, readAt: new Date().toISOString() });
    expect(close).toHaveBeenCalledOnce();
    event('notification.updated', { ...value, readAt: null });
    vi.spyOn(store.api, 'list').mockResolvedValue({
      items: [notice({ id: 'history' })],
      total: 1,
      nextCursor: null,
    });
    await store.loadList('notifications');
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).toHaveBeenCalledOnce();
  });
  it('treats dedupe republishes and enabling the option as new reminder opportunities', async () => {
    const { host, close, event } = systemFixture();
    const value = notice();
    event('notification.created', value);
    await vi.advanceTimersByTimeAsync(0);
    event('notification.updated', { ...value, count: 2, title: '再次完成' });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    event('notification.updated', { ...value, count: 2, systemNotification: false });
    expect(close).toHaveBeenCalledTimes(2);
    event('notification.updated', { ...value, count: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).toHaveBeenCalledTimes(3);
  });
  it('does not escalate foreground publications when later background progress arrives', async () => {
    const { host, event } = systemFixture();
    host.focus.isFocused.mockReturnValue(true);
    event('notification.created', notice({ progress: null }));
    await vi.advanceTimersByTimeAsync(0);
    host.focus.isFocused.mockReturnValue(false);
    event('notification.updated', notice({ progress: 100 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(host.notifications.show).not.toHaveBeenCalled();
  });
  it('raises the host and reveals the notification on click without marking it read', async () => {
    const { host, close, event } = systemFixture();
    const reveal = vi.fn();
    store.addEventListener('reveal-notification', reveal);
    event('notification.created', notice({ autoRead: false }));
    await vi.advanceTimersByTimeAsync(0);
    host.notifications.show.mock.calls[0][0].onClick();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.focus.focus).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
    expect((reveal.mock.calls[0][0] as CustomEvent).detail).toBe('import-complete');
    expect(store.toasts).toHaveLength(0);
    expect(store.notificationItems[0].readAt).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['read', 'delete', 'disable', 'dispose'] as const)(
    'cancels a pending asynchronous focus query on %s',
    async (action) => {
      const { host, event } = systemFixture();
      let resolveFocus!: (focused: boolean) => void;
      host.focus.isFocused.mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveFocus = resolve;
        }),
      );
      event('notification.created', notice());
      if (action === 'read') {
        event('notification.updated', { ids: ['import-complete'] });
      } else if (action === 'delete') {
        event('notification.updated', { ids: ['import-complete'], deleted: true });
      } else if (action === 'disable') {
        event('notification.updated', notice({ systemNotification: false }));
      } else {
        store.dispose();
      }
      resolveFocus(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(host.notifications.show).not.toHaveBeenCalled();
    },
  );
  it('closes a native handle that arrives after disposal and ignores stale clicks', async () => {
    const { host, close, event } = systemFixture();
    let finish!: (handle: { close(): void }) => void;
    host.notifications.show.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    event('notification.created', notice());
    await vi.advanceTimersByTimeAsync(0);
    const click = host.notifications.show.mock.calls[0][0].onClick;
    store.dispose();
    finish({ close });
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    click();
    expect(host.focus.focus).not.toHaveBeenCalled();
  });
  it('keeps in-app delivery working when a native notification fails', async () => {
    const { host, event } = systemFixture();
    host.notifications.show.mockRejectedValue(new Error('native service unavailable'));
    event('notification.created', notice());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.toasts[0].text).toBe('导入完成');
    expect(store.notifications[0].readAt).toBeNull();
  });
});
describe('toast history and reading', () => {
  it('keeps a controlled loading notification alive and updates it without reopening', async () => {
    vi.useFakeTimers();
    store = new WorkbenchStore();
    const notification: Notification = {
      id: 'controlled',
      source: 'plugin',
      pluginId: 'alpha',
      title: '开始',
      message: '',
      level: 'info',
      updatedAt: new Date().toISOString(),
      readAt: null,
      count: 1,
      actions: [],
      progress: null,
      autoRead: false,
    };
    vi.spyOn(store.api, 'request').mockResolvedValue({});
    store.notifications = [notification];
    store.toast(notification.title, notification.level, notification);
    store.focusToast(notification.id, true);
    store.focusToast(notification.id, false);
    await vi.advanceTimersByTimeAsync(7000);
    expect(store.toasts).toHaveLength(1);
    expect(notification.readAt).toBeNull();
    const event = (value: unknown) =>
      (store as unknown as { onEvent(event: WorkbenchEvent): void }).onEvent({
        type: 'notification.updated',
        payload: value,
      } as WorkbenchEvent);
    event({ ...notification, title: '一半', progress: 50 });
    expect(store.toasts[0].text).toBe('一半');
    expect(store.toasts[0].notification.progress).toBe(50);
    await vi.advanceTimersByTimeAsync(7000);
    expect(store.toasts).toHaveLength(1);
    event({ ...notification, title: '完成', progress: 100 });
    await vi.advanceTimersByTimeAsync(6000);
    expect(store.toasts).toHaveLength(0);
    expect(store.notificationItems[0].title).toBe('完成');
    event({ ids: [notification.id], deleted: true });
    expect(store.notificationItems).toHaveLength(0);
  });
  it('archives expired messages, excludes dismissed messages and pauses focused messages', async () => {
    vi.useFakeTimers();
    store = new WorkbenchStore();
    store.toast('expired');
    store.toast('dismissed');
    store.dismissToast(store.toasts[1].id);
    store.toast('focused');
    const id = store.toasts[1].id;
    store.focusToast(id, true);
    await vi.advanceTimersByTimeAsync(7000);
    expect(store.toasts.map((t) => t.text)).toEqual(['focused']);
    expect(store.notificationItems.map((n) => n.title)).toEqual(['expired']);
    expect(store.notificationItems[0].readAt).toBeNull();
    store.focusToast(id, false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(store.notificationItems.find((n) => n.id === id)?.readAt).toBeTruthy();
    await store.ackNotifications(store.notificationItems.map((n) => n.id));
    expect(store.notificationItems.every((n) => n.readAt)).toBe(true);
  });
});
