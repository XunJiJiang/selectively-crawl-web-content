import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        defaults: {},
        interceptors: { request: { use: vi.fn() } },
        get: mock.get,
      }),
    },
  };
});
import { createRetryGet } from './axios.ts';

const logger: SCWC.TLogger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
function cache(): SCWC.IPluginCache {
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async (_key, value) => value),
    setRedirect: vi.fn(async (_key, target) => target),
    del: vi.fn(async () => true),
    mdel: vi.fn(async () => true),
  };
}
beforeEach(() => mock.get.mockReset());

describe('retryGet with isolated plugin cache', () => {
  it('keeps streaming downloads in the plugin instead of serializing Readable over IPC', async () => {
    const sharedCache = cache();
    const stream = Readable.from(['streamed', '-image']);
    mock.get.mockResolvedValue({ data: stream });
    const retryGet = createRetryGet<unknown, { responseType: 'stream' }>(
      'test',
      logger,
      undefined,
      sharedCache,
    );
    const result = await retryGet('https://example.test/image', { responseType: 'stream' });
    let content = '';
    for await (const chunk of result.raw) {
      content += String(chunk);
    }
    expect(content).toBe('streamed-image');
    expect(sharedCache.get).not.toHaveBeenCalled();
    expect(sharedCache.set).not.toHaveBeenCalled();
    await result.delCache();
    expect(sharedCache.mdel).not.toHaveBeenCalled();
  });

  it('returns cached values without continuing a network request, including falsy JSON', async () => {
    const sharedCache = cache();
    vi.mocked(sharedCache.get).mockResolvedValue(false);
    const retryGet = createRetryGet<unknown, { responseType: 'json' }>(
      'test',
      logger,
      undefined,
      sharedCache,
    );
    expect((await retryGet('https://example.test/json', { responseType: 'json' })).raw).toBe(false);
    expect(mock.get).not.toHaveBeenCalled();
  });

  it('preserves custom request classes and buffers through the injected cache', async () => {
    const sharedCache = cache();
    mock.get.mockResolvedValue({ data: Buffer.from('image-data') });
    const retryGet = createRetryGet<{ marker: string }, { responseType: 'arraybuffer' }>(
      'test',
      logger,
      (Base) =>
        class extends Base {
          initConfig(url: string) {
            super.initConfig(url);
            this.customResData = { marker: url };
          }
        },
      sharedCache,
    );
    const result = await retryGet('https://example.test/image', { responseType: 'arraybuffer' });
    expect(Buffer.from(result.raw).toString()).toBe('image-data');
    expect(result.data).toEqual({ marker: 'https://example.test/image' });
    expect(sharedCache.set).toHaveBeenCalledWith(
      'https://example.test/image',
      Buffer.from('image-data'),
    );
  });
});
