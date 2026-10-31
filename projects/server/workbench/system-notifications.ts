import {
  coreNotificationRoute,
  initialSystemNotificationSettings,
  type SystemNotificationSettings,
} from '../../shared/system-notifications.ts';
import type { NotificationState } from '../../shared/workbench-feedback.ts';
import { workbenchEvents, type WorkbenchEvent, type WorkbenchEvents } from './events.ts';
import {
  nativeNotificationHost,
  type CoreNotificationHost,
  type CoreNotificationHandle,
} from './native-notification-host.ts';
import { serverLogger } from '../common/logger.ts';
interface Delivery {
  cancelled: boolean;
  handle?: CoreNotificationHandle;
}

/** Owns native delivery once per core, independently of how many browsers are connected. */
export class CoreSystemNotifications {
  private host: CoreNotificationHost;
  private forceCore = false;
  private settings: () => SystemNotificationSettings;
  private activate: (id: string) => void | Promise<void>;
  private events: WorkbenchEvents;
  private known = new Map<string, { count: number; systemNotification?: boolean }>();
  private deliveries = new Map<string, Delivery>();
  private viewers = new Map<string, { focused: boolean; time: number }>();
  private disposed = false;
  constructor(
    settings: () => SystemNotificationSettings,
    activate: (id: string) => void | Promise<void>,
    events = workbenchEvents,
  ) {
    this.settings = settings;
    this.activate = activate;
    this.events = events;
    this.host = nativeNotificationHost();
    events.on('event', this.event);
  }
  /** Desktop embedding replaces the native provider and forces core-only routing. */
  setHost(host: CoreNotificationHost, forceCore = true) {
    this.closeAll();
    this.host = host;
    this.forceCore = forceCore;
    this.events.publish('system-notification.host-changed', this.status());
  }
  status() {
    return { supported: this.host.supported(), forceCore: this.forceCore };
  }
  presence(viewer: string, focused: boolean) {
    this.viewers.delete(viewer);
    this.viewers.set(viewer, { focused, time: Date.now() });
    for (const [id, value] of this.viewers)
      if (Date.now() - value.time > 20000) this.viewers.delete(id);
    if (this.viewers.size > 256) this.viewers.delete(this.viewers.keys().next().value!);
    if (focused && !this.host.isFocused) this.closeAll();
  }
  private close(id: string) {
    const delivery = this.deliveries.get(id);
    if (!delivery) return;
    delivery.cancelled = true;
    this.deliveries.delete(id);
    try {
      delivery.handle?.close();
    } catch {
      /* A native sender may already have exited. */
    }
  }
  private closeAll() {
    for (const id of [...this.deliveries.keys()]) this.close(id);
  }
  private event = (event: WorkbenchEvent) => {
    if (event.type === 'preferences.changed') {
      if (!this.enabled()) this.closeAll();
      return;
    }
    if (!['notification.created', 'notification.updated'].includes(event.type)) return;
    const value = event.payload as NotificationState & { ids?: string[]; deleted?: boolean };
    if (value.ids) {
      for (const id of value.ids) {
        this.close(id);
        if (value.deleted) this.known.delete(id);
      }
      return;
    }
    const previous = this.known.get(value.id);
    this.known.delete(value.id);
    this.known.set(value.id, value);
    if (this.known.size > 1000) {
      const id = this.known.keys().next().value!;
      this.close(id);
      this.known.delete(id);
    }
    if (!value.systemNotification || value.readAt) {
      this.close(value.id);
      return;
    }
    const fresh =
      event.type === 'notification.created'
        ? !previous || value.count > previous.count
        : previous && (value.count > previous.count || !previous.systemNotification);
    if (fresh) void this.send(value);
  };
  private enabled() {
    const settings = this.settings() ?? initialSystemNotificationSettings;
    return (
      !this.disposed &&
      settings.enabled &&
      coreNotificationRoute(settings.mode, this.forceCore) &&
      this.host.supported()
    );
  }
  private async send(value: NotificationState) {
    if (!this.enabled()) return;
    this.close(value.id);
    const delivery: Delivery = { cancelled: false };
    this.deliveries.set(value.id, delivery);
    const current = () =>
      !delivery.cancelled && this.enabled() && this.deliveries.get(value.id) === delivery;
    try {
      const focused = this.host.isFocused
        ? await this.host.isFocused()
        : [...this.viewers.values()].some((v) => v.focused && Date.now() - v.time < 20000);
      if (focused || !current()) {
        this.close(value.id);
        return;
      }
      const handle = await this.host.show({
        id: value.id,
        title: value.title,
        message: value.message,
        isCurrent: current,
        onClick: () => {
          if (!current()) return;
          this.close(value.id);
          if (this.host.activateNotification) {
            void Promise.resolve(this.host.activateNotification(value.id)).catch((error) =>
              this.failed(error),
            );
            return;
          }
          const viewer = [...this.viewers.entries()]
            .filter(([, v]) => Date.now() - v.time < 20000)
            .sort((a, b) => b[1].time - a[1].time)[0]?.[0];
          if (viewer) this.events.publish('system-notification.clicked', { id: value.id, viewer });
          else void Promise.resolve(this.activate(value.id)).catch((error) => this.failed(error));
        },
        onError: (error) => {
          if (current()) this.failed(error);
        },
      });
      delivery.handle = handle;
      if (!current()) handle.close();
    } catch (error) {
      if (current()) this.failed(error);
    }
  }
  private failed(error: unknown) {
    serverLogger.warn('内核系统通知发送失败', error);
    this.events.publish('system-notification.failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  closeService() {
    this.disposed = true;
    this.events.off('event', this.event);
    this.closeAll();
    this.viewers.clear();
    this.known.clear();
  }
}
