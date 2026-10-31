export type SystemNotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface ApplicationFocus {
  /** Desktop hosts may query their native window over IPC. */
  isFocused(): boolean | Promise<boolean>;
  focus(): void | Promise<void>;
}
export interface SystemNotificationHandle {
  close(): void;
}
export interface SystemNotificationProvider {
  getPermission(): SystemNotificationPermission;
  /** Called directly from a user gesture, never while receiving a notification. */
  requestPermission(): Promise<SystemNotificationPermission>;
  show(value: {
    id: string;
    title: string;
    message: string;
    onClick(): void;
  }): SystemNotificationHandle | Promise<SystemNotificationHandle>;
}
export interface NotificationHost {
  focus: ApplicationFocus;
  notifications: SystemNotificationProvider;
}

/** Browser APIs are confined to this adapter; desktop hosts can replace both capabilities. */
export function browserNotificationHost(): NotificationHost {
  const getPermission = (): SystemNotificationPermission =>
    window.isSecureContext && typeof window.Notification === 'function'
      ? window.Notification.permission
      : 'unsupported';
  return {
    focus: {
      isFocused: () => document.visibilityState !== 'hidden' && document.hasFocus(),
      focus: () => window.focus(),
    },
    notifications: {
      getPermission,
      async requestPermission() {
        const permission = getPermission();
        return permission === 'default' ? window.Notification.requestPermission() : permission;
      },
      show({ id, title, message, onClick }) {
        const notification = new window.Notification(title, { body: message, tag: `scwc:${id}` });
        const handle = {
          close() {
            notification.onclick = null;
            notification.close();
          },
        };
        notification.onclick = () => {
          handle.close();
          onClick();
        };
        return handle;
      },
    },
  };
}
