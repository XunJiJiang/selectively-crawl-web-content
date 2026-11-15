import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../utils/notify.ts', () => ({ notify: vi.fn() }));
import { notify } from '../utils/notify.ts';
const key = ['scwc', 'userscript', 'sync-circuit', 'v1'].join('.');
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(notify).mockClear();
});
afterEach(() => vi.useRealTimers());

it('persists no retry count and records failure only after the entire retry budget', async () => {
  const circuit = await import('./sync-circuit.ts');
  expect(circuit.recordCoreSyncFailure()).toBe(false);
  expect(circuit.recordCoreSyncFailure()).toBe(false);
  expect(localStorage.getItem(key)).toBeNull();
  expect(circuit.recordCoreSyncFailure()).toBe(true);
  expect(localStorage.getItem(key)).toBe('false');
  expect(notify).toHaveBeenCalledOnce();
  circuit.resetCoreSyncCircuit();
  expect(localStorage.getItem(key)).toBe('false');
  circuit.recordCoreSyncFailure();
  expect(localStorage.getItem(key)).toBe('false');
  circuit.recordCoreSyncSuccess();
  expect(localStorage.getItem(key)).toBe('true');
});

it.each([false, { failures: 3, blocked: true }])(
  'reopens after previous failure %j and only notifies on interaction',
  async (saved) => {
    localStorage.setItem(key, JSON.stringify(saved));
    const circuit = await import('./sync-circuit.ts');
    expect(circuit.isCoreSyncBlocked()).toBe(false);
    expect(circuit.shouldNotifyAutomaticConnectionFailure()).toBe(false);
    expect(circuit.recordCoreSyncFailure()).toBe(false);
    expect(circuit.recordCoreSyncFailure()).toBe(false);
    expect(circuit.recordCoreSyncFailure()).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(() => circuit.assertCoreRequestAllowed(false)).toThrow();
    expect(notify).not.toHaveBeenCalled();
    expect(() => circuit.assertCoreRequestAllowed()).toThrow();
    expect(notify).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBe('false');
  },
);

it('does not carry an unfinished retry count to the next page', async () => {
  localStorage.setItem(key, JSON.stringify({ failures: 2, blocked: false }));
  const circuit = await import('./sync-circuit.ts');
  expect(localStorage.getItem(key)).toBeNull();
  expect(circuit.recordCoreSyncFailure()).toBe(false);
  expect(circuit.recordCoreSyncFailure()).toBe(false);
  expect(circuit.recordCoreSyncFailure()).toBe(true);
  expect(notify).toHaveBeenCalledOnce();
});

it('allows automatic failure notices again after an actual successful connection', async () => {
  localStorage.setItem(key, 'false');
  const circuit = await import('./sync-circuit.ts');
  circuit.recordCoreSyncSuccess();
  circuit.recordCoreSyncFailure();
  circuit.recordCoreSyncFailure();
  circuit.recordCoreSyncFailure();
  expect(notify).toHaveBeenCalledOnce();
});
