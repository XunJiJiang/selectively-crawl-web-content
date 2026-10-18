import type { PageSearchBatch } from '../../../shared/workbench-protocol.ts';
import type { FramePool, FrameRuntime } from './frames.ts';
export interface SearchSource {
  id: string;
  tabId: string;
  epoch: string;
  revision: number;
  items: PageSearchBatch['items'];
  cursor: string | null;
  loading: boolean;
  error: string;
  done: boolean;
  total?: number;
}
export class SearchCoordinator extends EventTarget {
  sources: SearchSource[] = [];
  query = '';
  private generation = 0;
  private active = false;
  private controllers = new Set<AbortController>();
  private pool: FramePool;
  constructor(pool: FramePool) {
    super();
    this.pool = pool;
    pool.addEventListener('search-changed', this.registrationChanged);
  }
  private registrationChanged = () => {
    if (this.active) {
      this.run(this.query);
    }
  };
  run(query: string, currentTabId?: string) {
    this.cancel();
    this.query = query.trim();
    this.active = Boolean(this.query);
    const generation = this.generation;
    if (!this.query) {
      this.sources = [];
      this.changed();
      return;
    }
    this.sources = [...this.pool.runtimes.values()]
      .filter((r) => r.searchAvailable && r.port && (!currentTabId || r.tabId === currentTabId))
      .map((r) => ({
        id: `${r.tabId}:${r.epoch}:${r.searchRevision}`,
        tabId: r.tabId,
        epoch: r.epoch,
        revision: r.searchRevision,
        items: [],
        cursor: null,
        loading: false,
        error: '',
        done: false,
      }));
    for (const source of this.sources) {
      void this.load(source, generation);
    }
    this.changed();
  }
  private changed() {
    this.dispatchEvent(new Event('change'));
  }
  async more(source: SearchSource) {
    if (!source.loading && !source.done) {
      await this.load(source, this.generation);
    }
  }
  private valid(source: SearchSource, r: FrameRuntime | undefined, generation: number) {
    return (
      generation === this.generation &&
      this.sources.includes(source) &&
      r?.epoch === source.epoch &&
      r.searchRevision === source.revision
    );
  }
  private async load(source: SearchSource, generation: number) {
    const runtime = this.pool.runtimes.get(source.tabId);
    if (!runtime?.port || !this.valid(source, runtime, generation)) {
      return;
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    const activity = crypto.randomUUID();
    runtime.activity.set(activity, '页面搜索');
    source.loading = true;
    source.error = '';
    this.changed();
    try {
      const cursor = source.cursor;
      const result = await runtime.port.request<PageSearchBatch>(
        'search.query',
        { query: this.query, cursor, limit: 50 },
        10000,
        controller.signal,
      );
      if (!this.valid(source, this.pool.runtimes.get(source.tabId), generation)) {
        return;
      }
      if (
        !Array.isArray(result.items) ||
        result.items.length > 100 ||
        !(result.nextCursor === null || typeof result.nextCursor === 'string') ||
        (result.nextCursor !== null && result.nextCursor === cursor)
      ) {
        throw new Error('页面搜索返回了无效或未推进的游标');
      }
      const ids = new Map(source.items.map((i) => [i.id, i]));
      for (const item of result.items) {
        if (typeof item.id !== 'string' || typeof item.title !== 'string') {
          throw new Error('搜索结果格式错误');
        }
        ids.set(item.id, item);
      }
      source.items = [...ids.values()];
      source.cursor = result.nextCursor;
      source.done = result.nextCursor === null;
      source.total = result.total;
    } catch (e) {
      if (this.valid(source, this.pool.runtimes.get(source.tabId), generation)) {
        source.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      runtime.activity.delete(activity);
      this.controllers.delete(controller);
      if (generation === this.generation) {
        source.loading = false;
        this.changed();
      }
    }
  }
  cancel() {
    this.active = false;
    for (const source of this.sources) {
      source.loading = false;
    }
    this.generation++;
    for (const c of this.controllers) {
      c.abort();
    }
    this.controllers.clear();
  }
  dispose() {
    this.cancel();
    this.pool.removeEventListener('search-changed', this.registrationChanged);
  }
}
