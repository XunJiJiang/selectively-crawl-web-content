import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import type { Notification, WorkbenchEvent } from './types.ts';
vi.mock('../../../shared/store/config.ts', () => ({
  ConfigController: { config: { api: { token: '' } } },
}));
let store: WorkbenchStore;
afterEach(() => {
  store?.dispose();
  vi.useRealTimers();
  globalThis.localStorage?.clear();
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
