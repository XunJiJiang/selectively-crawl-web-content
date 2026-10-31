import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT } from '../common/paths.ts';
import { notificationIconFile } from './notification-icon.ts';
import { prepareMacNotificationHelper } from './mac-notification-helper.ts';

export interface CoreNotificationHandle {
  close(): void;
}
export interface CoreNotificationHost {
  supported(): boolean;
  isFocused?(): boolean | Promise<boolean>;
  activateNotification?(id: string): void | Promise<void>;
  show(value: {
    id: string;
    title: string;
    message: string;
    isCurrent?(): boolean;
    onClick(): void;
    onError(error: unknown): void;
  }): CoreNotificationHandle | Promise<CoreNotificationHandle>;
}
interface Notifier {
  notify(
    options: Record<string, unknown>,
    callback: (error?: unknown, response?: unknown, metadata?: { activationType?: string }) => void,
  ): void;
  clearAll?(): void;
}
interface NotifierModule {
  NotificationCenter: new (options?: Record<string, unknown>) => Notifier;
  WindowsToaster: new () => Notifier;
  NotifySend: new () => Notifier;
}
const requireNative = createRequire(path.join(SERVER_ROOT, 'core.cjs'));
let macHelper: Promise<string> | undefined;
async function macNotificationHelper(icon: string) {
  const source = path.join(
    path.dirname(requireNative.resolve('node-notifier/package.json')),
    'vendor/mac.noindex/terminal-notifier.app',
  );
  return (macHelper ??= prepareMacNotificationHelper(source, icon).catch((error) => {
    macHelper = undefined;
    throw error;
  }));
}
let nativeId = Date.now() % 0x3fffffff;
export function nativeNotificationHost(): CoreNotificationHost {
  return {
    supported: () =>
      process.platform === 'darwin' ||
      process.platform === 'win32' ||
      (process.platform === 'linux' &&
        ['/usr/bin/notify-send', '/usr/local/bin/notify-send'].some(existsSync)),
    async show(value) {
      const icon = await notificationIconFile();
      const library = requireNative('node-notifier') as NotifierModule;
      const mac = process.platform === 'darwin';
      const notifier = mac
        ? new library.NotificationCenter({ customPath: await macNotificationHelper(icon) })
        : process.platform === 'win32'
          ? new library.WindowsToaster()
          : new library.NotifySend();
      if (value.isCurrent && !value.isCurrent()) return { close() {} };
      const id = ++nativeId;
      let closed = false;
      notifier.notify(
        {
          title: value.title,
          message: value.message || value.title,
          icon,
          contentImage: icon,
          group: `scwc:${value.id}`,
          id,
          actions: ['打开工作台'],
          timeout: 30,
          appName: process.platform === 'linux' ? 'SCWC' : undefined,
        },
        (error, _response, metadata) => {
          if (closed) return;
          if (error)
            value.onError(
              mac &&
                /Notifications are not allowed|Permission to send notifications was declined/i.test(
                  String(error),
                )
                ? Object.assign(
                    new Error(
                      'macOS 尚未允许 SCWC 发送通知。请在“系统设置 → 通知 → SCWC”中开启通知；如果刚更新了内核，请重启内核后再尝试。',
                    ),
                    { cause: error },
                  )
                : error,
            );
          else if (
            metadata &&
            [
              'contentsClicked',
              'actionClicked',
              'activated',
              'click',
              'clicked',
              'buttonClicked',
              '打开工作台',
            ].includes(metadata.activationType ?? '')
          )
            value.onClick();
        },
      );
      return {
        close() {
          if (closed) return;
          closed = true;
          notifier.clearAll?.();
          if (mac || process.platform === 'win32') {
            notifier.notify(mac ? { remove: `scwc:${value.id}` } : { remove: id }, () => undefined);
          }
        },
      };
    },
  };
}
