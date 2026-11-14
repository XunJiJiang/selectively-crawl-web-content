import { beforeEach, expect, it, vi } from 'vitest';
import { deliverNotification, saveNotificationChanges } from './notification-delivery.ts';
import { notificationStorageKey, type ExtensionNotification } from './notification-model.ts';
const mocks = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  runtime: vi.fn(),
  page: vi.fn(),
  inject: vi.fn(),
  getTab: vi.fn(),
}));
vi.mock('./browser.ts', () => ({
  browser: {
    storage: {
      local: {
        get: async () => structuredClone(mocks.values),
        set: async (values: object) => Object.assign(mocks.values, structuredClone(values)),
      },
    },
    runtime: { sendMessage: mocks.runtime },
    tabs: { get: mocks.getTab, sendMessage: mocks.page },
    scripting: { executeScript: mocks.inject },
  },
}));
beforeEach(() => {
  mocks.values = {};
  vi.clearAllMocks();
  mocks.runtime.mockRejectedValue(new Error('popup closed'));
  mocks.page.mockResolvedValue({ ok: true });
  mocks.getTab.mockResolvedValue({ id: 1, url: 'https://one.example/a' });
});
it('retains unread internal pushes when the popup is closed, without injecting a page', async () => {
  await deliverNotification(1, 'https://one.example/a', { title: '后台完成', type: 'success' });
  expect(mocks.page).not.toHaveBeenCalled();
  expect(mocks.values[notificationStorageKey]).toEqual([
    expect.objectContaining({ message: '后台完成', type: 'success', read: false, visible: false }),
  ]);
});
it('injects external pushes once and keeps shared options intact', async () => {
  mocks.page.mockRejectedValueOnce(new Error('not installed'));
  const options = {
    title: '外部通知',
    type: 'warn',
    scope: 'external',
    placement: 'bc',
    duration: 1200,
  } as const;
  const notification = {
    ...options,
    id: crypto.randomUUID(),
    pluginId: 'p',
    createdAt: Date.now(),
  };
  await deliverNotification(1, 'https://one.example/a', options, notification);
  await deliverNotification(1, 'https://one.example/a', options, notification);
  expect(mocks.inject).toHaveBeenCalledExactlyOnceWith({
    target: { tabId: 1 },
    files: ['content.js'],
  });
  expect(mocks.page).toHaveBeenLastCalledWith(1, {
    type: 'scwc.page',
    command: 'notification',
    site: 'https://one.example/a',
    notification: options,
  });
  expect(mocks.page).toHaveBeenCalledTimes(2);
});
it('merges simultaneous popup edits and background pushes without replacing unrelated history', async () => {
  const existing: ExtensionNotification = {
    id: 'old',
    message: 'old',
    type: 'info',
    createdAt: 1,
    visible: false,
    read: false,
  };
  await saveNotificationChanges([existing]);
  await Promise.all([
    saveNotificationChanges([{ ...existing, read: true }]),
    deliverNotification(1, 'https://one.example/a', { title: 'new' }),
  ]);
  expect(mocks.values[notificationStorageKey]).toEqual([
    expect.objectContaining({ id: 'old', read: true }),
    expect.objectContaining({ message: 'new' }),
  ]);
  await saveNotificationChanges([], ['old']);
  expect(mocks.values[notificationStorageKey]).toEqual([
    expect.objectContaining({ message: 'new' }),
  ]);
});
