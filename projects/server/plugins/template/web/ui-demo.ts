import { html } from 'lit';
import type { ConfigChange } from '../../../types/plugin-config.d.ts';

type SDK = Window['scwcutils'];
export class PageUIDemo {
  private sdk: SDK;
  private changed: () => void;
  private log: (message: string, error?: boolean) => void;
  private handles: { dispose(): Promise<void> }[] = [];
  private subscriptions: (() => void)[] = [];
  private selectionListeners = new Set<(value: string) => void>();
  private search?: { dispose(): Promise<void> };
  private adapter?: { dispose(): void };
  private count = 0;
  private last: unknown = null;
  private config: Awaited<ReturnType<SDK['config']['get']>> | undefined;
  private selected: unknown;
  private result: unknown;
  private changes: unknown[] = [];
  private draft = '  从普通页面请求后端写入  ';
  private dirty = false;
  private busy = false;
  private alive = true;
  constructor(sdk: SDK, changed: () => void, log: (message: string, error?: boolean) => void) {
    this.sdk = sdk;
    this.changed = changed;
    this.log = log;
  }
  private selection() {
    return JSON.stringify({ document: location.hash || '/', count: this.count, last: this.last });
  }
  async registerHandlers() {
    if (this.handles.length) return;
    const page = this;
    this.handles.push(
      await this.sdk.ui.handlers.register('template.selection', {
        readOnly: true,
        async run() {
          this.signal.throwIfAborted();
          return page.selection();
        },
        watch(_args, emit) {
          page.selectionListeners.add(emit);
          return () => page.selectionListeners.delete(emit);
        },
      }),
    );
    this.handles.push(
      await this.sdk.ui.handlers.register('template.record', {
        async run(...args) {
          this.signal.throwIfAborted();
          page.count++;
          page.last = {
            args,
            invocation: this.invocation,
            sourceTabId: this.sourceTabId,
            event: this.event ?? null,
          };
          for (const emit of page.selectionListeners) emit(page.selection());
          page.changed();
          return page.selection();
        },
      }),
    );
  }
  async initialize() {
    await this.registerHandlers();
    if (!this.alive) {
      await this.dispose();
      return;
    }
    this.subscribe();
    this.adapter = this.sdk.navigation.registerAdapter((url) => {
      const next = new URL(url, location.href);
      history.replaceState(null, '', next.href);
      this.log(`navigation adapter ${next.hash}`);
    });
    if (this.sdk.host.capabilities.search)
      this.search = await this.sdk.search.register({
        search: async ({ query, cursor, limit, signal }) => {
          signal.throwIfAborted();
          const rows = ['模板参数', '模板监听', '模板配置', '模板生命周期'].filter((title) =>
            title.includes(query),
          );
          const start = Number(cursor || 0),
            end = start + limit;
          return {
            items: rows.slice(start, end).map((title, i) => ({
              id: String(start + i),
              title,
              url: `${location.pathname}#demo-${start + i}`,
            })),
            nextCursor: end < rows.length ? String(end) : null,
            total: rows.length,
          };
        },
      });
    this.changed();
  }
  private subscribe() {
    this.unsubscribe();
    const receive = (kind: string) => (change: ConfigChange) => {
      this.changes = [{ kind, ...change }, ...this.changes].slice(0, 20);
      this.changed();
    };
    this.subscriptions.push(
      this.sdk.config.subscribe(['validation.note'], receive('指定键')),
      this.sdk.config.subscribe(receive('全部配置')),
      this.sdk.config.subscribe(undefined, receive('undefined 键')),
    );
  }
  private unsubscribe() {
    for (const stop of this.subscriptions) stop();
    this.subscriptions = [];
  }
  private async perform(run: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    try {
      this.result = await run();
    } catch (error) {
      this.result = { error: String(error) };
      this.log(String(error), true);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async backend(path: string, body: Record<string, unknown>) {
    const response = await this.sdk.fetch(path, { method: 'POST', body: JSON.stringify(body) });
    if (!response.success) throw new Error(response.message);
    return response.data;
  }
  private async configAction(action: string) {
    const value = await this.backend('/validation/config', {
      action,
      value: this.draft,
      baseRevision: this.config?.revision,
    });
    // Never silently rebase a dirty draft after failure or a remote change.
    if (value && typeof value === 'object' && 'effectiveValues' in value)
      this.config = value as typeof this.config;
    if (action === 'set' || action === 'update') {
      this.draft = this.config?.effectiveValues['validation.note'] ?? this.draft;
      this.dirty = false;
    }
    return value;
  }
  snapshot() {
    return { count: this.count, last: this.last, dirty: this.dirty, draft: this.draft };
  }
  restore(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const state = value as ReturnType<PageUIDemo['snapshot']>;
    this.count = state.count ?? 0;
    this.last = state.last ?? null;
    this.draft = state.draft ?? this.draft;
    this.dirty = !!state.dirty;
  }
  async dispose() {
    this.alive = false;
    this.unsubscribe();
    this.adapter?.dispose();
    await this.search?.dispose();
    for (const handle of this.handles.splice(0)) await handle.dispose();
    this.selectionListeners.clear();
  }
  render() {
    const button = (label: string, run: () => unknown) =>
      html`<button ?disabled=${this.busy} @click=${run}>${label}</button>`;
    return html`<section class="panel ui-demo" aria-label="统一模板接入">
      <div class="section-heading">
        <h2>04 <span>统一模板接入</span></h2>
        <span class="caption">名称/参数 · 数据/监听 · 配置 · UI · 生命周期</span>
      </div>
      <p class="hint">
        主侧栏“模板验证”有四个演示标签；辅助页支持
        JSON/HTML。后端属性与核心配置位于“页面信息”。本页只读 SDK 配置，写入交给本插件业务 API。
      </p>
      <p>host.capabilities：<code>${JSON.stringify(this.sdk.host.capabilities)}</code></p>
      <p>当前页面状态：<code>${this.selection()}</code></p>
      <label
        >配置写入草稿<input
          aria-label="配置写入草稿"
          .value=${this.draft}
          @input=${(e: Event) => {
            this.draft = (e.target as HTMLInputElement).value;
            this.dirty = true;
          }}
      /></label>
      <div class="buttons">
        ${button('读取完整配置基线', () => this.perform(() => this.configAction('list')))}
        ${button('读取选定键', () =>
          this.perform(
            async () => (this.selected = await this.sdk.config.get(['validation.note'])),
          ),
        )}
        ${['get', 'set', 'update', 'delete', 'reset', 'changes', 'subscribe', 'unsubscribe'].map(
          (action) =>
            button(`后端 config.${action}`, () => this.perform(() => this.configAction(action))),
        )}
        ${button('保留草稿并重新读取基线', () => this.perform(() => this.configAction('list')))}
        ${button('接受远端值', () =>
          this.perform(async () => {
            await this.configAction('list');
            this.draft = this.config?.effectiveValues['validation.note'] ?? '';
            this.dirty = false;
            return this.config;
          }),
        )}
        ${button('取消全部配置订阅', () => {
          this.unsubscribe();
          this.log('本页全部 config.subscribe 已注销');
        })}
        ${button('恢复配置订阅', () => this.subscribe())}
      </div>
      <p>
        基线 revision=${this.config?.revision ?? '未读'} /
        schemaRevision=${this.config?.schemaRevision ?? '未读'} · 草稿
        ${this.dirty ? '已修改' : '未修改'}。另开同插件页面修改后，用旧基线写入观察 CAS
        拒绝，再显式选择保留或接受远端值。
      </p>
      <div class="buttons">
        ${button('查询声明式状态', () =>
          this.perform(() => this.backend('/validation/ui', { action: 'inspect' })),
        )}
        ${button('恢复声明式演示', () =>
          this.perform(async () => {
            await this.registerHandlers();
            return this.backend('/validation/ui', { action: 'restore' });
          }),
        )}
        ${[
          'bump',
          'main.set',
          'main.content',
          'aux.json',
          'aux.html',
          'aux.content',
          'hide',
          'show',
          'tooltip',
          'status.disabled',
          'status.visible',
          'invalid',
          'reject.cycle',
          'reject.cross',
          'inspector',
          'inspector.dispose',
          'main.dispose',
          'aux.dispose',
          'status.dispose',
          'dispose',
        ].map((action) =>
          button(`UI ${action}`, () =>
            this.perform(() => this.backend('/validation/ui', { action })),
          ),
        )}
        ${button('释放前端处理器', () =>
          this.perform(async () => {
            await this.backend('/validation/ui', { action: 'dispose' });
            for (const handle of this.handles.splice(0)) await handle.dispose();
            return { disposed: true };
          }),
        )}
        ${button('保存页面 checkpoint', () => this.perform(() => this.sdk.lifecycle.checkpoint()))}
        ${button('报告页面导航', () =>
          this.perform(() =>
            this.sdk.navigation.report({
              url: `${location.pathname}#template-demo`,
              title: '模板演示导航',
            }),
          ),
        )}
        ${button('导航到演示锚点', () =>
          this.perform(() => this.sdk.navigation.navigate(`${location.pathname}#template-demo`)),
        )}
      </div>
      <details>
        <summary>配置快照 / 最后结果 / 真实订阅事件（无轮询）</summary>
        <pre class="ui-demo-output">
${JSON.stringify(
            {
              config: this.config,
              selected: this.selected,
              result: this.result,
              changes: this.changes,
            },
            null,
            2,
          )}</pre>
      </details>
    </section>`;
  }
}
