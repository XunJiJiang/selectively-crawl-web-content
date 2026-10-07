import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  InvocationContext,
  InvocationIdentity,
  TaskReporter,
  TaskSnapshot,
} from '../types/task.d.ts';

export const invocationStorage = new AsyncLocalStorage<InvocationContext>();

export class TaskScope {
  readonly controller = new AbortController();
  readonly reporter: TaskReporter;
  private automatic = 0;
  private manual = false;
  private handles = new Set<string>();
  private returned = false;
  private revision = 0;
  private disposed = false;
  private label?: string;
  readonly owner: string;
  readonly id: string;
  readonly identity?: InvocationIdentity;
  readonly persistent: boolean;
  private changed: (snapshot: TaskSnapshot) => void;
  constructor(
    owner: string,
    id: string,
    identity: InvocationIdentity | undefined,
    changed: (snapshot: TaskSnapshot) => void,
    persistent = false,
  ) {
    this.owner = owner;
    this.id = id;
    this.identity = identity;
    this.changed = changed;
    this.persistent = persistent;
    this.reporter = Object.freeze({
      begin: (label?: string) => {
        this.assertOpen();
        const id = randomUUID();
        this.handles.add(id);
        this.label = label;
        this.emit();
        return {
          id,
          end: () => {
            if (this.handles.delete(id)) {
              this.emit();
            }
          },
        };
      },
      setBusy: (busy: boolean, label?: string) => {
        if (this.disposed && !busy) {
          return;
        }
        this.assertOpen();
        this.manual = busy;
        this.label = label;
        this.emit();
      },
    });
  }
  private assertOpen() {
    if (this.disposed) {
      throw new Error('任务作用域已结束');
    }
  }
  get snapshot(): TaskSnapshot {
    return {
      id: this.id,
      owner: this.owner,
      identity: this.identity,
      automatic: this.automatic,
      manual: this.manual,
      reported: this.handles.size,
      returned: this.returned,
      revision: this.revision,
      busy: this.automatic > 0 || this.manual || this.handles.size > 0,
      label: this.label,
    };
  }
  get context(): InvocationContext {
    if (!this.identity) {
      throw new Error('进程作用域没有调用身份');
    }
    return Object.freeze({
      ...this.identity,
      tasks: this.reporter,
      signal: this.controller.signal,
    });
  }
  start() {
    this.assertOpen();
    this.automatic++;
    this.emit();
  }
  finish() {
    this.automatic = Math.max(0, this.automatic - 1);
    this.returned = true;
    this.emit();
  }
  cancel() {
    this.controller.abort();
  }
  dispose() {
    this.cancel();
    this.automatic = 0;
    this.manual = false;
    this.handles.clear();
    this.returned = true;
    this.emit();
    this.disposed = true;
  }
  private emit() {
    this.revision++;
    const snapshot = this.snapshot;
    this.changed(snapshot);
    if (!this.persistent && this.returned && !snapshot.busy) {
      this.disposed = true;
    }
  }
}

export class TaskRegistry extends EventEmitter {
  readonly scopes = new Map<string, TaskScope>();
  readonly snapshots = new Map<string, TaskSnapshot>();
  private retired = new Set<string>();
  create(owner: string, identity?: InvocationIdentity, persistent = false) {
    const id = identity?.executionId ?? randomUUID();
    const scope = new TaskScope(
      owner,
      id,
      identity,
      (snapshot) => this.update(owner, snapshot),
      persistent,
    );
    this.scopes.set(`${owner}:${id}`, scope);
    if (identity) {
      scope.start();
    }
    return scope;
  }
  update(owner: string, snapshot: TaskSnapshot) {
    if (this.retired.has(owner)) {
      return;
    }
    const key = `${owner}:${snapshot.id}`;
    const previous = this.snapshots.get(key);
    if (previous && previous.revision >= snapshot.revision) {
      return;
    }
    this.snapshots.set(key, { ...snapshot, owner });
    this.emit('snapshot', { ...snapshot, owner });
    this.emit('change', this.list());
    if (!snapshot.busy && snapshot.returned) {
      this.scopes.delete(key);
    }
    // Retain a bounded set of completed revisions for late-message rejection.
    if (this.snapshots.size > 4096) {
      for (const [id, value] of this.snapshots) {
        if (!value.busy) {
          this.snapshots.delete(id);
          break;
        }
      }
    }
  }
  list() {
    return [...this.snapshots.values()].filter((item) => item.busy);
  }
  executionIds(executionId: string) {
    const ids = new Set([executionId]);
    for (let round = 0; round < this.snapshots.size; round++) {
      let added = false;
      for (const snapshot of this.snapshots.values()) {
        const identity = snapshot.identity;
        if (
          identity?.parentExecutionId &&
          ids.has(identity.parentExecutionId) &&
          !ids.has(identity.executionId)
        ) {
          ids.add(identity.executionId);
          added = true;
        }
      }
      if (!added) {
        break;
      }
    }
    return ids;
  }
  busy(executionId?: string) {
    const ids = executionId ? this.executionIds(executionId) : undefined;
    return this.list().some(
      (item) => !ids || (item.identity && ids.has(item.identity.executionId)),
    );
  }
  removeOwner(owner: string) {
    this.emit('owner.stop', {
      owner,
      identities: this.list()
        .filter((item) => item.owner === owner)
        .map((item) => item.identity)
        .filter(Boolean),
    });
    for (const [key, scope] of this.scopes) {
      if (scope.owner === owner) {
        scope.dispose();
        this.scopes.delete(key);
      }
    }
    this.retired.add(owner);
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot.owner === owner) {
        this.snapshots.delete(key);
      }
    }
    this.emit('change', this.list());
  }
  cancel(executionId?: string) {
    const ids = executionId ? this.executionIds(executionId) : undefined;
    for (const scope of this.scopes.values()) {
      if (!ids || (scope.identity && ids.has(scope.identity.executionId))) {
        scope.cancel();
      }
    }
  }
  async waitIdle(executionId?: string, timeout = 3000) {
    if (!this.busy(executionId)) {
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timer);
        this.off('change', changed);
        resolve(value);
      };
      const changed = () => {
        if (!this.busy(executionId)) {
          done(true);
        }
      };
      const timer = setTimeout(() => done(false), timeout);
      this.on('change', changed);
      changed();
    });
  }
}
export const taskRegistry = new TaskRegistry();
export let outputWindowId: string | null = null;
export let runtimeSessionId: string | undefined;
export function configureTaskIdentity(windowId: string, sessionId: string) {
  outputWindowId = windowId;
  runtimeSessionId = sessionId;
}
export function currentIdentity(): InvocationIdentity {
  const context = invocationStorage.getStore();
  return context
    ? {
        executionId: context.executionId,
        windowId: context.windowId,
        sessionId: context.sessionId,
        parentExecutionId: context.parentExecutionId,
      }
    : { executionId: randomUUID(), windowId: outputWindowId, sessionId: runtimeSessionId };
}
