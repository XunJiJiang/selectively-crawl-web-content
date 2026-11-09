import { beforeEach, expect, it, vi } from 'vitest';
import { installNotificationBadge } from './notification-badge.ts';
import { notificationStorageKey } from './notification-model.ts';

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  text: vi.fn(),
  background: vi.fn(),
  color: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('./browser.ts', () => ({
  browser: {
    action: {
      setBadgeText: mock.text,
      setBadgeBackgroundColor: mock.background,
      setBadgeTextColor: mock.color,
    },
    storage: { local: { get: mock.get }, onChanged: { addListener: mock.listen } },
  },
}));
const record = (read?: boolean) => ({
  id: crypto.randomUUID(),
  message: '测试',
  type: 'info',
  createdAt: 1,
  read,
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.get.mockResolvedValue({});
});
it('restores unread counts, uses native badge colors and clears the count after reads or manual removals', async () => {
  mock.get.mockResolvedValue({ [notificationStorageKey]: [record(), record(false), record(true)] });
  installNotificationBadge();
  await vi.waitFor(() => expect(mock.text).toHaveBeenLastCalledWith({ text: '2' }));
  expect(mock.background).toHaveBeenCalledWith({ color: '#1a2c33' });
  expect(mock.color).toHaveBeenCalledWith({ color: '#ffffff' });
  const changed = mock.listen.mock.calls[0][0];
  changed({ [notificationStorageKey]: { newValue: [record(true)] } }, 'local');
  await vi.waitFor(() => expect(mock.text).toHaveBeenLastCalledWith({ text: '' }));
  changed({ [notificationStorageKey]: { newValue: [record(false)] } }, 'sync');
  await Promise.resolve();
  expect(mock.text).toHaveBeenLastCalledWith({ text: '' });
});
it('does not let a slow initial storage read overwrite a newer count', async () => {
  let restore!: (value: unknown) => void;
  mock.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        restore = resolve;
      }),
  );
  installNotificationBadge();
  mock.listen.mock.calls[0][0](
    { [notificationStorageKey]: { newValue: [record(false)] } },
    'local',
  );
  await vi.waitFor(() => expect(mock.text).toHaveBeenLastCalledWith({ text: '1' }));
  restore({ [notificationStorageKey]: [] });
  await Promise.resolve();
  expect(mock.text).toHaveBeenLastCalledWith({ text: '1' });
});
