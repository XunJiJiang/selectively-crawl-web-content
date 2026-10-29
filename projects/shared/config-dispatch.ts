import type { ConfigChange } from '../server/types/plugin-config.d.ts';

/** A queue belongs to one document epoch. A new document starts with a fresh snapshot. */
export class ConfigDispatchQueue {
  private pending: ConfigChange[] = [];
  private resync = true;
  private flushing = false;
  private closed = false;
  private acknowledged = -1;
  private boot = '';
  private bytes = 0;
  private active: () => boolean;
  private snapshot: () => Promise<ConfigChange>;
  private deliver: (change: ConfigChange) => Promise<unknown>;
  constructor(
    active: () => boolean,
    snapshot: () => Promise<ConfigChange>,
    deliver: (change: ConfigChange) => Promise<unknown>,
  ) {
    this.active = active;
    this.snapshot = snapshot;
    this.deliver = deliver;
  }
  enqueue(change: ConfigChange & { coreBootId?: string }) {
    if (this.closed) {
      return;
    }
    if (change.coreBootId && change.coreBootId !== this.boot) {
      this.boot = change.coreBootId;
      this.acknowledged = -1;
      this.resync = true;
      this.pending = [];
      this.bytes = 0;
    }
    if (
      change.revision <= this.acknowledged ||
      this.pending.some((c) => c.revision === change.revision)
    ) {
      return;
    }
    this.pending.push(change);
    this.bytes += JSON.stringify(change).length;
    if (this.pending.length > 256 || this.bytes > 262144) {
      this.pending = [];
      this.bytes = 0;
      this.resync = true;
    }
    void this.flush();
  }
  requireResync() {
    this.resync = true;
    void this.flush();
  }
  async flush() {
    if (this.closed || this.flushing || !this.active()) {
      return;
    }
    this.flushing = true;
    try {
      while (!this.closed && this.active() && (this.resync || this.pending.length)) {
        const snapshot = this.resync;
        const next = snapshot ? await this.snapshot() : this.pending[0];
        if (this.closed || !this.active()) {
          break;
        }
        const boot = (next as ConfigChange & { coreBootId?: string }).coreBootId;
        if (boot && !this.boot) {
          this.boot = boot;
        }
        if (next.revision > this.acknowledged || snapshot) {
          await this.deliver({ ...next, ...(this.boot ? { coreBootId: this.boot } : {}) });
          this.acknowledged = next.revision;
        }
        if (snapshot) {
          this.resync = false;
        }
        this.pending = this.pending.filter((c) => c.revision > this.acknowledged);
        this.bytes = this.pending.reduce((n, c) => n + JSON.stringify(c).length, 0);
      }
    } catch {
      /* Keep the unacknowledged item for the next ready/resume checkpoint. */
    } finally {
      this.flushing = false;
    }
  }
  dispose() {
    this.closed = true;
    this.pending = [];
    this.bytes = 0;
  }
}
