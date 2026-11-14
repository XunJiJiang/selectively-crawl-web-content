export type NotifyCloseSource = 'auto' | 'user' | 'manual';
interface Lifetime {
  remaining: number;
  startedAt: number;
  handle?: ReturnType<typeof setTimeout>;
  paused: Set<string>;
}

/** DOM/style independent notification lifetime controller. Zero duration stays open. */
export class NotifyController {
  private timers = new Map<string, Lifetime>();
  private suspended = false;
  private onClose: (id: string, source: NotifyCloseSource) => void;
  constructor(onClose: (id: string, source: NotifyCloseSource) => void) {
    this.onClose = onClose;
  }
  get ids() {
    return this.timers.keys();
  }
  has(id: string) {
    return this.timers.has(id);
  }
  set(id: string, duration: number) {
    const paused = this.timers.get(id)?.paused ?? new Set<string>();
    this.remove(id);
    this.timers.set(id, { remaining: duration, startedAt: 0, paused });
    this.start(id);
  }
  private start(id: string) {
    const timer = this.timers.get(id);
    if (
      !timer ||
      this.suspended ||
      timer.paused.size ||
      timer.handle !== undefined ||
      timer.remaining <= 0
    ) {
      return;
    }
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => this.close(id, 'auto'), timer.remaining);
  }
  pause(id: string, reason = 'pointer') {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    timer.paused.add(reason);
    if (timer.handle !== undefined) {
      clearTimeout(timer.handle);
      timer.handle = undefined;
      timer.remaining = Math.max(1, timer.remaining - (Date.now() - timer.startedAt));
    }
  }
  resume(id: string, reason = 'pointer') {
    this.timers.get(id)?.paused.delete(reason);
    this.start(id);
  }
  remove(id: string) {
    clearTimeout(this.timers.get(id)?.handle);
    return this.timers.delete(id);
  }
  close(id: string, source: NotifyCloseSource = 'manual') {
    if (!this.remove(id)) {
      return false;
    }
    this.onClose(id, source);
    return true;
  }
  suspend() {
    this.suspended = true;
    for (const id of this.ids) {
      this.pause(id, 'disconnected');
    }
  }
  connect() {
    this.suspended = false;
    for (const id of this.ids) {
      this.resume(id, 'disconnected');
    }
  }
  dispose() {
    for (const id of this.ids) {
      this.remove(id);
    }
  }
}
