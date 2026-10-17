export interface NotificationOptions {
  message?: string;
  dedupeKey?: string;
  target?: { pluginPath: string };
}
export interface NotificationLogger {
  info(title: string, options?: NotificationOptions): void;
  success(title: string, options?: NotificationOptions): void;
  warn(title: string, options?: NotificationOptions): void;
  error(title: string, options?: NotificationOptions): void;
}
