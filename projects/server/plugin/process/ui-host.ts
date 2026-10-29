import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  uiAssert,
  uiName,
  uiValue,
  type PluginUI,
  type HandlerDefinition,
  type InspectorProvider,
  type UISurface,
  type UIWireRegistry,
  type UIValue,
  type HandlerContext,
  type RenderContext,
} from '../../../shared/declarative-ui.ts';

/** Callbacks never leave the plugin process. Only the data snapshot is published. */
export class HostUI {
  private handlers = new Map<string, HandlerDefinition>();
  private providers = new Map<string, (context: RenderContext) => unknown>();
  private views = new Map<UISurface, Record<string, UIValue>>();
  private mounts = new Map<string, { path: string; file?: string; directory?: string }>();
  private inspector?: InspectorProvider;
  private stops = new Map<string, () => void>();
  private controllers = new Map<string, AbortController>();
  private publish: (snapshot: UIWireRegistry) => Promise<unknown>;
  private emit: (id: string, value: UIValue) => void;
  private active = false;
  private transactionScope = new AsyncLocalStorage<boolean>();
  private target: (data: Record<string, unknown>) => Promise<unknown>;
  private transactionDepth = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    publish: (snapshot: UIWireRegistry) => Promise<unknown>,
    emit: (id: string, value: UIValue) => void,
    target: (data: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.publish = publish;
    this.emit = emit;
    this.target = target;
  }
  snapshot(): UIWireRegistry {
    return {
      handlers: [...this.handlers].map(([name, h]) => ({
        name,
        readOnly: h.readOnly === true,
        watch: typeof h.watch === 'function',
        reads: h.reads ?? [],
      })),
      views: [...this.views].map(([surface, definition]) => ({ surface, definition })),
      mounts: [...this.mounts.values()],
      inspector: Boolean(this.inspector),
    };
  }
  activate() {
    this.active = true;
  }
  private wire(value: unknown): UIValue {
    if (typeof value === 'function') {
      const id = randomUUID();
      this.providers.set(id, value as (c: RenderContext) => unknown);
      return { $provider: id };
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.wire(v));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, this.wire(v)]),
      );
    }
    return uiValue(value);
  }
  private mutate(run: () => void) {
    const task = async () => {
      const before = {
        handlers: new Map(this.handlers),
        providers: new Map(this.providers),
        views: new Map(this.views),
        mounts: new Map(this.mounts),
        inspector: this.inspector,
      };
      try {
        run();
        if (this.active && !this.transactionDepth) {
          await this.publish(this.snapshot());
        }
      } catch (error) {
        Object.assign(this, before);
        throw error;
      }
    };
    if (this.transactionDepth && this.transactionScope.getStore()) {
      return task();
    }
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private validateAuxiliaryTemplate(surface: UISurface, definition: Record<string, UIValue>) {
    if (surface !== 'auxiliarySidebar' || definition.hideCurrentPage !== true) {
      return;
    }
    const content = definition.content;
    uiAssert(content && typeof content === 'object' && !Array.isArray(content), 'UI_INVALID_CONTENT', '隐藏页面信息前必须提供 JSON 或 HTML 模板');
    uiAssert(
      (typeof content.$provider === 'string' && this.providers.has(content.$provider)) ||
        (content.version === 1 &&
          ((content.format === 'html' && typeof content.html === 'string') ||
            (content.format === 'json' && content.root && typeof content.root === 'object' && !Array.isArray(content.root)))),
      'UI_INVALID_CONTENT',
      '隐藏页面信息前必须提供 JSON 或 HTML 模板',
    );
  }
  private async register(surface: UISurface, definition: unknown) {
    const serialized = this.wire(definition) as Record<string, UIValue>;
    uiName(serialized.id);
    await this.mutate(() => {
      uiAssert(!this.views.has(surface), 'UI_QUOTA_EXCEEDED', '每插件每区域只能注册一项');
      this.validateAuxiliaryTemplate(surface, serialized);
      this.views.set(surface, serialized);
    });
    const id = serialized.id;
    return {
      dispose: () =>
        this.mutate(() => {
          if (this.views.get(surface)?.id === id) {
            this.views.delete(surface);
          }
        }),
      set: async (def: unknown) => {
        const next = this.wire(def) as Record<string, UIValue>;
        uiAssert(next.id === id, 'UI_INVALID_CONTENT', '贡献 ID 不可改变');
        await this.mutate(() => {
          this.validateAuxiliaryTemplate(surface, next);
          this.views.set(surface, next);
        });
      },
      setContent: async (content: unknown, target?: { instanceId: string }) => {
        if (target) {
          await this.target({
            surface,
            viewId: id,
            instanceId: target.instanceId,
            content: this.wire(content),
          });
          return;
        }
        await this.mutate(() => {
          const old = this.views.get(surface);
          uiAssert(old, 'UI_STALE_INSTANCE', '贡献已释放');
          const next = { ...old, content: this.wire(content) };
          this.validateAuxiliaryTemplate(surface, next);
          this.views.set(surface, next);
        });
      },
      setCurrentPageVisible: (visible: boolean) =>
        this.mutate(() => {
          const old = this.views.get(surface);
          uiAssert(old, 'UI_STALE_INSTANCE', '贡献已释放');
          const next = { ...old, hideCurrentPage: !visible };
          this.validateAuxiliaryTemplate(surface, next);
          this.views.set(surface, next);
        }),
    };
  }
  readonly api: PluginUI = {
    apis: {
      mountStatic: async (path, source) => {
        uiAssert(
          path.startsWith('/') && !this.mounts.has(path),
          'UI_RESOURCE_DENIED',
          '挂载路径无效或重复',
        );
        await this.mutate(() => this.mounts.set(path, { path, ...source }));
        return {
          dispose: () =>
            this.mutate(() => {
              this.mounts.delete(path);
            }),
        };
      },
    },
    handlers: {
      register: async (name, definition) => {
        uiName(name);
        uiAssert(typeof definition.run === 'function', 'UI_INVALID_CONTENT', '处理器缺少 run');
        (definition.reads ?? []).forEach(uiName);
        await this.mutate(() => {
          uiAssert(!this.handlers.has(name), 'UI_HANDLER_IN_USE', '处理器重复');
          this.handlers.set(name, definition);
        });
        return {
          dispose: () =>
            this.mutate(() => {
              this.handlers.delete(name);
            }),
        };
      },
    },
    registerMainSidebar: (def) => this.register('mainSidebar', def),
    registerAuxiliarySidebar: (def) => this.register('auxiliarySidebar', def),
    registerStatusBar: (def) => this.register('statusBar', def),
    inspector: {
      register: async (def) => {
        await this.mutate(() => {
          uiAssert(!this.inspector, 'UI_QUOTA_EXCEEDED', '只能注册一个属性提供器');
          this.inspector = def;
        });
        return {
          dispose: () =>
            this.mutate(() => {
              this.inspector = undefined;
            }),
          invalidate: () => this.mutate(() => undefined),
        };
      },
    },
    transaction: async (run) => {
      uiAssert(!this.transactionScope.getStore(), 'UI_INVALID_CONTENT', '不支持嵌套事务');
      const task = () =>
        this.transactionScope.run(true, async () => {
          const before = {
            handlers: new Map(this.handlers),
            providers: new Map(this.providers),
            views: new Map(this.views),
            mounts: new Map(this.mounts),
            inspector: this.inspector,
          };
          this.transactionDepth++;
          try {
            await run(this.api);
            if (this.active) {
              await this.publish(this.snapshot());
            }
          } catch (error) {
            Object.assign(this, before);
            throw error;
          } finally {
            this.transactionDepth--;
          }
        });
      const result = this.queue.then(task);
      this.queue = result.catch(() => undefined);
      await result;
    },
  };
  async invoke(data: {
    kind: string;
    name?: string;
    args?: UIValue[];
    context: Omit<HandlerContext, 'signal' | 'readValue'> & { fields?: Record<string, UIValue> };
    id?: string;
  }) {
    if (data.kind === 'cancel') {
      this.controllers.get(data.id ?? '')?.abort();
      return null;
    }
    if (data.kind === 'watch.stop') {
      this.stops.get(data.id ?? '')?.();
      this.stops.delete(data.id ?? '');
      this.controllers.get(data.id ?? '')?.abort();
      this.controllers.delete(data.id ?? '');
      return null;
    }
    const controller = new AbortController();
    if (data.id) {
      this.controllers.set(data.id, controller);
    }
    const context = {
      ...data.context,
      signal: controller.signal,
      readValue: (name: string) => {
        const value = data.context.fields?.[name];
        uiAssert(value !== undefined, 'UI_UNKNOWN_VALUE', '字段未采集');
        return value;
      },
    } as HandlerContext;
    try {
      if (data.kind === 'content') {
        const fn = this.providers.get(data.name ?? '');
        uiAssert(fn, 'UI_STALE_HANDLERS', '内容提供器已失效');
        return uiValue(await fn(context as unknown as RenderContext), 262144);
      }
      if (data.kind === 'inspector') {
        return this.inspector
          ? uiValue(await this.inspector.provide(context as never))
          : { properties: [] };
      }
      const handler = this.handlers.get(data.name ?? '');
      uiAssert(handler, 'UI_HANDLER_NOT_FOUND', '处理器不存在');
      if (data.kind === 'watch.start') {
        uiAssert(
          handler.readOnly && handler.watch && data.id,
          'UI_WATCH_UNSUPPORTED',
          '处理器不支持监听',
        );
        const watchId = data.id;
        const stop = await handler.watch.call(context, data.args ?? [], (value) => {
          if (!controller.signal.aborted) {
            this.emit(watchId, uiValue(value));
          }
        });
        if (controller.signal.aborted) {
          stop();
          this.controllers.delete(data.id);
          throw new Error('监听已取消');
        }
        this.stops.set(data.id, () => {
          controller.abort();
          stop();
        });
      }
      const value = await handler.run.apply(context, data.args ?? []);
      return value === undefined ? { hasValue: false } : { hasValue: true, value: uiValue(value) };
    } finally {
      if (data.id && data.kind !== 'watch.start') {
        this.controllers.delete(data.id);
      }
    }
  }

  dispose() {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    for (const stop of this.stops.values()) {
      stop();
    }
    this.stops.clear();
  }
}
