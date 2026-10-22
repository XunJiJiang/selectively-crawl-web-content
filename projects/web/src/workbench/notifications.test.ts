import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
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
