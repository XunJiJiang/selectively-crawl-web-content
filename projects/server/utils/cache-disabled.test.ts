import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../common/environment.ts', () => ({}));
vi.mock('@keyv/redis', () => ({
  default: vi.fn(function UnexpectedRedis() {
    throw new Error('Redis must not be constructed when disabled');
  }),
}));
vi.stubEnv('REDIS_ENABLED', 'false');
vi.stubEnv('REDIS_PORT', 'invalid');
const { cache, createNamespacedCache } = await import('./cache.ts');
afterAll(async () => {
  await cache.clear();
  vi.unstubAllEnvs();
});

describe('cache without Redis', () => {
  it('supports real in-memory namespaced values and redirects without creating a Redis client', async () => {
    const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const first = createNamespacedCache('first', logger);
    const second = createNamespacedCache('second', logger);
    await first.set('target', { count: 2 });
    await second.set('target', { count: 3 });
    await first.setRedirect('alias', 'target');
    expect(await first.get('alias')).toEqual({ count: 2 });
    expect(await second.get('target')).toEqual({ count: 3 });
    await first.mdel(['alias', 'target']);
    expect(await first.get('target')).toBeUndefined();
    expect(await second.get('target')).toEqual({ count: 3 });
  });
});
