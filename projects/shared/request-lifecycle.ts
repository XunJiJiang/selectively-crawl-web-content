/** Requests are protected unless their owner explicitly opts into interruption. */
export interface RequestOptions {
  interruptible?: boolean;
}
export class RequestLifecycle extends EventTarget {
  paused = false;
  blocking = 0;
  private generation = 0;
  private active = new Set<AbortController>();
  private waiters = new Set<() => void>();
  cancelInterruptible() {
    for (const controller of this.active) {
      controller.abort();
    }
  }
  pause() {
    if (this.blocking) {
      return false;
    }
    this.paused = true;
    this.generation++;
    for (const controller of this.active) {
      controller.abort();
    }
    return true;
  }
  resume() {
    this.paused = false;
    for (const wake of this.waiters) {
      wake();
    }
    this.waiters.clear();
  }
  async wait(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.paused) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.waiters.delete(wake);
        signal?.removeEventListener('abort', abort);
      };
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason);
      };
      this.waiters.add(wake);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  protect() {
    this.blocking++;
    this.dispatchEvent(new Event('change'));
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.blocking--;
      this.dispatchEvent(new Event('change'));
    };
  }
  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    interruptible = false,
    signal?: AbortSignal,
  ): Promise<T> {
    const release = interruptible ? () => undefined : this.protect();
    try {
      for (;;) {
        await this.wait(signal);
        const generation = this.generation;
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
          abort();
        }
        if (interruptible) {
          this.active.add(controller);
        }
        try {
          return await operation(controller.signal);
        } catch (error) {
          if (!interruptible || signal?.aborted || generation === this.generation) {
            throw error;
          }
          // Only requests aborted by our pause are replayed; ordinary failures and
          // caller cancellation retain their original semantics.
        } finally {
          this.active.delete(controller);
          signal?.removeEventListener('abort', abort);
        }
      }
    } finally {
      release();
    }
  }
}
