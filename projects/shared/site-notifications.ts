import type { INotifyOptions } from './types/notify.d.ts';
export type NotificationScope = 'internal' | 'external';
/** Scope applies to browser extensions; userscripts always render in the page. */
export interface SiteNotificationOptions extends Omit<
  INotifyOptions,
  'onclose' | 'onclick' | 'actions'
> {
  scope?: NotificationScope;
}
export interface SiteNotification extends SiteNotificationOptions {
  id: string;
  pluginId: string;
  createdAt: number;
}
export interface SiteNotificationBatch {
  cursor: string;
  notifications: SiteNotification[];
}
export interface SiteNotifications {
  /** Send to connected scripts/extensions of the HTTP(S) website origin. */
  notify(site: string, options: SiteNotificationOptions): Promise<string>;
}
