import type { VersionNotice } from '../../shared/client-version.ts';

export type NotificationType = 'info' | 'success' | 'warn' | 'error';
export interface ExtensionNotification {
  id: string;
  message: string;
  type: NotificationType;
  createdAt: number;
  visible: boolean;
  read: boolean;
  versionNotice?: VersionNotice;
}
export const notificationStorageKey = 'scwc.extension.notifications.v1';

export function readNotifications(input: unknown): ExtensionNotification[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.message === 'string' &&
        ['info', 'success', 'warn', 'error'].includes(entry.type) &&
        typeof entry.createdAt === 'number' &&
        Number.isFinite(entry.createdAt) &&
        Math.abs(entry.createdAt) <= 8.64e15,
    )
    .map((entry) => ({ ...entry, visible: false, read: entry.read === true }))
    .sort((a, b) => a.createdAt - b.createdAt);
}
