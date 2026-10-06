import { describe, expect, it } from 'vitest';
import { resolveProcessOptions } from './options.ts';

describe('default process runtime settings', () => {
  it.each([undefined, {}, { mode: 'process' }, { apiVersion: 2 }])(
    'uses v2 isolation for omitted settings: %j',
    (input) => {
      expect(resolveProcessOptions(input)).toEqual({ mode: 'process', apiVersion: 2 });
    },
  );

  it('retains timeout overrides without requiring mode or apiVersion', () => {
    expect(resolveProcessOptions({ requestTimeoutMs: 300000, shutdownTimeoutMs: 100 })).toEqual({
      mode: 'process',
      apiVersion: 2,
      requestTimeoutMs: 300000,
      shutdownTimeoutMs: 100,
    });
  });

  it.each([
    null,
    [],
    'process',
    { mode: 'in-process' },
    { apiVersion: 1 },
    { apiVersion: '2' },
    { startupTimeoutMs: 99 },
    { requestTimeoutMs: 600001 },
    { shutdownTimeoutMs: 1.5 },
    { requestTimeoutMs: '1000' },
  ])('rejects unsupported or malformed settings: %j', (input) => {
    expect(() => resolveProcessOptions(input)).toThrow();
  });
});
