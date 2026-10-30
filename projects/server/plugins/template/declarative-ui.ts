import { fileURLToPath } from 'node:url';
import type {
  PluginUI,
  Disposable,
  HandlerContext,
  UIValue,
  SidebarHandle,
  AuxiliaryHandle,
} from '../../../shared/declarative-ui.ts';
import { ids, mainContent, auxiliaryContent, statusDefinition } from './ui-content.ts';

/** Callbacks and state stay in this process; every identity comes from the core. */
export class DeclarativeDemo {
  private ui: PluginUI;
  private main?: SidebarHandle;
  private aux?: AuxiliaryHandle;
  private status?: Awaited<ReturnType<PluginUI['registerStatusBar']>>;
  private inspector?: Awaited<ReturnType<PluginUI['inspector']['register']>>;
  private resources: Disposable[] = [];
  private handlers: Disposable[] = [];
  private listeners = new Set<() => void>();
  private count = 0;
  private mode = 0;
  private disabled = false;
  private visible = true;
  private last: UIValue = null;
  private property = 0;
  private registered = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(ui: PluginUI) {
    this.ui = ui;
  }
  snapshot() {
    return {
      count: this.count,
      last: this.last,
      listeners: this.listeners.size,
      registered: this.registered,
      main: !!this.main,
      auxiliary: !!this.aux,
      status: !!this.status,
      property: this.property,
      tooltipFormat: ['text', 'json', 'html'][this.mode % 3],
    };
  }
  private notify() {
    for (const fn of this.listeners) fn();
  }
  async register() {
    if (this.registered) return;
    const owner = this;
    await this.ui.transaction(async (draft) => {
      for (const [mount, source] of [
        ['/demo.svg', { file: fileURLToPath(new URL('./assets/mark.svg', import.meta.url)) }],
        ['/demo-assets', { directory: fileURLToPath(new URL('./assets/', import.meta.url)) }],
      ] as const)
        this.resources.push(await draft.apis.mountStatic(mount, source));
      const register = async (
        name: string,
        definition: Parameters<PluginUI['handlers']['register']>[1],
      ) => this.handlers.push(await draft.handlers.register(name, definition));
      await register('demo.normalize', {
        readOnly: true,
        async run(value) {
          this.signal.throwIfAborted();
          if (typeof value !== 'string') throw new Error('需要字符串');
          return value.replace(/\s+/g, ' ');
        },
      });
      await register('demo.wait', {
        readOnly: true,
        async run() {
          await new Promise<void>((resolve, reject) => {
            this.signal.throwIfAborted();
            const abort = () => {
              clearTimeout(timer);
              reject(new Error('演示调用已取消'));
            };
            const timer = setTimeout(() => {
              this.signal.removeEventListener('abort', abort);
              resolve();
            }, 1500);
            this.signal.addEventListener('abort', abort, { once: true });
          });
          this.signal.throwIfAborted();
          return '异步完成';
        },
      });
      await register('demo.echo', {
        readOnly: true,
        run(...args) {
          return args;
        },
      });
      await register('demo.null', {
        readOnly: true,
        run() {
          return null;
        },
      });
      await register('demo.literal', {
        readOnly: true,
        run() {
          return '<img onerror="alert(1)">';
        },
      });
      await register('demo.reader', {
        readOnly: true,
        run() {
          return `后端计数 ${owner.count}`;
        },
      });
      await register('demo.progress', {
        readOnly: true,
        run() {
          return (owner.count % 11) / 10;
        },
      });
      await register('demo.positive', {
        readOnly: true,
        run() {
          return owner.count > 0;
        },
      });
      for (const [name, read] of [
        ['demo.counter', () => owner.count],
        ['demo.snapshot', () => owner.last],
      ] as const)
        await register(name, {
          readOnly: true,
          run() {
            return read();
          },
          async watch(_args, emit) {
            const next = () => emit(read());
            owner.listeners.add(next);
            return () => owner.listeners.delete(next);
          },
        });
      const record = function (this: HandlerContext, ...args: UIValue[]) {
        owner.last = {
          args,
          invocation: this.invocation,
          eventId: this.eventId ?? null,
          instanceId: this.instanceId,
          sourceTabId: this.sourceTabId,
          source: this.source.kind,
          event: (this.event ?? null) as UIValue,
          cancelled: this.signal.aborted,
        };
        owner.notify();
        return owner.last;
      };
      await register('demo.record', { run: record });
      await register('demo.capture', {
        reads: ['query', 'memo', 'choice', 'checked', 'toggle'],
        run(...args) {
          return record.call(this, ...args, { query: this.readValue('query') });
        },
      });
      await register('demo.void', {
        run() {
          owner.last = 'void 已执行';
          owner.notify();
        },
      });
      await register('demo.manage', {
        async run(action) {
          return owner.manage(String(action), this);
        },
      });
      this.main = await draft.registerMainSidebar({
        id: ids.main,
        title: '模板验证',
        icon: { kind: 'builtin', name: 'beaker' },
        content: mainContent(),
      });
      this.aux = await draft.registerAuxiliarySidebar({
        id: ids.aux,
        title: '模板详情',
        icon: { kind: 'asset', path: '/demo.svg' },
        content: async (context) => {
          context.signal.throwIfAborted();
          return auxiliaryContent('html');
        },
      });
      this.status = await draft.registerStatusBar(
        statusDefinition(this.mode, this.count, this.disabled, this.visible),
      );
      this.inspector = await draft.inspector.register({
        async provide(context) {
          context.signal.throwIfAborted();
          return {
            title: `模板后端属性 ${owner.property}`,
            properties: [
              { key: 'source', label: '属性来源', value: '插件后端，非浏览器状态' },
              { key: 'property', label: '失效计数', value: String(owner.property) },
              {
                key: 'locator',
                label: '核心定位',
                value: context.locator ? JSON.stringify(context.locator) : '无来源页面',
              },
            ],
          };
        },
      });
    });
    this.registered = true;
  }
  action(action: string) {
    const task = this.queue.then(() => this.manage(action));
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async manage(action: string, context?: HandlerContext): Promise<UIValue> {
    if ((action.startsWith('main.') || action.startsWith('reject.')) && !this.main)
      throw new Error('主侧栏已释放，请先恢复声明式演示');
    if ((action.startsWith('aux.') || ['hide', 'show', 'invalid'].includes(action)) && !this.aux)
      throw new Error('辅助页已释放，请先恢复声明式演示');
    if ((action.startsWith('status.') || action === 'tooltip') && !this.status)
      throw new Error('状态项已释放，请先恢复声明式演示');
    if (action === 'restore') {
      await this.dispose();
      this.mode = 0;
      this.disabled = false;
      this.visible = true;
      await this.register();
    } else if (action === 'dispose') await this.dispose();
    else if (action === 'bump') {
      this.count++;
      this.notify();
    } else if (action === 'main.set')
      await this.main?.set({
        id: ids.main,
        title: '模板验证 · 已更新',
        icon: { kind: 'asset', path: '/demo.svg' },
        content: async (ctx) => {
          ctx.signal.throwIfAborted();
          return mainContent('异步 RenderContext 来源');
        },
      });
    else if (action === 'main.content')
      await this.main?.setContent(mainContent('全实例 setContent'));
    else if (action === 'target') {
      if (!context || !['mainSidebar', 'auxiliarySidebar'].includes(context.source.kind))
        throw new Error('定向更新只能从核心绑定的侧栏实例触发');
      const handle = context.source.kind === 'mainSidebar' ? this.main : this.aux;
      if (!handle) throw new Error('目标侧栏已释放，请先恢复声明式演示');
      await handle?.setContent(
        context.source.kind === 'mainSidebar'
          ? mainContent(`定向实例 ${context.instanceId}`)
          : auxiliaryContent('json'),
        { instanceId: context.instanceId },
      );
    } else if (action === 'aux.json' || action === 'aux.html')
      await this.aux?.set({
        id: ids.aux,
        title: action === 'aux.json' ? '模板详情 JSON' : '模板详情 HTML',
        icon: { kind: 'builtin', name: 'info' },
        content: auxiliaryContent(action === 'aux.json' ? 'json' : 'html'),
      });
    else if (action === 'aux.content') await this.aux?.setContent(auxiliaryContent('json'));
    else if (action === 'hide' || action === 'show')
      await this.aux?.setCurrentPageVisible(action === 'show');
    else if (action === 'reject.cycle' || action === 'reject.cross') {
      try {
        await this.main?.setContent({
          format: 'json',
          version: 1,
          root: {
            type: 'button',
            name: 'cycle',
            text: '此非法模板不能发布',
            events: {
              click:
                action === 'reject.cycle'
                  ? "core:event.trigger('cycle','click')"
                  : 'demo.echo()|ui:template.record($prev)',
            },
          },
        });
        throw new Error('核心未拒绝非法模板');
      } catch (error) {
        if (!(error instanceof Error) || !/循环|前后端/.test(error.message)) throw error;
        this.last = { rejected: true, message: error.message };
        this.notify();
      }
    } else if (action === 'invalid') {
      try {
        await this.ui.transaction(async () => {
          await this.main?.setContent(mainContent('这个批次必须回滚'));
          await this.aux?.set({
            id: ids.aux,
            title: '非法隐藏',
            icon: { kind: 'builtin', name: 'info' },
            hideCurrentPage: true,
            content: null as never,
          });
        });
        throw new Error('核心未拒绝非法批次');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('隐藏页面信息前')) throw error;
        this.last = { rejected: true, message: error.message };
        this.notify();
      }
    } else if (action === 'inspector' || action === 'inspector.target') {
      if (action === 'inspector.target' && !context?.sourceTabId)
        throw new Error('此操作需要真实来源页 tabId');
      this.property++;
      await this.inspector?.invalidate(
        action === 'inspector.target' ? { tabId: context!.sourceTabId! } : undefined,
      );
      this.last = 'HostUI 当前忽略 invalidate target，实际为全量投影失效';
      this.notify();
    } else if (action === 'tooltip' || action.startsWith('status.')) {
      if (action === 'tooltip') this.mode++;
      if (action === 'status.disabled') this.disabled = !this.disabled;
      if (action === 'status.visible') this.visible = !this.visible;
      if (action === 'status.dispose') {
        await this.status?.dispose();
        this.status = undefined;
      } else
        await this.status?.set(
          statusDefinition(this.mode, this.count, this.disabled, this.visible),
        );
    } else if (action === 'aux.dispose') {
      await this.aux?.dispose();
      this.aux = undefined;
    } else if (action === 'main.dispose') {
      await this.main?.dispose();
      this.main = undefined;
    } else if (action === 'inspector.dispose') {
      await this.inspector?.dispose();
      this.inspector = undefined;
    } else if (action !== 'inspect') throw new Error('未知声明式验证操作');
    return this.snapshot();
  }
  async dispose() {
    await this.ui.transaction(async () => {
      // Remove references before releasing handlers/resources in the same batch.
      await this.main?.dispose();
      await this.aux?.dispose();
      await this.status?.dispose();
      await this.inspector?.dispose();
      for (const handle of [...this.handlers, ...this.resources].reverse()) await handle.dispose();
    });
    this.main = undefined;
    this.aux = undefined;
    this.status = undefined;
    this.inspector = undefined;
    this.handlers = [];
    this.resources = [];
    this.listeners.clear();
    this.registered = false;
  }
}
let demo: DeclarativeDemo | undefined;
export async function registerDeclarativeDemo(ui: PluginUI) {
  demo = new DeclarativeDemo(ui);
  await demo.register();
}
export async function unloadDeclarativeDemo() {
  await demo?.dispose();
  demo = undefined;
}
export const declarativeApis: SCWC.TPluginApi[] = [
  {
    method: 'POST',
    path: '/validation/ui',
    async handler(data) {
      if (!demo || !data || typeof data !== 'object' || !('action' in data))
        throw new Error('演示尚未加载');
      return demo.action(String(data.action));
    },
  },
];
