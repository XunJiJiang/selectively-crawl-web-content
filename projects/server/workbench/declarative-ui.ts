import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { compileUI, compileCSS, validateAttribute } from './ui-compiler.ts';
import { getPluginConfig } from './plugin-config.ts';
import { workbenchEvents } from './events.ts';
import { coreBootId } from './storage.ts';
import {
  parseProgram,
  evaluateArgument,
  evaluateTemplate,
  walkArgument,
} from '../../shared/ui-expressions.ts';
import {
  UIError,
  UI_UNAVAILABLE,
  UI_LIMITS,
  uiAssert,
  uiValue,
  uiName,
  safeKey,
  type UIWireRegistry,
  type UIValue,
  type UIContribution,
  type UISurface,
  type CompiledUI,
  type HandlerContext,
  type CallNode,
  type ClientEffect,
  type NormalizedUIEvent,
  type UINode,
} from '../../shared/declarative-ui.ts';
import type { ConfigSnapshot } from '../types/plugin-config.d.ts';

type Remote = (data: Record<string, unknown>) => Promise<unknown>;
interface Registration {
  pluginId: string;
  owner: string;
  revision: number;
  root: string;
  snapshot: UIWireRegistry;
  invoke: Remote;
}
interface Instance {
  id: string;
  pluginId: string;
  owner: string;
  windowId: string;
  workspaceId: string;
  tabId: string | null;
  sourceTabId: string | null;
  sourceFrameEpoch: string | null;
  surface: UISurface;
  viewId: string;
  revision: number;
  compiled: CompiledUI;
  cap: string;
  updated: number;
  controller: AbortController;
  dataGeneration?: number;
  registryRevision?: number;
  schemaRevision?: number;
  executionDeadline?: number;
  readDeadline?: number;
  usedWatchKeys?: Set<string>;
  pausedExpressions?: Set<string>;
  override?: import('../../shared/declarative-ui.ts').UIContent;
  fields: Record<string, UIValue>;
  configFields?: Map<string, string>;
  baseline?: ConfigSnapshot;
  inspector?: Record<string, UIValue>;
  watches: Map<string, { key: string; stop: () => void }>;
  queue: Promise<unknown>;
  pending: number;
  events: Map<string, { hash: string; promise: Promise<unknown> }>;
}
const pureNames = new Set([
  'string.trim',
  'string.lower',
  'string.upper',
  'string.toString',
  'number.parse',
  'boolean.parse',
  'json.parse',
  'json.stringify',
  'object.get',
  'object.pick',
  'array.first',
  'array.length',
  'default',
  'validate',
  'value.read',
  'config.read',
  'get',
]);
const effectNames = new Set([
  'view.open',
  'view.refresh',
  'page.open',
  'settings.open',
  'tooltip.open',
  'tooltip.pin',
  'tooltip.close',
  'menu.open',
  'element.focus',
  'section.toggle',
  'scroll.to',
  'clipboard.writeText',
  'link.openExternal',
  'notification.show',
]);
const coreNames = new Set([
  ...pureNames,
  ...effectNames,
  'flow.stop',
  'value.write',
  'event.trigger',
  'config.write',
  'inspector.config.save',
  'inspector.config.reset',
  'inspector.config.rebase',
  'inspector.config.discard',
]);
const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function valuesObject(value: unknown): Record<string, UIValue> {
  uiAssert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'UI_INVALID_VALUE_TYPE',
    '需要数据对象',
  );
  return uiValue(value) as Record<string, UIValue>;
}

class UIExecutionFailure extends UIError {
  readonly completedBranches: number;
  readonly branch: number;
  readonly step: number;
  constructor(error: unknown, branch: number, step: number, completedBranches: number) {
    super(
      error instanceof UIError ? error.code : 'UI_EXECUTION_FAILED',
      error instanceof UIError ? error.message : '处理器执行失败',
    );
    this.branch = branch;
    this.step = step;
    this.completedBranches = completedBranches;
  }
}
export class DeclarativeUIService {
  private registrations = new Map<string, Registration>();
  private instances = new Map<string, Instance>();
  private iconTickets = new Map<
    string,
    { owner: string; pluginId: string; windowId: string; expires: number; paths: Set<string> }
  >();
  private revision = 0;
  private frontendAcks=new Map<string,{job:string;instanceId:string;windowId:string;created:number;promise?:Promise<unknown>}>();
  private continuations = new Map<
    string,
    {
      instance: Instance;
      eventId: string;
      branches: CallNode[][];
      next: number;
      completed:number;
      effects:ClientEffect[];
      renderRevision:number;
      registryRevision:number;
      event: NormalizedUIEvent;
      initial: Record<string, UIValue>;
      deadline: number;
      finish: () => void;
      result?: UIValue;
    }
  >();
  private watchCallbacks = new Map<string, {owner:string;run:()=>void}>();
  constructor() {
    workbenchEvents.on('event', (event) => {
      if (['config.changed', 'catalog.changed'].includes(event.type)) {
        for (const instance of this.instances.values()) {
          if (!event.entityId || event.entityId === instance.pluginId) {
            const change = event.payload as { schemaRevision?: number };
            if (
              event.type === 'config.changed' &&
              instance.surface === 'currentPage' &&
              instance.baseline &&
              change.schemaRevision !== instance.schemaRevision
            ) {
              workbenchEvents.publish(
                'ui.content.changed',
                { instanceId: instance.id },
                instance.id,
                undefined,
                `workspace:${instance.workspaceId}`,
              );
            } else {
              this.invalidate(instance);
            }
          }
        }
      }
    });
  }
  private invalidate(instance: Instance) {
    workbenchEvents.publish(
      'ui.data.changed',
      { instanceId: instance.id, windowId: instance.windowId },
      instance.id,
      undefined,
      `workspace:${instance.workspaceId}`,
    );
  }
  private validateCall(
    reg: Registration | undefined,
    name: string,
    readonly: boolean,
    watch: boolean,
  ) {
    if (name.startsWith('ui:')) {
      return;
    }
    if (name.startsWith('core:')) {
      const key = name.slice(5);
      uiAssert(coreNames.has(key), 'UI_HANDLER_NOT_FOUND', `未知核心处理器 ${name}`);
      uiAssert(
        !readonly || pureNames.has(key),
        'UI_INVALID_EXPRESSION',
        '模板中只能调用只读处理器',
      );
      uiAssert(
        !watch || ['get', 'config.read', 'value.read'].includes(key),
        'UI_WATCH_UNSUPPORTED',
        '该核心处理器没有变更源',
      );
      return;
    }
    const handler = reg?.snapshot.handlers.find((h) => h.name === name);
    if (watch && !handler) {
      return;
    } // Resolved against the complete field table after compilation.
    uiAssert(handler, 'UI_HANDLER_NOT_FOUND', `未注册处理器 ${name}`);
    uiAssert(!readonly || handler.readOnly, 'UI_INVALID_EXPRESSION', '模板中只能调用只读处理器');
    uiAssert(!watch || handler.watch, 'UI_WATCH_UNSUPPORTED', '处理器没有监听能力');
  }
  async install(
    pluginId: string,
    owner: string,
    root: string,
    snapshot: UIWireRegistry,
    invoke: Remote,
  ) {
    uiValue(snapshot, 1024 * 1024);
    uiAssert(
      snapshot.handlers.length <= 256 && snapshot.views.length <= 3 && snapshot.mounts.length <= 32,
      'UI_QUOTA_EXCEEDED',
      '插件注册数量超限',
    );
    const realRoot = await fs.realpath(root);
    const reg: Registration = {
      pluginId,
      owner,
      root: realRoot,
      snapshot: plain(snapshot),
      invoke,
      revision: this.revision + 1,
    };
    const unique = new Set<string>();
    for (const handler of snapshot.handlers) {
      uiName(handler.name);
      uiAssert(!unique.has(handler.name), 'UI_HANDLER_IN_USE', '处理器名称重复');
      unique.add(handler.name);
      handler.reads.forEach(uiName);
    }
    const surfaces = new Set<UISurface>();
    for (const mount of snapshot.mounts) {
      uiAssert(
        /^\/[A-Za-z0-9_./-]+$/.test(mount.path) && !mount.path.split('/').includes('..'),
        'UI_RESOURCE_DENIED',
        '静态挂载路径无效',
      );
      const location = await fs.realpath(mount.file ?? mount.directory ?? '');
      const relative = path.relative(realRoot, location);
      uiAssert(
        relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
        'UI_RESOURCE_DENIED',
        '静态挂载必须属于插件目录',
      );
      const stat = await fs.stat(location);
      uiAssert(
        mount.file ? stat.isFile() : stat.isDirectory(),
        'UI_RESOURCE_DENIED',
        '挂载类型不匹配',
      );
    }
    for (const view of snapshot.views) {
      uiAssert(
        ['mainSidebar', 'auxiliarySidebar', 'statusBar'].includes(view.surface) &&
          !surfaces.has(view.surface),
        'UI_QUOTA_EXCEEDED',
        '每区域只能注册一项',
      );
      surfaces.add(view.surface);
      uiName(view.definition.id);
      uiAssert(
        typeof (view.definition.title ?? view.definition.ariaLabel) === 'string',
        'UI_INVALID_CONTENT',
        '贡献缺少标题',
      );
      if (view.surface === 'statusBar') {
        this.statusContent(view.definition);
      } else if (!this.provider(view.definition.content)) {
        if (view.surface === 'auxiliarySidebar' && view.definition.hideCurrentPage === true) {
          const content = view.definition.content;
          uiAssert(content && typeof content === 'object' && !Array.isArray(content) && ['json', 'html'].includes(String(content.format)), 'UI_INVALID_CONTENT', '隐藏页面信息前必须提供 JSON 或 HTML 模板');
        }
        this.compile(reg, view.definition.content as never, undefined);
      }
      const eventMap = view.definition.events;
      if (eventMap && typeof eventMap === 'object' && !Array.isArray(eventMap)) {
        for (const p of Object.values(eventMap)) {
          this.checkProgram(reg, String(p));
        }
      }
    }
    const old = this.registrations.get(pluginId);
    const prepared = new Map<Instance, CompiledUI | undefined>();
    if (old?.owner === owner) {
      for (const instance of this.instances.values()) {
        if (instance.owner === owner && instance.surface !== 'currentPage') {
          const view = reg.snapshot.views.find(
            (v) =>
              (v.surface === instance.surface ||
                (['tooltip', 'contextMenu'].includes(instance.surface) &&
                  v.surface === 'statusBar')) &&
              v.definition.id === instance.viewId,
          );
          if (!view) {
            prepared.set(instance, undefined);
            continue;
          }
          if (instance.surface === 'tooltip' || instance.surface === 'contextMenu') {
            for (const binding of instance.compiled.events) {
              for (const chain of binding.program.branches) {
                for (const call of chain) {
                  walkArgument(call, (node) => {
                    if (node.type === 'call') {
                      this.validateCall(reg, node.name, node !== call, node.watch);
                    }
                  });
                }
              }
            }
            continue;
          }
          const oldView = old.snapshot.views.find(
            (v) => v.surface === view.surface && v.definition.id === view.definition.id,
          );
          let content =
            instance.override &&
            JSON.stringify(oldView?.definition.content) === JSON.stringify(view.definition.content)
              ? instance.override
              : view.surface === 'statusBar'
                ? this.statusContent(view.definition)
                : view.definition.content;
          if (this.provider(content)) {
            content = uiValue(
              await reg.invoke({
                kind: 'content',
                name: content.$provider,
                context: this.context(instance, 'render'),
              }),
              UI_LIMITS.bytes,
            );
          }
          prepared.set(instance, this.compile(reg, content as never, instance));
        }
      }
    }
    uiAssert(
      this.registrations.get(pluginId) === old,
      'UI_STALE_HANDLERS',
      '注册期间插件代数已变化',
    );
    this.registrations.set(pluginId, reg);
    this.revision++;
    if (old?.owner !== owner) {
      this.releaseOwner(old?.owner ?? '');
    } else {
      for (const instance of this.instances.values()) {
        if (instance.pluginId === pluginId) {
          if (prepared.has(instance)) {
            const projected = prepared.get(instance);
            if (!projected) {
              this.release(instance.id);
              continue;
            }
            instance.compiled = projected;
            instance.revision++;
          }
          if (!prepared.has(instance)) {
            instance.revision++;
          }
          instance.registryRevision = reg.revision;
          this.invalidate(instance);
        }
      }
    }
    workbenchEvents.publish(
      'ui.registry.changed',
      { revision: this.revision },
      pluginId,
      this.revision,
    );
    return { revision: this.revision };
  }
  async setContent(
    owner: string,
    data: {
      instanceId: string;
      surface: UISurface;
      viewId: string;
      content: import('../../shared/declarative-ui.ts').UIContent;
    },
  ) {
    const instance = this.instances.get(data.instanceId);
    uiAssert(
      instance &&
        instance.owner === owner &&
        instance.surface === data.surface &&
        instance.viewId === data.viewId,
      'UI_STALE_INSTANCE',
      '目标实例不属于当前贡献',
    );
    const compiled = this.compile(
      this.registrations.get(instance.pluginId),
      data.content,
      instance,
    );
    instance.override = data.content;
    instance.compiled = compiled;
    instance.revision++;
    for (const w of instance.watches.values()) {
      w.stop();
    }
    instance.watches.clear();
    workbenchEvents.publish(
      'ui.content.changed',
      { instanceId: instance.id, windowId: instance.windowId },
      instance.id,
      instance.revision,
      `workspace:${instance.workspaceId}`,
    );
    return { renderRevision: instance.revision };
  }
  releaseOwner(owner: string) {
    for (const instance of [...this.instances.values()]) {
      if (instance.owner === owner) {
        this.release(instance.id);
      }
    }
    for (const [id, ticket] of this.iconTickets) {
      if (ticket.owner === owner) {
        this.iconTickets.delete(id);
      }
    }
    for (const [id, reg] of this.registrations) {
      if (reg.owner === owner) {
        this.registrations.delete(id);
        this.revision++;
        workbenchEvents.publish(
          'ui.registry.changed',
          { revision: this.revision },
          id,
          this.revision,
        );
      }
    }
  }
  registry(windowId = '') {
    for (const [token, ticket] of this.iconTickets) {
      if (ticket.expires < Date.now()) {
        this.iconTickets.delete(token);
      }
    }
    const items: UIContribution[] = [];
    for (const reg of this.registrations.values()) {
      let ticket = [...this.iconTickets].find(
        ([, t]) => t.owner === reg.owner && t.windowId === windowId,
      );
      if (!ticket) {
        const token = randomUUID();
        const record = {
          owner: reg.owner,
          pluginId: reg.pluginId,
          windowId,
          expires: Date.now() + 300000,
          paths: new Set<string>(),
        };
        this.iconTickets.set(token, record);
        ticket = [token, record];
      }
      for (const view of reg.snapshot.views) {
        const icon = view.definition.icon as unknown as
          | import('../../shared/declarative-ui.ts').IconRef
          | undefined;
        let mapped = icon;
        if (icon?.kind === 'asset') {
          const value = this.resource(reg, ticket[0], icon.path);
          ticket[1].paths.add(
            new URL(value, 'https://scwc.invalid').pathname.split('/').slice(6).join('/'),
          );
          mapped = { kind: 'asset', path: value };
        }
        items.push({
          pluginId: reg.pluginId,
          ownerEpoch: reg.owner,
          surface: view.surface,
          id: String(view.definition.id),
          title: String(view.definition.title ?? view.definition.ariaLabel),
          icon: mapped,
          hideCurrentPage: view.definition.hideCurrentPage === true,
          alignment: view.definition.alignment as 'left' | 'right' | undefined,
          priority: Number(view.definition.priority ?? 0),
          hasTooltip: Boolean(view.definition.tooltip),
          hasContextMenu: Boolean(view.definition.contextMenu),
        });
      }
    }
    return { revision: this.revision, items };
  }

  private provider(value: unknown): value is { $provider: string } {
    return Boolean(value && typeof value === 'object' && '$provider' in value);
  }
  private resource(reg: Registration, cap: string, raw: string, base = '/') {
    uiAssert(
      typeof raw === 'string' && !/[\\\x00-\x20]/.test(raw),
      'UI_RESOURCE_DENIED',
      '资源路径无效',
    );
    const url = new URL(raw, 'https://scwc.invalid' + base);
    uiAssert(
      url.origin === 'https://scwc.invalid' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
      'UI_RESOURCE_DENIED',
      '只允许插件挂载资源',
    );
    const decoded = decodeURIComponent(url.pathname);
    uiAssert(
      !decoded.includes('\\') && !decoded.split('/').some((p) => p === '..' || p === '.'),
      'UI_RESOURCE_DENIED',
      '资源路径无效',
    );
    uiAssert(
      reg.snapshot.mounts.some(
        (m) => decoded === m.path || decoded.startsWith(m.path.replace(/\/$/, '') + '/'),
      ),
      'UI_RESOURCE_DENIED',
      '资源未挂载',
    );
    return `/web/ui/assets/${encodeURIComponent(reg.pluginId)}/${encodeURIComponent(reg.owner)}${url.pathname}?cap=${cap}`;
  }
  private compile(
    reg: Registration | undefined,
    content: Parameters<typeof compileUI>[0],
    instance?: Instance,
  ) {
    const result = compileUI(content, {
      resource: (raw) => {
        uiAssert(reg, 'UI_RESOURCE_DENIED', '核心模板不允许插件资源');
        return this.resource(reg, instance?.cap ?? 'validation', raw);
      },
      validateCall: (n, r, w) => this.validateCall(reg, n, r, w),
      reads: (name) => reg?.snapshot.handlers.find((h) => h.name === name)?.reads ?? [],
    });
    const names = new Set(result.fields.map((f) => f.name));
    for (const binding of [
      ...result.events.map((e) => e.program.branches.flat()),
      ...result.expressions.map((e) => e.parts.filter((p) => typeof p !== 'string')),
    ]) {
      for (const call of binding) {
        if (typeof call !== 'string') {
          walkArgument(call, (n) => {
            if (n.type === 'call' && n.watch && !n.name.includes(':')) {
              uiAssert(
                names.has(n.name) ||
                  reg?.snapshot.handlers.some((h) => h.name === n.name && h.watch),
                'UI_UNKNOWN_VALUE',
                '监听通道不存在',
              );
              uiAssert(
                !(names.has(n.name) && reg?.snapshot.handlers.some((h) => h.name === n.name)),
                'UI_INVALID_CONTENT',
                '元素与后端监听通道重名',
              );
            }
          });
        }
      }
    }
    for (const event of result.events) {
      for (const chain of event.program.branches) {
        for (const step of chain) {
          walkArgument(step, (node) => {
            if (node.type === 'call' && !node.name.includes(':')) {
              for (const name of reg?.snapshot.handlers.find((h) => h.name === node.name)?.reads ??
                []) {
                uiAssert(names.has(name), 'UI_UNKNOWN_VALUE', 'reads 引用了未声明字段');
                event.capture.push(name);
              }
            }
          });
        }
      }
    }
    return result;
  }
  private checkProgram(reg: Registration, text: string) {
    for (const chain of parseProgram(text).branches) {
      for (const call of chain) {
        walkArgument(call, (n) => {
          if (n.type === 'call') {
            this.validateCall(reg, n.name, n !== call, n.watch);
          }
        });
      }
    }
  }
  private statusContent(def: Record<string, UIValue>) {
    const children: Record<string, unknown>[] = [];
    if (def.icon && typeof def.icon === 'object') {
      children.push({ type: 'icon', icon: def.icon, label: def.ariaLabel });
    }
    children.push({
      type: 'button',
      key: 'status',
      text: def.text ?? def.ariaLabel,
      disabled: def.disabled ?? false,
      events: def.events ?? {},
    });
    return {
      format: 'json' as const,
      version: 1 as const,
      root: {
        type: 'stack',
        key: 'status',
        direction: 'row',
        visible: def.visible ?? true,
        children,
      } as never,
    };
  }
  async project(input: {
    pluginId: string;
    windowId: string;
    workspaceId: string;
    tabId: string | null;
  }) {
    const instance: Instance = {
      ...input,
      id: randomUUID(),
      owner: this.registrations.get(input.pluginId)?.owner ?? 'core',
      sourceTabId: null,
      sourceFrameEpoch: null,
      surface: 'currentPage',
      viewId: 'currentPage',
      revision: 1,
      compiled: { format: 'html', nodes: [], fields: [], events: [], expressions: [], styles: [] },
      cap: randomUUID(),
      updated: Date.now(),
      controller: new AbortController(),
      fields: {},
      watches: new Map(),
      queue: Promise.resolve(),
      pending: 0,
      events: new Map(),
    };
    try {
      return await this.inspector(instance);
    } finally {
      instance.controller.abort();
    }
  }
  async create(input: {
    pluginId: string;
    surface: UISurface;
    viewId: string;
    windowId: string;
    workspaceId: string;
    tabId: string | null;
    sourceTabId: string | null;
    sourceFrameEpoch: string | null;
  }) {
    for (const instance of [...this.instances.values()]) {
      if (Date.now() - instance.updated > 600000) {
        this.release(instance.id);
      }
    }
    uiAssert(this.instances.size < 1000, 'UI_QUOTA_EXCEEDED', 'UI 实例过多');
    const reg = this.registrations.get(input.pluginId);
    uiAssert(input.surface === 'currentPage' || reg, 'UI_STALE_INSTANCE', '插件 UI 不可用');
    const instance: Instance = {
      ...input,
      id: randomUUID(),
      owner: reg?.owner ?? 'core',
      revision: 1,
      compiled: { format: 'html', nodes: [], fields: [], events: [], expressions: [], styles: [] },
      cap: randomUUID(),
      updated: Date.now(),
      controller: new AbortController(),
      fields: {},
      watches: new Map(),
      queue: Promise.resolve(),
      pending: 0,
      events: new Map(),
    };
    this.instances.set(instance.id, instance);
    try {
      await this.content(instance);
      return this.public(instance);
    } catch (error) {
      this.release(instance.id);
      throw error;
    }
  }
  get(id: string, windowId: string) {
    const instance = this.instances.get(id);
    uiAssert(
      instance && instance.windowId === windowId,
      'UI_STALE_INSTANCE',
      'UI 实例不存在或不属于当前窗口',
    );
    uiAssert(!instance.controller.signal.aborted, 'UI_STALE_INSTANCE', 'UI 实例已释放');
    instance.updated = Date.now();
    return instance;
  }
  private public(instance: Instance) {
    return {
      id: instance.id,
      pluginId: instance.pluginId,
      ownerEpoch: instance.owner,
      renderRevision: instance.revision,
      compiled: instance.compiled,
      sourceTabId: instance.sourceTabId,
      sourceFrameEpoch: instance.sourceFrameEpoch,
      workspaceId: instance.workspaceId,
      assetRoot: `/web/ui/assets/${encodeURIComponent(instance.pluginId)}/${encodeURIComponent(instance.owner)}`,
      assetCapability: instance.cap,
    };
  }
  async refresh(id: string, windowId: string) {
    const instance = this.get(id, windowId);
    await this.content(instance);
    return this.public(instance);
  }
  private context(
    instance: Instance,
    invocation: HandlerContext['invocation'],
    event?: NormalizedUIEvent,
  ) {
    return {
      pluginId: instance.pluginId,
      instanceId: instance.id,
      windowId: instance.windowId,
      workspaceId: instance.workspaceId,
      tabId: instance.tabId,
      sourceTabId: instance.sourceTabId,
      source: { kind: instance.surface, viewId: instance.viewId },
      invocation,
      event,
      fields: instance.fields,
    };
  }
  private async remote(
    instance: Instance,
    kind: string,
    name?: string,
    args?: UIValue[],
    id?: string,
    invocation: HandlerContext['invocation'] = 'event',
    event?: NormalizedUIEvent,
    extraContext: Record<string, unknown> = {},
  ) {
    const reg = this.registrations.get(instance.pluginId);
    uiAssert(reg && reg.owner === instance.owner, 'UI_STALE_HANDLERS', '插件处理器已失效');
    const callId = id ?? randomUUID();
    const cancel = () => {
      void reg
        .invoke({ kind: 'cancel', id: callId, context: this.context(instance, invocation) })
        .catch(() => undefined);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          cancel();
          reject(new UIError('UI_EXECUTION_TIMEOUT', '处理器执行超时；已发生的副作用不会自动重放'));
        },
        Math.max(
          1,
          (invocation === 'event' ? instance.executionDeadline : instance.readDeadline) ??
            Date.now() + 10000,
        ) - Date.now(),
      );
      timer.unref();
    });
    instance.controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      return await Promise.race([
        timeout,
        reg.invoke({
          kind,
          name,
          args,
          id: callId,
          context: {
            ...this.context(
              instance,
              kind === 'content' ? 'render' : kind === 'watch.start' ? 'watch' : invocation,
              event,
            ),
            ...extraContext,
          },
        }),
      ]);
    } finally {
      clearTimeout(timer);
      instance.controller.signal.removeEventListener('abort', cancel);
    }
  }
  private async content(instance: Instance) {
    for (const stop of instance.watches.values()) {
      stop.stop();
    }
    instance.watches.clear();
    const reg = this.registrations.get(instance.pluginId);
    let content;
    if (instance.override) {
      content = instance.override;
    } else if (instance.surface === 'currentPage') {
      uiAssert(!reg || reg.owner === instance.owner, 'UI_STALE_HANDLERS', '插件代数已变化');
      content = await this.inspectorTemplate(instance);
    } else {
      const view = reg?.snapshot.views.find(
        (v) =>
          (v.surface === instance.surface ||
            (['tooltip', 'contextMenu'].includes(instance.surface) && v.surface === 'statusBar')) &&
          v.definition.id === instance.viewId,
      );
      uiAssert(view, 'UI_STALE_INSTANCE', '贡献已注销');
      content =
        view.surface === 'statusBar'
          ? this.statusContent(view.definition)
          : view.definition.content;
      if (instance.surface === 'tooltip') {
        const tooltip = view.definition.tooltip as Record<string, UIValue>;
        uiAssert(tooltip, 'UI_INVALID_CONTENT', '状态项未提供提示层');
        content = tooltip.content;
        if (
          content &&
          typeof content === 'object' &&
          !Array.isArray(content) &&
          content.format === 'text'
        ) {
          content = { format: 'html', version: 1, html: escape(content.text) };
        }
      }
      if (instance.surface === 'contextMenu') {
        const menu = view.definition.contextMenu;
        uiAssert(Array.isArray(menu), 'UI_INVALID_CONTENT', '状态项未提供菜单');
        let count = 0;
        const nodes = (items: UIValue[], depth = 0): unknown[] => {
          uiAssert(depth <= 4 && (count += items.length) <= 100, 'UI_QUOTA_EXCEEDED', '菜单过大');
          return items.map((raw) => {
            const item = raw as Record<string, UIValue>;
            if (item.kind === 'separator') {
              return { type: 'divider' };
            }
            if (item.kind === 'submenu') {
              return {
                type: 'stack',
                direction: 'column',
                children: [
                  { type: 'text', text: item.label },
                  ...nodes(item.children as UIValue[], depth + 1),
                ],
              };
            }
            return item.kind === 'checkbox'
              ? {
                  type: 'checkbox',
                  key: item.id,
                  name: item.id,
                  checked: item.checked,
                  disabled: item.disabled ?? false,
                  label: item.label,
                  events: { change: item.action },
                }
              : {
                  type: 'button',
                  key: item.id,
                  name: item.id,
                  text:
                    (item.kind === 'checkbox' && item.checked === true ? '✓ ' : '') + item.label,
                  disabled: item.disabled ?? false,
                  events: { click: item.action },
                };
          });
        };
        content = {
          format: 'json',
          version: 1,
          root: { type: 'stack', direction: 'column', children: nodes(menu) },
        };
      }
      if (this.provider(content)) {
        content = await this.remote(instance, 'content', content.$provider);
      }
    }
    instance.compiled = this.compile(reg, content as never, instance);
    instance.registryRevision = reg?.revision ?? 0;
    instance.revision++;
    instance.fields = {};
  }
  async inspector(instance: Instance) {
    const { pluginCatalog } = await import('./catalog.ts');
    const plugin = await pluginCatalog.require(instance.pluginId);
    const config = getPluginConfig().snapshot(instance.pluginId);
    let userTitle: string | null = null;
    let pageTitle = plugin.title,
      entryUrl: string | null = null,
      locator = null;
    if (instance.tabId) {
      const { getWorkbench } = await import('./runtime.ts');
      const tab = getWorkbench()
        .workspace.get(instance.workspaceId)
        .snapshot.tabs.find((t) => t.id === instance.tabId);
      uiAssert(
        tab?.kind === 'plugin' && tab.pluginId === instance.pluginId,
        'UI_STALE_INSTANCE',
        '页面归属已变化',
      );
      userTitle = tab.customTitle;
      pageTitle = userTitle ?? plugin.title;
      entryUrl = tab.locator?.path ?? '/';
      locator = { path: tab.locator.path, search: tab.locator.search, hash: tab.locator.hash };
    }
    const reg = this.registrations.get(instance.pluginId);
    let properties: UIValue = [];
    const diagnostics = [
      ...plugin.diagnostics.map((item) => ({ ...item, source: 'core' })),
      ...plugin.ui.diagnostics.map((item) => ({ ...item, source: 'ui' })),
    ];
    if (reg?.snapshot.inspector) {
      try {
        const data = valuesObject(
          await this.remote(
            instance,
            'inspector',
            undefined,
            undefined,
            undefined,
            'render',
            undefined,
            { locator },
          ),
        );
        uiAssert(
          Object.keys(data).every((key) => ['title', 'properties'].includes(key)) &&
            Array.isArray(data.properties) &&
            data.properties.length <= 100 &&
            data.properties.every(
              (row) =>
                row &&
                typeof row === 'object' &&
                !Array.isArray(row) &&
                typeof row.key === 'string' &&
                typeof row.label === 'string' &&
                typeof row.value === 'string',
            ),
          'UI_INVALID_CONTENT',
          '属性提供器必须返回标题及扁平字符串属性',
        );
        if (typeof data.title === 'string' && userTitle === null) {
          pageTitle = data.title;
        }
        properties = data.properties;
      } catch {
        diagnostics.push({
          code: 'INSPECTOR_BACKEND_UNAVAILABLE',
          message: '插件后端属性暂不可用',
          source: 'plugin-backend',
        });
      }
    }
    const snapshot = {
      version: 1,
      pluginId: instance.pluginId,
      tabId: instance.tabId,
      coreBootId,
      ownerEpoch: reg?.owner ?? null,
      revision: pluginCatalog.revision,
      generatedAt: new Date().toISOString(),
      page: { title: pageTitle, entryUrl },
      plugin: {
        title: plugin.title,
        description: plugin.description ?? null,
        version: plugin.version ?? null,
        pid: plugin.runtime.pid ?? null,
        runtimeStatus: plugin.runtime.status,
        uiBuildStatus: plugin.ui.state,
      },
      properties,
      config,
      diagnostics,
    };
    instance.inspector = plain(snapshot) as unknown as Record<string, UIValue>;
    instance.baseline ??= config;
    return instance.inspector;
  }
  private async inspectorTemplate(instance: Instance) {
    const data = await this.inspector(instance),
      config = data.config as unknown as ConfigSnapshot;
    instance.schemaRevision = config.schemaRevision;
    const configFieldMap = new Map<string, string>();
    instance.configFields = configFieldMap;
    const watch = (path: string) => `\${watch:core:get(${JSON.stringify('inspector.' + path)})}`;
    const configWatch = (key: string) =>
      `\${watch:core:config.read(${JSON.stringify(key)})}`;
    const text = (key: string, value: string, tone?: string): UINode => ({
      type: 'text',
      key,
      text: value,
      ...(tone ? { tone } : {}),
    });
    const propertyRow = (key: string, label: string, value: string): UINode => ({
      type: 'stack',
      key: `property-row-${key}`,
      direction: 'row',
      gap: 'medium',
      children: [text(`property-label-${key}`, label, 'muted'), text(`property-value-${key}`, value)],
    });
    const properties = Array.isArray(data.properties)
      ? (data.properties as unknown as { key: string; label: string; value: string }[])
      : [];
    const configFields = new Set<string>();
    const definitions = config.definitions.map((definition, definitionIndex) => ({
      id: `config-${definitionIndex}`,
      label: definition.id,
      children: definition.items.map((item, itemIndex): UINode => {
        const name = 'config.f' + createHash('sha256').update(item.key).digest('hex').slice(0, 16);
        const disabled =
          item.control === 'readonly' ||
          item.validationPolicy === 'page-required' ||
          !getPluginConfig().definitionVerified(instance.pluginId, definition.id);
        if (!disabled) {
          configFieldMap.set(name, item.key);
          configFields.add(name);
        }
        const key = `config-item-${definitionIndex}-${itemIndex}`;
        const input: UINode =
          item.control === 'readonly'
            ? text(`${key}-value`, configWatch(item.key))
            : item.control === 'switch'
              ? {
                  type: 'checkbox',
                  key: `${key}-control`,
                  name: disabled ? undefined : name,
                  label: item.label,
                  checked: `\${core:boolean.parse(core:default(watch:core:config.read(${JSON.stringify(item.key)}), 'false'))}`,
                  disabled,
                }
              : item.control === 'select'
                ? {
                    type: 'select',
                    key: `${key}-control`,
                    name: disabled ? undefined : name,
                    value: configWatch(item.key),
                    options: item.rules?.options ?? [],
                    disabled,
                  }
                : item.control === 'textarea'
                  ? {
                      type: 'textarea',
                      key: `${key}-control`,
                      name: disabled ? undefined : name,
                      value: configWatch(item.key),
                      disabled,
                    }
                  : {
                      type: 'input',
                      key: `${key}-control`,
                      name: disabled ? undefined : name,
                      inputType:
                        item.control === 'number'
                          ? 'number'
                          : item.control === 'color'
                            ? 'color'
                            : 'text',
                      value: configWatch(item.key),
                      disabled,
                    };
        return {
          type: 'stack',
          key,
          gap: 'small',
          children: [
            item.control === 'switch' ? input : text(`${key}-label`, item.label, 'title'),
            ...(item.description ? [text(`${key}-description`, item.description, 'muted')] : []),
            ...(item.control === 'switch' ? [] : [input]),
            text(`${key}-key`, item.key, 'code'),
            ...(item.validationPolicy === 'page-required'
              ? [text(`${key}-migration`, '此配置需要原页面校验；请由插件后端重新声明校验规则。', 'muted')]
              : []),
          ],
        };
      }),
    }));
    const configForm: UINode = {
      type: 'form',
      key: 'inspector-config-form',
      name: 'inspectorConfig',
      events: { submit: 'core:inspector.config.save($event)' },
      children: [
        ...(definitions.length
          ? [{ type: 'tabs', key: 'config-groups', label: '配置分组', tabs: definitions } as UINode]
          : [text('no-config', '插件后端尚未注册配置项。', 'muted')]),
        ...(configFields.size
          ? [
              {
                type: 'stack',
                key: 'config-actions',
                direction: 'row',
                gap: 'small',
                children: [
                  { type: 'button', key: 'config-save', text: '保存更改', submit: true },
                  {
                    type: 'button',
                    key: 'config-reset',
                    text: '重置',
                    for: [...configFields],
                    events: { click: 'core:inspector.config.reset($event)' },
                  },
                  {
                    type: 'button',
                    key: 'config-discard',
                    text: '接受远端值',
                    for: [...configFields],
                    events: { click: 'core:inspector.config.discard($event)' },
                  },
                  {
                    type: 'button',
                    key: 'config-rebase',
                    text: '保留草稿并重新校验',
                    events: { click: 'core:inspector.config.rebase($event)' },
                  },
                ],
              } as UINode,
            ]
          : []),
      ],
    };
    const diagnostics = Array.isArray(data.diagnostics)
      ? (data.diagnostics as unknown as { code: string; message: string; source: string }[])
      : [];
    return {
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        key: 'current-page',
        gap: 'small',
        children: [
          text(
            'inspector-instance',
            `${typeof data.tabId === 'string' ? data.tabId.slice(0, 8) : '插件配置'} · ${instance.pluginId}`,
            'muted',
          ),
          text('page-title', watch('page.title'), 'title'),
          text('plugin-description', watch('plugin.description'), 'muted'),
          {
            type: 'tabs',
            key: 'current-page-tabs',
            label: '页面信息',
            tabs: [
              {
                id: 'properties',
                label: '属性',
                children: [
                  {
                    type: 'stack',
                    key: 'page-properties',
                    gap: 'medium',
                    children: [
                      propertyRow('plugin', '插件', watch('plugin.title')),
                      propertyRow('version', '版本', watch('plugin.version')),
                      propertyRow('pid', '进程 PID', watch('plugin.pid')),
                      propertyRow('backend', '后端状态', watch('plugin.runtimeStatus')),
                      propertyRow('ui', 'UI 状态', watch('plugin.uiBuildStatus')),
                      propertyRow('url', '入口路径', watch('page.entryUrl')),
                      ...(properties.length
                        ? [
                            text('plugin-properties-title', '插件属性', 'title'),
                            ...properties.map((item, index) =>
                              propertyRow(`plugin-${index}`, item.label, item.value),
                            ),
                          ]
                        : []),
                    ],
                  },
                ],
              },
              {
                id: 'config',
                label: '配置',
                children: [configForm],
              },
              {
                id: 'diagnostics',
                label: '诊断',
                children: [
                  {
                    type: 'stack',
                    key: 'page-diagnostics',
                    gap: 'small',
                    children: diagnostics.length
                      ? diagnostics.flatMap((item, index) => [
                          text(`diagnostic-${index}-code`, `${item.source} · ${item.code}`, 'title'),
                          text(`diagnostic-${index}-message`, item.message),
                        ])
                      : [text('no-diagnostics', '当前没有诊断信息。', 'muted')],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as const;
  }
  private capture(instance: Instance, fields: unknown, allowed?: string[]) {
    const input = valuesObject(fields ?? {}),
      result: Record<string, UIValue> = {};
    for (const [name, raw] of Object.entries(input)) {
      const field = instance.compiled.fields.find((f) => f.name === name);
      uiAssert(
        field && (!allowed || allowed.includes(name)),
        'UI_UNKNOWN_VALUE',
        '字段不属于当前绑定',
      );
      const value =
        raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? raw.value : raw;
      uiAssert(
        field.kind === 'boolean'
          ? typeof value === 'boolean'
          : field.kind === 'multiple'
            ? Array.isArray(value) && value.every((v) => typeof v === 'string')
            : typeof value === 'string',
        'UI_INVALID_VALUE_TYPE',
        '字段类型不匹配',
      );
      result[name] = value;
    }
    if (allowed) {
      for (const name of allowed) {
        uiAssert(Object.hasOwn(result, name), 'UI_UNKNOWN_VALUE', '缺少关联字段');
      }
    }
    return result;
  }
  async data(
    id: string,
    windowId: string,
    body: { renderRevision: number; fields?: unknown; expressionBindingId?: string },
  ) {
    const ownerInstance = this.get(id, windowId);
    uiAssert(
      (this.registrations.get(ownerInstance.pluginId)?.revision ?? 0) ===
        ownerInstance.registryRevision,
      'UI_STALE_HANDLERS',
      '处理器注册版本已变化',
    );
    const dataGeneration = (ownerInstance.dataGeneration = (ownerInstance.dataGeneration ?? 0) + 1);
    const instance = {
      ...ownerInstance,
      fields: this.capture(ownerInstance, body.fields),
      readDeadline: Date.now() + 10000,
    };
    uiAssert(body.renderRevision === instance.revision, 'UI_STALE_RENDER', '模板版本已变化');
    if (instance.surface === 'currentPage') {
      await this.inspector(instance);
    }
    const usedWatches = new Set<string>();
    instance.usedWatchKeys = usedWatches;
    if (body.expressionBindingId) {
      ownerInstance.pausedExpressions?.delete(body.expressionBindingId);
    }
    const updates = [];
    for (const binding of instance.compiled.expressions) {
      if (ownerInstance.pausedExpressions?.has(binding.id)) {
        continue;
      }
      if (body.expressionBindingId && binding.id !== body.expressionBindingId) {
        continue;
      }
      let frontend = false;
      for (const part of binding.parts) {
        if (typeof part !== 'string') {
          walkArgument(part, (n) => {
            if (n.type === 'call' && n.domain === 'frontend') {
              frontend = true;
            }
          });
        }
      }
      if (frontend) {
        updates.push({ id: binding.id, frontend: true });
        continue;
      }
      try {
        uiAssert(Date.now() < instance.readDeadline, 'UI_EXECUTION_TIMEOUT', '模板数据获取超时');
        const value = await evaluateTemplate(binding.parts, {
          fields: instance.fields,
          invoke: (call, args) => {
            if (call.watch) {
              usedWatches.add(JSON.stringify([binding.id, call.name, args]));
            }
            return this.call(instance, call, args, [], true, binding.id);
          },
        });
        let resolved = validateAttribute(binding.attribute, value);
        if (['src', 'href'].includes(binding.attribute ?? '') && resolved !== null) {
          const reg = this.registrations.get(instance.pluginId);
          uiAssert(
            reg && typeof resolved === 'string',
            'UI_RESOURCE_DENIED',
            '资源模板需要挂载路径',
          );
          resolved = this.resource(reg, instance.cap, resolved);
        }
        updates.push({ id: binding.id, value: resolved });
      } catch (e) {
        updates.push({ id: binding.id, error: e instanceof UIError ? e.message : '数据读取失败' });
      }
    }
    ownerInstance.baseline ??= instance.baseline;
    ownerInstance.inspector = instance.inspector;
    if (ownerInstance.dataGeneration === dataGeneration) {
      for (const [key, watch] of instance.watches) {
        if (!usedWatches.has(key)) {
          watch.stop();
          instance.watches.delete(key);
        }
      }
    }
    return {
      updates,
      subscriptions: instance.compiled.expressions
        .filter((binding) => {
          let watches = false;
          for (const part of binding.parts) {
            if (typeof part !== 'string') {
              walkArgument(part, (node) => {
                if (node.type === 'call' && node.watch) {
                  watches = true;
                }
              });
            }
          }
          return watches;
        })
        .map((binding) => ({ id: binding.id, expressionBindingId: binding.id })),
    };
  }
  unsubscribe(id: string, owner: string, expressionId: string) {
    const instance = this.get(id, owner);
    uiAssert(
      instance.compiled.expressions.some((binding) => binding.id === expressionId),
      'UI_UNKNOWN_VALUE',
      '监听绑定不存在',
    );
    instance.pausedExpressions ??= new Set();
    instance.pausedExpressions.add(expressionId);
    for (const [key, watch] of instance.watches) {
      if (JSON.parse(key)[0] === expressionId) {
        watch.stop();
        instance.watches.delete(key);
      }
    }
    return { unsubscribed: true };
  }
  private async call(
    instance: Instance,
    call: CallNode,
    args: UIValue[],
    effects: ClientEffect[],
    readOnly = false,
    bindingId = '',
    event?: NormalizedUIEvent,
    depth = 0,
  ): Promise<UIValue | undefined> {
    uiAssert(depth < 8, 'UI_TRIGGER_CYCLE', '嵌套触发过深');
    this.validateCall(
      this.registrations.get(instance.pluginId),
      call.name,
      readOnly || call.watch,
      call.watch,
    );
    if (call.domain === 'frontend') {
      throw new UIError('UI_CROSS_DOMAIN_PIPE', '前端处理器不能在后端执行');
    }
    if (
      call.watch &&
      !call.name.includes(':') &&
      instance.compiled.fields.some((f) => f.name === call.name)
    ) {
      return instance.fields[call.name] ?? null;
    }
    if (call.watch && !call.name.startsWith('core:')) {
      instance.usedWatchKeys?.add(JSON.stringify([bindingId, call.name, args]));
      const key = JSON.stringify([bindingId, call.name, args]),
        previous = instance.watches.get(key);
      if (previous?.key !== key) {
        previous?.stop();
        uiAssert(instance.watches.size < UI_LIMITS.subscriptions, 'UI_QUOTA_EXCEEDED', '监听过多');
        const id = randomUUID();
        this.watchCallbacks.set(id, {owner:instance.owner,run:()=>this.invalidate(instance)});
        const response = (await this.remote(instance, 'watch.start', call.name, args, id)) as {
          hasValue: boolean;
          value: UIValue;
        };
        instance.watches.set(key, {
          key,
          stop: () => {
            this.watchCallbacks.delete(id);
            void this.remote(instance, 'watch.stop', undefined, undefined, id).catch(
              () => undefined,
            );
          },
        });
        return response.hasValue ? response.value : undefined;
      }
    }
    if (!call.name.startsWith('core:')) {
      const response = (await this.remote(
        instance,
        'handler',
        call.name,
        args,
        undefined,
        readOnly ? 'render' : 'event',
        event,
      )) as { hasValue: boolean; value: UIValue };
      return response.hasValue ? response.value : undefined;
    }
    const name = call.name.slice(5),
      first = args[0];
    const string = (v: UIValue) => {
      uiAssert(typeof v === 'string', 'UI_INVALID_VALUE_TYPE', '需要字符串');
      return v;
    };
    const array = (v: UIValue) => {
      uiAssert(Array.isArray(v), 'UI_INVALID_VALUE_TYPE', '需要数组');
      return v;
    };
    if (name === 'string.trim') {
      return string(first).trim();
    }
    if (name === 'string.lower') {
      return string(first).toLowerCase();
    }
    if (name === 'string.upper') {
      return string(first).toUpperCase();
    }
    if (name === 'string.toString') {
      uiAssert(
        first === null || typeof first !== 'object',
        'UI_INVALID_VALUE_TYPE',
        '对象需要 JSON 序列化',
      );
      return String(first);
    }
    if (name === 'number.parse') {
      const raw = string(first);
      uiAssert(
        /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw),
        'UI_INVALID_VALUE_TYPE',
        '数字格式无效',
      );
      return uiValue(Number(raw));
    }
    if (name === 'boolean.parse') {
      uiAssert(
        typeof first === 'boolean' || first === 'true' || first === 'false',
        'UI_INVALID_VALUE_TYPE',
        '布尔值无效',
      );
      return first === true || first === 'true';
    }
    if (name === 'json.parse') {
      return uiValue(JSON.parse(string(first)));
    }
    if (name === 'json.stringify') {
      return JSON.stringify(first);
    }
    if (name === 'default') {
      return first === null ? args[1] : first;
    }
    if (name === 'array.first') {
      return array(first)[0] ?? null;
    }
    if (name === 'array.length') {
      return array(first).length;
    }
    if (name === 'object.get') {
      let value = first;
      for (const part of array(args[1])) {
        const key = string(part);
        safeKey(key);
        value =
          value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key)
            ? value[key]
            : null;
      }
      return value;
    }
    if (name === 'object.pick') {
      const object = valuesObject(first);
      return Object.fromEntries(
        array(args[1]).map((key) => {
          const k = string(key);
          safeKey(k);
          return [k, object[k] ?? null];
        }),
      );
    }
    if (name === 'validate') {
      const rule = valuesObject(args[1]);
      uiAssert(
        Object.keys(rule).every((key) =>
          ['codec', 'min', 'max', 'maxLength', 'options'].includes(key),
        ),
        'UI_INVALID_CONTENT',
        '校验规则含未知字段',
      );
      if (rule.maxLength !== undefined) {
        uiAssert(string(first).length <= Number(rule.maxLength), 'UI_INVALID_VALUE_TYPE', '值过长');
      }
      if (rule.options) {
        uiAssert(
          array(rule.options).some((value) => JSON.stringify(value) === JSON.stringify(first)),
          'UI_INVALID_VALUE_TYPE',
          '值不在选项中',
        );
      }
      if (rule.codec === 'string') {
        string(first);
      }
      if (rule.codec === 'boolean') {
        uiAssert(
          typeof first === 'boolean' || first === 'true' || first === 'false',
          'UI_INVALID_VALUE_TYPE',
          '需要布尔值',
        );
      }
      if (
        rule.codec === 'number' ||
        rule.codec === 'integer' ||
        rule.min !== undefined ||
        rule.max !== undefined
      ) {
        const numeric =
          typeof first === 'number'
            ? first
            : typeof first === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(first)
              ? Number(first)
              : NaN;
        uiAssert(
          Number.isFinite(numeric) &&
            (rule.codec !== 'integer' || Number.isInteger(numeric)) &&
            (rule.min === undefined || numeric >= Number(rule.min)) &&
            (rule.max === undefined || numeric <= Number(rule.max)),
          'UI_INVALID_VALUE_TYPE',
          '数值不符合声明式规则',
        );
      }
      return first;
    }
    if (name === 'flow.stop') {
      throw new UIError('UI_FLOW_STOP', '分支结束');
    }
    if (name === 'value.read') {
      return instance.fields[string(first)] ?? null;
    }
    if (name === 'value.write') {
      const key = string(first),
        field = instance.compiled.fields.find((f) => f.name === key);
      uiAssert(field, 'UI_UNKNOWN_VALUE', '命名值不存在');
      uiAssert(
        field.kind === 'boolean'
          ? typeof args[1] === 'boolean'
          : field.kind === 'multiple'
            ? Array.isArray(args[1]) && args[1].every((v) => typeof v === 'string')
            : typeof args[1] === 'string',
        'UI_INVALID_VALUE_TYPE',
        '写入的字段值类型不匹配',
      );
      instance.fields[key] = args[1];
      effects.push({
        id: randomUUID(),
        type: 'value.write',
        args,
        instanceId: instance.id,
        renderRevision: instance.revision,
      });
      return args[1];
    }
    if (name === 'get') {
      const key = string(first);
      if (key === '') {
        return instance.inspector ?? null;
      }
      if (key.startsWith('config.')) {
        return getPluginConfig().get(instance.pluginId, key.slice(7)) ?? null;
      }
      if (key.startsWith('inspector.')) {
        const data = instance.inspector ?? (await this.inspector(instance));
        let value: UIValue = data;
        for (const segment of key.slice(10).split('.')) {
          safeKey(segment);
          value =
            value && typeof value === 'object' && !Array.isArray(value)
              ? (value[segment] ?? null)
              : null;
        }
        return value;
      }
      const reg = this.registrations.get(instance.pluginId);
      uiAssert(
        reg?.snapshot.handlers.some((h) => h.name === key && h.readOnly),
        'UI_HANDLER_NOT_FOUND',
        '数据键未注册',
      );
      return this.call(
        instance,
        { ...call, name: key },
        [],
        effects,
        true,
        bindingId,
        event,
        depth + 1,
      );
    }
    if (name === 'config.read') {
      instance.baseline ??= getPluginConfig().snapshot(instance.pluginId);
      return getPluginConfig().get(instance.pluginId, string(first)) ?? null;
    }
    if (name === 'config.write') {
      uiAssert(instance.baseline, 'UI_INVALID_CONTENT', '请先读取配置基线');
      const result = await getPluginConfig().update(
        instance.pluginId,
        { [string(first)]: string(args[1]) },
        {
          baseRevision: instance.baseline.revision,
          schemaRevision: instance.baseline.schemaRevision,
          verifiedDefinitions: true,
        },
      );
      uiAssert(
        !instance.executionDeadline || Date.now() < instance.executionDeadline,
        'UI_EXECUTION_TIMEOUT',
        '配置调用已超时，请重新读取权威状态',
      );
      instance.baseline = result;
      return result.effectiveValues[string(first)];
    }
    if (name.startsWith('inspector.config.')) {
      uiAssert(
        instance.surface === 'currentPage' && instance.baseline,
        'UI_INVALID_CONTENT',
        '只有核心模板可提交当前页面配置',
      );
      const snapshot = instance.baseline;
      if (name.endsWith('rebase') || name.endsWith('discard')) {
        instance.baseline = getPluginConfig().snapshot(instance.pluginId);
        effects.push({
          id: randomUUID(),
          type: name.endsWith('discard') ? 'config.saved' : 'config.rebased',
          args: [],
          instanceId: instance.id,
          renderRevision: instance.revision,
        });
        return plain(instance.baseline) as unknown as UIValue;
      }
      const values = Object.fromEntries(
        Object.entries(event?.values ?? {}).map(([key, value]) => {
          const configKey = instance.configFields?.get(key);
          uiAssert(configKey, 'UI_UNKNOWN_VALUE', '配置字段不属于当前模板');
          return [configKey, typeof value === 'boolean' ? String(value) : string(value)];
        }),
      );
      const keys = [...(instance.configFields?.values() ?? [])];
      const result = await getPluginConfig().update(
        instance.pluginId,
        name.endsWith('reset') ? {} : values,
        {
          baseRevision: snapshot.revision,
          schemaRevision: snapshot.schemaRevision,
          reset: name.endsWith('reset') ? keys : undefined,
          verifiedDefinitions: true,
        },
      );
      uiAssert(
        !instance.executionDeadline || Date.now() < instance.executionDeadline,
        'UI_EXECUTION_TIMEOUT',
        '配置调用已超时，请重新读取权威状态',
      );
      instance.baseline = result;
      effects.push({
        id: randomUUID(),
        type: 'config.saved',
        args: [],
        instanceId: instance.id,
        renderRevision: instance.revision,
      });
      return plain(result) as unknown as UIValue;
    }
    if (name === 'event.trigger') {
      const target = instance.compiled.nodes
        .flatMap(function all(n): typeof instance.compiled.nodes {
          return [n, ...(n.children ?? []).flatMap(all)];
        })
        .find((n) => n.attrs?.name === first);
      const binding = instance.compiled.events.find(
        (b) => b.nodeId === target?.id && b.event === args[1],
      );
      uiAssert(binding, 'UI_UNKNOWN_VALUE', '目标事件不存在');
      uiAssert(
        binding.program.branches.every((chain) => chain.every((c) => c.domain === 'backend')),
        'UI_CROSS_DOMAIN_PIPE',
        '嵌套触发不能跨域',
      );
      const values = Object.fromEntries(binding.capture.map((key) => [key, instance.fields[key]]));
      const associated = binding.for.length
        ? binding.for
        : instance.compiled.fields.filter((f) => f.nodeId === binding.nodeId).map((f) => f.name);
      const nextEvent: NormalizedUIEvent = {
        type: binding.event,
        name: target?.attrs?.name,
        values: values as never,
        ...(associated.length === 1 ? { value: instance.fields[associated[0]] as never } : {}),
      };
      return this.run(instance, binding.program.branches, nextEvent, effects, depth + 1);
    }
    if (effectNames.has(name)) {
      if (
        [
          'clipboard.writeText',
          'link.openExternal',
          'notification.show',
          'page.open',
          'element.focus',
          'section.toggle',
          'scroll.to',
        ].includes(name)
      ) {
        string(first);
      }
      if (name === 'link.openExternal') {
        const url = new URL(string(first));
        uiAssert(
          ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
          'UI_RESOURCE_DENIED',
          '外链只允许 HTTP/HTTPS',
        );
      }
      if (name === 'notification.show') {
        uiAssert(
          args[1] === undefined ||
            ['info', 'success', 'warning', 'error'].includes(String(args[1])),
          'UI_INVALID_VALUE_TYPE',
          '通知级别无效',
        );
      }
      if (name === 'view.open' || name === 'view.refresh') {
        uiAssert(
          ['mainSidebar', 'auxiliarySidebar'].includes(string(first)) &&
            this.registrations
              .get(instance.pluginId)
              ?.snapshot.views.some((v) => v.surface === first && v.definition.id === args[1]),
          'UI_UNKNOWN_VALUE',
          '只能打开所属插件的已注册视图',
        );
      }

      effects.push({
        id: randomUUID(),
        type: name,
        args,
        instanceId: instance.id,
        renderRevision: instance.revision,
      });
      return null;
    }
    throw new UIError('UI_HANDLER_NOT_FOUND', '处理器不存在');
  }
  watchChanged(owner:string,id:string){const callback=this.watchCallbacks.get(id);if(callback?.owner===owner){callback.run();}}
  private async callBefore(
    instance: Instance,
    call: CallNode,
    args: UIValue[],
    effects: ClientEffect[],
    event: NormalizedUIEvent,
    depth: number,
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new UIError('UI_EXECUTION_TIMEOUT', '事件执行超过总预算，未知结果不会重放')),
        Math.max(1, (instance.executionDeadline ?? Date.now() + 10000) - Date.now()),
      );
      timer.unref();
    });
    try {
      return await Promise.race([
        this.call(instance, call, args, effects, false, '', event, depth),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async run(
    instance: Instance,
    branches: CallNode[][],
    event: NormalizedUIEvent,
    effects: ClientEffect[],
    depth = 0,
  ) {
    const renderRevision = instance.revision;
    instance.executionDeadline ??= Date.now() + 10000;
    const registryRevision = this.registrations.get(instance.pluginId)?.revision ?? 0;
    let result: UIValue | undefined;
    let steps = 0;
    const initial = plain(instance.fields);
    for (const [branchIndex, chain] of branches.entries()) {
      instance.fields = plain(initial);
      const branchEffects: ClientEffect[] = [];
      let prev: UIValue | undefined;
      for (const [stepIndex, step] of chain.entries()) {
        uiAssert(++steps <= 64, 'UI_QUOTA_EXCEEDED', '调用步骤过多');
        uiAssert(
          Date.now() < instance.executionDeadline &&
            instance.revision === renderRevision &&
            !instance.controller.signal.aborted &&
            (this.registrations.get(instance.pluginId)?.revision ?? 0) === registryRevision,
          'UI_STALE_RENDER',
          '执行期间模板已变化',
        );
        try {
          prev = await evaluateArgument(step, {
            event: plain(event) as unknown as UIValue,
            prev,
            fields: instance.fields,
            invoke: (call, args) =>
              this.callBefore(instance, call, args, branchEffects, event, depth),
          });
          uiAssert(
            Date.now() < instance.executionDeadline &&
              instance.revision === renderRevision &&
              !instance.controller.signal.aborted &&
              (this.registrations.get(instance.pluginId)?.revision ?? 0) === registryRevision,
            'UI_STALE_RENDER',
            '执行期间模板已变化',
          );
        } catch (error) {
          if (error instanceof UIError && error.code === 'UI_FLOW_STOP') {
            break;
          }
          throw new UIExecutionFailure(error, branchIndex, stepIndex, branchIndex);
        }
      }
      effects.push(...branchEffects);
      result = prev;
    }
    return result;
  }
  private async advance(token: string) {
    const job = this.continuations.get(token);
    uiAssert(job, 'UI_STALE_INSTANCE', '前端调用已经结束');
    const effects: ClientEffect[] = [];
    try {
      uiAssert(
        this.instances.get(job.instance.id) === job.instance && Date.now() < job.deadline&&job.instance.revision===job.renderRevision&&(this.registrations.get(job.instance.pluginId)?.revision??0)===job.registryRevision,
        'UI_EXECUTION_TIMEOUT',
        '调用已过期',
      );
      while (job.next < job.branches.length) {
        const chain = job.branches[job.next++];
        job.instance.fields = plain(job.initial);
        if (chain[0].domain === 'frontend') {
          if (!job.instance.sourceTabId) {
            const result = { status: 'unavailable', result: UI_UNAVAILABLE, effects };
            this.closeContinuation(token, result);
            return result;
          }
          const phase=randomUUID();this.frontendAcks.set(phase,{job:token,instanceId:job.instance.id,windowId:job.instance.windowId,created:Date.now()});
          return {
            status: 'frontend',
            continuation: phase,
            branches: [chain],
            event: job.event,
            fields: job.initial,
            effects,
            sourceTabId: job.instance.sourceTabId,
            sourceFrameEpoch: job.instance.sourceFrameEpoch,
          };
        }
        job.result = await this.run(job.instance, [chain], job.event, effects);job.completed++;
      }
      job.effects.push(...effects);
      const result = {
        status: 'succeeded',
        ...(job.result === undefined ? {} : { result: job.result }),
        effects:job.effects,
      };
      this.closeContinuation(token, result);
      return result;
    } catch (error) {
      job.effects.push(...effects);
      const result = {
        status: job.completed ? 'partial' : 'failed',
        effects:job.effects,
        error: error instanceof UIError ? error.message : '处理器执行失败',
      };
      this.closeContinuation(token, result);
      return result;
    }
  }
  private closeContinuation(token: string, result: unknown) {
    const job = this.continuations.get(token);
    if (!job) {
      return;
    }
    this.continuations.delete(token);
    const receipt = job.instance.events.get(job.eventId);
    if (receipt) {
      receipt.promise = Promise.resolve(result);
    }
    job.finish();
  }
  continueEvent(id:string,owner:string,token:string,succeeded:boolean){
    const instance = this.get(id, owner);
    const ack = this.frontendAcks.get(token);
    uiAssert(
      ack &&
        ack.instanceId === instance.id &&
        ack.windowId === owner &&
        Date.now() - ack.created <= 300000,
      'UI_STALE_INSTANCE',
      '前端阶段回执已失效',
    );
    if (ack.promise) {
      return ack.promise;
    }
    const job = this.continuations.get(ack.job);
    uiAssert(job?.instance === instance, 'UI_STALE_INSTANCE', '调用已结束');
    if (!succeeded) {
      const result = { status: 'failed', effects: [], error: '前端处理器执行失败' };
      this.closeContinuation(ack.job, result);
      ack.promise = Promise.resolve(result);
    } else {
      ack.promise = this.advance(ack.job);
    }
    return ack.promise;
  }
  execute(
    id: string,
    windowId: string,
    body: {
      eventId: string;
      bindingId: string;
      renderRevision: number;
      fields: unknown;
      event?: NormalizedUIEvent;
    },
  ) {
    for (const [token, ack] of this.frontendAcks) {
      if (Date.now() - ack.created > 300000) {
        this.frontendAcks.delete(token);
      }
    }
    const instance = this.get(id, windowId);
    uiAssert(
      (this.registrations.get(instance.pluginId)?.revision ?? 0) === instance.registryRevision,
      'UI_STALE_HANDLERS',
      '处理器注册版本已变化',
    );
    uiAssert(body.renderRevision === instance.revision, 'UI_STALE_RENDER', '模板已变化');
    const binding = instance.compiled.events.find((b) => b.id === body.bindingId);
    uiAssert(binding, 'UI_INVALID_PROGRAM', '事件绑定不存在');
    uiAssert(
      typeof body.eventId === 'string' && body.eventId.length <= 100,
      'UI_INVALID_PROGRAM',
      '事件标识无效',
    );
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      existing = instance.events.get(body.eventId);
    if (existing) {
      uiAssert(existing.hash === hash, 'UI_EVENT_ID_CONFLICT', '事件 ID 冲突');
      return existing.promise;
    }
    uiAssert(instance.pending < 32, 'UI_QUOTA_EXCEEDED', '事件队列已满');
    instance.pending++;
    let releaseGate = () => {
      /* Backend-only events do not need a continuation gate. */
    };
    const gate = binding.program.branches.some((chain) => chain[0].domain === 'frontend')
      ? new Promise<void>((resolve) => {
          releaseGate = resolve;
        })
      : undefined;
    const task = async () => {
      uiAssert(
        this.instances.get(id) === instance && !instance.controller.signal.aborted,
        'UI_STALE_INSTANCE',
        '实例已释放',
      );
      instance.executionDeadline = Date.now() + 10000;
      instance.fields = this.capture(instance, body.fields, [...new Set(binding.capture)]);
      const values = Object.fromEntries(binding.capture.map((key) => [key, instance.fields[key]]));
      const event: NormalizedUIEvent = {
        type:
          binding.event === 'mouseenter' || binding.event === 'mouseleave'
            ? 'hover'
            : binding.event,
        values: values as never,
      };
      if (binding.event === 'mouseenter' || binding.event === 'mouseleave') {
        event.phase = binding.event === 'mouseenter' ? 'enter' : 'leave';
      }
      const node = instance.compiled.nodes
        .flatMap(function all(n): typeof instance.compiled.nodes {
          return [n, ...(n.children ?? []).flatMap(all)];
        })
        .find((n) => n.id === binding.nodeId);
      if (node?.attrs?.name) {
        event.name = node.attrs.name;
      }
      const associated = binding.for.length
        ? binding.for
        : instance.compiled.fields.filter((f) => f.nodeId === binding.nodeId).map((f) => f.name);
      if (associated.length === 1) {
        event.value = instance.fields[associated[0]] as never;
      }
      if (body.event?.modifiers) {
        event.modifiers = {
          alt: body.event.modifiers.alt === true,
          ctrl: body.event.modifiers.ctrl === true,
          meta: body.event.modifiers.meta === true,
          shift: body.event.modifiers.shift === true,
        };
      }
      const effects: ClientEffect[] = [];
      if (
        binding.program.branches.some((chain) => chain.some((call) => call.domain === 'frontend'))
      ) {
        const token = randomUUID();
        const finish = releaseGate;
        const timer = setTimeout(
          () =>
            this.closeContinuation(token, { status: 'failed', error: '前端调用超时', effects: [] }),
          10000,
        );
        timer.unref();
        this.continuations.set(token, {
          instance,
          eventId: body.eventId,
          branches: binding.program.branches,
          next: 0,completed:0,effects:[],renderRevision:instance.revision,registryRevision:instance.registryRevision??0,
          event,
          initial: plain(instance.fields),
          deadline: Date.now() + 10000,
          finish: () => {
            clearTimeout(timer);
            finish();
          },
        });
        return this.advance(token);
      }
      try {
        const result = await this.run(instance, binding.program.branches, event, effects);
        return {
          status: 'succeeded',
          completedBranches: binding.program.branches.length,
          ...(result === undefined ? {} : { result }),
          effects,
        };
      } catch (error) {
        if (!(error instanceof UIExecutionFailure)) {
          throw error;
        }
        return {
          status: error.completedBranches ? 'partial' : 'failed',
          completedBranches: error.completedBranches,
          effects,
          error: {
            code: error.code,
            branch: error.branch,
            step: error.step,
            message: error.message,
          },
        };
      }
    };
    const promise = instance.queue.then(task).finally(() => {
      instance.pending--;
    });
    instance.queue = promise.then(
      async () => {
        if (gate) {
          await gate;
        }
      },
      () => {
        releaseGate();
      },
    );
    instance.events.set(body.eventId, { hash, promise });
    while (instance.events.size > 1024) {
      const oldest = instance.events.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      instance.events.delete(oldest);
    }
    return promise;
  }
  release(id: string) {
    const instance = this.instances.get(id);
    if (!instance) {
      return;
    }
    for (const [token, job] of this.continuations) {
      if (job.instance === instance) {
        this.closeContinuation(token, { status: 'cancelled', effects: [] });
      }
    }
    instance.controller.abort();
    for (const [token, ack] of this.frontendAcks) {
      if (ack.instanceId === instance.id) {
        this.frontendAcks.delete(token);
      }
    }
    for (const w of instance.watches.values()) {
      w.stop();
    }
    this.instances.delete(id);
  }
  async asset(pluginId: string, owner: string, assetPath: string, cap: string) {
    const instance = [...this.instances.values()].find(
      (i) => i.pluginId === pluginId && i.owner === owner && i.cap === cap,
    );
    const iconTicket = this.iconTickets.get(cap);
    uiAssert(
      instance ||
        (iconTicket &&
          iconTicket.owner === owner &&
          iconTicket.pluginId === pluginId &&
          iconTicket.expires > Date.now() &&
          iconTicket.paths.has(assetPath)),
      'UI_RESOURCE_DENIED',
      '资源票据已失效',
    );
    const reg = this.registrations.get(pluginId);
    uiAssert(reg?.owner === owner, 'UI_RESOURCE_DENIED', '插件已重载');
    const normalized = '/' + assetPath;
    this.resource(reg, cap, normalized);
    const mount = reg.snapshot.mounts
      .filter((m) => normalized === m.path || normalized.startsWith(m.path + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    uiAssert(mount, 'UI_RESOURCE_DENIED', '资源未挂载');
    const rootPath = mount.file ?? mount.directory;
    uiAssert(rootPath, 'UI_RESOURCE_DENIED', '挂载路径缺失');
    const root = await fs.realpath(rootPath),
      file = await fs.realpath(
        mount.file ?? path.resolve(root, '.' + normalized.slice(mount.path.length)),
      );
    const relative = path.relative(root, file);
    uiAssert(
      !relative.startsWith('..') && !path.isAbsolute(relative),
      'UI_RESOURCE_DENIED',
      '资源超出挂载范围',
    );
    const ext = path.extname(file).toLowerCase();
    const mime: Record<string, string> = {
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    };
    uiAssert(mime[ext], 'UI_RESOURCE_DENIED', '资源类型不允许');
    const data = await fs.readFile(file);
    uiAssert(data.length <= 524288, 'UI_QUOTA_EXCEEDED', '资源过大');
    if (ext === '.css') {
      return {
        type: mime[ext],
        data: Buffer.from(
          compileCSS(data.toString(), (raw) =>
            this.resource(reg, cap, raw, path.posix.dirname(normalized) + '/'),
          ),
        ),
      };
    }
    if (ext === '.svg') {
      const { JSDOM } = await import('jsdom');
      const { default: purify } = await import('dompurify');
      const dom = new JSDOM('');
      try {
        return {
          type: mime[ext],
          data: Buffer.from(
            purify(dom.window).sanitize(data.toString(), {
              USE_PROFILES: { svg: true },
              FORBID_TAGS: [
                'foreignObject',
                'animate',
                'animateMotion',
                'animateTransform',
                'set',
                'image',
                'use',
              ],
              FORBID_ATTR: ['href', 'xlink:href', 'style'],
            }),
          ),
        };
      } finally {
        dom.window.close();
      }
    }
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(data);
    uiAssert(
      detected && detected.mime === mime[ext],
      'UI_RESOURCE_DENIED',
      '资源内容与扩展名不匹配',
    );
    return { type: mime[ext], data };
  }
}
export const declarativeUI = new DeclarativeUIService();
