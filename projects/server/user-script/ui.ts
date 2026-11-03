import { randomUUID } from 'node:crypto';
import { validateUIValue } from '../../shared/ui-validation.ts';
import type { ScriptConfigStorage, ScriptConfigBaseline } from './ui-config.ts';
import { compileUI } from '../workbench/ui-compiler.ts';
import { evaluateArgument, evaluateTemplate } from '../../shared/ui-expressions.ts';
import {
  uiAssert,
  uiValue,
  UI_LIMITS,
  type UIValue,
  type UINode,
  type CallNode,
  type FieldValue,
} from '../../shared/declarative-ui.ts';
import type {
  ScriptConfigV2,
  ScriptContext,
  ScriptUIEvent,
  ScriptUIModel,
  ScriptUIResult,
} from '../../shared/script-ui.ts';

const builtins: Record<string, (...args: UIValue[]) => UIValue> = {
  'string.trim': (v) => String(v ?? '').trim(),
  'string.concat': (...v) => v.join(''),
  'string.lower': (v) => String(v).toLowerCase(),
  'string.upper': (v) => String(v).toUpperCase(),
  'json.parse': (v) => uiValue(JSON.parse(String(v))),
  'json.stringify': (v) => JSON.stringify(v),
  'number.parse': (v) => uiValue(Number(v)),
  'number.add': (...v) => uiValue(v.reduce<number>((sum, n) => sum + Number(n), 0)),
  'number.multiply': (...v) => uiValue(v.reduce<number>((product, n) => product * Number(n), 1)),
  'boolean.parse': (v) => v === true || v === 'true',
  'string.toString': (v) => String(v ?? ''),
  validate: validateUIValue,
  not: (v) => !v,
  equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  default: (v, fallback) => (v === null || v === '' ? fallback : v),
};
type Instance = {
  site: string;
  model: ScriptUIModel;
  config: ScriptConfigV2;
  defaults: Record<string, FieldValue>;
  pending: number;
  touched: number;
  tail: Promise<unknown>;
  replies: Map<string, { fingerprint: string; result: Promise<ScriptUIResult> }>;
  bound: Map<
    string,
    ScriptConfigBaseline & { key: string; scope: 'plugin' | 'site'; fallback: string }
  >;
};

/** Lives inside the plugin process. Functions and event programs never come from the browser. */
export class ScriptUIRuntime {
  private storage?: ScriptConfigStorage;
  constructor(storage?: ScriptConfigStorage) {
    this.storage = storage;
  }
  private instances = new Map<string, Instance>();
  private validate(config: ScriptConfigV2, name: string, readOnly: boolean, watch: boolean) {
    const bound = /^core:(?:site\.)?config\.bound\.(read|write)$/.exec(name);
    uiAssert(
      (!watch || bound?.[1] === 'read') && !name.startsWith('ui:'),
      'UI_INVALID_HANDLER',
      '脚本配置仅支持后端处理器',
    );
    if (bound) {
      uiAssert(
        this.storage && (!readOnly || bound[1] === 'read'),
        'UI_HANDLER_NOT_READ_ONLY',
        '配置绑定需要核心存储，模板只能读取配置',
      );
      return;
    }
    if (name.startsWith('core:')) {
      uiAssert(
        Object.hasOwn(builtins, name.slice(5)) || name === 'core:value.read',
        'UI_UNKNOWN_HANDLER',
        `未知内置处理器 ${name}`,
      );
    } else {
      uiAssert(
        Object.hasOwn(config.handlers ?? {}, name),
        'UI_UNKNOWN_HANDLER',
        `未知处理器 ${name}`,
      );
      uiAssert(
        !readOnly || config.handlers?.[name].readOnly === true,
        'UI_HANDLER_NOT_READ_ONLY',
        '模板只能调用只读处理器',
      );
    }
  }
  private async invoke(
    config: ScriptConfigV2,
    context: ScriptContext,
    call: CallNode,
    args: UIValue[],
    instance?: Instance,
    saved?: Record<string, FieldValue>,
  ) {
    if (/^core:(?:site\.)?config\.bound\.(read|write)$/.test(call.name)) {
      uiAssert(instance && this.storage, 'UI_INVALID_CONTENT', '配置实例未就绪');
      const scope = call.name.startsWith('core:site.') ? 'site' : 'plugin';
      const key = String(args[0]),
        field = String(args[1]);
      const previous = instance.bound.get(field);
      if (call.name.endsWith('.read')) {
        const current = await this.storage.read(scope, instance.site, key);
        const fallback = String(args[2]);
        const currentField = context.values[field];
        if (
          !previous ||
          currentField === undefined ||
          String(currentField) === String(previous.value ?? previous.fallback)
        ) {
          instance.bound.set(field, { ...current, key, scope, fallback });
        }
        return current.value ?? fallback;
      }
      uiAssert(
        previous?.key === key && previous.scope === scope,
        'UI_INVALID_CONTENT',
        '请先读取配置基线',
      );
      const boolean =
        instance.model.compiled.fields.find((f) => f.name === field)?.kind === 'boolean';
      const result = await this.storage.write(
        scope,
        instance.site,
        key,
        String(args[2]),
        previous,
        boolean,
      );
      instance.bound.set(field, { ...previous, ...result });
      const value = boolean
        ? result.value === true || result.value === 'true'
        : String(result.value ?? '');
      context.values[field] = value;
      if (saved) saved[field] = value;
      return result.value ?? null;
    }
    const handler = config.handlers?.[call.name];
    uiAssert(call.name.startsWith('core:') || handler, 'UI_UNKNOWN_HANDLER', '处理器已失效');
    const value =
      call.name === 'core:value.read'
        ? (context.values[String(args[0])] ?? null)
        : call.name.startsWith('core:')
          ? builtins[call.name.slice(5)](...args)
          : await handler?.run.apply(context, args);
    return value === undefined ? undefined : uiValue(value);
  }
  private async updates(instance: Instance, context: ScriptContext) {
    const updates: ScriptUIModel['updates'] = [];
    for (const binding of instance.model.compiled.expressions) {
      updates.push({
        id: binding.id,
        value: await evaluateTemplate(binding.parts, {
          fields: context.values,
          invoke: (call, args) => this.invoke(instance.config, context, call, args, instance),
        }),
      });
    }
    return updates;
  }
  async render(config: ScriptConfigV2, context: ScriptContext): Promise<ScriptUIModel> {
    for (const [id, instance] of this.instances) {
      if (Date.now() - instance.touched > 15 * 60_000) {
        this.instances.delete(id);
      }
    }
    while (this.instances.size >= 128) {
      const oldest = this.instances.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.instances.delete(oldest);
    }
    const source =
      typeof config.content === 'function' ? await config.content(context) : config.content;
    uiAssert(
      source?.format === 'json' && source.version === 1,
      'UI_INVALID_CONTENT',
      'v2 必须显式提供 JSON content',
    );
    let count = 0;
    const expand = async (node: UINode, depth = 0): Promise<UINode> => {
      uiAssert(
        ++count <= UI_LIMITS.nodes && depth <= UI_LIMITS.depth,
        'UI_QUOTA_EXCEEDED',
        '自定义控件展开超过限制',
      );
      if (node.type === 'custom') {
        const name = String(node.component);
        const component = Object.hasOwn(config.components ?? {}, name)
          ? config.components?.[name]
          : undefined;
        uiAssert(component, 'UI_INVALID_CONTENT', `未知自定义控件 ${name}`);
        return expand(await component(uiValue(node.props ?? {}), context), depth + 1);
      }
      return {
        ...node,
        ...(node.children
          ? { children: await Promise.all(node.children.map((n) => expand(n, depth + 1))) }
          : {}),
        ...(node.tabs
          ? {
              tabs: await Promise.all(
                node.tabs.map(async (tab) => ({
                  ...tab,
                  children: await Promise.all(tab.children.map((n) => expand(n, depth + 1))),
                })),
              ),
            }
          : {}),
      };
    };
    const compiled = compileUI(
      { ...source, root: await expand(source.root) },
      {
        resource: () => {
          throw new Error('脚本 JSON 不允许远程资源，请使用内置图标');
        },
        validateCall: (name, readOnly, watch) => this.validate(config, name, readOnly, watch),
      },
    );
    const model: ScriptUIModel = { instanceId: randomUUID(), compiled, updates: [] };
    const defaults: Record<string, FieldValue> = {};
    const collect = (nodes: typeof compiled.nodes) => {
      for (const node of nodes) {
        const field = compiled.fields.find((f) => f.nodeId === node.id);
        if (field) {
          defaults[field.name] =
            field.kind === 'boolean'
              ? Object.hasOwn(node.attrs ?? {}, 'checked')
              : field.kind === 'multiple'
                ? (node.children ?? [])
                    .filter((n) => Object.hasOwn(n.attrs ?? {}, 'selected'))
                    .map((n) => n.attrs?.value ?? '')
                : (node.attrs?.value ?? '');
        }
        collect(node.children ?? []);
      }
    };
    collect(compiled.nodes);
    const instance: Instance = {
      site: context.site.url,
      model,
      config,
      defaults,
      pending: 0,
      touched: Date.now(),
      tail: Promise.resolve(),
      replies: new Map(),
      bound: new Map(),
    };
    model.updates = await this.updates(instance, {
      ...context,
      values: { ...defaults, ...context.values },
    });
    model.boundFields = [...instance.bound.keys()];
    const previous = context.previousInstanceId
      ? this.instances.get(context.previousInstanceId)
      : undefined;
    if (previous?.site === instance.site) {
      for (const field of context.dirtyFields ?? []) {
        const baseline = previous.bound.get(field),
          current = instance.bound.get(field);
        if (
          baseline &&
          current?.key === baseline.key &&
          current.scope === baseline.scope &&
          previous.model.compiled.fields.find((f) => f.name === field)?.kind ===
            compiled.fields.find((f) => f.name === field)?.kind
        )
          instance.bound.set(field, { ...baseline });
      }
    }
    this.instances.set(model.instanceId, instance);
    return model;
  }
  async event(request: ScriptUIEvent, context: ScriptContext): Promise<ScriptUIResult> {
    uiValue(request, UI_LIMITS.bytes);
    const instance = this.instances.get(request.instanceId);
    uiAssert(
      request.version === 'v2' &&
        instance &&
        instance.site === context.site.url &&
        Date.now() - instance.touched < 15 * 60_000,
      'UI_STALE_INSTANCE',
      '插件配置已过期，请刷新插件',
    );
    const readOnly = request.readOnly === true && request.bindingId === '$read';
    const binding = instance.model.compiled.events.find((item) => item.id === request.bindingId);
    uiAssert(
      (readOnly || (!request.readOnly && binding)) && request.eventId?.length <= 200,
      'UI_INVALID_EVENT',
      '未知事件绑定',
    );
    const fields: Record<string, FieldValue> = { ...instance.defaults };
    for (const field of instance.model.compiled.fields) {
      const value = request.fields[field.name]?.value;
      if (value === undefined) {
        continue;
      }
      uiAssert(
        field.kind === 'boolean'
          ? typeof value === 'boolean'
          : field.kind === 'multiple'
            ? Array.isArray(value) && value.every((v) => typeof v === 'string')
            : typeof value === 'string',
        'UI_INVALID_VALUE_TYPE',
        '字段值类型无效',
      );
      fields[field.name] = value;
    }
    const fingerprint = JSON.stringify(request);
    const cached = readOnly ? undefined : instance.replies.get(request.eventId);
    if (cached) {
      uiAssert(cached.fingerprint === fingerprint, 'UI_EVENT_CONFLICT', '事件身份冲突');
      return cached.result;
    }
    uiAssert(
      readOnly || instance.replies.size < 512,
      'UI_QUOTA_EXCEEDED',
      '事件数量已达限制，请刷新插件',
    );
    uiAssert(instance.pending < 32, 'UI_QUOTA_EXCEEDED', '插件事件队列已满');
    instance.pending++;
    instance.touched = Date.now();
    const work = instance.tail
      .catch(() => undefined)
      .then(async () => {
        const signal = AbortSignal.any([
          ...(context.signal ? [context.signal] : []),
          AbortSignal.timeout(10000),
        ]);
        const ctx = { ...context, signal, values: fields };
        if (readOnly) {
          for (const field of instance.bound.keys())
            if (!Object.hasOwn(request.fields, field)) delete ctx.values[field];
          return { updates: await this.updates(instance, ctx) };
        }
        uiAssert(binding, 'UI_INVALID_EVENT', '未知事件绑定');
        const saved: Record<string, FieldValue> = {};
        const eventField = instance.model.compiled.fields.find((f) => f.nodeId === binding.nodeId);
        const event: UIValue = {
          type: binding.event,
          values: Object.fromEntries(binding.for.map((name) => [name, fields[name]])),
          ...(eventField ? { name: eventField.name, value: fields[eventField.name] } : {}),
          ...(request.event?.modifiers ? { modifiers: request.event.modifiers } : {}),
        };
        const invoke = async (call: CallNode, args: UIValue[]) => {
          signal.throwIfAborted();
          let abort!: () => void;
          const cancelled = new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
          });
          try {
            return await Promise.race([
              this.invoke(instance.config, ctx, call, args, instance, saved),
              cancelled,
            ]);
          } finally {
            signal.removeEventListener('abort', abort);
          }
        };
        let result: UIValue | undefined;
        for (const branch of binding.program.branches) {
          let prev: UIValue | undefined;
          for (const step of branch) {
            prev = await evaluateArgument(step, { fields, event, prev, invoke });
          }
          result = prev;
        }
        return {
          ...(result === undefined ? {} : { result }),
          updates: await this.updates(instance, ctx),
          saved,
        };
      })
      .finally(() => {
        instance.pending--;
      });
    instance.tail = work;
    if (!readOnly) instance.replies.set(request.eventId, { fingerprint, result: work });
    return work;
  }
}
