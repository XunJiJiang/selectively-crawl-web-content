import { browser } from './browser.ts';
import { notificationStorageKey, readNotifications } from './notification-model.ts';

/** 由后台持有角标，弹窗关闭或 MV3 Worker 重启后也从本地历史恢复。 */
export function installNotificationBadge() {
  const action = browser.action;
  if (!action) {
    return;
  }
  let revision = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const update = (records: unknown) => {
    const unread = readNotifications(records).filter((entry) => !entry.read).length;
    tail = tail
      .then(async () => {
        await action.setBadgeBackgroundColor({ color: '#1a2c33' });
        await action.setBadgeTextColor?.({ color: '#ffffff' });
        await action.setBadgeText({ text: unread ? String(unread) : '' });
      })
      .catch(() => undefined);
  };
  browser.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && notificationStorageKey in changes) {
      revision++;
      update(changes[notificationStorageKey].newValue);
    }
  });
  void browser.storage.local
    .get(notificationStorageKey)
    .then((saved) => {
      if (revision === 0) {
        update(saved[notificationStorageKey]);
      }
    })
    .catch(() => undefined);
}
