import {
  uiAssert,
  uiName,
  uiValue,
  type HandlerDefinition,
  type HandlerContext,
  type UIValue,
} from '../../shared/declarative-ui.ts';

/** Page-local callbacks. The workbench only receives versioned descriptors. */
export function createPageHandlers(
  changed: (value: unknown) => void,
  emit: (value: unknown) => void,
) {
  const handlers = new Map<string, HandlerDefinition>(),
    stops = new Map<string, () => void>();
  let revision = 0;
  const descriptors = () => ({
    revision,
    handlers: [...handlers].map(([name, h]) => ({
      name,
      readOnly: h.readOnly === true,
      watch: Boolean(h.watch),
    })),
  });
  const api = {
    handlers: {
      register: async (name: string, definition: HandlerDefinition) => {
        uiName(name);
        uiAssert(
          typeof definition.run === 'function' && !handlers.has(name),
          'UI_INVALID_HANDLER_NAME',
          '前端处理器无效或重复',
        );
        handlers.set(name, definition);
        revision++;
        changed(descriptors());
        return {
          dispose: async () => {
            if (handlers.get(name) === definition) {
              handlers.delete(name);
              revision++;
              for (const stop of stops.values()) {
                stop();
              }
              stops.clear();
              changed(descriptors());
            }
          },
        };
      },
    },
  };
  const handle = async (
    data: {
      name: string;
      kind?: string;
      id?: string;
      args?: UIValue[];
      context?: Partial<HandlerContext> & { fields?: Record<string, UIValue> };
      revision?: number;
    },
    signal?: AbortSignal,
  ) => {
    if (data.kind === 'watch.stop') {
      stops.get(data.id ?? '')?.();
      stops.delete(data.id ?? '');
      return null;
    }
    uiAssert(
      data.revision === undefined || data.revision === revision,
      'UI_STALE_HANDLERS',
      '前端处理器版本已变化',
    );
    const definition = handlers.get(data.name);
    uiAssert(definition, 'UI_HANDLER_NOT_FOUND', '页面未提供该处理器');
    const controller = new AbortController(),
      context = {
        ...data.context,
        signal: controller.signal,
        readValue: (name: string) => {
          uiAssert(
            Object.hasOwn(data.context?.fields ?? {}, name),
            'UI_UNKNOWN_VALUE',
            '字段未采集',
          );
          const fields = data.context?.fields ?? {};
          return fields[name];
        },
      } as HandlerContext;
    const abort = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    uiAssert(
      context.invocation === 'event' || definition.readOnly,
      'UI_INVALID_EXPRESSION',
      '模板只能调用只读前端处理器',
    );
    if (data.kind === 'watch.start') {
      uiAssert(
        definition.readOnly && definition.watch && data.id,
        'UI_WATCH_UNSUPPORTED',
        '页面处理器不支持监听',
      );
      uiAssert(stops.size < 128, 'UI_QUOTA_EXCEEDED', '页面监听过多');
      stops.get(data.id)?.();
      const stop = await definition.watch.call(context, data.args ?? [], (value) => {
        if (!controller.signal.aborted) {
          emit({ id: data.id, value: uiValue(value), revision });
        }
      });
      if (controller.signal.aborted) {
        stop();
        throw Error('页面调用已取消');
      }
      stops.set(data.id, () => {
        controller.abort();
        stop();
      });
    }
    try {
      const value = await definition.run.apply(
        context,
        (data.args ?? []).map((value) => uiValue(value)),
      );
      return value === undefined ? { hasValue: false } : { hasValue: true, value: uiValue(value) };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };
  return {
    api,
    handle,
    descriptors,
    dispose: () => {
      for (const stop of stops.values()) {
        stop();
      }
      stops.clear();
      handlers.clear();
    },
  };
}
