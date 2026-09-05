import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TLogger } from '../types/log.d.ts';

const mocked = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const cache = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      return value;
    }),
    del: vi.fn(async (key: string) => values.delete(key)),
    mdel: vi.fn(async (keys: string[]) => {
      let deleted = false;
      for (const key of keys) {
        deleted = values.delete(key) || deleted;
      }
      return deleted;
    }),
    clear: vi.fn(async () => values.clear()),
  };
  return { cache, values };
});

vi.mock('cache-manager', () => ({
  createCache: () => mocked.cache,
}));

vi.mock('keyv', () => ({
  Keyv: vi.fn(function MockKeyv() {
    return { on: vi.fn() };
  }),
}));

vi.mock('@keyv/redis', () => ({
  default: vi.fn(function MockKeyvRedis() {
    return { mocked: true };
  }),
}));

vi.mock('cacheable', () => ({
  CacheableMemory: vi.fn(function MockCacheableMemory() {
    return { mocked: true };
  }),
}));

import { createNamespacedCache } from './cache.ts';

const logger: TLogger = {
  info: vi.fn(),
  pathInfo: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('createNamespacedCache', () => {
  beforeEach(() => {
    mocked.values.clear();
    vi.clearAllMocks();
  });

  it('isolates identical keys between plugin namespaces', async () => {
    const first = createNamespacedCache('plugin:first', logger);
    const second = createNamespacedCache('plugin:second', logger);

    await first.set('shared-key', 'first-value');
    await second.set('shared-key', 'second-value');

    await expect(first.get<string>('shared-key')).resolves.toBe('first-value');
    await expect(second.get<string>('shared-key')).resolves.toBe('second-value');
    expect(mocked.values.has('shared-key')).toBe(false);
    expect(mocked.values.has('plugin:first:shared-key')).toBe(true);
    expect(mocked.values.has('plugin:second:shared-key')).toBe(true);
  });

  it('keeps redirects and deletion inside the bound namespace', async () => {
    const first = createNamespacedCache('plugin:first', logger);
    const second = createNamespacedCache('plugin:second', logger);

    await first.set('target', 'first-value');
    await first.setRedirect('alias', 'target');
    await second.set('target', 'second-value');

    await expect(first.get<string>('alias')).resolves.toBe('first-value');
    await expect(first.mdel(['alias', 'target'])).resolves.toBe(true);
    await expect(first.get<string>('target')).resolves.toBeUndefined();
    await expect(second.get<string>('target')).resolves.toBe('second-value');
  });

  it('does not expose namespace mutation or global cache clearing', () => {
    const pluginCache = createNamespacedCache('plugin:first', logger);

    expect(Object.isFrozen(pluginCache)).toBe(true);
    expect(pluginCache).not.toHaveProperty('clearAll');
    expect(pluginCache).not.toHaveProperty('namespace');
  });
});
