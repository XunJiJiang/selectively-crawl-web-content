import { NotifyController } from './notify-controller.ts';
import type {
  INotifyOptions,
  NotifyHandle,
  NotifyInteraction,
  NotifyState,
} from './types/notify.d.ts';

interface RecordItem {
  options: INotifyOptions;
  state: NotifyState;
  visibleInCenter: boolean;
}

/** State, callbacks and timers belong to the document that creates the notification. */
export class NotifyManager {
  readonly items = new Map<string, RecordItem>();
  readonly controller = new NotifyController((id, source) => {
    if (source === 'manual') {
      this.remove(id);
      return;
    }
    const item = this.items.get(id);
    if (!item) {
      return;
    }
    if (source === 'user') {
      this.remove(id);
    } else {
      item.state.banner = false;
      item.state.visible = item.visibleInCenter;
      this.changed(item);
    }
    item.options.onclose?.(source);
  });
  private publish: (state: NotifyState | null, id: string) => void;
  constructor(publish: (state: NotifyState | null, id: string) => void) {
    this.publish = publish;
  }
  private changed(item: RecordItem) {
    item.state.updatedAt = new Date().toISOString();
    this.publish(this.snapshot(item), item.state.id);
  }
  private snapshot(item: RecordItem): NotifyState {
    return { ...item.state, actions: item.state.actions.map((action) => ({ ...action })) };
  }
  private schedule(item: RecordItem) {
    if (!item.state.banner) {
      return;
    }
    const progress = item.state.progress;
    this.controller.set(
      item.state.id,
      progress !== false && progress !== 100 ? 0 : item.state.duration,
    );
  }
  notify(options: INotifyOptions): NotifyHandle {
    const id = crypto.randomUUID();
    const item: RecordItem = {
      options: { ...options },
      visibleInCenter: false,
      state: {
        id,
        title: '',
        description: '',
        type: 'info',
        placement: 'tr',
        duration: 3000,
        progress: false,
        autoRead: true,
        readAt: null,
        seenAt: null,
        updatedAt: new Date().toISOString(),
        visible: true,
        banner: true,
        actions: [],
      },
    };
    const update = (value: Partial<INotifyOptions>) => {
      if (!this.items.has(id)) {
        return false;
      }
      if (value.actions && value.actions.length > 4) {
        throw new Error('通知最多支持 4 个操作按钮');
      }
      Object.assign(item.options, value);
      for (const key of [
        'title',
        'description',
        'type',
        'placement',
        'duration',
        'progress',
        'autoRead',
      ] as const) {
        if (value[key] !== undefined) {
          Object.assign(item.state, { [key]: value[key] });
        }
      }
      if (value.actions) {
        item.state.actions = value.actions.map((action) => ({
          id: crypto.randomUUID(),
          label: action.label,
        }));
      }
      this.schedule(item);
      this.changed(item);
      return true;
    };
    if (options.actions && options.actions.length > 4) {
      throw new Error('通知最多支持 4 个操作按钮');
    }
    // Retain bounded history after automatic banner expiry, so its handle can still update it.
    const oldest = this.items.keys().next().value;
    if (this.items.size >= 1000 && oldest) {
      this.remove(oldest);
    }
    this.items.set(id, item);
    update(options);
    const state = async () => this.snapshot(item);
    const patch = async (value: Partial<INotifyOptions>) => {
      if (!update(value)) {
        throw new Error('通知已关闭');
      }
      return state();
    };
    return {
      id,
      update,
      close: () => this.remove(id),
      setContent: (title, description = '') => patch({ title, description }),
      setProgress: (progress) => patch({ progress }),
      setActions: (actions) => patch({ actions }),
      markRead: async (read = true) => {
        await this.interact(id, { type: 'read', read });
        return state();
      },
      getState: state,
      isVisible: async () => item.state.visible,
    };
  }
  remove(id: string) {
    const item = this.items.get(id);
    if (!item) {
      return false;
    }
    this.controller.remove(id);
    item.state.visible = item.state.banner = false;
    this.items.delete(id);
    this.publish(null, id);
    return true;
  }
  async interact(id: string, interaction: NotifyInteraction) {
    const item = this.items.get(id);
    if (!item) {
      throw new Error('通知已关闭');
    }
    const state = item.state;
    switch (interaction.type) {
      case 'close':
        this.remove(id);
        item.options.onclose?.('user');
        return;
      case 'click':
        item.options.onclick?.();
        return;
      case 'action': {
        const index = state.actions.findIndex((action) => action.id === interaction.actionId);
        if (index < 0) {
          throw new Error('通知操作已失效');
        }
        await item.options.actions?.[index].onClick();
        return;
      }
      case 'read':
        state.readAt = interaction.read ? new Date().toISOString() : null;
        break;
      case 'visible':
        item.visibleInCenter = interaction.value;
        state.visible = state.banner || interaction.value;
        if (interaction.value) {
          state.seenAt ??= new Date().toISOString();
        }
        break;
      case 'focus':
      case 'hover':
        if (interaction.value) {
          this.controller.pause(id, interaction.type);
        } else {
          this.controller.resume(id, interaction.type);
        }
        if (interaction.type === 'focus' && interaction.value && state.autoRead) {
          state.readAt = new Date().toISOString();
        }
        break;
    }
    this.changed(item);
  }
  dispose() {
    for (const id of this.items.keys()) {
      this.remove(id);
    }
    this.controller.dispose();
  }
}

// The injected SDK and a plugin's bundled shared module are separate module instances.
const hostKey = Symbol.for('scwc.notify.host');
type NotifyHost = (options: INotifyOptions) => NotifyHandle;
const hosts = globalThis as typeof globalThis & { [hostKey]?: NotifyHost };
export function installNotifyHost(host: NotifyHost) {
  hosts[hostKey] = host;
  return () => {
    if (hosts[hostKey] === host) {
      hosts[hostKey] = undefined;
    }
  };
}
export function hostedNotify(options: INotifyOptions) {
  return options.useCore === false ? undefined : hosts[hostKey]?.(options);
}

/** Validate untrusted iframe state before projecting it into core UI. */
export function isNotifyState(value: unknown): value is NotifyState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const s = value as NotifyState;
  return (
    typeof s.id === 'string' &&
    /^[a-zA-Z0-9-]{1,100}$/.test(s.id) &&
    typeof s.title === 'string' &&
    s.title.length <= 1000 &&
    typeof s.description === 'string' &&
    s.description.length <= 16000 &&
    ['info', 'success', 'warn', 'error'].includes(s.type) &&
    ['tl', 'tc', 'tr', 'bl', 'bc', 'br'].includes(s.placement) &&
    Number.isFinite(s.duration) &&
    s.duration >= 0 &&
    (s.progress === false ||
      s.progress === null ||
      (typeof s.progress === 'number' &&
        Number.isFinite(s.progress) &&
        s.progress >= 0 &&
        s.progress <= 100)) &&
    [s.autoRead, s.visible, s.banner].every((v) => typeof v === 'boolean') &&
    [s.readAt, s.seenAt].every(
      (v) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v))),
    ) &&
    typeof s.updatedAt === 'string' &&
    Number.isFinite(Date.parse(s.updatedAt)) &&
    Array.isArray(s.actions) &&
    s.actions.length <= 4 &&
    s.actions.every(
      (a) =>
        a !== null &&
        typeof a === 'object' &&
        typeof a.id === 'string' &&
        a.id.length <= 100 &&
        typeof a.label === 'string' &&
        a.label.length <= 100,
    )
  );
}
