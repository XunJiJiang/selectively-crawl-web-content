import { browser } from './browser.ts';
import {
  notificationStorageKey,
  readNotifications,
  type ExtensionNotification,
} from './notification-model.ts';
import type { SiteNotificationOptions, SiteNotification } from '../../shared/site-notifications.ts';

let writes: Promise<unknown> = Promise.resolve();
const delivered = new Set<string>();
/** One background writer prevents popup edits from overwriting concurrently pushed records. */
export function saveNotificationChanges(upsert: ExtensionNotification[], remove: string[] = []) {
  const work = writes.then(async () => {
    const records = new Map(
      readNotifications(
        (await browser.storage.local.get(notificationStorageKey))[notificationStorageKey],
      ).map((record) => [record.id, record]),
    );
    for (const id of remove) {
      records.delete(id);
    }
    for (const record of upsert) {
      records.set(record.id, { ...record, visible: false });
    }
    await browser.storage.local.set({
      [notificationStorageKey]: [...records.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-1000),
    });
  });
  writes = work.catch(() => undefined);
  return work;
}
export async function deliverNotification(
  tab: number | undefined,
  site: string,
  options: SiteNotificationOptions,
  notification?: SiteNotification,
) {
  const deliveryKey = notification ? `${notification.id}:${tab}` : undefined;
  if (notification && deliveryKey && delivered.has(deliveryKey)) {
    return notification.id;
  }
  if (deliveryKey) {
    delivered.add(deliveryKey);
  }
  const record: ExtensionNotification = {
    id: notification?.id ?? crypto.randomUUID(),
    message: options.description ? `${options.title}\n${options.description}` : options.title,
    type: options.type ?? 'info',
    createdAt: notification?.createdAt ?? Date.now(),
    read: false,
    visible: false,
  };
  try {
    await saveNotificationChanges([record]);
  } catch (error) {
    if (deliveryKey) {
      delivered.delete(deliveryKey);
    }
    throw error;
  }
  if (deliveryKey) {
    if (delivered.size > 2000) {
      const oldest = delivered.values().next().value;
      if (oldest) {
        delivered.delete(oldest);
      }
    }
  }
  if (options.scope === 'external') {
    if (tab === undefined) {
      throw new Error('外部通知需要可访问的网页标签');
    }
    const current = await browser.tabs.get(tab);
    if (current.url !== site) {
      throw new Error('网页地址已变化，通知已保存在历史中');
    }
    try {
      await browser.tabs.sendMessage(tab, { type: 'scwc.page', command: 'ping' });
    } catch {
      await browser.scripting.executeScript({ target: { tabId: tab }, files: ['content.js'] });
    }
    const result = await browser.tabs.sendMessage<{ ok: boolean; error?: string }>(tab, {
      type: 'scwc.page',
      command: 'notification',
      site,
      notification: options,
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? '网页通知显示失败');
    }
  }
  // A closed popup leaves an unread history entry and badge; opening it does not replay banners.
  await browser.runtime
    .sendMessage({ type: 'notification.received', record, options })
    .catch(() => undefined);
  return record.id;
}
