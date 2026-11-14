import { randomUUID } from 'node:crypto';
import { validateUIValue } from '../../shared/ui-validation.ts';
import type { ScriptConfigStorage, ScriptConfigBaseline } from './ui-config.ts';
import { compileUI } from '../workbench/ui-compiler.ts';
import {
  evaluateArgument,
  evaluateTemplate,
  validateUIField,
} from '../../shared/ui-expressions.ts';
import {
  uiAssert,
  uiValue,
  UI_LIMITS,
  type UIValue,
  type UINode,
  type CallNode,
  type FieldValue,
  type ClientEffect,
} from '../../shared/declarative-ui.ts';
import type {
  ScriptConfigV2,
  ScriptContext,
  ScriptUIEvent,
  ScriptUIModel,
  ScriptUIResult,
} from '../../shared/script-ui.ts';
import { TreeSessions } from '../../shared/tree-session.ts';
import type { TreeCommand } from '../../shared/tree.ts';

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
  trees: TreeSessions;
  registration: string;
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
  private handlerIds = new WeakMap<object, number>();
  private nextHandlerId = 0;
  private registration(config: ScriptConfigV2) {
    return JSON.stringify(
      Object.entries(config.handlers ?? {}).map(([name, handler]) => {
        if (!this.handlerIds.has(handler.run)) {
          this.handlerIds.set(handler.run, ++this.nextHandlerId);
        }
        return [name, this.handlerIds.get(handler.run), handler.readOnly === true];
      }),
    );
  }
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
        Object.hasOwn(builtins, name.slice(5)) ||
          name === 'core:value.read' ||
          (!readOnly && (name === 'core:value.write' || name.startsWith('core:tree.'))),
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
    effects: ClientEffect[] = [],
  ) {
    this.validate(config, call.name, call.readOnly === true, call.watch);
    if (call.name === 'core:value.write') {
      uiAssert(instance && typeof args[0] === 'string', 'UI_UNKNOWN_VALUE', '字段不存在');
      const name = args[0],
        field = instance.model.compiled.fields.find((field) => field.name === name),
        value = args[1];
      uiAssert(
        field &&
          (field.kind === 'multiple'
            ? Array.isArray(value) && value.every((item) => typeof item === 'string')
            : field.kind === 'boolean'
              ? typeof value === 'boolean'
              : typeof value === 'string'),
        'UI_INVALID_VALUE_TYPE',
        '字段值类型无效',
      );
      const tree = instance.trees.field(name);
      if (tree) {
        const patches = await tree.prepareSelection(
          value,
          { instanceId: instance.model.instanceId, renderRevision: 1 },
          {
            fields: context.values,
            signal: context.signal,
            invoke: (call, args, signal) =>
              this.invoke(config, { ...context, signal }, call, args, instance),
          },
        );
        for (const patch of patches) {
          effects.push({
            id: randomUUID(),
            type: 'tree.patch',
            args: [name, patch as unknown as UIValue],
            instanceId: instance.model.instanceId,
            renderRevision: 1,
          });
        }
        tree.validateSelection(value, true);
      }
      context.values[name] = value as FieldValue;
      if (saved) {
        saved[name] = value as FieldValue;
      }
      return value;
    }
    if (call.name.startsWith('core:tree.')) {
      uiAssert(instance && typeof args[0] === 'string', 'TREE_UNKNOWN_TREE', '树目标无效');
      const tree = instance.trees.field(args[0]);
      uiAssert(tree, 'TREE_UNKNOWN_TREE', '树不存在');
      const type = call.name.slice(10);
      const command =
        type === 'move'
          ? {
              type,
              sourceIds: args[1],
              ...(args[2] as object),
              expectedVersion: tree.store.version,
            }
          : ['expand', 'collapse', 'reveal'].includes(type)
            ? { type, nodeId: args[1] }
            : type === 'refresh'
              ? { type, parentId: args[1] ?? null }
              : type === 'filter'
                ? { type, query: args[1] }
                : { type };
      const result = await tree.request(
        {
          instanceId: instance.model.instanceId,
          renderRevision: 1,
          treeId: tree.definition.treeId,
          dataEpoch: tree.definition.dataEpoch,
          requestId: crypto.randomUUID(),
          kind: 'command',
          operationId: crypto.randomUUID(),
          command: command as TreeCommand,
        },
        {
          fields: context.values,
          signal: context.signal,
          invoke: (call, args) =>
            this.invoke(config, context, call, args, instance, saved, effects),
        },
      );
      uiAssert(
        !result.error,
        result.error?.code ?? 'TREE_COMMAND_FAILED',
        result.error?.message ?? '树命令失败',
      );
      effects.push({
        id: crypto.randomUUID(),
        type: 'tree.command',
        args: [args[0], command as unknown as UIValue, result as unknown as UIValue],
        instanceId: instance.model.instanceId,
        renderRevision: 1,
      });
      return result as unknown as UIValue;
    }
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
      const candidate = { ...context, values: { ...context.values, [field]: value } };
      await validateUIField(field, {
        fields: candidate.values,
        fieldDefinitions: instance.model.compiled.fields,
        invoke: (call, args) => this.invoke(config, candidate, call, args, instance),
      });
      context.values[field] = value;
      if (saved) {
        saved[field] = value;
      }
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
      try {
        const scope = {
          fields: context.values,
          fieldDefinitions: instance.model.compiled.fields,
          invoke: (call: CallNode, args: UIValue[]) =>
            this.invoke(instance.config, context, call, args, instance),
        };
        const value = await evaluateTemplate(binding.parts, scope);
        const field = instance.model.compiled.fields.find(
          (field) => field.nodeId === binding.nodeId,
        );
        const tree = [...instance.trees.sessions.values()].find(
          (tree) => tree.definition.hostNodeId === binding.nodeId,
        );
        if (tree && binding.attribute === 'disabled') {
          tree.disabled = value === true;
        }
        if (tree && binding.attribute === 'readonly') {
          tree.readonly = value === true;
        }
        if (field && ['value', 'checked'].includes(binding.attribute ?? '')) {
          tree?.validateSelection(value, true);
          uiAssert(
            typeof value === 'string' ||
              typeof value === 'boolean' ||
              (Array.isArray(value) && value.every((item) => typeof item === 'string')),
            'UI_INVALID_VALUE_TYPE',
            '控件值类型无效',
          );
          const candidate = { ...context, values: { ...context.values, [field.name]: value } };
          await validateUIField(field.name, {
            ...scope,
            fields: candidate.values,
            invoke: (call, args) => this.invoke(instance.config, candidate, call, args, instance),
          });
        }
        updates.push({ id: binding.id, value });
      } catch (error) {
        updates.push({
          id: binding.id,
          error: error instanceof Error ? error.message : '读取失败',
          field:
            error instanceof Error && 'field' in error
              ? String(error.field ?? '') || undefined
              : undefined,
        });
      }
    }
    return updates;
  }
  async render(config: ScriptConfigV2, context: ScriptContext): Promise<ScriptUIModel> {
    for (const [id, instance] of this.instances) {
      if (Date.now() - instance.touched > 15 * 60_000) {
        instance.trees.dispose();
        this.instances.delete(id);
      }
    }
    while (this.instances.size >= 128) {
      const oldest = this.instances.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.instances.get(oldest)?.trees.dispose();
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
    for (const tree of compiled.trees ?? []) {
      if (tree.options.selectionMode !== 'none') {
        defaults[tree.name] =
          tree.options.value ?? (tree.options.selectionMode === 'multiple' ? [] : '');
      }
    }
    const previous = context.previousInstanceId
      ? this.instances.get(context.previousInstanceId)
      : undefined;
    const registration = this.registration(config);
    const reuseTrees =
      previous?.site === context.site.url &&
      previous.registration === registration &&
      [...previous.trees.sessions.values()].every((tree) => tree.pendingCount === 0);
    const instance: Instance = {
      registration,
      trees: (reuseTrees ? previous.trees : new TreeSessions()).sync(compiled.trees, {
        resource: () => {
          throw new Error('脚本树仅允许内置图标');
        },
        validateCall: (name, readonly, watch) => this.validate(config, name, readonly, watch),
      }),
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
        ) {
          instance.bound.set(field, { ...baseline });
        }
      }
      if (!reuseTrees) {
        previous.trees.dispose();
      }
      this.instances.delete(previous.model.instanceId);
    }
    this.instances.set(model.instanceId, instance);
    return model;
  }
  async event(request: ScriptUIEvent, context: ScriptContext): Promise<ScriptUIResult> {
    uiValue(request, UI_LIMITS.bytes);
    const instance = this.instances.get(request.instanceId);
    if (instance) {
      uiAssert(
        instance.registration === this.registration(instance.config),
        'UI_STALE_HANDLERS',
        '树处理器注册已变化，请刷新',
      );
    }
    uiAssert(
      request.version === 'v2' &&
        instance &&
        instance.site === context.site.url &&
        Date.now() - instance.touched < 15 * 60_000,
      'UI_STALE_INSTANCE',
      '插件配置已过期，请刷新插件',
    );
    const readOnly = request.readOnly === true && request.bindingId === '$read';
    if (request.treeRequest) {
      uiAssert(
        request.treeRequest.instanceId === request.instanceId &&
          request.treeRequest.renderRevision === 1 &&
          request.bindingId === '$tree',
        'TREE_STALE_INSTANCE',
        '树请求实例不匹配',
      );
      const readonly =
        request.treeRequest.kind !== 'command' || request.treeRequest.command.type !== 'move';
      uiAssert(request.readOnly === readonly, 'TREE_INVALID_REQUEST', '树请求读写属性无效');
      instance.touched = Date.now();
      instance.trees.quota();
      const fields = {
        ...instance.defaults,
        ...Object.fromEntries(
          Object.entries(request.fields).map(([name, field]) => [name, field.value]),
        ),
      };
      const treeResponse = await instance.trees
        .get(request.treeRequest.treeId)
        .request(request.treeRequest, {
          fields,
          signal: context.signal,
          invoke: (call, args, signal) =>
            this.invoke(
              instance.config,
              { ...context, values: fields, signal },
              call,
              args,
              instance,
            ),
        });
      instance.trees.quota();
      return { updates: [], treeResponse };
    }
    const treeEvent = request.tree
      ? instance.trees.get(request.tree.treeId).event(request.tree, request.bindingId)
      : undefined;
    const binding =
      treeEvent?.binding ??
      instance.model.compiled.events.find((item) => item.id === request.bindingId);
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
      if (treeEvent) {
        instance.trees.field(field.name)?.validateSelection(value);
      }
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
          ctx.values = Object.fromEntries(
            Object.entries(ctx.values).filter(
              ([field]) => !instance.bound.has(field) || Object.hasOwn(request.fields, field),
            ),
          );
          return { updates: await this.updates(instance, ctx) };
        }
        uiAssert(binding, 'UI_INVALID_EVENT', '未知事件绑定');
        const saved: Record<string, FieldValue> = {};
        const effects: ClientEffect[] = [];
        const eventField = instance.model.compiled.fields.find((f) => f.nodeId === binding.nodeId);
        const event: UIValue = {
          type: binding.event,
          values: Object.fromEntries(binding.for.map((name) => [name, fields[name]])),
          ...(eventField ? { name: eventField.name, value: fields[eventField.name] } : {}),
          ...(request.event?.modifiers ? { modifiers: request.event.modifiers } : {}),
          ...(treeEvent ? (treeEvent.event as unknown as Record<string, UIValue>) : {}),
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
              this.invoke(instance.config, ctx, call, args, instance, saved, effects),
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
            prev = await evaluateArgument(step, {
              fields,
              event,
              tree: treeEvent?.event.tree as unknown as UIValue,
              prev,
              invoke,
              fieldDefinitions: instance.model.compiled.fields,
            });
          }
          if (!branch[0]?.validationStep) {
            result = prev;
          }
        }
        return {
          ...(result === undefined ? {} : { result }),
          updates: await this.updates(instance, ctx),
          saved,
          effects,
        };
      })
      .finally(() => {
        instance.pending--;
      });
    instance.tail = work;
    if (!readOnly) {
      instance.replies.set(request.eventId, { fingerprint, result: work });
    }
    return work;
  }
}
