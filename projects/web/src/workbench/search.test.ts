import { describe, expect, it, vi } from 'vitest';
import { SearchCoordinator } from './search.ts';
import type { FramePool, FrameRuntime } from './frames.ts';
function fixture(request: () => Promise<unknown>) {
  const pool = Object.assign(new EventTarget(), {
    runtimes: new Map([
      [
        'tab',
        {
          tabId: 'tab',
          epoch: 'epoch',
          searchRevision: 1,
          searchAvailable: true,
          port: { request },
          activity: new Map(),
        } as unknown as FrameRuntime,
      ],
    ]),
  });
  return { pool, search: new SearchCoordinator(pool as unknown as FramePool) };
}
describe('asynchronous page search', () => {
  it('discards late results after the query changes and keeps per-source cursors', async () => {
    let resolveOld: (result: unknown) => void = () => {
      /* Assigned by the provider below. */
    };
    const request = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ items: [{ id: 'new', title: 'new result' }], nextCursor: 'next' })
      .mockResolvedValueOnce({
        items: [
          { id: 'new', title: 'updated' },
          { id: 'b', title: 'second' },
        ],
        nextCursor: null,
      });
    const { search } = fixture(request);
    search.run('old');
    search.run('new');
    await Promise.resolve();
    await Promise.resolve();
    resolveOld({ items: [{ id: 'old', title: 'late' }], nextCursor: null });
    await Promise.resolve();
    expect(search.sources[0].items.map((i) => i.id)).toEqual(['new']);
    await search.more(search.sources[0]);
    expect(request.mock.calls[2][1]).toMatchObject({ query: 'new', cursor: 'next' });
    expect(search.sources[0].items.map((i) => i.id)).toEqual(['new', 'b']);
    search.dispose();
  });
  it('rejects a repeated cursor without an infinite pagination loop', async () => {
    const request = vi.fn().mockResolvedValue({ items: [], nextCursor: 'same' });
    const { search } = fixture(request);
    search.run('query');
    await Promise.resolve();
    await Promise.resolve();
    await search.more(search.sources[0]);
    expect(search.sources[0].error).toContain('游标');
    expect(request).toHaveBeenCalledTimes(2);
    search.dispose();
  });
});
