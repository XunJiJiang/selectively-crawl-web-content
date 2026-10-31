import type { NotificationState } from '../../../shared/workbench-feedback.ts';
import type { NotificationHost, SystemNotificationHandle } from './notification-host.ts';

interface Delivery {
  count: number;
  cancelled: boolean;
  handle?: SystemNotificationHandle;
}

/** Receives live publications only; notification history never triggers system alerts. */
export class SystemNotifications {
  private host: NotificationHost;
  private activate: (id: string) => void;
  private deliveries = new Map<string, Delivery>();
  private disposed = false;
  constructor(host: NotificationHost, activate: (id: string) => void) {
    this.host = host;
    this.activate = activate;
  }
  publish(value: NotificationState, enabledByUpdate = false) {
    if (
      this.disposed ||
      !value.systemNotification ||
      value.readAt ||
      (!enabledByUpdate && (this.deliveries.get(value.id)?.count ?? 0) >= value.count)
    ) {
      return;
    }
    this.close([value.id]);
    const delivery: Delivery = { count: value.count, cancelled: false };
    this.deliveries.delete(value.id);
    this.deliveries.set(value.id, delivery);
    // Match the server's bounded notification history, including pending native requests.
    if (this.deliveries.size > 1000) {
      const oldest = this.deliveries.keys().next().value;
      if (oldest !== undefined) {
        this.close([oldest]);
        this.deliveries.delete(oldest);
      }
    }
    void this.deliver(value, delivery);
  }
  update(value: NotificationState, previous?: NotificationState) {
    if (!value.systemNotification || value.readAt) {
      this.close([value.id]);
    } else if (previous && (value.count > previous.count || !previous.systemNotification)) {
      this.publish(value, !previous.systemNotification);
    }
  }
  private async deliver(value: NotificationState, delivery: Delivery) {
    const current = () =>
      !this.disposed && !delivery.cancelled && this.deliveries.get(value.id) === delivery;
    try {
      if (
        (await this.host.focus.isFocused()) ||
        !current() ||
        this.host.notifications.getPermission() !== 'granted'
      ) {
        return;
      }
      const handle = await this.host.notifications.show({
        id: value.id,
        title: value.title,
        message: value.message,
        onClick: () => {
          if (current()) {
            this.close([value.id]);
            void this.reveal(value.id);
          }
        },
      });
      delivery.handle = handle;
      if (!current()) {
        this.closeDelivery(delivery);
      }
    } catch {
      // Permission, native IPC or browser support failures leave the in-app notification intact.
    }
  }
  private async reveal(id: string) {
    try {
      await this.host.focus.focus();
    } catch {
      // Still reveal the notification in the application if the host cannot raise its window.
    }
    if (!this.disposed) {
      this.activate(id);
    }
  }
  private closeDelivery(delivery: Delivery) {
    delivery.cancelled = true;
    const handle = delivery.handle;
    delivery.handle = undefined;
    try {
      handle?.close();
    } catch {
      // A native notification may already have been dismissed or its host disconnected.
    }
  }
  close(ids: string[]) {
    for (const id of ids) {
      const delivery = this.deliveries.get(id);
      if (delivery) {
        this.closeDelivery(delivery);
      }
    }
  }
  closeAll() {
    for (const delivery of this.deliveries.values()) {
      this.closeDelivery(delivery);
    }
    this.deliveries.clear();
  }
  dispose() {
    this.disposed = true;
    this.closeAll();
  }
}
