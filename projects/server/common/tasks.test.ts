import { describe, it, expect } from 'vitest';
import { TaskRegistry } from './tasks.ts';
import { bindLogger, setLogSink } from '../utils/log.ts';

describe('invocation tasks and log ownership', () => {
  it('retains manually busy work after return and isolates concurrent scopes', () => {
    const registry = new TaskRegistry();
    const a = registry.create('plugin', { executionId: 'a', windowId: 'window-a' });
    const b = registry.create('plugin', { executionId: 'b', windowId: 'window-b' });
    a.reporter.setBusy(true);
    a.finish();
    b.reporter.setBusy(false);
    expect(registry.busy('a')).toBe(true);
    expect(registry.busy('b')).toBe(true);
    b.finish();
    expect(registry.busy('b')).toBe(false);
    expect(registry.busy('a')).toBe(true);
    a.reporter.setBusy(false);
    expect(registry.busy()).toBe(false);
    expect(() => a.reporter.begin()).toThrow('已结束');
  });
  it('keeps begin handles independent of manual flags and ends idempotently', () => {
    const registry = new TaskRegistry();
    const scope = registry.create('plugin', { executionId: 'a', windowId: 'window' });
    const first = scope.reporter.begin();
    const second = scope.reporter.begin();
    scope.reporter.setBusy(true);
    scope.finish();
    scope.reporter.setBusy(false);
    first.end();
    first.end();
    expect(registry.busy()).toBe(true);
    second.end();
    expect(registry.busy()).toBe(false);
  });
  it('aggregates children, cancels their signals and preserves unrelated work', () => {
    const registry = new TaskRegistry();
    const parent = registry.create('core', { executionId: 'a', windowId: 'w' });
    const child = registry.create('host', {
      executionId: 'child',
      parentExecutionId: 'a',
      windowId: 'w',
    });
    const other = registry.create('another', { executionId: 'b', windowId: 'v' });
    parent.finish();
    child.reporter.setBusy(true);
    child.finish();
    registry.cancel('a');
    expect(child.controller.signal.aborted).toBe(true);
    expect(other.controller.signal.aborted).toBe(false);
    expect(registry.busy('a')).toBe(true);
    registry.removeOwner('host');
    expect(registry.busy('a')).toBe(false);
    expect(registry.busy('b')).toBe(true);
    registry.update('host', { ...child.snapshot, revision: 999, busy: true });
    expect(registry.busy('a')).toBe(false);
  });
  it('ignores older IPC snapshots and retains process-level manual work', () => {
    const registry = new TaskRegistry();
    const process = registry.create('host', undefined, true);
    process.reporter.setBusy(true);
    const latest = process.snapshot;
    process.reporter.setBusy(false);
    registry.update('host', latest);
    expect(registry.busy()).toBe(false);
    process.reporter.setBusy(true);
    expect(registry.busy()).toBe(true);
  });
  it('binds logger identities independently of active asynchronous calls', async () => {
    const events: { windowId: string | null; executionId?: string; text: string }[] = [];
    setLogSink((event) => events.push(event));
    try {
      const base = {
        info: () => undefined,
        pathInfo: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      };
      const a = bindLogger(base, { windowId: 'a', executionId: 'first' }, 'plugin');
      const b = bindLogger(base, { windowId: 'b', executionId: 'second' }, 'plugin');
      b.info('immediate');
      await Promise.resolve();
      a.info('late');
      expect(Object.isFrozen(a)).toBe(true);
      expect(events.map((event) => [event.windowId, event.executionId])).toEqual([
        ['b', 'second'],
        ['a', 'first'],
      ]);
    } finally {
      setLogSink();
    }
  });
});
